// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited
import type { Dirent } from "node:fs";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
  EXTENSION_LANGUAGE_MAP,
  hashContent,
  indexExtensionlessEnabled,
  MAX_GRAPH_FILE_BYTES,
  SOCRATICODE_VERSION,
  toForwardSlash,
} from "../constants.js";
import { readFileHead } from "./extensionless.js";
import { createIgnoreFilter, type IgnoreFilter, shouldIgnore } from "./ignore.js";

// ── What the graph was built from ────────────────────────────────────────

/**
 * The shape version of a persisted {@link GraphInputRecord}.
 *
 * A record carrying any other version is treated exactly as a missing one: one
 * full rebuild, which writes the current shape back. Nothing migrates, nothing
 * is re-indexed, and no operator action is involved.
 */
export const GRAPH_INPUTS_VERSION = 1;

/**
 * Every input the graph build actually consumed, persisted beside the graph.
 *
 * The point of recording it from the build rather than describing it in a
 * predicate is that there is then no second answer to "does this file
 * contribute to the code graph?" to drift from the first. A file reaches this
 * record because the builder read it; a file the builder stops reading stops
 * being recorded in the same commit.
 *
 * The buckets mirror the *kinds of read* the build makes, because each kind
 * can only be watched the way it was made:
 *
 * | the build | recorded as | watched by |
 * |---|---|---|
 * | read a file whole | content hash | re-hashing it |
 * | read a file's head to classify it | head hash | re-reading that head |
 * | used a file without opening it | its size | a stat |
 * | tried to open one and could not | its path | trying again |
 * | listed a directory | its entry names | listing it again |
 * | tried to list one and could not | its path | listing it again |
 */
export interface GraphInputRecord {
  version: number;
  /**
   * The SocratiCode version that produced this record. Compared on its own
   * rather than folded into {@link GraphInputRecord.settings} so that an
   * upgrade's rebuild is legible in the log and reviewable as its own rule.
   */
  builtByVersion: string;
  /**
   * Project-relative path → {@link hashContent} of the bytes the build used.
   * Paths outside the project root (a `tsconfig` reached through `extends`,
   * say) keep their `../` prefix and are resolved against the root again.
   */
  files: Record<string, string>;
  /**
   * Extensionless files the build head-read to decide whether they were code,
   * and turned away — path → hash of that head.
   *
   * Their bytes decided the shape of the file set, so they are inputs; but
   * only the head was read, and a whole-file hash would not describe the
   * decision. Size will not do either: `# hello!!` becoming `#!/bin/sh` flips
   * the answer without moving a byte count.
   */
  heads: Record<string, string>;
  /**
   * Inputs the build used without reading their bytes: a leaf node made from
   * its path alone, a file too large for the graph to read, a file that could
   * not be read at all. Recorded as the size the build saw, or `-1` where even
   * that was unknown.
   */
  presence: Record<string, number>;
  /**
   * Files the build tried to open and could not — a manifest it found and
   * failed to read, a `tsconfig.json` that exists but is unreadable, a source
   * file that vanished mid-walk, an extensionless file whose head-read threw.
   *
   * Distinct from {@link GraphInputRecord.presence}, which is a file the build
   * deliberately did not open: that one is watched by size, and an unreadable
   * file has no size the build ever saw. The only question that matters for
   * these is whether they can be read now, because a file that starts being
   * readable starts contributing.
   */
  unreadable: string[];
  /**
   * Directories the walk could not list. The subtree under one contributed
   * nothing, so a directory that starts being listable can add nodes with its
   * own entry in the parent unchanged — and there is no listing to compare,
   * which is why these are separate from {@link GraphInputRecord.directories}
   * and re-checked with a `readdir` rather than a readability test.
   */
  unreadableDirectories: string[];
  /**
   * Every directory the discovery walk listed → what it saw there. The root is
   * `"."`.
   *
   * This is what makes an addition detectable at all. The other buckets
   * describe files that existed when the build ran, so nothing in them can
   * speak for a path that did not — and the index cannot speak for one it does
   * not hold, which covers `go.mod`, `project.godot`, `.uid` sidecars and,
   * unless `INCLUDE_DOT_FILES` is set, every ignore file. A directory listing
   * is the read the walk actually made, and it changes the moment any of them
   * appears.
   */
  directories: Record<string, DirectoryListing>;
  /** Hash of every graph input that is not a file — see {@link graphSettingsHash}. */
  settings: string;
  /**
   * Which parsers the build actually had — see {@link graphCapabilitiesHash}.
   *
   * Separate from {@link GraphInputRecord.builtByVersion} because it varies
   * *within* a version: the optional `@ast-grep/lang-*` grammars and the
   * GDScript native addon ship platform-specific prebuilds, so the same
   * SocratiCode on a different host, runtime or architecture can extract
   * different imports and symbols from byte-identical sources.
   */
  capabilities: string;
}

