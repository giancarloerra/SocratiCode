// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  EXTRA_EXTENSIONS,
  hashContent,
  MAX_GRAPH_FILE_BYTES,
  SOCRATICODE_VERSION,
} from "../../src/constants.js";
import {
  buildCodeGraph,
  currentGraphCapabilities,
  ensureDynamicLanguages,
  gdscriptParserAvailable,
  getDynamicLanguageStatus,
} from "../../src/services/code-graph.js";
import { ensureElixirTemplateParsers } from "../../src/services/elixir-templates.js";
import {
  decideGraphRebuild,
  GRAPH_INPUTS_VERSION,
  type GraphChangeSummary,
  type GraphInputRecord,
  graphCapabilitiesHash,
} from "../../src/services/graph-inputs.js";
import {
  addFileToFixture,
  canTestPermissionDenied,
  createFixtureProject,
  type FixtureProject,
  oversizedTs,
} from "../helpers/fixtures.js";

/**
 * The gate that decides whether an incremental update has to rebuild the graph
 * (issue #163). Every case here is one the record has to answer for: a source
 * file, a manifest the resolver reads but the index need not hold, an ignore
 * file, a configuration change, an addition the index cannot see, a removal,
 * an input that stopped being readable, and a record written before any of
 * this existed.
 *
 * The ones that make the rest worth having are the two skips — if those ever
 * start rebuilding, the feature is gone while every other test here passes.
 */
