// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

import fsp from "node:fs/promises";
import path from "node:path";
import { type Lang, parse } from "@ast-grep/napi";
import { glob } from "glob";
import { collectionName, projectIdFromPath } from "../config.js";
import {
  CHUNK_OVERLAP,
  CHUNK_SIZE,
  EXTENSION_LANGUAGE_MAP,
  EXTRA_EXTENSIONS,
  getLanguageFromExtension,
  hashContent,
  INDEX_BATCH_SIZE,
  indexExtensionlessEnabled,
  MAX_AVG_LINE_LENGTH,
  MAX_CHUNK_CHARS,
  SPECIAL_FILES,
  SUPPORTED_EXTENSIONS
} from "../constants.js";
import type { FileChunk } from "../types.js";
import {
  continuationId,
  SPLITTING_INDEX_FORMAT_VERSION,
  splitTextToCharCap,
  uuidFromSeed,
} from "./chunk-split.js";
import { ensureDynamicLanguages, gdscriptParserAvailable, getAstGrepLang, rebuildGraph, removeGraph, shouldRebuildGraph } from "./code-graph.js";
import { ensureArtifactsIndexed, loadConfig, removeAllArtifacts } from "./context-artifacts.js";
import { analyzeElixirTemplate, ensureElixirTemplateParsers, isElixirTemplateExtension } from "./elixir-templates.js";
import { generateEmbeddings, prepareDocumentText } from "./embeddings.js";
import { detectExtensionFromSource, resolveExtensionlessExtension } from "./extensionless.js";
import { createIgnoreFilter, shouldIgnore } from "./ignore.js";
import {
  CURRENT_INDEX_FORMAT_VERSION,
  documentTextProfile,
  type EffectiveIndexProfile,
  ensureEffectiveEmbeddingReady,
  profileExtensionLanguageMap,
  resolveEffectiveIndexProfile,
  withEffectiveEmbedding,
} from "./index-profile.js";
import { acquireProjectLock, holdsProjectLock, releaseProjectLock } from "./lock.js";
import { logger } from "./logger.js";
import {
  type CollectionInfo,
  deleteCollection,
  deleteFileChunks,
  deleteProjectMetadata,
  ensureCollection,
  getCollectionInfo,
  getProjectMetadata,
  listIndexedFilePaths,
  loadIndexingStatus,
  loadProjectEffectiveProfile,
  loadProjectHashes,
  saveProjectMetadata,
  upsertPreEmbeddedChunks,
} from "./qdrant.js";

export const FILE_SCAN_BATCH = 50; // Number of files to scan/chunk in parallel (I/O only, no network)


/** State for tracking indexed files per project (loaded from Qdrant on first use) */
const projectHashes = new Map<string, Map<string, string>>();
const projectHashesLoaded = new Set<string>();

/** Progress details for an in-flight indexing operation */
export interface IndexingProgress {
  type: "full-index" | "incremental-update";
  startedAt: number;  // Date.now()
  filesTotal: number;
  filesProcessed: number;
  chunksTotal?: number;
  chunksProcessed?: number;
  /** Total number of file batches (each up to INDEX_BATCH_SIZE files) */
  batchesTotal?: number;
  /** Number of file batches fully processed and checkpointed */
  batchesProcessed?: number;
  phase: string;
  error?: string;
}

/** Summary of a completed indexing operation */
export interface IndexingCompleted {
  type: "full-index" | "incremental-update";
  completedAt: number;  // Date.now()
  durationMs: number;
  filesProcessed: number;
  chunksCreated: number;
  error?: string;
}

/** Track which projects currently have an indexing operation in flight */
const indexingInProgress = new Map<string, IndexingProgress>();

/** Track the last completed indexing operation per project */
const lastCompleted = new Map<string, IndexingCompleted>();

/** Cancellation requests — set to true to stop indexing at the next batch boundary */
const cancellationRequested = new Map<string, boolean>();

/** Check if a project is currently being indexed (full index or incremental update) */
export function isIndexingInProgress(projectPath: string): boolean {
  return indexingInProgress.has(path.resolve(projectPath));
}

/** Get progress details for a project currently being indexed */
export function getIndexingProgress(projectPath: string): IndexingProgress | null {
  return indexingInProgress.get(path.resolve(projectPath)) ?? null;
}

/** Set or clear progress for a project (used by index-tools during infrastructure setup) */
export function setIndexingProgress(projectPath: string, progress: IndexingProgress | null): void {
  const resolved = path.resolve(projectPath);
  if (progress) {
    indexingInProgress.set(resolved, progress);
  } else {
    indexingInProgress.delete(resolved);
  }
}

/** Get the last completed indexing operation for a project */
export function getLastCompleted(projectPath: string): IndexingCompleted | null {
  return lastCompleted.get(path.resolve(projectPath)) ?? null;
}

/** Get all projects currently being indexed */
export function getIndexingInProgressProjects(): string[] {
  return Array.from(indexingInProgress.keys());
}

/** Check if a project's index is complete by querying persisted metadata in Qdrant.
 *  Returns "completed", "in-progress", or "unknown" (no metadata found). */
export async function getPersistedIndexingStatus(projectPath: string): Promise<"completed" | "in-progress" | "unknown"> {
  const resolvedPath = path.resolve(projectPath);
  const projectId = projectIdFromPath(resolvedPath);
  const collection = collectionName(projectId);
  const metadata = await getProjectMetadata(collection);
  if (!metadata) return "unknown";
  return metadata.indexingStatus;
}

/** Request graceful cancellation of an in-flight indexing operation.
 *  The operation will stop after the current batch finishes and checkpoint. */
export function requestCancellation(projectPath: string): boolean {
  const resolved = path.resolve(projectPath);
  if (!indexingInProgress.has(resolved)) return false;
  cancellationRequested.set(resolved, true);
  logger.info("Cancellation requested — will stop after current batch", { projectPath: resolved });
  return true;
}

/**
 * Stand down when the index lock is lost mid-run.
 *
 * The lock is keyed by project id and the collection is shared, so losing it
 * means another process may now be indexing what this run is still writing to.
 * Two writers is the state the reconciliation on resume exists to survive; not
 * racing in the first place is better.
 *
 * Cancellation is checked between batches and returns before the terminal
 * `completed` write, so the collection is left `in-progress` and the next run
 * reconciles it. That makes standing down safe even when the compromise was
 * spurious — the cost is one resumable run, against two processes writing to
 * one collection.
 *
 * `requestCancellation` no-ops if the run is not registered yet, which cannot
 * happen here: registration follows the lock acquisition with no `await`
 * between them, and this runs from proper-lockfile's timer, which cannot fire
 * during synchronous execution.
 */
function cancelBecauseLockWasLost(projectPath: string): void {
  logger.warn("Index lock lost while indexing — cancelling to avoid racing the new holder", {
    projectPath,
  });
  requestCancellation(projectPath);
}

/**
 * Persist the terminal `completed` status, and undo it only while this process
 * still owns the project lock.
 *
 * The gate before the call cannot close the window on its own:
 * `saveProjectMetadata` is asynchronous and a compromise arrives from
 * proper-lockfile's timer, so cancellation can land after the check and before
 * the write does.
 *
 * The repair is therefore conditional on ownership rather than on cancellation
 * alone. A user-requested stop leaves the lock held, so the status can safely be
 * put back. A lost lock means another process may already have written its own
 * status and hashes, and correcting ours would overwrite theirs — so once
 * ownership is known to be gone, no further write is started at all. Qdrant
 * offers no conditional upsert to distinguish the two after the fact, which is
 * exactly why the decision is made before writing rather than after.
 *
 * Returns whether `completed` stands.
 */
async function persistCompletedUnlessLockLost(
  collection: string,
  resolvedPath: string,
  filesTotal: number,
  filesIndexed: number,
  hashes: Map<string, string>,
  effectiveProfile: EffectiveIndexProfile,
): Promise<boolean> {
  await saveProjectMetadata(
    collection,
    resolvedPath,
    filesTotal,
    filesIndexed,
    hashes,
    "completed",
    effectiveProfile,
  );

  if (!isCancellationRequested(resolvedPath)) return true;

  if (!holdsProjectLock(resolvedPath, "index")) {
    logger.warn(
      "Cancelled while completing and the lock is no longer held — leaving metadata alone rather than overwriting the new holder",
      { projectPath: resolvedPath, collection },
    );
    return false;
  }

  logger.warn("Cancelled while the completed status was being written — reverting to in-progress", {
    projectPath: resolvedPath,
    collection,
  });
  await saveProjectMetadata(
    collection,
    resolvedPath,
    filesTotal,
    filesIndexed,
    hashes,
    "in-progress",
    effectiveProfile,
  );
  return false;
}

/** Check whether cancellation has been requested for a project */
function isCancellationRequested(resolvedPath: string): boolean {
  return cancellationRequested.get(resolvedPath) === true;
}

async function getProjectHashes(projectId: string, collection: string, resolvedProjectPath?: string): Promise<Map<string, string>> {
  if (!projectHashes.has(projectId)) {
    // Try to load from Qdrant (persistent storage).
    // loadProjectHashes now throws on transient errors (instead of returning null),
    // so a Qdrant blip will propagate up rather than silently returning empty hashes
    // (which could cascade into a destructive clean-start).
    if (!projectHashesLoaded.has(projectId)) {
      projectHashesLoaded.add(projectId);
      const stored = await loadProjectHashes(collection);
      if (stored) {
        // Migrate absolute-path keys to relative paths (one-time, transparent).
        // Indexes built before the relative-path fix stored absolute paths as hash keys.
        const migrated = migrateAbsolutePathKeys(stored, resolvedProjectPath);
        logger.info("Loaded file hashes from Qdrant", { projectId, count: migrated.size, wasMigrated: migrated !== stored });
        projectHashes.set(projectId, migrated);
        return migrated;
      }
    }
    projectHashes.set(projectId, new Map());
  }
  return projectHashes.get(projectId) as Map<string, string>;
}