/**
 * What one directory held, hashed two ways.
 *
 * `all` is every entry name, ignored ones included; `kept` is only those the
 * ignore filter admitted. Both, because they answer the same question at very
 * different prices: comparing `all` needs nothing but a `readdir`, while
 * `kept` needs the filter, and building one costs a synchronous walk of the
 * tree plus an `ignore` test per entry — 2.1s of the 2.2s a check took on a
 * 3,941-file repository, against 5ms for the listings themselves.
 *
 * So `all` is asked first and settles the common case. It cannot answer on its
 * own: a `.DS_Store` appearing, or a coverage directory written and cleaned by
 * a test run, moves it without moving anything the graph was built from, and a
 * rebuild for each of those would leave the skip theoretical. `kept` is what
 * decides, and it is only ever computed for a directory whose `all` moved.
 */
export interface DirectoryListing {
  all: string;
  kept: string;
}

/** Sorts record keys into one deterministic order, wherever they are written. */
const byKey = ([a]: [string, unknown], [b]: [string, unknown]): number =>
  a < b ? -1 : a > b ? 1 : 0;

const sortedRecord = <T>(entries: Iterable<[string, T]>): Record<string, T> =>
  Object.fromEntries([...entries].sort(byKey));

/**
 * Hash of the inputs the build reads from configuration rather than from the
 * tree: which extra extensions count as source, which extensions are mapped to
 * another language's grammar, whether dotfiles and `.gitignore` are honoured,
 * and how large a file the graph will still read.
 */
/**
 * Which parsers were available to the build, as one hash.
 *
 * Names only, never the error text of a failed load: the text carries paths
 * and messages that differ between hosts for reasons that have nothing to do
 * with what the build could parse, and would make the fingerprint unstable in
 * exactly the situation it exists to detect.
 */
export function graphCapabilitiesHash(input: {
  loadedGrammars: readonly string[];
  gdscript: boolean;
  elixirTemplates: boolean;
}): string {
  return hashContent(
    JSON.stringify({
      loadedGrammars: [...input.loadedGrammars].sort(),
      gdscript: input.gdscript,
      elixirTemplates: input.elixirTemplates,
    }),
  );
}

export function graphSettingsHash(extraExtensions: ReadonlySet<string>): string {
  return hashContent(
    JSON.stringify({
      extraExtensions: [...extraExtensions].sort(),
      // Decides whether an extensionless file can become a node at all, so
      // toggling it moves the node set with no file on disk changing.
      indexExtensionless: indexExtensionlessEnabled(),
      extensionLanguageMap: [...EXTENSION_LANGUAGE_MAP.entries()].sort(byKey),
      includeDotFiles: (process.env.INCLUDE_DOT_FILES ?? "false").toLowerCase() === "true",
      respectGitignore: (process.env.RESPECT_GITIGNORE ?? "true").toLowerCase() !== "false",
      maxGraphFileBytes: MAX_GRAPH_FILE_BYTES,
    }),
  );
}

/** What the ignore filter made of one directory's entries. */
export interface DirectoryScan {
  /** The entries the filter admitted, in the order they were read. */
  kept: Dirent[];
  listing: DirectoryListing;
}

const hashEntryNames = (names: string[]): string => hashContent(names.sort().join("\n"));

const entryName = (entry: Dirent): string =>
  entry.isDirectory() ? `${entry.name}/` : entry.name;

/**
 * Apply the ignore filter to one directory's entries, and hash what it saw.
 *
 * The single place the filter is applied to a listing: the discovery walk
 * iterates the `kept` entries this returns rather than filtering again, and
 * the rebuild check re-reads the directory through this same function. Neither
 * can drift from the other about which entries counted, because neither has
 * its own opinion.
 */
