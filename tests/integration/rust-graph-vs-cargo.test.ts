// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCodeGraph, ensureDynamicLanguages } from "../../src/services/code-graph.js";

// Every other test on the Rust graph builds a tree and asserts what we believe
// is right. That is how two regressions reached `main`: our belief was wrong in
// the same way on both sides of the assertion. This one asks the compiler
// instead — it builds a crate, runs `cargo check`, and takes the dep-info cargo
// leaves behind (`target/debug/deps/*.d`) as the list of sources rustc actually
// opened. A file rustc read that our graph never reaches is a defect, whatever
// our fixtures say.
//
// The crate is deliberately dependency-free so the check needs no network, and
// it carries the shapes that were broken: a `mod` written inside a macro body,
// a `#[cfg_attr(…, path = …)]` relocation, a module named `env` — the name the
// ignore list used to delete at any depth — and a macro whose body is not items
// on its own, written inside an inline `mod`, where blanking the braces used to
// re-parent the rest of the block to file level.

function haveCargo(): boolean {
  try {
    execFileSync("cargo", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Every dep-info file (`*.d`) cargo left under `dir`, wherever it put them.
 *
 * Cargo documents its build-directory layout as an internal detail, and it has
 * moved: the new layout, always on from cargo 1.100, writes them to
 * `target/debug/build/<package>/<hash>/out/` where they used to be in
 * `target/debug/deps/`. Reading a fixed directory made this test fail with
 * ENOENT on the newer cargo even though the crate compiled, so find them by
 * extension instead.
 */
function depInfoFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...depInfoFiles(full));
    else if (entry.name.endsWith(".d")) found.push(full);
  }
  return found;
}

/** The sources rustc opened, per cargo's own dep-info, relative to the crate. */
function sourcesRustcRead(root: string): Set<string> {
  const read = new Set<string>();
  for (const file of depInfoFiles(path.join(root, "target", "debug"))) {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const colon = line.indexOf(":");
      if (colon === -1) continue;
      for (const raw of line.slice(colon + 1).trim().split(/\s+/)) {
        if (!raw.endsWith(".rs")) continue;
        // Every comparison below this — against graph edges and against
        // literals like `src/lib.rs` — is written with forward slashes, and so
        // is the `target/` guard. On Windows `path.relative` answers with the
        // platform separator, which would fail every lookup and let the build
        // directory through (review finding).
        const rel = path.relative(root, path.resolve(root, raw)).split(path.sep).join("/");
        if (!rel || rel.startsWith("..") || rel.startsWith("target/")) continue;
        read.add(rel);
      }
    }
  }
  return read;
}

const write = (root: string, rel: string, body: string): void => {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
};