/**
 * Drop hashes for files that have no chunks left in the collection.
 *
 * An interrupted run can leave the two out of step. The stored hashes are
 * checkpointed as `in-progress`, then chunks for files that disappeared are
 * deleted, and only afterwards is the pruned hash map written back. Stop
 * between those steps — a crash, a cancellation, a host that exits — and the
 * collection keeps hashes for points that are gone.
 *
 * Nothing recovers from that on its own. The next run reads the file, computes
 * the same content hash, matches the stale entry and skips it, so the missing
 * chunks are never rebuilt. `codebase_index` does not help either: it takes the
 * same skip. Until now the only way back was deleting the collection and
 * starting over.
 *
 * Reconciling the hash map against the points that actually exist turns that
 * into a self-healing case: a file whose chunks are absent loses its hash, so
 * the very next run re-indexes it.
 *
 * SCOPE — deliberately limited to a resume from `in-progress`.
 *
 * This costs one paged scroll of the collection, which is cheap next to
 * indexing but not free: a repository of ~60k points is ~60 round trips, and a
 * healthy incremental otherwise finishes in seconds. Running it on every index
 * would also catch chunk loss from causes other than interruption, and that is
 * a defensible choice — but it taxes the common path to guard against the rare
 * one. Interruption is the failure mode with a known mechanism, and it is the
 * one that is marked in the metadata, so it is what this checks. If loss is
 * ever observed after a run that completed cleanly, widening this is the
 * change to make, and the only cost is the scroll.
 */
async function reconcileHashesWithStoredPoints(
  collection: string,
  hashes: Map<string, string>,
  projectId: string,
): Promise<number> {
  if (hashes.size === 0) return 0;

  const present = await listIndexedFilePaths(collection);
  // An empty collection is not evidence of loss — a fresh index legitimately has
  // no points yet, and clearing every hash there would force a full re-embed for
  // no reason. Only prune when there is something to compare against.
  if (present.size === 0) return 0;

  let dropped = 0;
  for (const [relativePath] of hashes) {
    if (!present.has(relativePath)) {
      hashes.delete(relativePath);
      dropped++;
    }
  }
  if (dropped > 0) {
    logger.info("Reconciled hashes against stored points; files with no chunks will be re-indexed", {
      projectId,
      collection,
      filesRestored: dropped,
      hashesRemaining: hashes.size,
    });
  }
  return dropped;
}

/**
 * Migrate hash map keys from absolute paths to relative paths.
 * Returns a new map if migration was needed, or the original map if keys are already relative.
 */
function migrateAbsolutePathKeys(hashes: Map<string, string>, resolvedProjectPath?: string): Map<string, string> {
  if (hashes.size === 0) return hashes;

  // Check if keys look like absolute paths
  const firstKey = hashes.keys().next().value as string;
  if (!firstKey.startsWith("/") && !firstKey.startsWith("\\")) return hashes;

  // Try to strip the stored project path prefix, or detect the common prefix
  const prefix = resolvedProjectPath
    ? `${resolvedProjectPath}/`
    : detectCommonPrefix(hashes);

  if (!prefix) {
    logger.warn("Hash keys appear absolute but could not determine prefix to strip — skipping migration");
    return hashes;
  }

  const migrated = new Map<string, string>();
  for (const [absPath, hash] of hashes) {
    const relative = absPath.startsWith(prefix) ? absPath.slice(prefix.length) : absPath;
    migrated.set(relative, hash);
  }

  logger.info("Migrated hash keys from absolute to relative paths", { count: migrated.size, prefix });
  return migrated;
}

/** Detect the longest common directory prefix across all hash keys */
function detectCommonPrefix(hashes: Map<string, string>): string | null {
  const keys = Array.from(hashes.keys());
  if (keys.length === 0) return null;

  let prefix = keys[0];
  for (let i = 1; i < keys.length; i++) {
    while (!keys[i].startsWith(prefix)) {
      const lastSlash = prefix.lastIndexOf("/");
      if (lastSlash <= 0) return null;
      prefix = prefix.slice(0, lastSlash + 1);
    }
  }

  // Ensure prefix ends with /
  if (!prefix.endsWith("/")) {
    const lastSlash = prefix.lastIndexOf("/");
    if (lastSlash <= 0) return null;
    prefix = prefix.slice(0, lastSlash + 1);
  }

  return prefix;
}

// `hashContent` now lives in constants.ts, shared with the graph's input
// recording; re-exported here because this module is where callers look for it.
export { hashContent };

/** Generate a stable chunk ID as a valid UUID (required by Qdrant) */
export function chunkId(relativePath: string, startLine: number): string {
  return uuidFromSeed(`${relativePath}:${startLine}`);
}

/** Check if a file should be indexed based on extension or name */
export function isIndexableFile(
  fileName: string,
  extraExts?: Set<string>,
  extensionLanguageMap: Map<string, string> = EXTENSION_LANGUAGE_MAP,
): boolean {
  if (SPECIAL_FILES.has(fileName)) return true;
  const ext = path.extname(fileName).toLowerCase();
  if (SUPPORTED_EXTENSIONS.has(ext)) return true;
  // Extensions mapped to a real language via EXTENSION_LANGUAGE_MAP are
  // first-class source files, not plaintext extras.
  if (extensionLanguageMap.has(ext)) return true;
  // Check extra extensions (from env var + tool parameter)
  const extras = extraExts ?? EXTRA_EXTENSIONS;
  return extras.has(ext);
}

/** AST node kinds that represent top-level declarations per language */
const TOP_LEVEL_KINDS: Record<string, string[]> = {
  // JS/TS
  JavaScript: ["function_declaration", "class_declaration", "export_statement",
               "lexical_declaration", "variable_declaration", "expression_statement"],
  TypeScript: ["function_declaration", "class_declaration", "export_statement",
               "lexical_declaration", "variable_declaration", "interface_declaration",
               "type_alias_declaration", "enum_declaration", "expression_statement"],
  Tsx:        ["function_declaration", "class_declaration", "export_statement",
               "lexical_declaration", "variable_declaration", "interface_declaration",
               "type_alias_declaration", "enum_declaration", "expression_statement"],
  // Python
  python:     ["function_definition", "class_definition", "decorated_definition"],
  // Java / Kotlin / Scala
  java:       ["class_declaration", "interface_declaration", "enum_declaration", "method_declaration"],
  kotlin:     ["class_declaration", "function_declaration", "object_declaration"],
  scala:      ["class_definition", "object_definition", "trait_definition", "function_definition"],
  // C / C++
  c:          ["function_definition", "struct_specifier", "enum_specifier", "declaration"],
  cpp:        ["function_definition", "class_specifier", "struct_specifier", "namespace_definition", "declaration"],
  // Others
  csharp:     ["class_declaration", "interface_declaration", "method_declaration", "namespace_declaration"],
  go:         ["function_declaration", "method_declaration", "type_declaration"],
  rust:       ["function_item", "impl_item", "struct_item", "enum_item", "trait_item", "mod_item"],
  ruby:       ["method", "class", "module", "singleton_method"],
  php:        ["function_definition", "class_declaration", "method_declaration", "trait_declaration"],
  swift:      ["function_declaration", "class_declaration", "struct_declaration", "protocol_declaration", "extension_declaration"],
  bash:       ["function_definition"],
  // Dart: class/mixin/enum/extension nodes span their bodies, but a top-level
  // function is a `function_signature` followed by a SIBLING `function_body`
  // starting on the same line. Both kinds are listed so the overlap-merge in
  // findAstBoundaries fuses each signature/body pair into one region.
  dart:       ["class_definition", "mixin_declaration", "enum_declaration", "extension_declaration", "type_alias", "function_signature", "function_body"],
  elixir:     ["call"],
  // GDScript (Godot)
  gdscript:   ["function_definition", "class_definition", "variable_statement",
               "export_variable_statement", "onready_variable_statement",
               "signal_statement", "const_statement", "enum_definition",
               "extends_statement", "class_name_statement"],
};

/** Minimum lines for a chunk to stand on its own (otherwise merge with neighbors) */
const MIN_CHUNK_LINES = 5;
/** Maximum lines for a single AST chunk before sub-chunking */
const MAX_CHUNK_LINES = 150;

interface AstRegion {
  startLine: number; // 0-based
  endLine: number;   // 0-based exclusive
}

/**
 * Use ast-grep to find top-level declaration boundaries in source code.
 * Returns sorted, non-overlapping regions.
 */
function findAstBoundaries(source: string, lang: Lang | string): AstRegion[] {
  const langKey = String(lang);
  const kinds = TOP_LEVEL_KINDS[langKey];
  if (!kinds) return [];
  // GDScript parser is registered dynamically and may be unavailable on
  // platforms without a compatible prebuild (e.g. linux-arm64). Skip AST
  // chunking there — files fall back to line-based chunking.
  if (langKey === "gdscript" && !gdscriptParserAvailable) return [];

  try {
    const root = parse(lang, source).root();
    const regions: AstRegion[] = [];

    for (const kind of kinds) {
      for (const node of root.findAll({ rule: { kind } })) {
        const range = node.range();
        // Only top-level nodes (depth 1 from root, or depth 2 for namespace/module wrappers)
        const parent = node.parent();
        const grandparent = parent?.parent();
        const isTopLevel = !parent || parent.kind() === "program" || parent.kind() === "source" || parent.kind() === "source_file"
          || parent.kind() === "translation_unit" || parent.kind() === "module"
          || parent.kind() === "export_statement" || parent.kind() === "decorated_definition"
          || parent.kind() === "compilation_unit"
          // Depth 2: e.g., class inside namespace
          || (grandparent && (grandparent.kind() === "program" || grandparent.kind() === "source_file"
            || grandparent.kind() === "translation_unit" || grandparent.kind() === "compilation_unit"
            || grandparent.kind() === "source"));

        if (isTopLevel) {
          regions.push({ startLine: range.start.line, endLine: range.end.line + 1 });
        }
      }
    }

    // Sort by start line and merge overlapping regions
    regions.sort((a, b) => a.startLine - b.startLine);
    const merged: AstRegion[] = [];
    for (const r of regions) {
      const last = merged[merged.length - 1];
      if (last && r.startLine <= last.endLine) {
        last.endLine = Math.max(last.endLine, r.endLine);
      } else {
        merged.push({ ...r });
      }
    }

    return merged;
  } catch {
    return [];
  }
}