export function scanDirectory(
  ig: IgnoreFilter,
  projectPath: string,
  dir: string,
  entries: Dirent[],
): DirectoryScan {
  const kept: Dirent[] = [];
  for (const entry of entries) {
    const relPath = toForwardSlash(path.relative(projectPath, path.join(dir, entry.name)));
    if (shouldIgnore(ig, entry.isDirectory() ? `${relPath}/` : relPath)) continue;
    kept.push(entry);
  }
  return {
    kept,
    listing: {
      all: hashEntryNames(entries.map(entryName)),
      kept: hashEntryNames(kept.map(entryName)),
    },
  };
}

/**
 * Collects what a single graph build read. One per build, handed to every part
 * of the build that opens a file.
 */
export interface GraphInputRecorder {
  /** An input the build read whole, recorded by the bytes it actually used. */
  read(absolutePath: string, content: string): void;
  /** An input the build head-read to classify and did not take. */
  head(absolutePath: string, head: string): void;
  /**
   * An input the build used without reading it. `size` is what the build saw,
   * where it got that far.
   */
  present(absolutePath: string, size?: number): void;
  /** An input the build tried to open and could not. */
  unreadable(absolutePath: string): void;
  /** A directory the walk tried to list and could not. */
  unreadableDirectory(absolutePath: string): void;
  /** A directory the walk listed, by what it saw there. */
  directory(absolutePath: string, listing: DirectoryListing): void;
  /** Seal the record. Safe to call once the build has finished reading. */
  finish(extraExtensions: ReadonlySet<string>, capabilities: string): GraphInputRecord;
}

export function createGraphInputRecorder(projectRoot: string): GraphInputRecorder {
  const root = path.resolve(projectRoot);
  const files = new Map<string, string>();
  const heads = new Map<string, string>();
  const presence = new Map<string, number>();
  const unreadable = new Set<string>();
  const unreadableDirectories = new Set<string>();
  const directories = new Map<string, DirectoryListing>();
  const rel = (absolutePath: string): string =>
    toForwardSlash(path.relative(root, path.resolve(absolutePath))) || ".";

  return {
    read(absolutePath, content) {
      const key = rel(absolutePath);
      files.set(key, hashContent(content));
      // A file read whole after a weaker sighting supersedes it: the content
      // hash says everything the size or the head said, and more.
      presence.delete(key);
      heads.delete(key);
      unreadable.delete(key);
    },
    head(absolutePath, headText) {
      const key = rel(absolutePath);
      if (!files.has(key)) heads.set(key, hashContent(headText));
    },
    present(absolutePath, size) {
      const key = rel(absolutePath);
      if (!files.has(key) && !heads.has(key)) presence.set(key, size ?? -1);
    },
    unreadable(absolutePath) {
      const key = rel(absolutePath);
      if (!files.has(key) && !heads.has(key)) unreadable.add(key);
    },
    directory(absolutePath, listing) {
      const key = rel(absolutePath);
      directories.set(key, listing);
      unreadableDirectories.delete(key);
    },
    unreadableDirectory(absolutePath) {
      const key = rel(absolutePath);
      if (!directories.has(key)) unreadableDirectories.add(key);
    },
    finish(extraExtensions, capabilities) {
      return {
        version: GRAPH_INPUTS_VERSION,
        builtByVersion: SOCRATICODE_VERSION,
        capabilities,
        files: sortedRecord(files),
        heads: sortedRecord(heads),
        presence: sortedRecord(presence),
        unreadable: [...unreadable].sort(),
        unreadableDirectories: [...unreadableDirectories].sort(),
        directories: sortedRecord(directories),
        settings: graphSettingsHash(extraExtensions),
      };
    },
  };
}

const isStringMap = (value: unknown): boolean =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.values(value as Record<string, unknown>).every((v) => typeof v === "string");

/**
 * A record whose shape this build understands, or null.
 *
 * Persisted as a JSON string beside the graph, so the string form is what
 * comes back and is accepted here; anything that fails to parse, or parses to
 * something that is not this shape, is null — which the caller reads the same
 * way as no record at all.
 */