// The condition is in the name because a skip is silent otherwise: vitest
// prints the title and nothing about why, and a suite that quietly stops
// running reads exactly like a suite that passes. In CI it cannot skip — the
// `rust-graph-vs-cargo` job checks `rustc --version` before it gets here.
describe.skipIf(!haveCargo())("the Rust graph against cargo's dep-info (needs cargo on PATH)", () => {
  let root: string;
  let read: Set<string>;

  beforeAll(() => {
    ensureDynamicLanguages();
    root = fs.mkdtempSync(path.join(os.tmpdir(), "socraticode-cargo-"));

    write(root, "Cargo.toml", ['[package]', 'name = "oracle"', 'version = "0.1.0"', 'edition = "2021"', "", "[dependencies]", ""].join("\n"));

    // A macro body is not a module level: it opens no scope, so `mod plain;`
    // written inside one still resolves next to the file that wrote it.
    write(
      root,
      "src/lib.rs",
      [
        "macro_rules! declare {",
        "    ($($item:item)*) => { $($item)* };",
        "}",
        "",
        "declare! {",
        "    mod hidden;",
        "}",
        "",
        "#[cfg_attr(unix, path = \"under_unix.rs\")]",
        "#[cfg_attr(windows, path = \"under_windows.rs\")]",
        "mod platform;",
        "",
        "pub mod env;",
        "",
        "include!(\"pasted.rs\");",
        "",
        // `pick!` has the shape of `cfg_if!`: arms written as an `if` carrying
        // an attribute, which is not Rust once the head and braces are blanked.
        // Spelled out here so the crate still depends on nothing.
        "macro_rules! pick {",
        "    (if #[cfg($a:meta)] { $($ia:item)* } else if #[cfg($b:meta)] { $($ib:item)* } else { $($ic:item)* }) => {",
        "        $(#[cfg($a)] $ia)*",
        "        $(#[cfg(all(not($a), $b))] $ib)*",
        "        $(#[cfg(all(not($a), not($b)))] $ic)*",
        "    };",
        "}",
        "",
        "pub mod inner {",
        "    mod before;",
        "    pick! {",
        "        if #[cfg(unix)] {",
        "            mod arm_a;",
        "        } else if #[cfg(windows)] {",
        "            mod arm_b;",
        "        } else {",
        "            mod arm_c;",
        "        }",
        "    }",
        "    mod after;",
        "",
        "    pub fn value() -> u32 {",
        "        before::value() + after::value()",
        "    }",
        "}",
        "",
        // The same shape at file level, where recovery moves nothing and the
        // declarations stay where rustc reads them. This is the case the guard
        // is drawn narrowly to keep, so the oracle has to cover it: the arm
        // this platform builds must be reached.
        "pick! {",
        "    if #[cfg(unix)] {",
        "        mod flat_unix;",
        "    } else if #[cfg(windows)] {",
        "        mod flat_windows;",
        "    } else {",
        "        mod flat_other;",
        "    }",
        "}",
        "",
        "pub fn all() -> u32 {",
        "    hidden::value() + platform::value() + env::value() + pasted() + inner::value()",
        "}",
        "",
      ].join("\n"),
    );

    write(root, "src/hidden.rs", "pub fn value() -> u32 {\n    1\n}\n");
    write(root, "src/under_unix.rs", "pub fn value() -> u32 {\n    2\n}\n");
    write(root, "src/under_windows.rs", "pub fn value() -> u32 {\n    2\n}\n");
    write(root, "src/env/mod.rs", "pub fn value() -> u32 {\n    3\n}\n");
    // Pasted rather than declared: `pasted()` is called unqualified from
    // `lib.rs` above, which only compiles because `include!` puts it there.
    write(root, "src/pasted.rs", "fn pasted() -> u32 {\n    4\n}\n");

    // The block the macro sits in. Its modules live under `src/inner/`, and the
    // arms are one per platform — only one of them is ever compiled.
    for (const name of ["before", "after", "arm_a", "arm_b", "arm_c"]) {
      write(root, `src/inner/${name}.rs`, "pub fn value() -> u32 {\n    5\n}\n");
    }
    // The bait, at the level recovery used to re-parent to. A build that
    // succeeds is the proof rustc never opens these.
    for (const name of ["arm_a", "arm_b", "arm_c", "after"]) {
      write(root, `src/${name}.rs`, `compile_error!("src/${name}.rs is never compiled");\n`);
    }
    // The file-level arms. Real modules, all three: only one is compiled, and
    // the graph is expected to draw all of them — it fixes no platform.
    for (const name of ["flat_unix", "flat_windows", "flat_other"]) {
      write(root, `src/${name}.rs`, "pub fn value() -> u32 {\n    6\n}\n");
    }

    // `--offline` because the crate declares no dependencies: nothing here
    // should ever reach the network, and asking for it makes that a failure
    // instead of a slow success.
    try {
      execFileSync("cargo", ["check", "--offline", "--quiet"], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 120_000,
      });
    } catch (err) {
      // Without this the failure surfaces as a bare non-zero exit from
      // `beforeAll`, which says nothing about the crate that would not build —
      // and the whole oracle rests on that build.
      const details = err instanceof Error && "stderr" in err ? String(err.stderr) : String(err);
      throw new Error(`the fixture crate did not compile, so there is no oracle:\n${details}`);
    }

    read = sourcesRustcRead(root);
  }, 180_000);

  afterAll(() => {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  // The arm this platform compiles. It is the one file rustc reads that the
  // graph is not expected to reach: its declaration is written inside a macro
  // body that is not items on its own, so the body is left unread — the price
  // of not drawing the three edges the next test names.
  const compiledArm = process.platform === "win32" ? "src/inner/arm_b.rs" : "src/inner/arm_a.rs";

  it("reads a dep-info that names the files rustc opened", () => {
    // Guards the oracle itself: a half-written dep-info would let every
    // assertion below pass by having nothing to check.
    expect(read.has("src/lib.rs")).toBe(true);
    expect(read.has("src/hidden.rs")).toBe(true);
    expect(read.has(compiledArm)).toBe(true);
    expect(read.size).toBeGreaterThanOrEqual(4);
  });

  it("draws no edge into the file level a recovered macro body used to spill into", async () => {
    // `pick!` has `cfg_if!`'s if/else shape, and blanking its head and braces
    // leaves the parser recovering: it closed `mod inner` after the first arm
    // and re-parented the rest to file level. The graph drew
    // `src/lib.rs -> src/arm_b.rs` twice and `src/lib.rs -> src/after.rs`,
    // three edges into `compile_error!` files that this crate's clean build
    // proves are never compiled — while `mod after;`, which does belong to the
    // block, lost the edge it should have had.
    const graph = await buildCodeGraph(root);
    const targets = new Set(graph.edges.map((e) => String(e.target)));

    for (const bait of ["src/arm_a.rs", "src/arm_b.rs", "src/arm_c.rs", "src/after.rs"]) {
      expect(read.has(bait), `${bait} must stay uncompiled for this to be a test`).toBe(false);
      expect([...targets], `edge into ${bait}`).not.toContain(bait);
    }

    // The control. Without it this test also passes with macro bodies never
    // read at all, and with the whole inline-module machinery removed.
    expect([...targets]).toContain("src/inner/before.rs");
    expect([...targets]).toContain("src/inner/after.rs");
    expect([...targets]).toContain("src/hidden.rs");
  });

  it("still reads the same shape written at file level, where nothing moved", async () => {
    // The other half of the rule, and the reason the guard tests where recovery
    // reaches instead of whether an ERROR exists at all. The same `pick!` at
    // file level leaves an ERROR on the attribute and moves nothing, so the arm
    // rustc compiles keeps its edge — cargo says which one that is.
    const graph = await buildCodeGraph(root);
    const targets = new Set(graph.edges.map((e) => String(e.target)));

    const compiled = process.platform === "win32" ? "src/flat_windows.rs" : "src/flat_unix.rs";
    expect(read.has(compiled), "cargo must have compiled this arm").toBe(true);
    expect([...targets]).toContain(compiled);

    // And the arms it does not compile are drawn too: the graph fixes no
    // platform, so both are dependencies of a build somewhere. Stated here
    // because it is the reason the test above lists its baits by name instead
    // of asking for "every file rustc did not read".
    for (const arm of ["src/flat_unix.rs", "src/flat_windows.rs", "src/flat_other.rs"]) {
      expect([...targets], `arm ${arm}`).toContain(arm);
    }
  });

  it("reaches every source rustc read, walking from the crate root", async () => {
    const graph = await buildCodeGraph(root);
    const outgoing = new Map<string, string[]>();
    for (const edge of graph.edges) {
      const from = outgoing.get(edge.source);
      if (from) from.push(edge.target);
      else outgoing.set(edge.source, [edge.target]);
    }

    const seen = new Set<string>(["src/lib.rs"]);
    const queue = ["src/lib.rs"];
    while (queue.length > 0) {
      const current = queue.pop() as string;
      for (const next of outgoing.get(current) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }

    // The compiled arm is the declared exception, and naming it rather than
    // filtering it out is what keeps this test able to fail: anything else
    // rustc reads and the graph misses still shows up here.
    const missed = [...read].filter((f) => !seen.has(f)).sort();
    expect(missed).toEqual([compiledArm]);
  });

  it("draws no edge into a file rustc never opened, apart from the other cfg arms", async () => {
    const graph = await buildCodeGraph(root);
    // The graph fixes neither platform nor feature, so it draws every arm of a
    // `cfg` choice and not just the one this machine builds: the `cfg_attr`
    // relocation and the file-level `pick!`. They are listed by name — the
    // alternative, filtering out everything rustc did not read, would let a
    // genuinely wrong edge through unnoticed.
    const otherArms =
      process.platform === "win32"
        ? ["src/under_unix.rs", "src/flat_unix.rs", "src/flat_other.rs"]
        : ["src/under_windows.rs", "src/flat_windows.rs", "src/flat_other.rs"];
    const strangers = graph.edges
      .map((e) => String(e.target))
      .filter((t) => t.endsWith(".rs") && !read.has(t) && !otherArms.includes(t));
    expect([...new Set(strangers)]).toEqual([]);
  });
});

// A workspace, for what one package may reach in another. Only what a package
// declares is in its extern prelude: a sibling the manifest never names is
// E0432 to rustc, whatever the workspace holds. The import that names the
// undeclared sibling is written under `#[cfg(any())]`, which rustc strips
// before it resolves names — so the crate builds, and the sibling carries a
// `compile_error!` that would end the build if cargo ever compiled it as a
// dependency. The graph fixes no cfg and reads the line; it must still draw
// nothing from it.
describe.skipIf(!haveCargo())("the Rust graph against cargo's dep-info, across a workspace (needs cargo on PATH)", () => {
  let root: string;
  let read: Set<string>;

  beforeAll(() => {
    ensureDynamicLanguages();
    root = fs.mkdtempSync(path.join(os.tmpdir(), "socraticode-cargo-ws-"));

    write(root, "Cargo.toml", ['[workspace]', 'members = ["app", "helper", "util", "other"]', 'resolver = "2"', ""].join("\n"));
    write(
      root,
      "app/Cargo.toml",
      [
        "[package]",
        'name = "app"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
        "[dependencies]",
        'util = { path = "../util" }',
        // Declared under its package name; its code is imported under the
        // library name it sets, which is the name cargo hands rustc.
        'other = { path = "../other" }',
        "",
      ].join("\n"),
    );
    write(
      root,
      "app/src/lib.rs",
      [
        "#[cfg(any())]",
        "use helper::Thing;",
        "",
        // Written as a `use`: a path inside an expression is not an import to
        // the graph, and this fixture is about what a `use` may reach.
        "use util::value;",
        "use otherlib::other_value;",
        "",
        "pub fn all() -> u32 {",
        "    value() + other_value()",
        "}",
        "",
      ].join("\n"),
    );
    write(
      root,
      "other/Cargo.toml",
      ['[package]', 'name = "other"', 'version = "0.1.0"', 'edition = "2021"', "", "[lib]", 'name = "otherlib"', ""].join("\n"),
    );
    write(root, "other/src/lib.rs", "pub fn other_value() -> u32 {\n    11\n}\n");
    // Another target of the same package reaches its library by the package's
    // own name, which no manifest declares.
    write(root, "app/src/bin/tool.rs", "use app::all;\n\nfn main() {\n    println!(\"{}\", all());\n}\n");
    write(root, "helper/Cargo.toml", ['[package]', 'name = "helper"', 'version = "0.1.0"', 'edition = "2021"', ""].join("\n"));
    write(root, "helper/src/lib.rs", 'compile_error!("helper is not a dependency of app and must never be compiled for it");\npub struct Thing;\n');
    write(root, "util/Cargo.toml", ['[package]', 'name = "util"', 'version = "0.1.0"', 'edition = "2021"', ""].join("\n"));
    write(root, "util/src/lib.rs", "pub fn value() -> u32 {\n    7\n}\n");

    try {
      execFileSync("cargo", ["check", "--offline", "--quiet", "-p", "app", "--bins", "--lib"], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 120_000,
      });
    } catch (err) {
      const details = err instanceof Error && "stderr" in err ? String(err.stderr) : String(err);
      throw new Error(`the fixture workspace did not compile, so there is no oracle:\n${details}`);
    }

    read = sourcesRustcRead(root);
  }, 180_000);

  afterAll(() => {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it("reads a dep-info that names the files rustc opened, and not the sibling", () => {
    expect(read.has("app/src/lib.rs")).toBe(true);
    expect(read.has("app/src/bin/tool.rs")).toBe(true);
    expect(read.has("util/src/lib.rs")).toBe(true);
    expect(read.has("helper/src/lib.rs")).toBe(false);
  });

  it("draws no edge into a sibling crate the importing package never declared", async () => {
    // Review finding: the raw import head used to be searched across every
    // crate of the workspace, and `use helper::Thing` drew `app -> helper`
    // though app's manifest names no `helper`.
    const graph = await buildCodeGraph(root);
    const intoHelper = graph.edges.filter((e) => String(e.target).startsWith("helper/"));
    expect(intoHelper.map((e) => `${e.source} -> ${e.target}`)).toEqual([]);
  });

  it("still reaches a declared dependency, and the package's own library from its binary", async () => {
    const graph = await buildCodeGraph(root);
    const pairs = new Set(graph.edges.map((e) => `${e.source} -> ${e.target}`));
    expect(pairs.has("app/src/lib.rs -> util/src/lib.rs")).toBe(true);
    expect(pairs.has("app/src/bin/tool.rs -> app/src/lib.rs")).toBe(true);
    // Declared as `other`, imported as `otherlib`: the first cut of the fence
    // keyed on declared names alone and turned this edge away, a regression
    // against the head before it (review finding). rustc reads
    // `other/src/lib.rs` here, and `use other::…` would be E0432.
    expect(read.has("other/src/lib.rs")).toBe(true);
    expect(pairs.has("app/src/lib.rs -> other/src/lib.rs")).toBe(true);
  });
});

// Edition 2015, where a leading `::` is the crate root. The child declares a
// `foo` of its own, moved by `#[path]`, and writes `use ::foo::Item` — which
// compiles only because `::foo` is the root's module: the local one defines
// no `Item`. rustc is the oracle for the meaning; the graph has to draw the
// edge to the file rustc read the name from.
describe.skipIf(!haveCargo())("the Rust graph against cargo's dep-info, in edition 2015 (needs cargo on PATH)", () => {
  let root: string;
  let read: Set<string>;

  beforeAll(() => {
    ensureDynamicLanguages();
    root = fs.mkdtempSync(path.join(os.tmpdir(), "socraticode-cargo-2015-"));

    write(root, "Cargo.toml", ['[package]', 'name = "old"', 'version = "0.1.0"', 'edition = "2015"', ""].join("\n"));
    write(root, "src/lib.rs", "pub mod foo;\npub mod deep;\n");
    write(root, "src/foo.rs", "pub struct Item;\n");
    write(root, "src/deep/mod.rs", "pub mod child;\n");
    write(
      root,
      "src/deep/child.rs",
      [
        '#[path = "local.rs"]',
        "pub mod foo;",
        "",
        "use ::foo::Item;",
        "",
        "pub fn item() -> Item {",
        "    Item",
        "}",
        "",
        "pub fn other() -> foo::Other {",
        "    foo::Other",
        "}",
        "",
      ].join("\n"),
    );
    write(root, "src/deep/local.rs", "pub struct Other;\n");

    try {
      execFileSync("cargo", ["check", "--offline", "--quiet"], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 120_000,
      });
    } catch (err) {
      const details = err instanceof Error && "stderr" in err ? String(err.stderr) : String(err);
      throw new Error(`the fixture crate did not compile, so there is no oracle:\n${details}`);
    }

    read = sourcesRustcRead(root);
  }, 180_000);

  afterAll(() => {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it("reads a dep-info that names both files called foo", () => {
    expect(read.has("src/foo.rs")).toBe(true);
    expect(read.has("src/deep/local.rs")).toBe(true);
  });

  it("answers the child's leading :: with the root's module, not the one it moved", async () => {
    // Review finding, left open from an earlier round: the child's own
    // `#[path]` declaration used to capture `::foo`, and the edge to the
    // root's `foo` — the one rustc reads `Item` from — was never drawn.
    const graph = await buildCodeGraph(root);
    const pairs = new Set(graph.edges.map((e) => `${e.source} -> ${e.target}`));
    expect(pairs.has("src/deep/child.rs -> src/foo.rs")).toBe(true);
    // The declaration still draws its own edge to the moved file.
    expect(pairs.has("src/deep/child.rs -> src/deep/local.rs")).toBe(true);
  });
});

// A member directory of a single character, under a `[workspace]`-only root.
// The root's `"."` is the empty prefix, but measured as a string it is one
// character long and tied with `a/`, and the tie went to the root: every file
// of `a/` was governed by a manifest that declares no dependency and no
// edition. Both halves of that show here, and cargo settles both — `a` really
// does depend on `bb`, and `::bb` really is the crate rather than the local
// module, since `a/src/bb.rs` defines no `Thing`.
//
// `a/sub` is here because ranking by depth decides two orderings, not one:
// root against member, and shallow member against the one nested inside it. A
// first cut of this fixture pinned only the first, and answering "0 for the
// root, 1 for everything else" kept it green while `a` governed `a/sub` — where
// `use cc::Deep;` is E0432, `cc` being declared by `sub` alone.
describe.skipIf(!haveCargo())("the Rust graph against cargo's dep-info, in a one-letter member (needs cargo on PATH)", () => {
  let root: string;
  let read: Set<string>;

  beforeAll(() => {
    ensureDynamicLanguages();
    root = fs.mkdtempSync(path.join(os.tmpdir(), "socraticode-cargo-short-"));

    write(root, "Cargo.toml", ["[workspace]", 'members = ["a", "a/sub", "bb", "cc"]', 'resolver = "2"', ""].join("\n"));
    write(
      root,
      "a/Cargo.toml",
      ["[package]", 'name = "pkg"', 'version = "0.1.0"', 'edition = "2021"', "", "[dependencies]", 'bb = { path = "../bb" }', ""].join("\n"),
    );
    write(root, "a/src/lib.rs", ["pub mod bb;", "", "use ::bb::Thing;", "", "pub fn go() -> Thing {", "    Thing", "}", ""].join("\n"));
    // Declared, so rustc compiles it — and it defines no `Thing`, which is why
    // the `use` above compiles only when `::bb` is the dependency crate.
    write(root, "a/src/bb.rs", "pub struct Other;\n");
    // Nested inside `a/`, and depending on what `a` does not: `cc` is declared
    // here and nowhere else, so `a` governing this file loses the edge.
    write(
      root,
      "a/sub/Cargo.toml",
      ["[package]", 'name = "sub"', 'version = "0.1.0"', 'edition = "2021"', "", "[dependencies]", 'cc = { path = "../../cc" }', ""].join("\n"),
    );
    write(root, "a/sub/src/lib.rs", ["use cc::Deep;", "", "pub fn deep() -> Deep {", "    Deep", "}", ""].join("\n"));
    write(root, "bb/Cargo.toml", ["[package]", 'name = "bb"', 'version = "0.1.0"', 'edition = "2021"', ""].join("\n"));
    write(root, "bb/src/lib.rs", "pub struct Thing;\n");
    write(root, "cc/Cargo.toml", ["[package]", 'name = "cc"', 'version = "0.1.0"', 'edition = "2021"', ""].join("\n"));
    write(root, "cc/src/lib.rs", "pub struct Deep;\n");

    try {
      execFileSync("cargo", ["check", "--offline", "--quiet", "-p", "pkg", "-p", "sub", "--lib"], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 120_000,
      });
    } catch (err) {
      const details = err instanceof Error && "stderr" in err ? String(err.stderr) : String(err);
      throw new Error(`the fixture workspace did not compile, so there is no oracle:\n${details}`);
    }

    read = sourcesRustcRead(root);
  }, 180_000);

  afterAll(() => {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it("reads a dep-info that names the dependency and the local module both", () => {
    expect(read.has("a/src/lib.rs")).toBe(true);
    expect(read.has("a/src/bb.rs")).toBe(true);
    expect(read.has("bb/src/lib.rs")).toBe(true);
    expect(read.has("a/sub/src/lib.rs")).toBe(true);
    expect(read.has("cc/src/lib.rs")).toBe(true);
  });

  // Three assertions, three tests: each names a different way the ranking goes
  // wrong, and one `it` holding all three reports only the first to fail.
  it("reaches a one-letter member's own dependency, which the root declares nothing of", async () => {
    // Review finding. Governed by a `[workspace]`-only root, `a` declared
    // nothing, and the fence turned every crate it names away.
    const graph = await buildCodeGraph(root);
    const pairs = graph.edges.map((e) => `${e.source} -> ${e.target}`);
    expect(pairs).toContain("a/src/lib.rs -> bb/src/lib.rs");
  });

  it("does not read a one-letter member's 2021 file as edition 2015", async () => {
    // The root declares no edition either, which defaults to 2015, where a
    // leading `::` counts from the crate root — turning `use ::bb::Thing` into
    // a second edge to the local `a/src/bb.rs`. The `mod bb;` declaration draws
    // one edge there, and it is the only one.
    const graph = await buildCodeGraph(root);
    const pairs = graph.edges.map((e) => `${e.source} -> ${e.target}`);
    expect(pairs.filter((p) => p === "a/src/lib.rs -> a/src/bb.rs")).toHaveLength(1);
  });

  it("governs a nested member by its own manifest, not its parent package's", async () => {
    // The other ordering depth decides. `a` declares `bb` and not `cc`, so
    // `a` governing `a/sub` loses this edge — and `use cc::Deep;` there is
    // E0432 to rustc, which is what the build above proves it is not.
    const graph = await buildCodeGraph(root);
    const pairs = graph.edges.map((e) => `${e.source} -> ${e.target}`);
    expect(pairs).toContain("a/sub/src/lib.rs -> cc/src/lib.rs");
  });
});