describe("graph input invalidation", () => {
  let fixture: FixtureProject;
  let record: GraphInputRecord;

  const GITIGNORE = "ignored/\n*.log\n";
  const GO_MOD = "module example.com/app\n\ngo 1.22\n";
  const NOTES = "just prose, nothing a grammar would take\n";

  /** Nothing changed, and nothing is known from the index: everything is read. */
  const quiet = (): GraphChangeSummary => ({
    hasAdditions: false,
    changed: new Map(),
    removed: new Set(),
    unreadable: new Set(),
    knownHash: () => undefined,
  });

  const decide = async (stored: unknown, change: GraphChangeSummary = quiet()) =>
    decideGraphRebuild(
      fixture.root,
      stored,
      change,
      EXTRA_EXTENSIONS,
      await currentGraphCapabilities(),
    );

  const at = (relativePath: string) => path.join(fixture.root, relativePath);

  beforeAll(async () => {
    ensureDynamicLanguages();
    fixture = createFixtureProject("graph-inputs");
    addFileToFixture(fixture.root, ".gitignore", GITIGNORE);
    addFileToFixture(fixture.root, "ignored/hidden.ts", "export const hidden = 1;\n");
    addFileToFixture(fixture.root, "go.mod", GO_MOD);
    addFileToFixture(fixture.root, "cmd/main.go", "package main\n\nfunc main() {}\n");
    addFileToFixture(fixture.root, "README.md", "# docs\n");
    addFileToFixture(fixture.root, "NOTES", NOTES);
    addFileToFixture(fixture.root, "src/huge.ts", oversizedTs());
    // A virtualenv the walk must exclude by its marker rather than by name:
    // `/venv` and `/env` are anchored at the root, so one nested under a
    // package is recognised only by the `pyvenv.cfg` inside it.
    addFileToFixture(fixture.root, "backend/app.py", "x = 1\n");
    addFileToFixture(fixture.root, "backend/env/pyvenv.cfg", "home = /usr\n");
    addFileToFixture(fixture.root, "backend/env/site.py", "y = 2\n");

    record = (await buildCodeGraph(fixture.root)).graphInputs;
  });

  afterAll(() => fixture.cleanup());

  describe("what the build reports", () => {
    it("records the source it parsed, and the manifest and ignore file it read", () => {
      expect(record.version).toBe(GRAPH_INPUTS_VERSION);
      expect(record.builtByVersion).toBe(SOCRATICODE_VERSION);
      expect(record.files["src/index.ts"]).toBe(
        hashContent(fs.readFileSync(at("src/index.ts"), "utf-8")),
      );
      // Neither of these is ever a graph node: `go.mod` is walked to for module
      // paths and `.gitignore` decides what the walk sees at all. A record of
      // graph *nodes* would hold neither, which is the hole this is here for.
      expect(record.files["go.mod"]).toBe(hashContent(GO_MOD));
      expect(record.files[".gitignore"]).toBe(hashContent(GITIGNORE));
    });

    it("leaves out what it never read", () => {
      // A markdown file has no grammar and is not an extra extension, so the
      // build never opens it — and a commit touching only this must not cost a
      // rebuild. An ignored file is not read either.
      expect(record.files["README.md"]).toBeUndefined();
      expect(record.presence["README.md"]).toBeUndefined();
      expect(record.files["ignored/hidden.ts"]).toBeUndefined();
    });

    it("records a file it could not read by size rather than by hash", () => {
      // Too large to read is still a classification the build made, and the
      // size is what made it: shrink the file under the limit and it becomes a
      // node. There is no hash to compare, so the size is what is watched.
      expect(record.files["src/huge.ts"]).toBeUndefined();
      expect(record.presence["src/huge.ts"]).toBeGreaterThan(MAX_GRAPH_FILE_BYTES);
    });

    it("records an extensionless file it head-read and turned away, by that head", () => {
      // Only the head was read, so only the head can be watched — a whole-file
      // hash would describe bytes the decision never saw, and a size would miss
      // a same-length edit that flips the answer.
      expect(record.heads.NOTES).toBe(hashContent(NOTES));
      expect(record.files.NOTES).toBeUndefined();
      expect(record.presence.NOTES).toBeUndefined();
    });

    it("records a file it tried to open and could not", () => {
      // Separate from `presence`, which is a file it deliberately did not open.
      // There is no size here the build ever saw — only whether it can be read.
      expect(record.unreadable).toEqual(expect.arrayContaining(["jsconfig.json"]));
    });

    it("records every directory the walk listed", () => {
      // The listing is the only read that can speak for a file which does not
      // exist yet, so it is the whole of the addition story for anything the
      // index does not hold.
      expect(Object.keys(record.directories)).toEqual(
        expect.arrayContaining([".", "src", "src/utils", "lib", "cmd"]),
      );
      // The walk never entered an ignored directory, so it has no listing.
      expect(record.directories.ignored).toBeUndefined();
    });
  });

  describe("the decision", () => {
    it("leaves the graph alone when nothing it read changed", async () => {
      await expect(decide(record)).resolves.toEqual({
        rebuild: false,
        reason: "no graph input changed",
        graphExists: true,
      });
    });

    it("leaves the graph alone for a change to a file the build never read", async () => {
      // The case the whole feature exists for: a README, a fixture, a
      // migration — indexed, changed, and not an input to the graph.
      const change = {
        ...quiet(),
        changed: new Map([["README.md", hashContent("# rewritten\n")]]),
      };
      await expect(decide(record, change)).resolves.toMatchObject({ rebuild: false });
    });

    it("leaves the graph alone when an ignored file appears where the walk looked", async () => {
      // The directory check must not fire on a `.DS_Store`, an editor lock, or
      // anything else the filter excludes — otherwise the skip never happens in
      // practice and the feature is theatre.
      fs.writeFileSync(at("src/debug.log"), "noise\n");
      try {
        await expect(decide(record)).resolves.toMatchObject({ rebuild: false });
      } finally {
        fs.unlinkSync(at("src/debug.log"));
      }
    });

    it("rebuilds when a file the index never holds appears where the build looked", async () => {
      // The case no other bucket can answer. A nested `go.mod` has no indexable
      // extension — `.mod` is in neither SUPPORTED_EXTENSIONS nor SPECIAL_FILES
      // — so the index reports no addition, and the record cannot hold a path
      // that did not exist when the build ran. Only the directory listing moves.
      fs.writeFileSync(at("lib/go.mod"), "module example.com/lib\n");
      try {
        await expect(decide(record)).resolves.toEqual({
          rebuild: true,
          reason: "files appeared or vanished in: lib",
          graphExists: true,
        });
      } finally {
        fs.unlinkSync(at("lib/go.mod"));
      }
    });

    it("rebuilds when something it could not open becomes readable", async () => {
      // `jsconfig.json` does not exist, so the alias loader looked and got
      // nothing. Creating one changes the aliases, and no other bucket moves —
      // the directory listing would catch this one, but a file that was there
      // all along and merely unreadable has no entry-name change at all.
      const crafted = { ...record, unreadable: ["README.md"] };
      await expect(decide(crafted)).resolves.toEqual({
        rebuild: true,
        reason: "graph input became readable: README.md",
        graphExists: true,
      });
    });

    it.skipIf(!canTestPermissionDenied)(
      "records a manifest it could not read, and rebuilds when it can",
      async () => {
        const manifest = at("go.mod");
        fs.chmodSync(manifest, 0o000);
        try {
          const denied = (await buildCodeGraph(fixture.root)).graphInputs;
          expect(denied.unreadable).toEqual(expect.arrayContaining(["go.mod"]));
          expect(denied.files["go.mod"]).toBeUndefined();

          fs.chmodSync(manifest, 0o644);
          await expect(decide(denied)).resolves.toMatchObject({
            rebuild: true,
            reason: "graph input became readable: go.mod",
          });
        } finally {
          fs.chmodSync(manifest, 0o644);
        }
      },
    );

    it.skipIf(!canTestPermissionDenied)(
      "records an environment root it could not list as a directory, not a file",
      async () => {
        // The environment-root listing is a `readdir` like any other, so a
        // failure belongs in the bucket that is re-checked with a `readdir`.
        // 0o111: executable but not readable, so the marker inside it still
        // stats — the filter still calls it an environment, which is what
        // sends this down the environment-root loop — while the `readdir`
        // that loop makes fails. At 0o000 the marker is unstattable, the
        // filter stops calling it an environment, and the *walk* records the
        // failure instead, which is a different path proving nothing here.
        const env = at("backend/env");
        fs.chmodSync(env, 0o111);
        try {
          const denied = (await buildCodeGraph(fixture.root)).graphInputs;
          expect(denied.unreadableDirectories).toEqual(expect.arrayContaining(["backend/env"]));
          expect(denied.unreadable).not.toContain("backend/env");

          fs.chmodSync(env, 0o755);
          await expect(decide(denied)).resolves.toMatchObject({
            rebuild: true,
            reason: "graph input directory became listable: backend/env",
          });
        } finally {
          fs.chmodSync(env, 0o755);
        }
      },
    );

    it("rebuilds when a virtualenv marker is removed and its subtree becomes visible", async () => {
      // The filter recognises `backend/env/` by the `pyvenv.cfg` inside it, and
      // the marker is not a file any bucket hashes. Removing it re-admits the
      // whole subtree — caught because `backend`'s kept listing gains `env/`.
      const marker = at("backend/env/pyvenv.cfg");
      const kept = fs.readFileSync(marker, "utf-8");
      fs.unlinkSync(marker);
      try {
        await expect(decide(record)).resolves.toMatchObject({
          rebuild: true,
          reason: "files appeared or vanished in: backend/env",
        });
      } finally {
        fs.writeFileSync(marker, kept);
      }
    });

    it("rebuilds when extensionless indexing is switched off under it", async () => {
      // It decides whether an extensionless file can be a node at all, so it
      // moves the node set with nothing on disk changing.
      const before = process.env.INDEX_EXTENSIONLESS;
      process.env.INDEX_EXTENSIONLESS = "false";
      try {
        await expect(decide(record)).resolves.toMatchObject({
          rebuild: true,
          reason: "graph configuration changed since the last build",
        });
      } finally {
        if (before === undefined) delete process.env.INDEX_EXTENSIONLESS;
        else process.env.INDEX_EXTENSIONLESS = before;
      }
    });

    it("rebuilds when the parsers available to the build change", async () => {
      // Optional grammars and the GDScript addon ship platform-specific
      // prebuilds, so the same version on another host can extract different
      // imports from byte-identical sources. A grammar becoming available is
      // the case that matters: the graph is missing every edge it would find.
      await expect(
        decideGraphRebuild(
          fixture.root,
          record,
          quiet(),
          EXTRA_EXTENSIONS,
          "0000000000000000",
        ),
      ).resolves.toEqual({
        rebuild: true,
        reason: "the parsers available to the build changed",
        graphExists: true,
      });
    });

    it("counts the HEEx/EEx parser mode as a capability of its own", async () => {
      // The template grammars are a separate WASM load from the ast-grep ones,
      // and both import and symbol extraction fall back to a line/leaf
      // approximation without them — so a fingerprint that ignored them would
      // let a graph built under the fallback be reused once they arrived.
      const base = { loadedGrammars: ["go", "python"], gdscript: false };
      expect(graphCapabilitiesHash({ ...base, elixirTemplates: true })).not.toBe(
        graphCapabilitiesHash({ ...base, elixirTemplates: false }),
      );
      // And the live fingerprint moves with it, rather than being computed
      // from the grammar names alone.
      expect(await currentGraphCapabilities()).toBe(
        graphCapabilitiesHash({
          loadedGrammars: getDynamicLanguageStatus().loaded,
          gdscript: gdscriptParserAvailable,
          elixirTemplates: await ensureElixirTemplateParsers(),
        }),
      );
    });

    it.skipIf(!canTestPermissionDenied)(
      "records a directory it could not list, and rebuilds when it can",
      async () => {
        // The parent's listing holds this directory's name either way, so a
        // subtree that becomes listable would otherwise add nodes with nothing
        // recorded having moved. Re-checked with a readdir, not a file read.
        const locked = at("lib/private");
        fs.mkdirSync(locked, { recursive: true });
        fs.writeFileSync(path.join(locked, "hidden.ts"), "export const x = 1;\n");
        fs.chmodSync(locked, 0o000);
        try {
          const denied = (await buildCodeGraph(fixture.root)).graphInputs;
          expect(denied.unreadableDirectories).toEqual(expect.arrayContaining(["lib/private"]));
          expect(denied.directories["lib/private"]).toBeUndefined();
          // A directory, so it must not have landed in the file bucket, whose
          // recovery test is a readability check rather than a listing.
          expect(denied.unreadable).not.toContain("lib/private");

          fs.chmodSync(locked, 0o755);
          await expect(decide(denied)).resolves.toMatchObject({
            rebuild: true,
            reason: "graph input directory became listable: lib/private",
          });
        } finally {
          fs.chmodSync(locked, 0o755);
          fs.rmSync(locked, { recursive: true, force: true });
        }
      },
    );

    it("keeps a custom-extension leaf across an update without a false mismatch", async () => {
      // The extras the index was built with have to reach the graph build and
      // the decision alike: a leaf admitted by `.md` must survive, and asking
      // under the same set must not read as a configuration change.
      const extras = new Set([".md"]);
      const withLeaf = (await buildCodeGraph(fixture.root, extras)).graphInputs;

      expect(withLeaf.presence["README.md"]).toBeDefined();
      await expect(
        decideGraphRebuild(fixture.root, withLeaf, quiet(), extras, await currentGraphCapabilities()),
      ).resolves.toMatchObject({ rebuild: false });
    });

    it("keeps skipping, and keeps the record untouched, when only ignored entries moved", async () => {
      // The stale cheap hash costs every later decision one ignore-filter
      // build until the next real rebuild. Nothing is written back for it: the
      // record is owned by the graph save, and a second writer racing a
      // concurrent rebuild would replace a newer graph's inputs with an older
      // graph's. Asked twice, the answer is the same both times.
      fs.writeFileSync(at("src/debug.log"), "noise\n");
      try {
        await expect(decide(record)).resolves.toEqual({
          rebuild: false,
          reason: "no graph input changed",
          graphExists: true,
        });
        await expect(decide(record)).resolves.toMatchObject({ rebuild: false });
      } finally {
        fs.unlinkSync(at("src/debug.log"));
      }
    });

    it("rebuilds when a source file the index reported changed is a recorded input", async () => {
      const change = {
        ...quiet(),
        changed: new Map([["src/index.ts", hashContent("something else entirely")]]),
      };
      await expect(decide(record, change)).resolves.toEqual({
        rebuild: true,
        reason: "graph input changed: src/index.ts",
        graphExists: true,
      });
    });

    it("rebuilds when a manifest changes, with nothing from the index to say so", async () => {
      // `go.mod` need not be in the index at all, so the changed set is empty
      // here and the decision has to find it by reading the file itself.
      fs.writeFileSync(at("go.mod"), "module example.com/renamed\n\ngo 1.22\n");
      try {
        await expect(decide(record)).resolves.toEqual({
          rebuild: true,
          reason: "graph input changed: go.mod",
          graphExists: true,
        });
      } finally {
        fs.writeFileSync(at("go.mod"), GO_MOD);
      }
    });

    it("rebuilds when an ignore file changes, which changes what discovery sees", async () => {
      fs.writeFileSync(at(".gitignore"), "");
      try {
        await expect(decide(record)).resolves.toEqual({
          rebuild: true,
          reason: "graph input changed: .gitignore",
          graphExists: true,
        });
      } finally {
        fs.writeFileSync(at(".gitignore"), GITIGNORE);
      }
    });

    it("rebuilds when the head of a turned-away extensionless file changes", async () => {
      // Still not code, so it is still turned away — but the bytes the decision
      // was made on have moved, and the next one could land differently.
      fs.writeFileSync(at("NOTES"), "different prose entirely, still not code\n");
      try {
        await expect(decide(record)).resolves.toEqual({
          rebuild: true,
          reason: "graph input changed: NOTES",
          graphExists: true,
        });
      } finally {
        fs.writeFileSync(at("NOTES"), NOTES);
      }
    });

    it("rebuilds when the configuration the build ran under changes", async () => {
      const before = process.env.INCLUDE_DOT_FILES;
      process.env.INCLUDE_DOT_FILES = "true";
      try {
        await expect(decide(record)).resolves.toMatchObject({
          rebuild: true,
          reason: "graph configuration changed since the last build",
        });
      } finally {
        if (before === undefined) delete process.env.INCLUDE_DOT_FILES;
        else process.env.INCLUDE_DOT_FILES = before;
      }
    });

    it("rebuilds when an extra extension is configured that was not in force before", async () => {
      // The same gate reached the other way: the record is unchanged and the
      // set of extensions the build would admit is not.
      const withExtras = new Set([...EXTRA_EXTENSIONS, ".md"]);
      await expect(
        decideGraphRebuild(
          fixture.root,
          record,
          quiet(),
          withExtras,
          await currentGraphCapabilities(),
        ),
      ).resolves.toMatchObject({ rebuild: true });
    });

    it("rebuilds for any addition the index did see", async () => {
      await expect(decide(record, { ...quiet(), hasAdditions: true })).resolves.toEqual({
        rebuild: true,
        reason: "files were added",
        graphExists: true,
      });
    });

    it("rebuilds when a recorded input is removed", async () => {
      const change = { ...quiet(), removed: new Set(["src/index.ts"]) };
      await expect(decide(record, change)).resolves.toEqual({
        rebuild: true,
        reason: "graph input removed: src/index.ts",
        graphExists: true,
      });
    });

    it("rebuilds when the index could not read a recorded input this run", async () => {
      // The index keeps the hash it already had, so without this the decision
      // would read that stale hash as proof the file is unchanged — while a
      // rebuild would classify it read-failed and drop its node.
      const change = { ...quiet(), unreadable: new Set(["src/index.ts"]) };
      await expect(decide(record, change)).resolves.toEqual({
        rebuild: true,
        reason: "graph input no longer readable: src/index.ts",
        graphExists: true,
      });
    });

    it("rebuilds when a recorded input is gone from disk without the index saying so", async () => {
      const kept = fs.readFileSync(at("go.mod"), "utf-8");
      fs.unlinkSync(at("go.mod"));
      try {
        await expect(decide(record)).resolves.toMatchObject({
          rebuild: true,
          reason: "graph input unreadable: go.mod",
        });
      } finally {
        fs.writeFileSync(at("go.mod"), kept);
      }
    });

    it("rebuilds when a file recorded as too large is no longer too large", async () => {
      const kept = fs.readFileSync(at("src/huge.ts"), "utf-8");
      fs.writeFileSync(at("src/huge.ts"), "export const small = 1;\n");
      try {
        await expect(decide(record)).resolves.toMatchObject({
          rebuild: true,
          reason: "graph input changed size: src/huge.ts",
        });
      } finally {
        fs.writeFileSync(at("src/huge.ts"), kept);
      }
    });

    it("prefers the index's hash over reading the file again", async () => {
      // Every recorded input is answered from the index here, so a wrong answer
      // proves the hash comparison ran rather than the read being skipped.
      const stale = { ...quiet(), knownHash: () => "0000000000000000" };
      await expect(decide(record, stale)).resolves.toMatchObject({ rebuild: true });
    });
  });

  describe("a record this build cannot use", () => {
    it("rebuilds a graph whose record is missing, however quiet the update was", async () => {
      // The compatibility rule: a graph with no usable record rebuilds once and
      // writes one. `graphExists` is true because the graph is there — it is
      // the *record* that is missing — so the caller must not suppress this on
      // an update that indexed nothing.
      await expect(decide(null)).resolves.toEqual({
        rebuild: true,
        reason: "no usable record of what the graph was built from",
        graphExists: true,
      });
      await expect(decide(undefined)).resolves.toMatchObject({
        rebuild: true,
        graphExists: true,
      });
    });

    it("rebuilds once for a record written under another shape version", async () => {
      const legacy = { ...record, version: GRAPH_INPUTS_VERSION + 1 };
      await expect(decide(legacy)).resolves.toMatchObject({ rebuild: true });
    });

    it("rebuilds once for a graph built by another SocratiCode version", async () => {
      // A persisted graph is served unchanged across upgrades, so one cut
      // before a resolver shipped keeps answering as if it had not (#120). The
      // reason names both versions rather than reading as a settings change.
      const older = { ...record, builtByVersion: "0.0.1-old" };
      await expect(decide(older)).resolves.toEqual({
        rebuild: true,
        reason: `built by SocratiCode 0.0.1-old, running ${SOCRATICODE_VERSION}`,
        graphExists: true,
      });
    });

    it("rebuilds once for a record that is malformed rather than merely old", async () => {
      await expect(decide({ version: GRAPH_INPUTS_VERSION })).resolves.toMatchObject({
        rebuild: true,
      });
      await expect(decide("not json at all")).resolves.toMatchObject({ rebuild: true });
      await expect(decide({ ...record, files: { "src/index.ts": 7 } })).resolves.toMatchObject({
        rebuild: true,
      });
      await expect(decide({ ...record, directories: 3 })).resolves.toMatchObject({ rebuild: true });
    });

    it("reads a record back from the string form it is persisted as", async () => {
      // Stored as JSON beside the graph, so the string is the shape that
      // actually comes back from Qdrant — and it must decide the same way.
      await expect(decide(JSON.stringify(record))).resolves.toMatchObject({ rebuild: false });
    });
  });
});