export function parseGraphInputRecord(stored: unknown): GraphInputRecord | null {
  let candidate = stored;
  if (typeof candidate === "string") {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return null;
    }
  }
  if (candidate === null || typeof candidate !== "object") return null;
  const record = candidate as Partial<GraphInputRecord>;
  if (record.version !== GRAPH_INPUTS_VERSION) return null;
  if (typeof record.builtByVersion !== "string") return null;
  if (typeof record.settings !== "string") return null;
  if (typeof record.capabilities !== "string") return null;
  if (!isStringMap(record.files)) return null;
  if (!isStringMap(record.heads)) return null;
  if (
    record.directories === null ||
    typeof record.directories !== "object" ||
    Array.isArray(record.directories) ||
    Object.values(record.directories).some(
      (listing) =>
        listing === null ||
        typeof listing !== "object" ||
        typeof (listing as DirectoryListing).all !== "string" ||
        typeof (listing as DirectoryListing).kept !== "string",
    )
  ) {
    return null;
  }
  if (!Array.isArray(record.unreadable) || record.unreadable.some((p) => typeof p !== "string")) {
    return null;
  }
  if (
    !Array.isArray(record.unreadableDirectories) ||
    record.unreadableDirectories.some((p) => typeof p !== "string")
  ) {
    return null;
  }
  if (
    record.presence === null ||
    typeof record.presence !== "object" ||
    Array.isArray(record.presence) ||
    Object.values(record.presence).some((size) => typeof size !== "number")
  ) {
    return null;
  }
  return record as GraphInputRecord;
}

// ── Deciding whether a graph rebuild can be skipped ──────────────────────

/**
 * What an incremental update did to the index, in the terms this decision
 * needs. The index has already hashed everything it holds, so most recorded
 * inputs are answered from that work rather than read again.
 */
export interface GraphChangeSummary {
  /**
   * Whether the update indexed a file it had never seen. Cheaper than the
   * directory check below and answers the common case, so it is asked first —
   * but it speaks only for files the index holds, which is why it is not the
   * whole of the addition story.
   */
  hasAdditions: boolean;
  /** Paths whose content changed, mapped to the hash the index now holds. */
  changed: ReadonlyMap<string, string>;
  /** Paths the index no longer holds. */
  removed: ReadonlySet<string>;
  /**
   * Paths the index tried to read this run and could not. The index keeps the
   * hash it already had for those, so without this they would read here as
   * unchanged — while a rebuild would drop them from the graph.
   */
  unreadable: ReadonlySet<string>;
  /**
   * The hash the index currently holds for a path it did not report as
   * changed, or undefined for a path it does not index at all (a `.gitignore`,
   * a `go.mod`). Those are read from disk here.
   */
  knownHash(relativePath: string): string | undefined;
}

export interface GraphRebuildDecision {
  rebuild: boolean;
  /** Why, in a few words, for the log line and the progress message. */
  reason: string;
  /**
   * Whether there is a graph to rebuild at all.
   *
   * False only when the project has no persisted graph: rebuilding then is
   * *building* one, which an update that indexed nothing has no business
   * doing. Every other answer — including a graph whose record is missing,
   * malformed, or could not be read — is true, because those are the cases
   * that must rebuild once and populate however quiet the update was.
   */
  graphExists: boolean;
}

/** Files hashed per round when the record has inputs the index does not cover. */
const HASH_BATCH = 32;
/** Presence-only inputs stat'd per round. */
const STAT_BATCH = 64;
/** Directories listed per round. */
const LISTING_BATCH = 64;

const rebuildFor = (reason: string): GraphRebuildDecision => ({
  rebuild: true,
  reason,
  graphExists: true,
});

async function inBatches<T, R>(
  items: T[],
  size: number,
  run: (item: T) => Promise<R>,
  inspect: (item: T, result: R) => GraphRebuildDecision | null,
): Promise<GraphRebuildDecision | null> {
  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size);
    const results = await Promise.all(batch.map(run));
    for (let j = 0; j < batch.length; j++) {
      const decision = inspect(batch[j], results[j]);
      if (decision) return decision;
    }
  }
  return null;
}