/**
 * Enforce the per-chunk character cap on every chunking strategy.
 *
 * On a collection indexed as format 2 the cap is a split boundary: a chunk
 * longer than it becomes as many chunks as it needs, and nothing but
 * whitespace-only pieces is dropped. A collection stored below that keeps
 * truncating, so its stored representation stays what its profile says.
 *
 * Truncation was the behaviour everywhere. Chunks are cut by line count
 * (CHUNK_SIZE) while the cap counts characters, so a window of CHUNK_SIZE lines
 * overflows as soon as its lines average more than
 * MAX_CHUNK_CHARS / CHUNK_SIZE characters — which ordinary source and prose
 * both do — and everything past the cap reached neither the vector, nor the
 * payload, nor the BM25 text. No search could retrieve it.
 *
 * The provider's pre-truncation still stands behind this as the last-resort
 * defence; this cap ensures chunks are already within bounds before that.
 */
function splitToCharCap(
  chunks: FileChunk[],
  maxChunkChars: number = MAX_CHUNK_CHARS,
  indexFormatVersion: number = CURRENT_INDEX_FORMAT_VERSION,
): FileChunk[] {
  // A collection keeps the representation it was created with. Splitting is the
  // format-2 representation; a collection stored as format 0 or 1 must keep
  // truncating, for files that changed and for files discovered after the
  // upgrade alike, so that what is written never drifts from what its persisted
  // effective profile says.
  if (indexFormatVersion < SPLITTING_INDEX_FORMAT_VERSION) {
    return chunks
      .map((c) =>
        c.content.length > maxChunkChars
          ? { ...c, content: c.content.substring(0, maxChunkChars) }
          : c,
      )
      .filter((c) => c.content.trim().length > 0);
  }
  // Terminal invariant: never emit a chunk with no non-whitespace content.
  // Four of the five `return` paths in chunkFileContent pass through here (the
  // fifth returns []), so this is the one place that can guarantee the property
  // for every chunking strategy — including zero-byte and whitespace-only files,
  // which reach chunkByLines and would otherwise yield a single blank chunk.
  // Safe to drop: chunk ids are derived from the chunk's own position, so
  // removing a chunk never renumbers any other.
  //
  // ORDER MATTERS: split first, then filter. A chunk can be all whitespace up to
  // the cap and hold its only real content past it; filtering first would keep
  // the piece that turns out blank and drop nothing, so the invariant would not
  // actually hold on the returned chunks.
  const split =
    chunks.every((c) => c.content.length <= maxChunkChars)
      ? chunks
      : chunks.flatMap((c) =>
          c.content.length > maxChunkChars
            ? splitOversizedChunk(c, maxChunkChars)
            : [c],
        );
  return split.filter((c) => c.content.trim().length > 0);
}

/**
 * Split one over-long chunk into cap-sized pieces.
 *
 * Ordinary source and prose use the newline-first boundary rule. Minified code
 * has a separate token-safe rule in `chunkByCharacters`; routing this path
 * through that chunker would make ordinary chunks change representation too.
 * The ids and line numbers here are rebased onto the parent, so the pieces stay
 * addressable and keep pointing at the lines they came from.
 */
function splitOversizedChunk(chunk: FileChunk, maxChunkChars: number): FileChunk[] {
  // Only reachable for format 2: splitToCharCap returns before this for a
  // collection stored below it.
  const pieces = splitTextToCharCap(chunk.content, maxChunkChars);
  return pieces.map((piece, index) => ({
    ...chunk,
    content: piece.text,
    // The first piece inherits the parent's identity — same id, same startLine —
    // so a chunk that needed no splitting and one that did agree on where they
    // begin. Continuations are seeded from the parent id (see continuationId).
    id: index === 0 ? chunk.id : continuationId(chunk.id, index),
    // split helper counts lines from 1 within the slice it was given; the
    // parent's own startLine puts them back on the file's line numbering. This
    // also re-derives the parent's endLine, which truncation used to leave
    // claiming lines the chunk no longer held.
    startLine: chunk.startLine + piece.startLine - 1,
    // The parent's last piece ends where the parent ended. Deriving it from the
    // piece instead would come up a line short whenever the parent's final line
    // is blank: the text then ends on a newline, and a trailing newline closes
    // the last line rather than opening another. Together the pieces cover the
    // parent exactly, so the last one has to reach its end.
    endLine:
      index === pieces.length - 1 ? chunk.endLine : chunk.startLine + piece.endLine - 1,
    type: chunk.type,
  }));
}

/**
 * Character-based chunking for minified/bundled content whose average line
 * length exceeds MAX_AVG_LINE_LENGTH, so that chunks stay within
 * MAX_CHUNK_CHARS.
 *
 * Where the boundary falls depends on the collection's stored format, because
 * a collection keeps the representation it was created with. Format 0 and 1
 * run the released scan, which accepts a newline, space, tab, semicolon or
 * comma near the end of the window and so usually avoids splitting
 * mid-identifier. Format 2 preserves that boundary set, but bounds the scan
 * inside the cap and corrects line-ending and Unicode-pair handling — see
 * splitTextToCharCap.
 *
 * NOTE: The chunk `id` uses the byte offset as its discriminator (not the
 * line number) because minified files may consist of a single very long
 * line, making startLine identical across all chunks.
 */
function chunkByCharacters(
  filePath: string,
  relativePath: string,
  content: string,
  language: string,
  maxChunkChars: number,
  indexFormatVersion: number,
): FileChunk[] {
  // Format 0 and 1 keep the released algorithm exactly — boundaries, offsets
  // and ids alike. This path already produces chunks within the cap, so the
  // gate in splitToCharCap runs too late to restore them; the choice has to be
  // made here.
  if (indexFormatVersion < SPLITTING_INDEX_FORMAT_VERSION) {
    return chunkByCharactersLegacy(filePath, relativePath, content, language, maxChunkChars);
  }

  let offset = 0;
  return splitTextToCharCap(content, maxChunkChars, "code-token").map((piece) => {
    const chunk: FileChunk = {
      id: chunkId(relativePath, offset), // byte offset → unique ID even for 1-line files
      filePath,
      relativePath,
      content: piece.text,
      startLine: piece.startLine,
      endLine: piece.endLine,
      language,
      type: "code",
    };
    offset += piece.text.length;
    return chunk;
  });
}

/**
 * The released character-based chunker, kept verbatim for collections stored as
 * format 0 or 1.
 *
 * Its boundary set (newline, space, tab, semicolon, comma) and its scan that
 * starts at the limit itself decide where every chunk begins, and the chunk id
 * is seeded from that byte offset. Reproducing the bytes is therefore not
 * enough: anything but this exact loop gives such a collection different ids
 * and different line ranges on the next incremental update.
 */
function chunkByCharactersLegacy(
  filePath: string,
  relativePath: string,
  content: string,
  language: string,
  maxChunkChars: number,
): FileChunk[] {
  const chunks: FileChunk[] = [];
  let offset = 0;
  let currentLine = 1;

  while (offset < content.length) {
    let end = Math.min(offset + maxChunkChars, content.length);

    // Scan backwards from the hard limit to find a safe split boundary.
    // If none is found within the window, fall through and split at the limit.
    if (end < content.length) {
      for (let i = end; i > offset; i--) {
        const ch = content[i];
        if (ch === "\n" || ch === " " || ch === "\t" || ch === ";" || ch === ",") {
          end = i + 1;
          break;
        }
      }
    }

    const chunkContent = content.slice(offset, end);
    const startLine = currentLine;
    const newlineCount = (chunkContent.match(/\n/g) ?? []).length;
    const endLine = startLine + newlineCount;

    chunks.push({
      id: chunkId(relativePath, offset), // byte offset → unique ID even for 1-line files
      filePath,
      relativePath,
      content: chunkContent,
      startLine,
      endLine,
      language,
      type: "code",
    });

    // Advance line counter: if the chunk ended with a newline the next
    // chunk starts on a new line; otherwise we're still on the same line.
    currentLine = chunkContent.endsWith("\n") ? endLine + 1 : endLine;
    offset = end;
  }

  return chunks;
}

/**
 * Split file content into chunks using AST-aware boundaries when possible.
 * Falls back to line-based chunking for unsupported languages or on parse
 * failure. Minified/bundled content (detected via average line length) is
 * handled by character-based chunking to avoid context-window overflows.
 * A hard character cap is applied to every chunk regardless of strategy.
 */