/**
 * Whether the graph has to be rebuilt for this change.
 *
 * Conservative in every direction that is not proven: an unreadable or
 * unrecognised record, a version or settings change, any addition, and any
 * recorded input that changed, vanished, or cannot be read all rebuild. The
 * skip is reached only by checking every recorded input and finding all of
 * them unchanged.
 *
 * Ordered cheapest first — the checks that need no I/O, then stats, then head
 * reads, then whole-file hashes, and last the directory listings, which are
 * the only check that walks anything.
 */
export async function decideGraphRebuild(
  projectRoot: string,
  stored: unknown,
  change: GraphChangeSummary,
  extraExtensions: ReadonlySet<string>,
  capabilities: string,
): Promise<GraphRebuildDecision> {
  const record = parseGraphInputRecord(stored);
  if (!record) {
    // A graph is there; what is missing is any account of what it was built
    // from. That is the legacy case, and it rebuilds once and writes one
    // however quiet the update was — `graphExists` is what says so.
    return rebuildFor("no usable record of what the graph was built from");
  }
  if (record.capabilities !== capabilities) {
    // Same version, different parsers: the optional grammars and the GDScript
    // addon ship platform-specific prebuilds, so a graph built where one was
    // missing holds none of the edges it would have found.
    return rebuildFor("the parsers available to the build changed");
  }
  if (record.builtByVersion !== SOCRATICODE_VERSION) {
    // A persisted graph is served unchanged across upgrades, so one cut before
    // a resolver shipped keeps answering as if that resolver did not exist —
    // the reasoning already recorded in `builtByVersion` (issue #120). One
    // rebuild on the first update after an upgrade settles it, and covers
    // every compile-time constant the build reads in the same stroke.
    return rebuildFor(
      `built by SocratiCode ${record.builtByVersion}, running ${SOCRATICODE_VERSION}`,
    );
  }
  if (record.settings !== graphSettingsHash(extraExtensions)) {
    return rebuildFor("graph configuration changed since the last build");
  }
  if (change.hasAdditions) {
    return rebuildFor("files were added");
  }

  const root = path.resolve(projectRoot);

  // Set lookups first: they settle the common case without touching the disk.
  const needHashing: string[] = [];
  for (const [relativePath, recordedHash] of Object.entries(record.files)) {
    if (change.removed.has(relativePath)) return rebuildFor(`graph input removed: ${relativePath}`);
    if (change.unreadable.has(relativePath)) {
      return rebuildFor(`graph input no longer readable: ${relativePath}`);
    }
    const indexedHash = change.changed.get(relativePath) ?? change.knownHash(relativePath);
    if (indexedHash === undefined) {
      needHashing.push(relativePath);
      continue;
    }
    if (indexedHash !== recordedHash) return rebuildFor(`graph input changed: ${relativePath}`);
  }
  for (const relativePath of Object.keys(record.heads)) {
    if (change.removed.has(relativePath)) return rebuildFor(`graph input removed: ${relativePath}`);
    if (change.unreadable.has(relativePath)) {
      return rebuildFor(`graph input no longer readable: ${relativePath}`);
    }
  }
  // A presence-only input is one the build already could not read, so an index
  // that still cannot read it says nothing new — only a change or a removal
  // does, which keeps an unreadable file from forcing a rebuild every run.
  const needStatting = Object.entries(record.presence);
  for (const [relativePath] of needStatting) {
    if (change.removed.has(relativePath) || change.changed.has(relativePath)) {
      return rebuildFor(`graph input changed: ${relativePath}`);
    }
  }

  const sized = await inBatches(
    needStatting,
    STAT_BATCH,
    async ([relativePath]) => {
      try {
        return (await fs.stat(path.resolve(root, relativePath))).size;
      } catch {
        return null;
      }
    },
    ([relativePath, recordedSize], size) => {
      if (size === null) return rebuildFor(`graph input gone: ${relativePath}`);
      // Size is what carried the file across the limit, in either direction.
      if (recordedSize >= 0 && size !== recordedSize) {
        return rebuildFor(`graph input changed size: ${relativePath}`);
      }
      return null;
    },
  );
  if (sized) return sized;

  // A directory the walk could not list is watched the same way, but with the
  // read it actually failed at: a subtree that becomes listable can add nodes
  // while its own entry in the parent never changes.
  const relisted = await inBatches(
    record.unreadableDirectories,
    LISTING_BATCH,
    async (relativePath) => {
      try {
        await fs.readdir(path.resolve(root, relativePath));
        return true;
      } catch {
        return false;
      }
    },
    (relativePath, listable) =>
      listable ? rebuildFor(`graph input directory became listable: ${relativePath}`) : null,
  );
  if (relisted) return relisted;

  // A file the build could not open is watched by whether that is still true:
  // one that starts being readable starts contributing, and nothing else in
  // the record would move when it does.
  const recovered = await inBatches(
    record.unreadable,
    HASH_BATCH,
    async (relativePath) => {
      try {
        await fs.access(path.resolve(root, relativePath), fsConstants.R_OK);
        return true;
      } catch {
        return false;
      }
    },
    (relativePath, readable) =>
      readable ? rebuildFor(`graph input became readable: ${relativePath}`) : null,
  );
  if (recovered) return recovered;

  const headed = await inBatches(
    Object.keys(record.heads),
    HASH_BATCH,
    async (relativePath) => {
      try {
        // The same window discovery scored the file on, so the two answers
        // stay comparable — see `ExtensionlessDetection.head`.
        return await readFileHead(path.resolve(root, relativePath));
      } catch {
        return null;
      }
    },
    (relativePath, head) => {
      if (head === null) return rebuildFor(`graph input unreadable: ${relativePath}`);
      if (hashContent(head) !== record.heads[relativePath]) {
        return rebuildFor(`graph input changed: ${relativePath}`);
      }
      return null;
    },
  );
  if (headed) return headed;

  const hashed = await inBatches(
    needHashing,
    HASH_BATCH,
    async (relativePath) => {
      try {
        return await fs.readFile(path.resolve(root, relativePath), "utf-8");
      } catch {
        return null;
      }
    },
    (relativePath, content) => {
      if (content === null) return rebuildFor(`graph input unreadable: ${relativePath}`);
      if (hashContent(content) !== record.files[relativePath]) {
        return rebuildFor(`graph input changed: ${relativePath}`);
      }
      return null;
    },
  );
  if (hashed) return hashed;

  // Last: whether anything appeared or vanished where the walk looked. This is
  // what catches a file the index never holds — a new nested `go.mod`, a new
  // `project.godot`, a `.uid` sidecar — none of which any other bucket can
  // speak for, since none of them existed when the record was written.
  //
  // Two tiers, because the entry names are free and the ignore filter is not.
  const moved: Array<[string, Dirent[]]> = [];
  const listed = await inBatches(
    Object.keys(record.directories),
    LISTING_BATCH,
    async (relativePath) => {
      try {
        return await fs.readdir(path.resolve(root, relativePath), { withFileTypes: true });
      } catch {
        return null;
      }
    },
    (relativePath, entries) => {
      if (entries === null) return rebuildFor(`graph input directory gone: ${relativePath}`);
      if (hashEntryNames(entries.map(entryName)) !== record.directories[relativePath].all) {
        moved.push([relativePath, entries]);
      }
      return null;
    },
  );
  if (listed) return listed;

  if (moved.length > 0) {
    // Something is different in at least one directory. Only now is the filter
    // worth building, and only these directories are worth asking about.
    //
    // Nothing is written back. An ignored entry that appeared after the last
    // build leaves this cheap hash stale, so every later decision pays for one
    // ignore-filter build (~0.6s on a 3,941-file repository) to reach this
    // same answer, until the next real rebuild refreshes the record. That is
    // the accepted cost of keeping the record immutable except when the graph
    // itself is saved: the alternative is a second writer for a field the
    // graph save owns, and a write that lands after a concurrent rebuild would
    // replace a newer graph's inputs with an older graph's.
    const ig = createIgnoreFilter(root);
    for (const [relativePath, entries] of moved) {
      const { listing } = scanDirectory(ig, root, path.resolve(root, relativePath), entries);
      if (listing.kept !== record.directories[relativePath].kept) {
        return rebuildFor(`files appeared or vanished in: ${relativePath}`);
      }
    }
  }

  return { rebuild: false, reason: "no graph input changed", graphExists: true };
}