export function chunkFileContent(
  filePath: string,
  relativePath: string,
  content: string,
  options: {
    maxChunkChars?: number;
    extensionLanguageMap?: Map<string, string>;
    indexFormatVersion?: number;
  } = {},
): FileChunk[] {
  const maxChunkChars = options.maxChunkChars ?? MAX_CHUNK_CHARS;
  const extensionLanguageMap = options.extensionLanguageMap ?? EXTENSION_LANGUAGE_MAP;
  const indexFormatVersion = options.indexFormatVersion ?? CURRENT_INDEX_FORMAT_VERSION;
  const lines = content.split("\n");
  let ext = path.extname(filePath).toLowerCase();
  // Extensionless files (not SPECIAL_FILES) inherit their language/grammar from
  // content detection, gated by the same kill-switch as discovery so the two
  // stay consistent. The on-disk path is never rewritten — only the
  // language/grammar selection changes.
  if (ext === "" && indexExtensionlessEnabled() && !SPECIAL_FILES.has(path.basename(filePath))) {
    // Scores the same byte window as discovery's readFileHead, via the one
    // helper that owns that rule, so chunking and discovery cannot disagree
    // about the same bytes.
    const detected = detectExtensionFromSource(content);
    // If the content changed since discovery admitted this file (TOCTOU) and it
    // no longer detects as code, produce no chunks rather than indexing it as
    // plaintext — keeping chunking consistent with getIndexableFiles' contract.
    if (!detected) return [];
    ext = detected;
  }
  const language = getLanguageFromExtension(ext, extensionLanguageMap);

  // Detect minified/bundled content before any other branching: a high
  // average line length means line-based chunks would be huge single lines
  // that overflow the embedding model's context window.
  const avgLineLength = lines.length > 0 ? content.length / lines.length : 0;
  if (avgLineLength > MAX_AVG_LINE_LENGTH) {
    logger.debug("Minified/bundled content detected — using character-based chunking", {
      relativePath,
      avgLineLength: Math.round(avgLineLength),
    });
    return splitToCharCap(
      chunkByCharacters(filePath, relativePath, content, language, maxChunkChars, indexFormatVersion),
      maxChunkChars,
      indexFormatVersion,
    );
  }

  // Small files: single chunk regardless of language
  if (lines.length <= CHUNK_SIZE) {
    return splitToCharCap([{
      id: chunkId(relativePath, 1),
      filePath,
      relativePath,
      content,
      startLine: 1,
      endLine: lines.length,
      language,
      type: "code",
    }], maxChunkChars, indexFormatVersion);
  }

  // Try AST-aware chunking for supported languages and mixed Elixir templates.
  const astLang = getAstGrepLang(ext, extensionLanguageMap);
  const regions = isElixirTemplateExtension(ext)
    ? (analyzeElixirTemplate(content, ext)?.regions ?? [])
    : astLang ? findAstBoundaries(content, astLang) : [];

  if (regions.length > 0) {
    return splitToCharCap(
      chunkByAstRegions(filePath, relativePath, lines, language, regions),
      maxChunkChars,
      indexFormatVersion,
    );
  }

  // Fallback: line-based chunking
  return splitToCharCap(
    chunkByLines(filePath, relativePath, lines, language),
    maxChunkChars,
    indexFormatVersion,
  );
}

/**
 * Create chunks aligned to AST declaration boundaries.
 * Groups small declarations together; sub-chunks large ones.
 */
function chunkByAstRegions(
  filePath: string,
  relativePath: string,
  lines: string[],
  language: string,
  regions: AstRegion[],
): FileChunk[] {
  const chunks: FileChunk[] = [];

  // Preamble: everything before the first declaration (imports, constants, comments)
  if (regions[0].startLine > 0) {
    const preambleLines = lines.slice(0, regions[0].startLine);
    if (preambleLines.some((line) => line.length > 0)) {
      chunks.push({
        id: chunkId(relativePath, 1),
        filePath,
        relativePath,
        content: preambleLines.join("\n"),
        startLine: 1,
        endLine: regions[0].startLine,
        language,
        type: "code",
      });
    }
  }

  // Process each region, merging small ones, sub-chunking large ones
  let pendingStart = -1;
  let pendingEnd = -1;

  const flushPending = () => {
    if (pendingStart < 0) return;
    const regionLines = lines.slice(pendingStart, pendingEnd);
    const regionLength = regionLines.length;

    if (regionLength <= MAX_CHUNK_LINES) {
      chunks.push({
        id: chunkId(relativePath, pendingStart + 1),
        filePath,
        relativePath,
        content: regionLines.join("\n"),
        startLine: pendingStart + 1,
        endLine: pendingEnd,
        language,
        type: "code",
      });
    } else {
      // Sub-chunk large declarations with overlap
      for (let start = 0; start < regionLength; start += CHUNK_SIZE - CHUNK_OVERLAP) {
        const end = Math.min(start + CHUNK_SIZE, regionLength);
        chunks.push({
          id: chunkId(relativePath, pendingStart + start + 1),
          filePath,
          relativePath,
          content: regionLines.slice(start, end).join("\n"),
          startLine: pendingStart + start + 1,
          endLine: pendingStart + end,
          language,
          type: "code",
        });
        if (end >= regionLength) break;
      }
    }
    pendingStart = -1;
    pendingEnd = -1;
  };

  for (let i = 0; i < regions.length; i++) {
    const region = regions[i];
    const regionLength = region.endLine - region.startLine;

    // Include gap lines between previous region end and this region start
    const gapStart = i === 0 ? regions[0].startLine : regions[i - 1].endLine;
    const effectiveStart = gapStart < region.startLine ? gapStart : region.startLine;

    if (pendingStart < 0) {
      // Start a new pending group
      pendingStart = effectiveStart;
      pendingEnd = region.endLine;
    } else {
      const combinedLength = region.endLine - pendingStart;
      if (combinedLength <= CHUNK_SIZE && regionLength < MIN_CHUNK_LINES) {
        // Merge small declaration into pending group
        pendingEnd = region.endLine;
      } else {
        // Flush previous group, start new one
        flushPending();
        pendingStart = effectiveStart;
        pendingEnd = region.endLine;
      }
    }
  }
  flushPending();

  // Epilogue: anything after the last declaration
  const lastEnd = regions[regions.length - 1].endLine;
  if (lastEnd < lines.length) {
    const epilogueLines = lines.slice(lastEnd);
    if (epilogueLines.some((line) => line.length > 0)) {
      chunks.push({
        id: chunkId(relativePath, lastEnd + 1),
        filePath,
        relativePath,
        content: epilogueLines.join("\n"),
        startLine: lastEnd + 1,
        endLine: lines.length,
        language,
        type: "code",
      });
    }
  }

  return chunks;
}

/**
 * Fallback line-based chunking with fixed overlap.
 */
function chunkByLines(
  filePath: string,
  relativePath: string,
  lines: string[],
  language: string,
): FileChunk[] {
  const chunks: FileChunk[] = [];

  for (let start = 0; start < lines.length; start += CHUNK_SIZE - CHUNK_OVERLAP) {
    const end = Math.min(start + CHUNK_SIZE, lines.length);
    const chunkContent = lines.slice(start, end).join("\n");

    chunks.push({
      id: chunkId(relativePath, start + 1),
      filePath,
      relativePath,
      content: chunkContent,
      startLine: start + 1,
      endLine: end,
      language,
      type: "code",
    });

    if (end >= lines.length) break;
  }

  return chunks;
}

/** Get all indexable files in a project directory */
export async function getIndexableFiles(
  projectPath: string,
  extraExts?: Set<string>,
  extensionLanguageMap: Map<string, string> = EXTENSION_LANGUAGE_MAP,
): Promise<string[]> {
  const ig = createIgnoreFilter(projectPath);

  const allFiles = await glob("**/*", {
    cwd: projectPath,
    nodir: true,
    dot: (process.env.INCLUDE_DOT_FILES ?? "false").toLowerCase() === "true",
    absolute: false,
  });

  const kept: string[] = [];
  const extensionlessCandidates: string[] = [];
  const detectionEnabled = indexExtensionlessEnabled();

  for (const relativePath of allFiles) {
    if (shouldIgnore(ig, relativePath)) continue;
    const fileName = path.basename(relativePath);
    if (isIndexableFile(fileName, extraExts, extensionLanguageMap)) {
      kept.push(relativePath);
      continue;
    }
    // Extensionless survivors (detection never runs on a file with an
    // extension, and SPECIAL_FILES were already admitted above).
    if (detectionEnabled && path.extname(fileName) === "") {
      extensionlessCandidates.push(relativePath);
    }
  }

  // Batched head-read + content detection for extensionless candidates.
  for (let i = 0; i < extensionlessCandidates.length; i += FILE_SCAN_BATCH) {
    const batch = extensionlessCandidates.slice(i, i + FILE_SCAN_BATCH);
    const detected = await Promise.all(
      batch.map(async (relativePath) => {
        const ext = await resolveExtensionlessExtension(path.join(projectPath, relativePath));
        return ext ? relativePath : null;
      }),
    );
    for (const r of detected) if (r) kept.push(r);
  }

  return kept;
}

/** Full index of a project directory */
export async function indexProject(
  projectPath: string,
  onProgress?: (message: string) => void,
  extraExtensions?: Set<string>,
): Promise<{ filesIndexed: number; chunksCreated: number; cancelled: boolean }> {
  // Register dynamic AST grammars for AST-aware chunking
  ensureDynamicLanguages();

  const resolvedPath = path.resolve(projectPath);

  // Cross-process lock: prevent two MCP instances from indexing the same project
  const lockAcquired = await acquireProjectLock(resolvedPath, "index", () =>
    cancelBecauseLockWasLost(resolvedPath),
  );
  if (!lockAcquired) {
    const msg = "Another process is already indexing this project, skipping";
    logger.info(msg, { projectPath: resolvedPath });
    onProgress?.(msg);
    return { filesIndexed: 0, chunksCreated: 0, cancelled: false };
  }

  const progress: IndexingProgress = {
    type: "full-index",
    startedAt: Date.now(),
    filesTotal: 0,
    filesProcessed: 0,
    phase: "setting up",
  };
  indexingInProgress.set(resolvedPath, progress);

  try {
  const projectId = projectIdFromPath(resolvedPath);
  const collection = collectionName(projectId);
  const hashes = await getProjectHashes(projectId, collection, resolvedPath);

  // Smart re-index: check if collection already has data.
  // getCollectionInfo now throws on transient errors (instead of returning null),
  // so a Qdrant blip will abort the operation rather than trigger a false clean-start.
  let existingInfo: CollectionInfo | null;
  try {
    existingInfo = await getCollectionInfo(collection);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("Cannot determine collection state — aborting indexing to protect existing data", {
      collection,
      error: msg,
    });
    throw new Error(`Failed to check collection state for ${collection}: ${msg}. Aborting to avoid accidental data loss.`);
  }
  const hasExistingData = existingInfo !== null && existingInfo.pointsCount > 0;

  // Resuming from `in-progress` is the one state where hashes are known to
  // outlive the chunks they describe, so it is the one state that pays for the
  // reconciliation scroll. See reconcileHashesWithStoredPoints for why this is
  // scoped rather than run on every index.
  if (hasExistingData) {
    // Strict read on purpose: getProjectMetadata() answers null for any failure,
    // so using it here would turn a transient metadata error into "not
    // interrupted", skip the recovery that error should have triggered, and let
    // the run persist a still-damaged index as completed. A failed read must
    // abort instead.
    const persisted = await loadIndexingStatus(collection);
    if (persisted === "in-progress") {
      await reconcileHashesWithStoredPoints(collection, hashes, projectId);
    }
  }

  const storedProfile = existingInfo === null
    ? null
    : await loadProjectEffectiveProfile(collection);
  const effectiveProfile = resolveEffectiveIndexProfile(
    "code",
    storedProfile,
    hasExistingData,
    existingInfo?.denseVectorSize,
  );
  const effectiveExtensionMap = profileExtensionLanguageMap(effectiveProfile);
  const effectiveMaxFileBytes = effectiveProfile.maxFileBytes;
  if (effectiveMaxFileBytes === undefined) {
    throw new Error(`Code index profile for ${collection} has no maxFileBytes value.`);
  }
  const effectiveDocumentText = documentTextProfile(effectiveProfile);
  await ensureEffectiveEmbeddingReady(effectiveProfile, onProgress);

  // ensureCollection is idempotent — creates if absent, no-op if exists.
  // IMPORTANT: We NEVER delete a collection here. Only removeProjectIndex
  // (called by the codebase_remove tool) is allowed to delete collections.
  await withEffectiveEmbedding(effectiveProfile, () => ensureCollection(collection));

  if (hasExistingData) {
    if (hashes.size > 0) {
      onProgress?.(`Existing index found (${existingInfo?.pointsCount} chunks, ${hashes.size} file hashes), resuming...`);
    } else {
      // Collection has data but no hashes — likely a crash before metadata was saved,
      // or hashes were lost. Re-embed everything but keep existing chunks to avoid
      // destroying a partially completed index.
      onProgress?.(`Existing index found (${existingInfo?.pointsCount} chunks, no file hashes). Re-indexing all files (existing chunks preserved)...`);
    }
  } else {
    // Collection is empty or was just created — fresh start, clear any stale in-memory hashes
    if (existingInfo === null) {
      onProgress?.(`Setting up collection ${collection} (new)...`);
      logger.info("Collection did not exist, created fresh", { collection });
    } else {
      onProgress?.(`Setting up collection ${collection} (empty, reusing)...`);
      logger.info("Collection exists but is empty, reusing", { collection, pointsCount: existingInfo.pointsCount });
    }
    hashes.clear();
  }

  // Persist the profile before the first vector write. A crash between an
  // upsert and the first batch checkpoint must not leave unprofiled new points.
  await saveProjectMetadata(
    collection,
    resolvedPath,
    0,
    hashes.size,
    hashes,
    "in-progress",
    effectiveProfile,
  );

  // ── Phase 1: Scan and chunk files ──
  progress.phase = "scanning files";
  const files = await getIndexableFiles(
    resolvedPath,
    extraExtensions,
    effectiveExtensionMap,
  );
  if (files.some((file) => isElixirTemplateExtension(path.extname(file)))) {
    await ensureElixirTemplateParsers();
  }
  progress.filesTotal = files.length;
  onProgress?.(`Found ${files.length} indexable files`);

  interface ChunkedFile {
    relativePath: string;
    absolutePath: string;
    contentHash: string;
    chunks: FileChunk[];
  }

  const chunkedFiles: ChunkedFile[] = [];
  const oversizedFiles = new Set<string>();
  let skippedCount = 0;

  for (let i = 0; i < files.length; i += FILE_SCAN_BATCH) {
    const batch = files.slice(i, i + FILE_SCAN_BATCH);
    const results = await Promise.all(
      batch.map(async (relativePath): Promise<ChunkedFile | null> => {
        const absolutePath = path.join(resolvedPath, relativePath);
        try {
          const stat = await fsp.stat(absolutePath);
          if (stat.size > effectiveMaxFileBytes) {
            onProgress?.(`Skipping large file (${(stat.size / 1024 / 1024).toFixed(1)}MB): ${relativePath}`);
            oversizedFiles.add(relativePath);
            return null;
          }
          const content = await fsp.readFile(absolutePath, "utf-8");
          const contentHash = hashContent(content);

          // Skip unchanged files during re-index
          if (hasExistingData && hashes.get(relativePath) === contentHash) {
            return null;
          }

          const chunks = chunkFileContent(absolutePath, relativePath, content, {
            maxChunkChars: effectiveProfile.maxChunkChars,
            extensionLanguageMap: effectiveExtensionMap,
            indexFormatVersion: effectiveProfile.indexFormatVersion,
          });
          return { relativePath, absolutePath, contentHash, chunks };
        } catch {
          return null;
        }
      }),
    );

    for (const r of results) {
      if (r) chunkedFiles.push(r);
      else skippedCount++;
    }
    progress.filesProcessed = Math.min(i + batch.length, files.length);
  }

  if (hasExistingData) {
    onProgress?.(`${chunkedFiles.length} files changed, ${skippedCount} unchanged/skipped`);

    // Delete old chunks for changed files
    progress.phase = "cleaning stale chunks";
    for (const file of chunkedFiles) {
      if (hashes.has(file.relativePath)) {
        await deleteFileChunks(collection, file.relativePath);
      }
    }

    // Handle deleted files
    const currentFileSet = new Set(
      files.filter((relativePath) => !oversizedFiles.has(relativePath)),
    );
    for (const [filePath] of hashes) {
      if (!currentFileSet.has(filePath)) {
        await deleteFileChunks(collection, filePath);
        hashes.delete(filePath);
      }
    }
  }

  // ── Phase 2 & 3: Process files in batches (embed → upsert → checkpoint) ──
  const totalBatches = Math.ceil(chunkedFiles.length / INDEX_BATCH_SIZE) || 1;
  progress.batchesTotal = totalBatches;
  progress.batchesProcessed = 0;

  // Count total chunks across all batches for progress reporting
  let totalChunks = 0;
  for (const file of chunkedFiles) totalChunks += file.chunks.length;
  progress.chunksTotal = totalChunks;
  progress.chunksProcessed = 0;

  let globalChunksProcessed = 0;
  let totalChunksCreated = 0;

  for (let batchIdx = 0; batchIdx < chunkedFiles.length; batchIdx += INDEX_BATCH_SIZE) {
    // ── Cancellation check: stop gracefully between batches ──
    if (isCancellationRequested(resolvedPath)) {
      const chunksIndexed = totalChunksCreated;
      onProgress?.(`Indexing cancelled after ${progress.batchesProcessed ?? 0}/${totalBatches} batches (${chunksIndexed} chunks saved). Progress is preserved — re-run codebase_index to resume.`);
      logger.info("Indexing cancelled by user", { projectPath: resolvedPath, batchesCompleted: progress.batchesProcessed ?? 0, totalBatches, chunksIndexed });
      lastCompleted.set(resolvedPath, {
        type: "full-index",
        completedAt: Date.now(),
        durationMs: Date.now() - progress.startedAt,
        filesProcessed: progress.filesProcessed,
        chunksCreated: chunksIndexed,
        error: "Cancelled by user",
      });
      return { filesIndexed: progress.filesProcessed, chunksCreated: chunksIndexed, cancelled: true };
    }

    const fileBatch = chunkedFiles.slice(batchIdx, batchIdx + INDEX_BATCH_SIZE);
    const batchNum = Math.floor(batchIdx / INDEX_BATCH_SIZE) + 1;

    // Collect chunks for this file batch
    const batchChunkData: Array<{ chunk: FileChunk; contentHash: string; absolutePath: string }> = [];
    for (const file of fileBatch) {
      for (const chunk of file.chunks) {
        batchChunkData.push({ chunk, contentHash: file.contentHash, absolutePath: file.absolutePath });
      }
    }

    if (batchChunkData.length === 0) {
      for (const file of fileBatch) {
        hashes.set(file.relativePath, file.contentHash);
      }
      progress.phase = `checkpointing (batch ${batchNum}/${totalBatches})`;
      await saveProjectMetadata(
        collection,
        resolvedPath,
        files.length,
        hashes.size,
        hashes,
        "in-progress",
        effectiveProfile,
      );
      progress.batchesProcessed = batchNum;
      onProgress?.(`Batch ${batchNum}/${totalBatches} checkpointed (${totalChunksCreated} chunks so far)`);
      continue;
    }

    // Generate embeddings for this batch
    progress.phase = `generating embeddings (batch ${batchNum}/${totalBatches})`;
    onProgress?.(`Batch ${batchNum}/${totalBatches}: generating embeddings for ${batchChunkData.length} chunks (${fileBatch.length} files)...`);

    const batchTexts = batchChunkData.map((c) =>
      prepareDocumentText(c.chunk.content, c.chunk.relativePath, effectiveDocumentText),
    );
    const batchEmbeddings = await withEffectiveEmbedding(effectiveProfile, () =>
      generateEmbeddings(batchTexts, (processed) => {
        progress.chunksProcessed = globalChunksProcessed + processed;
      }),
    );
    globalChunksProcessed += batchChunkData.length;

    // Upsert this batch to Qdrant
    progress.phase = `storing index (batch ${batchNum}/${totalBatches})`;
    const batchPoints = batchChunkData.map((c, i) => ({
      id: c.chunk.id,
      vector: batchEmbeddings[i],
      bm25Text: batchTexts[i],
      payload: {
        filePath: c.chunk.filePath,
        relativePath: c.chunk.relativePath,
        content: c.chunk.content,
        startLine: c.chunk.startLine,
        endLine: c.chunk.endLine,
        language: c.chunk.language,
        type: c.chunk.type,
        contentHash: c.contentHash,
      },
    }));

    // Throws if any point failed after the per-point fallback, so hashes below
    // are only advanced for a batch that landed in full.
    await upsertPreEmbeddedChunks(collection, batchPoints).catch((err) => {
      // Enrich the error with batch context for debugging
      const fileList = fileBatch.map((f) => f.relativePath).join(", ");
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Qdrant upsert failed for batch ${batchNum}/${totalBatches} ` +
        `(${batchPoints.length} points, collection=${collection}): ${msg}. ` +
        `Files in batch: ${fileList}`
      );
    });

    // Update hashes for this batch's files
    for (const file of fileBatch) {
      hashes.set(file.relativePath, file.contentHash);
    }
    totalChunksCreated += batchChunkData.length;

    // Checkpoint: persist hashes after each batch so progress survives crashes
    progress.phase = `checkpointing (batch ${batchNum}/${totalBatches})`;
    await saveProjectMetadata(
      collection,
      resolvedPath,
      files.length,
      hashes.size,
      hashes,
      "in-progress",
      effectiveProfile,
    );
    progress.batchesProcessed = batchNum;
    onProgress?.(`Batch ${batchNum}/${totalBatches} checkpointed (${totalChunksCreated} chunks so far)`);
  }

  // filesTotal is everything the walk found; filesIndexed is what the index
  // actually represents. They differ whenever a file was skipped before
  // chunking — oversized, or unreadable — so the walked count would overstate
  // the result. hashes.size is authoritative: oversized paths are excluded from
  // currentFileSet above and pruned from hashes, and unreadable files never get
  // an entry. Reaching here means every batch landed in full, since a partial
  // upsert throws, so no stale entry can inflate it either.
  const filesTotal = files.length;
  const filesIndexed = hashes.size;
  const chunksCreated = totalChunksCreated;

  // The batch loop's check cannot see a cancellation that arrives during the
  // final batch, and a run with no batches never reaches it at all. Either way
  // the flag would be set and never read, and this transition would then tell
  // the next run the collection is healthy — suppressing the reconciliation
  // that repairs it. The checkpoints above already persisted `in-progress`, so
  // returning here leaves the collection recoverable.
  if (isCancellationRequested(resolvedPath)) {
    onProgress?.(`Indexing cancelled before completion (${chunksCreated} chunks saved). Progress is preserved — re-run codebase_index to resume.`);
    logger.info("Indexing cancelled before the completed transition", { projectPath: resolvedPath, chunksIndexed: chunksCreated });
    lastCompleted.set(resolvedPath, {
      type: "full-index",
      completedAt: Date.now(),
      durationMs: Date.now() - progress.startedAt,
      filesProcessed: progress.filesProcessed,
      chunksCreated,
      error: "Cancelled by user",
    });
    return { filesIndexed: progress.filesProcessed, chunksCreated, cancelled: true };
  }

  // Final metadata save
  progress.phase = "saving metadata";
  const completedStands = await persistCompletedUnlessLockLost(
    collection,
    resolvedPath,
    filesTotal,
    filesIndexed,
    hashes,
    effectiveProfile,
  );
  if (!completedStands) {
    onProgress?.(`Indexing cancelled while completing (${chunksCreated} chunks saved). Progress is preserved — re-run codebase_index to resume.`);
    lastCompleted.set(resolvedPath, {
      type: "full-index",
      completedAt: Date.now(),
      durationMs: Date.now() - progress.startedAt,
      filesProcessed: progress.filesProcessed,
      chunksCreated,
      error: "Cancelled by user",
    });
    return { filesIndexed: progress.filesProcessed, chunksCreated, cancelled: true };
  }

  // Post-terminal phases are long, asynchronous, and write to collections the
  // reconciliation does not cover — the code graph, the symbol graph and the
  // context artifacts. A lock lost during any of them leaves this process
  // writing to a project it no longer owns, and previously the run carried on
  // through every remaining phase and then reported success. Check between
  // phases and stop instead.
  const stopIfCancelled = (): {
    filesIndexed: number;
    chunksCreated: number;
    cancelled: boolean;
  } | null => {
    if (!isCancellationRequested(resolvedPath)) return null;
    onProgress?.(`Indexing cancelled during ${progress.phase} (${chunksCreated} chunks saved). The index itself is written; re-run codebase_index to finish the remaining work.`);
    logger.info("Indexing cancelled during post-index work", {
      projectPath: resolvedPath,
      phase: progress.phase,
    });
    lastCompleted.set(resolvedPath, {
      type: "full-index",
      completedAt: Date.now(),
      durationMs: Date.now() - progress.startedAt,
      filesProcessed: filesIndexed,
      chunksCreated,
      error: "Cancelled by user",
    });
    return { filesIndexed, chunksCreated, cancelled: true };
  };

  let postIndexCancelled = stopIfCancelled();
  if (postIndexCancelled) return postIndexCancelled;

  // Auto-build code graph
  progress.phase = "building code graph";
  onProgress?.("Building code dependency graph...");
  try {
    // The same extra extensions the index was built with: a graph built under
    // the defaults would drop every leaf node they admit, and the record would
    // then disagree with the next decision about which set was in force.
    const graph = await rebuildGraph(resolvedPath, extraExtensions);
    onProgress?.(`Code graph built: ${graph.nodes.length} files, ${graph.edges.length} edges`);
  } catch (graphErr) {
    const graphMsg = graphErr instanceof Error ? graphErr.message : String(graphErr);
    logger.warn("Code graph build failed (non-fatal)", { projectPath: resolvedPath, error: graphMsg });
    onProgress?.(`Code graph build failed (non-fatal): ${graphMsg}`);
  }

  postIndexCancelled = stopIfCancelled();
  if (postIndexCancelled) return postIndexCancelled;

  // Auto-index context artifacts if .socraticodecontextartifacts.json exists
  try {
    const artifactConfig = await loadConfig(resolvedPath);
    // Ownership can be lost while loadConfig is pending, and this run would
    // then start a fresh write to the context collection for a project it no
    // longer owns. The gate before this phase cannot see that, so check again
    // once the await has resolved and before anything is written.
    postIndexCancelled = stopIfCancelled();
    if (postIndexCancelled) return postIndexCancelled;

    if (artifactConfig?.artifacts?.length) {
      progress.phase = "indexing context artifacts";
      onProgress?.(`Indexing ${artifactConfig.artifacts.length} context artifact${artifactConfig.artifacts.length === 1 ? "" : "s"}...`);
      const result = await ensureArtifactsIndexed(resolvedPath);
      if (result.reindexed.length > 0) {
        onProgress?.(`Context artifacts: ${result.reindexed.length} indexed/re-indexed, ${result.upToDate.length} up-to-date`);
      } else {
        onProgress?.(`Context artifacts: ${result.upToDate.length} artifact${result.upToDate.length === 1 ? "" : "s"} up-to-date`);
      }
    }
  } catch (artifactErr) {
    const artifactMsg = artifactErr instanceof Error ? artifactErr.message : String(artifactErr);
    logger.warn("Context artifact indexing failed (non-fatal)", { projectPath: resolvedPath, error: artifactMsg });
    onProgress?.(`Context artifact indexing failed (non-fatal): ${artifactMsg}`);
  }

  postIndexCancelled = stopIfCancelled();
  if (postIndexCancelled) return postIndexCancelled;

  onProgress?.(`Indexing complete: ${filesIndexed} files, ${chunksCreated} chunks`);
  lastCompleted.set(resolvedPath, {
    type: "full-index",
    completedAt: Date.now(),
    durationMs: Date.now() - progress.startedAt,
    filesProcessed: filesIndexed,
    chunksCreated,
  });
  return { filesIndexed, chunksCreated, cancelled: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    progress.error = message;
    lastCompleted.set(resolvedPath, {
      type: "full-index",
      completedAt: Date.now(),
      durationMs: Date.now() - progress.startedAt,
      filesProcessed: progress.filesProcessed,
      chunksCreated: 0,
      error: message,
    });
    throw err;
  } finally {
    indexingInProgress.delete(resolvedPath);
    cancellationRequested.delete(resolvedPath);
    await releaseProjectLock(resolvedPath, "index");
  }
}

/** Incremental update: only re-index changed/new files, remove deleted ones */
export async function updateProjectIndex(
  projectPath: string,
  onProgress?: (message: string) => void,
  extraExtensions?: Set<string>,
): Promise<{ added: number; updated: number; removed: number; chunksCreated: number; cancelled: boolean }> {
  ensureDynamicLanguages();

  const resolvedPath = path.resolve(projectPath);

  // Cross-process lock: prevent two MCP instances from updating the same project
  const lockAcquired = await acquireProjectLock(resolvedPath, "index", () =>
    cancelBecauseLockWasLost(resolvedPath),
  );
  if (!lockAcquired) {
    const msg = "Another process is already indexing this project, skipping";
    logger.info(msg, { projectPath: resolvedPath });
    onProgress?.(msg);
    return { added: 0, updated: 0, removed: 0, chunksCreated: 0, cancelled: false };
  }

  const progress: IndexingProgress = {
    type: "incremental-update",
    startedAt: Date.now(),
    filesTotal: 0,
    filesProcessed: 0,
    phase: "checking for changes",
  };
  indexingInProgress.set(resolvedPath, progress);

  try {
  const projectId = projectIdFromPath(resolvedPath);
  const collection = collectionName(projectId);
  const hashes = await getProjectHashes(projectId, collection, resolvedPath);

  // Ensure collection exists — getCollectionInfo now throws on transient errors,
  // so a network blip will abort rather than cascade into a destructive fallback.
  let info: CollectionInfo | null;
  try {
    info = await getCollectionInfo(collection);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("Cannot determine collection state during update — aborting to protect existing data", {
      collection,
      error: msg,
    });
    throw new Error(`Failed to check collection state for ${collection}: ${msg}. Aborting to avoid accidental data loss.`);
  }

  if (!info || info.pointsCount === 0) {
    // Collection truly doesn't exist or is empty — safe to do a full index
    onProgress?.("No existing index found, performing full index...");
    const result = await indexProject(projectPath, onProgress, extraExtensions);
    return { added: result.filesIndexed, updated: 0, removed: 0, chunksCreated: result.chunksCreated, cancelled: result.cancelled };
  }

  // Same reconciliation as indexProject, and needed here for the same reason:
  // an incremental is what usually runs after an interruption, so this is the
  // path that would otherwise trust a hash whose chunks are gone and skip the
  // file forever. Scoped to `in-progress` — see reconcileHashesWithStoredPoints.
  {
    // Strict read — see the note at the matching gate in indexProject.
    const persisted = await loadIndexingStatus(collection);
    if (persisted === "in-progress") {
      await reconcileHashesWithStoredPoints(collection, hashes, projectId);
    }
  }

  if (hashes.size === 0) {
    // Collection has data but no hashes — do NOT fall through to a clean full index
    // that might delete the collection. Instead, call indexProject which will detect
    // existing data via getCollectionInfo and use re-index mode (preserving the collection).
    onProgress?.(`No metadata found for existing index (${info.pointsCount} chunks). Re-indexing all files (existing data preserved)...`);
    logger.info("updateProjectIndex: falling back to re-index (no hashes, but collection has data)", {
      collection,
      pointsCount: info.pointsCount,
    });
    const result = await indexProject(projectPath, onProgress, extraExtensions);
    return { added: result.filesIndexed, updated: 0, removed: 0, chunksCreated: result.chunksCreated, cancelled: result.cancelled };
  }

  const storedProfile = await loadProjectEffectiveProfile(collection);
  const effectiveProfile = resolveEffectiveIndexProfile(
    "code",
    storedProfile,
    true,
    info.denseVectorSize,
  );
  const effectiveExtensionMap = profileExtensionLanguageMap(effectiveProfile);
  const effectiveMaxFileBytes = effectiveProfile.maxFileBytes;
  if (effectiveMaxFileBytes === undefined) {
    throw new Error(`Code index profile for ${collection} has no maxFileBytes value.`);
  }
  const effectiveDocumentText = documentTextProfile(effectiveProfile);
  await ensureEffectiveEmbeddingReady(effectiveProfile, onProgress);

  await saveProjectMetadata(
    collection,
    resolvedPath,
    0,
    hashes.size,
    hashes,
    "in-progress",
    effectiveProfile,
  );

  // ── Phase 1: Scan files and identify changes ──
  progress.phase = "scanning for changes";
  const currentFiles = await getIndexableFiles(
    resolvedPath,
    extraExtensions,
    effectiveExtensionMap,
  );
  if (currentFiles.some((file) => isElixirTemplateExtension(path.extname(file)))) {
    await ensureElixirTemplateParsers();
  }
  progress.filesTotal = currentFiles.length;
  onProgress?.(`Found ${currentFiles.length} indexable files, scanning for changes...`);

  interface ChangedFile {
    relativePath: string;
    absolutePath: string;
    contentHash: string;
    chunks: FileChunk[];
    isNew: boolean;
  }

  const changedFiles: ChangedFile[] = [];
  const oversizedFiles = new Set<string>();
  // Files this run tried to read and could not. The index keeps whatever hash
  // it already held for them, so nothing downstream can tell they went unread —
  // except the code graph's rebuild gate, which would otherwise take that
  // stale hash as proof the file is unchanged while a rebuild would drop it.
  const unreadableFiles = new Set<string>();

  for (let i = 0; i < currentFiles.length; i += FILE_SCAN_BATCH) {
    const batch = currentFiles.slice(i, i + FILE_SCAN_BATCH);
    const results = await Promise.all(
      batch.map(async (relativePath): Promise<ChangedFile | null> => {
        const absolutePath = path.join(resolvedPath, relativePath);
        let read = false;
        try {
          const stat = await fsp.stat(absolutePath);
          if (stat.size > effectiveMaxFileBytes) {
            onProgress?.(`Skipping large file (${(stat.size / 1024 / 1024).toFixed(1)}MB): ${relativePath}`);
            oversizedFiles.add(relativePath);
            return null;
          }
          const content = await fsp.readFile(absolutePath, "utf-8");
          read = true;
          const contentHash = hashContent(content);
          const existingHash = hashes.get(relativePath);

          if (existingHash === contentHash) return null;

          const chunks = chunkFileContent(absolutePath, relativePath, content, {
            maxChunkChars: effectiveProfile.maxChunkChars,
            extensionLanguageMap: effectiveExtensionMap,
            indexFormatVersion: effectiveProfile.indexFormatVersion,
          });
          return { relativePath, absolutePath, contentHash, chunks, isNew: !existingHash };
        } catch {
          // Only a stat or read that failed counts: a file that was read and
          // then failed to chunk is not unreadable, and marking it so would
          // rebuild the graph on every run for as long as it stayed that way.
          if (!read) unreadableFiles.add(relativePath);
          return null;
        }
      }),
    );

    changedFiles.push(...results.filter((r): r is ChangedFile => r !== null));
    progress.filesProcessed = Math.min(i + batch.length, currentFiles.length);
  }

  const unchangedCount = currentFiles.length - changedFiles.length;
  onProgress?.(`${changedFiles.length} files changed, ${unchangedCount} unchanged/skipped`);
  const currentFileSet = new Set(
    currentFiles.filter((relativePath) => !oversizedFiles.has(relativePath)),
  );

  let added = 0;
  let updated = 0;
  let removed = 0;
  let chunksCreated = 0;

  if (changedFiles.length > 0) {
    // Delete old chunks for updated (not new) files
    progress.phase = "cleaning stale chunks";
    for (const file of changedFiles) {
      if (!file.isNew) {
        await deleteFileChunks(collection, file.relativePath);
      }
    }

    // ── Phase 2 & 3: Process changed files in batches (embed → upsert → checkpoint) ──
    const totalBatches = Math.ceil(changedFiles.length / INDEX_BATCH_SIZE) || 1;
    progress.batchesTotal = totalBatches;
    progress.batchesProcessed = 0;

    // Count total chunks across all batches
    let totalChunksCount = 0;
    for (const file of changedFiles) totalChunksCount += file.chunks.length;
    progress.chunksTotal = totalChunksCount;
    progress.chunksProcessed = 0;

    let globalChunksProcessed = 0;

    for (let batchIdx = 0; batchIdx < changedFiles.length; batchIdx += INDEX_BATCH_SIZE) {
      // ── Cancellation check: stop gracefully between batches ──
      if (isCancellationRequested(resolvedPath)) {
        onProgress?.(`Update cancelled after ${progress.batchesProcessed ?? 0}/${totalBatches} batches (${chunksCreated} chunks saved). Progress is preserved — re-run codebase_update to resume.`);
        logger.info("Incremental update cancelled by user", { projectPath: resolvedPath, batchesCompleted: progress.batchesProcessed ?? 0, totalBatches, chunksCreated });
        lastCompleted.set(resolvedPath, {
          type: "incremental-update",
          completedAt: Date.now(),
          durationMs: Date.now() - progress.startedAt,
          filesProcessed: progress.filesProcessed,
          chunksCreated,
          error: "Cancelled by user",
        });
        return { added, updated, removed, chunksCreated, cancelled: true };
      }

      const fileBatch = changedFiles.slice(batchIdx, batchIdx + INDEX_BATCH_SIZE);
      const batchNum = Math.floor(batchIdx / INDEX_BATCH_SIZE) + 1;

      // Collect chunks for this file batch
      const batchChunkData: Array<{ chunk: FileChunk; contentHash: string }> = [];
      for (const file of fileBatch) {
        for (const chunk of file.chunks) {
          batchChunkData.push({ chunk, contentHash: file.contentHash });
        }
      }

      if (batchChunkData.length === 0) {
        for (const file of fileBatch) {
          hashes.set(file.relativePath, file.contentHash);
          if (file.isNew) added++;
          else updated++;
        }
        progress.phase = `checkpointing (batch ${batchNum}/${totalBatches})`;
        await saveProjectMetadata(
          collection,
          resolvedPath,
          currentFiles.length,
          hashes.size,
          hashes,
          "in-progress",
          effectiveProfile,
        );
        progress.batchesProcessed = batchNum;
        onProgress?.(`Batch ${batchNum}/${totalBatches} checkpointed (${chunksCreated} chunks so far)`);
        continue;
      }

      // Generate embeddings for this batch
      progress.phase = `generating embeddings (batch ${batchNum}/${totalBatches})`;
      onProgress?.(`Batch ${batchNum}/${totalBatches}: generating embeddings for ${batchChunkData.length} chunks (${fileBatch.length} files changed)...`);

      const batchTexts = batchChunkData.map((c) =>
        prepareDocumentText(c.chunk.content, c.chunk.relativePath, effectiveDocumentText),
      );
      const batchEmbeddings = await withEffectiveEmbedding(effectiveProfile, () =>
        generateEmbeddings(batchTexts, (processed) => {
          progress.chunksProcessed = globalChunksProcessed + processed;
        }),
      );
      globalChunksProcessed += batchChunkData.length;

      // Upsert this batch to Qdrant
      progress.phase = `storing index (batch ${batchNum}/${totalBatches})`;
      const batchPoints = batchChunkData.map((c, i) => ({
        id: c.chunk.id,
        vector: batchEmbeddings[i],
        bm25Text: batchTexts[i],
        payload: {
          filePath: c.chunk.filePath,
          relativePath: c.chunk.relativePath,
          content: c.chunk.content,
          startLine: c.chunk.startLine,
          endLine: c.chunk.endLine,
          language: c.chunk.language,
          type: c.chunk.type,
          contentHash: c.contentHash,
        },
      }));

      // Throws if any point failed after the per-point fallback, so hashes below
      // are only advanced for a batch that landed in full.
      await upsertPreEmbeddedChunks(collection, batchPoints);

      // Update hashes and counts for this batch's files
      for (const file of fileBatch) {
        hashes.set(file.relativePath, file.contentHash);
        if (file.isNew) added++;
        else updated++;
      }
      chunksCreated += batchChunkData.length;

      // Checkpoint: persist hashes after each batch
      progress.phase = `checkpointing (batch ${batchNum}/${totalBatches})`;
      await saveProjectMetadata(
        collection,
        resolvedPath,
        currentFiles.length,
        hashes.size,
        hashes,
        "in-progress",
        effectiveProfile,
      );
      progress.batchesProcessed = batchNum;
      onProgress?.(`Batch ${batchNum}/${totalBatches} checkpointed (${chunksCreated} chunks so far)`);
    }
  }

  // Check for deleted files
  progress.phase = "removing deleted files";
  const removedRelPaths: string[] = [];
  for (const [filePath] of hashes) {
    if (!currentFileSet.has(filePath)) {
      await deleteFileChunks(collection, filePath);
      hashes.delete(filePath);
      removed++;
      removedRelPaths.push(filePath);
    }
  }

  // Same terminal gate as the full index, and it matters more here: the removal
  // loop above deletes chunks, and the batch loop is skipped entirely when
  // nothing changed, so a cancellation can arrive with no later check to read
  // it. Persisting `completed` over a half-removed collection is precisely the
  // state the reconciliation on resume exists to repair.
  if (isCancellationRequested(resolvedPath)) {
    onProgress?.(`Update cancelled before completion (${chunksCreated} chunks saved). Progress is preserved — re-run codebase_update to resume.`);
    logger.info("Incremental update cancelled before the completed transition", { projectPath: resolvedPath, chunksCreated });
    lastCompleted.set(resolvedPath, {
      type: "incremental-update",
      completedAt: Date.now(),
      durationMs: Date.now() - progress.startedAt,
      filesProcessed: progress.filesProcessed,
      chunksCreated,
      error: "Cancelled by user",
    });
    return { added, updated, removed, chunksCreated, cancelled: true };
  }

  // Persist updated hashes
  const completedStands = await persistCompletedUnlessLockLost(
    collection,
    resolvedPath,
    currentFiles.length,
    hashes.size,
    hashes,
    effectiveProfile,
  );
  if (!completedStands) {
    onProgress?.(`Update cancelled while completing (${chunksCreated} chunks saved). Progress is preserved — re-run codebase_update to resume.`);
    lastCompleted.set(resolvedPath, {
      type: "incremental-update",
      completedAt: Date.now(),
      durationMs: Date.now() - progress.startedAt,
      filesProcessed: progress.filesProcessed,
      chunksCreated,
      error: "Cancelled by user",
    });
    return { added, updated, removed, chunksCreated, cancelled: true };
  }

  // Same post-terminal guard as the full index: the graph, symbol-graph and
  // context collections are written here, none of them covered by the
  // reconciliation, so a lock lost during one of these phases must stop the run
  // rather than carry it through to a success result.
  const stopIfCancelled = (): {
    added: number;
    updated: number;
    removed: number;
    chunksCreated: number;
    cancelled: boolean;
  } | null => {
    if (!isCancellationRequested(resolvedPath)) return null;
    onProgress?.(`Update cancelled during ${progress.phase} (${chunksCreated} chunks saved). The index itself is written; re-run codebase_update to finish the remaining work.`);
    logger.info("Incremental update cancelled during post-index work", {
      projectPath: resolvedPath,
      phase: progress.phase,
    });
    lastCompleted.set(resolvedPath, {
      type: "incremental-update",
      completedAt: Date.now(),
      durationMs: Date.now() - progress.startedAt,
      filesProcessed: progress.filesProcessed,
      chunksCreated,
      error: "Cancelled by user",
    });
    return { added, updated, removed, chunksCreated, cancelled: true };
  };

  let postIndexCancelled = stopIfCancelled();
  if (postIndexCancelled) return postIndexCancelled;

  // Auto-rebuild code graph if any graph input changed (Phase F).
  //
  // While every changed or removed file requires a complete symbol-graph rebuild,
  // bypass the incremental branch and perform one complete graph rebuild.
  //
  // Not every change is one the graph is built from, though. A commit touching
  // only a README, a fixture, a migration or a manifest the resolver never
  // reads produces the graph that already exists, and pays the whole rebuild
  // for it — roughly 7ms per file, so 27s on a large repository, per commit.
  // `shouldRebuildGraph` answers from the record the last build left of what
  // it read, and says so only when the change is proven to touch none of it.
  //
  // The question is asked whether or not the index itself moved, because the
  // two sets are not the same: `go.mod`, `project.godot`, a `.uid` sidecar and
  // (unless INCLUDE_DOT_FILES is set) every ignore file shape the graph while
  // being indexed by nothing, so a commit touching only one of those has every
  // counter at zero and still leaves the graph wrong. Gated on a record having
  // been found: without one there is nothing to argue from, so a project that
  // has never been built under this scheme keeps the old trigger and the first
  // update that changes anything is what rebuilds and writes the record.
  const indexChanged = added > 0 || updated > 0 || removed > 0;
  {
    const totalChanged = changedFiles.length + removedRelPaths.length;

    try {
      // `hashes` has already been brought up to date above — changed files
      // carry their new hash and removed ones are gone — so it answers "what
      // is in this file now" for everything the index holds, and the graph's
      // recorded inputs are compared against it without reading anything
      // twice. Inputs the index does not hold are read by the decision itself.
      const decision = await shouldRebuildGraph(
        resolvedPath,
        {
          hasAdditions: changedFiles.some((file) => file.isNew),
          changed: new Map(changedFiles.map((file) => [file.relativePath, file.contentHash])),
          removed: new Set(removedRelPaths),
          unreadable: unreadableFiles,
          knownHash: (relativePath) => hashes.get(relativePath),
        },
        extraExtensions,
      );

      if (!decision.rebuild || !(indexChanged || decision.graphExists)) {
        if (indexChanged) {
          logger.info("Code graph rebuild skipped: the change touched no graph input", {
            projectPath: resolvedPath,
            filesChanged: totalChanged,
          });
          onProgress?.(
            `Code graph unchanged (${totalChanged} file(s) changed, none of them a graph input)`,
          );
        }
      } else {
        progress.phase = "building code graph";
        logger.info("Rebuilding code graph", { projectPath: resolvedPath, reason: decision.reason });
        onProgress?.(
          totalChanged > 0
            ? `Building code dependency graph (${totalChanged} file(s) changed, full rebuild)...`
            : `Building code dependency graph (${decision.reason})...`,
        );
        const graph = await rebuildGraph(resolvedPath, {
          skipSymbolGraph: false,
          extraExtensions,
        });
        onProgress?.(`Code graph built: ${graph.nodes.length} files, ${graph.edges.length} edges`);
      }
    } catch (graphErr) {
      const graphMsg = graphErr instanceof Error ? graphErr.message : String(graphErr);
      logger.warn("Code graph build failed during incremental update (non-fatal)", { projectPath: resolvedPath, error: graphMsg });
      onProgress?.(`Code graph build failed (non-fatal): ${graphMsg}`);
    }
  }

  postIndexCancelled = stopIfCancelled();
  if (postIndexCancelled) return postIndexCancelled;

  // Auto-index context artifacts if changed (non-fatal)
  try {
    const artifactConfig = await loadConfig(resolvedPath);
    // Ownership can be lost while loadConfig is pending, and this run would
    // then start a fresh write to the context collection for a project it no
    // longer owns. The gate before this phase cannot see that, so check again
    // once the await has resolved and before anything is written.
    postIndexCancelled = stopIfCancelled();
    if (postIndexCancelled) return postIndexCancelled;

    if (artifactConfig?.artifacts?.length) {
      progress.phase = "indexing context artifacts";
      const result = await ensureArtifactsIndexed(resolvedPath);
      if (result.reindexed.length > 0) {
        onProgress?.(`Context artifacts: ${result.reindexed.length} indexed/re-indexed, ${result.upToDate.length} up-to-date`);
      }
    }
  } catch (artifactErr) {
    const artifactMsg = artifactErr instanceof Error ? artifactErr.message : String(artifactErr);
    logger.warn("Context artifact indexing failed during incremental update (non-fatal)", { projectPath: resolvedPath, error: artifactMsg });
  }

  postIndexCancelled = stopIfCancelled();
  if (postIndexCancelled) return postIndexCancelled;

  onProgress?.(`Update complete: ${added} added, ${updated} updated, ${removed} removed`);

  lastCompleted.set(resolvedPath, {
    type: "incremental-update",
    completedAt: Date.now(),
    durationMs: Date.now() - progress.startedAt,
    filesProcessed: added + updated,
    chunksCreated,
  });
  return { added, updated, removed, chunksCreated, cancelled: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    progress.error = message;
    lastCompleted.set(resolvedPath, {
      type: "incremental-update",
      completedAt: Date.now(),
      durationMs: Date.now() - progress.startedAt,
      filesProcessed: progress.filesProcessed,
      chunksCreated: 0,
      error: message,
    });
    throw err;
  } finally {
    indexingInProgress.delete(resolvedPath);
    cancellationRequested.delete(resolvedPath);
    await releaseProjectLock(resolvedPath, "index");
  }
}

/** Remove an entire project index */
export async function removeProjectIndex(projectPath: string): Promise<void> {
  const resolvedPath = path.resolve(projectPath);
  const projectId = projectIdFromPath(resolvedPath);
  const collection = collectionName(projectId);
  await deleteCollection(collection);
  await deleteProjectMetadata(collection);
  // Also remove the code graph
  await removeGraph(resolvedPath);
  // Also remove context artifacts (if any)
  await removeAllArtifacts(resolvedPath);
  projectHashes.delete(projectId);
  projectHashesLoaded.delete(projectId);
}
