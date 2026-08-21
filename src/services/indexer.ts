// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

import { createHash } from "node:crypto";
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
  INDEX_BATCH_SIZE,
  indexExtensionlessEnabled,
  MAX_AVG_LINE_LENGTH,
  MAX_CHUNK_CHARS,MAX_FILE_BYTES,
  SPECIAL_FILES,
  SUPPORTED_EXTENSIONS
} from "../constants.js";
import type { FileChunk } from "../types.js";
import { ensureDynamicLanguages, getAstGrepLang, rebuildGraph, removeGraph } from "./code-graph.js";
import { ensureArtifactsIndexed, loadConfig, removeAllArtifacts } from "./context-artifacts.js";
import { analyzeElixirTemplate, ensureElixirTemplateParsers, isElixirTemplateExtension } from "./elixir-templates.js";
import { generateEmbeddings, prepareDocumentText } from "./embeddings.js";
import { detectExtensionFromSource, resolveExtensionlessExtension } from "./extensionless.js";
import { createIgnoreFilter, shouldIgnore } from "./ignore.js";
import { acquireProjectLock, releaseProjectLock } from "./lock.js";
import { logger } from "./logger.js";
import {
  deleteCollection,
  deleteFileChunks,
  deleteProjectMetadata,
  ensureCollection,
  getCollectionInfo,
  getProjectMetadata,
  loadProjectHashes,
  saveProjectMetadata,
  upsertPreEmbeddedChunks,
} from "./qdrant.js";
import { updateChangedFilesSymbolGraph } from "./symbol-graph-incremental.js";
import { loadSymbolGraphMeta } from "./symbol-graph-store.js";

export const FILE_SCAN_BATCH = 50; // Number of files to scan/chunk in parallel (I/O only, no network)

/**
 * Phase F: maximum number of changed/removed files for which the watcher path
 * patches the symbol graph in-place rather than rebuilding it from scratch.
 * Above this threshold a full rebuild is faster than re-running per-file
 * extraction + shard merging, since most shards would be touched anyway.
 */
const INCREMENTAL_SYMBOL_THRESHOLD = 50;

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

/** Hash file content for change detection */
export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/** Generate a stable chunk ID as a valid UUID (required by Qdrant) */
export function chunkId(relativePath: string, startLine: number): string {
  const hash = createHash("sha256").update(`${relativePath}:${startLine}`).digest("hex").slice(0, 32);
  // Format as UUID: 8-4-4-4-12
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

/** Check if a file should be indexed based on extension or name */
export function isIndexableFile(fileName: string, extraExts?: Set<string>): boolean {
  if (SPECIAL_FILES.has(fileName)) return true;
  const ext = path.extname(fileName).toLowerCase();
  if (SUPPORTED_EXTENSIONS.has(ext)) return true;
  // Extensions mapped to a real language via EXTENSION_LANGUAGE_MAP are
  // first-class source files, not plaintext extras.
  if (EXTENSION_LANGUAGE_MAP.has(ext)) return true;
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
            || grandparent.kind() === "translation_unit" || grandparent.kind() === "compilation_unit"));

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
 * Apply a hard character cap to every chunk as a universal safety net.
 * Any chunk whose content exceeds MAX_CHUNK_CHARS is truncated. This is
 * intentionally simple — the provider's pre-truncation is the last-resort
 * defence; this cap ensures chunks are already within bounds before that.
 */
function applyCharCap(chunks: FileChunk[]): FileChunk[] {
  // Terminal invariant: never emit a chunk with no non-whitespace content.
  // Four of the five `return` paths in chunkFileContent pass through here (the
  // fifth returns []), so this is the one place that can guarantee the property
  // for every chunking strategy — including zero-byte and whitespace-only files,
  // which reach chunkByLines and would otherwise yield a single blank chunk.
  // Safe to drop: chunk ids are sha256(relativePath + ":" + startLine), so
  // removing a chunk never renumbers any other.
  //
  // ORDER MATTERS: cap first, then filter. Filtering first lets a chunk whose only
  // non-whitespace content sits past MAX_CHUNK_CHARS pass the filter and then be
  // truncated back into a blank chunk, so the invariant would not actually hold.
  const capped =
    chunks.every((c) => c.content.length <= MAX_CHUNK_CHARS)
      ? chunks
      : chunks.map((c) =>
          c.content.length > MAX_CHUNK_CHARS
            ? { ...c, content: c.content.substring(0, MAX_CHUNK_CHARS) }
            : c,
        );
  return capped.filter((c) => c.content.trim().length > 0);
}

/**
 * Character-based chunking for minified/bundled content whose average line
 * length exceeds MAX_AVG_LINE_LENGTH. Splits at safe token boundaries
 * (newline, space, tab, semicolon, comma) so chunks stay within
 * MAX_CHUNK_CHARS without splitting mid-identifier.
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
): FileChunk[] {
  const chunks: FileChunk[] = [];
  let offset = 0;
  let currentLine = 1;

  while (offset < content.length) {
    let end = Math.min(offset + MAX_CHUNK_CHARS, content.length);

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
): FileChunk[] {
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
  const language = getLanguageFromExtension(ext);

  // Detect minified/bundled content before any other branching: a high
  // average line length means line-based chunks would be huge single lines
  // that overflow the embedding model's context window.
  const avgLineLength = lines.length > 0 ? content.length / lines.length : 0;
  if (avgLineLength > MAX_AVG_LINE_LENGTH) {
    logger.debug("Minified/bundled content detected — using character-based chunking", {
      relativePath,
      avgLineLength: Math.round(avgLineLength),
    });
    return applyCharCap(chunkByCharacters(filePath, relativePath, content, language));
  }

  // Small files: single chunk regardless of language
  if (lines.length <= CHUNK_SIZE) {
    return applyCharCap([{
      id: chunkId(relativePath, 1),
      filePath,
      relativePath,
      content,
      startLine: 1,
      endLine: lines.length,
      language,
      type: "code",
    }]);
  }

  // Try AST-aware chunking for supported languages and mixed Elixir templates.
  const astLang = getAstGrepLang(ext);
  const regions = isElixirTemplateExtension(ext)
    ? (analyzeElixirTemplate(content, ext)?.regions ?? [])
    : astLang ? findAstBoundaries(content, astLang) : [];

  if (regions.length > 0) {
    return applyCharCap(chunkByAstRegions(filePath, relativePath, lines, language, regions));
  }

  // Fallback: line-based chunking
  return applyCharCap(chunkByLines(filePath, relativePath, lines, language));
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
    if (isIndexableFile(fileName, extraExts)) {
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
  const lockAcquired = await acquireProjectLock(resolvedPath, "index");
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
  let existingInfo: { pointsCount: number; status: string } | null;
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

  // ensureCollection is idempotent — creates if absent, no-op if exists.
  // IMPORTANT: We NEVER delete a collection here. Only removeProjectIndex
  // (called by the codebase_remove tool) is allowed to delete collections.
  await ensureCollection(collection);

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

  // ── Phase 1: Scan and chunk files ──
  progress.phase = "scanning files";
  const files = await getIndexableFiles(resolvedPath, extraExtensions);
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
  let skippedCount = 0;

  for (let i = 0; i < files.length; i += FILE_SCAN_BATCH) {
    const batch = files.slice(i, i + FILE_SCAN_BATCH);
    const results = await Promise.all(
      batch.map(async (relativePath): Promise<ChunkedFile | null> => {
        const absolutePath = path.join(resolvedPath, relativePath);
        try {
          const stat = await fsp.stat(absolutePath);
          if (stat.size > MAX_FILE_BYTES) {
            onProgress?.(`Skipping large file (${(stat.size / 1024 / 1024).toFixed(1)}MB): ${relativePath}`);
            return null;
          }
          const content = await fsp.readFile(absolutePath, "utf-8");
          const contentHash = hashContent(content);

          // Skip unchanged files during re-index
          if (hasExistingData && hashes.get(relativePath) === contentHash) {
            return null;
          }

          const chunks = chunkFileContent(absolutePath, relativePath, content);
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
    const currentFileSet = new Set(files);
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
      progress.batchesProcessed = batchNum;
      continue;
    }

    // Generate embeddings for this batch
    progress.phase = `generating embeddings (batch ${batchNum}/${totalBatches})`;
    onProgress?.(`Batch ${batchNum}/${totalBatches}: generating embeddings for ${batchChunkData.length} chunks (${fileBatch.length} files)...`);

    const batchTexts = batchChunkData.map((c) => prepareDocumentText(c.chunk.content, c.chunk.relativePath));
    const batchEmbeddings = await generateEmbeddings(batchTexts, (processed) => {
      progress.chunksProcessed = globalChunksProcessed + processed;
    });
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

    const { pointsSkipped } = await upsertPreEmbeddedChunks(collection, batchPoints).catch((err) => {
      // Enrich the error with batch context for debugging
      const fileList = fileBatch.map((f) => f.relativePath).join(", ");
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Qdrant upsert failed for batch ${batchNum}/${totalBatches} ` +
        `(${batchPoints.length} points, collection=${collection}): ${msg}. ` +
        `Files in batch: ${fileList}`
      );
    });

    if (pointsSkipped > 0 && pointsSkipped === batchPoints.length) {
      // Every single point in the batch was skipped — the collection likely disappeared
      throw new Error(
        `Qdrant upsert: all ${batchPoints.length} points in batch ${batchNum}/${totalBatches} ` +
        `were skipped (collection=${collection}). The collection may have been deleted externally.`
      );
    }

    // Update hashes for this batch's files
    for (const file of fileBatch) {
      hashes.set(file.relativePath, file.contentHash);
    }
    totalChunksCreated += batchChunkData.length;

    // Checkpoint: persist hashes after each batch so progress survives crashes
    progress.phase = `checkpointing (batch ${batchNum}/${totalBatches})`;
    await saveProjectMetadata(collection, resolvedPath, files.length, hashes.size, hashes, "in-progress");
    progress.batchesProcessed = batchNum;
    onProgress?.(`Batch ${batchNum}/${totalBatches} checkpointed (${totalChunksCreated} chunks so far)`);
  }

  const filesIndexed = files.length;
  const chunksCreated = totalChunksCreated;

  // Final metadata save
  progress.phase = "saving metadata";
  await saveProjectMetadata(collection, resolvedPath, filesIndexed, hashes.size, hashes, "completed");

  // Auto-build code graph
  progress.phase = "building code graph";
  onProgress?.("Building code dependency graph...");
  try {
    const graph = await rebuildGraph(resolvedPath);
    onProgress?.(`Code graph built: ${graph.nodes.length} files, ${graph.edges.length} edges`);
  } catch (graphErr) {
    const graphMsg = graphErr instanceof Error ? graphErr.message : String(graphErr);
    logger.warn("Code graph build failed (non-fatal)", { projectPath: resolvedPath, error: graphMsg });
    onProgress?.(`Code graph build failed (non-fatal): ${graphMsg}`);
  }

  // Auto-index context artifacts if .socraticodecontextartifacts.json exists
  try {
    const artifactConfig = await loadConfig(resolvedPath);
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
  const lockAcquired = await acquireProjectLock(resolvedPath, "index");
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
  let info: { pointsCount: number; status: string } | null;
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

  // ── Phase 1: Scan files and identify changes ──
  progress.phase = "scanning for changes";
  const currentFiles = await getIndexableFiles(resolvedPath, extraExtensions);
  if (currentFiles.some((file) => isElixirTemplateExtension(path.extname(file)))) {
    await ensureElixirTemplateParsers();
  }
  progress.filesTotal = currentFiles.length;
  onProgress?.(`Found ${currentFiles.length} indexable files, scanning for changes...`);
  const currentFileSet = new Set(currentFiles);

  interface ChangedFile {
    relativePath: string;
    absolutePath: string;
    contentHash: string;
    chunks: FileChunk[];
    isNew: boolean;
  }

  const changedFiles: ChangedFile[] = [];

  for (let i = 0; i < currentFiles.length; i += FILE_SCAN_BATCH) {
    const batch = currentFiles.slice(i, i + FILE_SCAN_BATCH);
    const results = await Promise.all(
      batch.map(async (relativePath): Promise<ChangedFile | null> => {
        const absolutePath = path.join(resolvedPath, relativePath);
        try {
          const stat = await fsp.stat(absolutePath);
          if (stat.size > MAX_FILE_BYTES) {
            onProgress?.(`Skipping large file (${(stat.size / 1024 / 1024).toFixed(1)}MB): ${relativePath}`);
            return null;
          }
          const content = await fsp.readFile(absolutePath, "utf-8");
          const contentHash = hashContent(content);
          const existingHash = hashes.get(relativePath);

          if (existingHash === contentHash) return null;

          const chunks = chunkFileContent(absolutePath, relativePath, content);
          return { relativePath, absolutePath, contentHash, chunks, isNew: !existingHash };
        } catch {
          return null;
        }
      }),
    );

    changedFiles.push(...results.filter((r): r is ChangedFile => r !== null));
    progress.filesProcessed = Math.min(i + batch.length, currentFiles.length);
  }

  const unchangedCount = currentFiles.length - changedFiles.length;
  onProgress?.(`${changedFiles.length} files changed, ${unchangedCount} unchanged/skipped`);

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
        progress.batchesProcessed = batchNum;
        continue;
      }

      // Generate embeddings for this batch
      progress.phase = `generating embeddings (batch ${batchNum}/${totalBatches})`;
      onProgress?.(`Batch ${batchNum}/${totalBatches}: generating embeddings for ${batchChunkData.length} chunks (${fileBatch.length} files changed)...`);

      const batchTexts = batchChunkData.map((c) => prepareDocumentText(c.chunk.content, c.chunk.relativePath));
      const batchEmbeddings = await generateEmbeddings(batchTexts, (processed) => {
        progress.chunksProcessed = globalChunksProcessed + processed;
      });
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

      const { pointsSkipped } = await upsertPreEmbeddedChunks(collection, batchPoints);

      if (pointsSkipped > 0 && pointsSkipped === batchPoints.length) {
        throw new Error(
          `Qdrant upsert: all ${batchPoints.length} points in batch ${batchNum}/${totalBatches} ` +
          `were skipped (collection=${collection}). The collection may have been deleted externally.`
        );
      }

      // Update hashes and counts for this batch's files
      for (const file of fileBatch) {
        hashes.set(file.relativePath, file.contentHash);
        if (file.isNew) added++;
        else updated++;
      }
      chunksCreated += batchChunkData.length;

      // Checkpoint: persist hashes after each batch
      progress.phase = `checkpointing (batch ${batchNum}/${totalBatches})`;
      await saveProjectMetadata(collection, resolvedPath, currentFiles.length, hashes.size, hashes, "in-progress");
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

  // Persist updated hashes
  await saveProjectMetadata(collection, resolvedPath, currentFiles.length, hashes.size, hashes, "completed");

  // Auto-rebuild code graph if any files changed (Phase F).
  //
  // Strategy:
  //   - If a symbol-graph already exists AND the change set is small
  //     (≤ INCREMENTAL_SYMBOL_THRESHOLD files), do a fast file-import-graph
  //     rebuild then patch the symbol graph per-file via
  //     `updateChangedFilesSymbolGraph`.
  //   - Otherwise fall back to a full `rebuildGraph()` that also rebuilds
  //     the symbol graph end-to-end.
  if (added > 0 || updated > 0 || removed > 0) {
    progress.phase = "building code graph";
    const projectId = projectIdFromPath(resolvedPath);
    const totalChanged = changedFiles.length + removedRelPaths.length;
    const meta = await loadSymbolGraphMeta(projectId).catch(() => null);
    const useIncremental = meta !== null && totalChanged <= INCREMENTAL_SYMBOL_THRESHOLD;

    try {
      onProgress?.(
        useIncremental
          ? `Building file graph + incrementally updating ${totalChanged} symbol payload(s)...`
          : "Building code dependency graph (full rebuild)...",
      );
      const graph = await rebuildGraph(resolvedPath, { skipSymbolGraph: useIncremental });
      onProgress?.(`Code graph built: ${graph.nodes.length} files, ${graph.edges.length} edges`);

      if (useIncremental) {
        try {
          const result = await updateChangedFilesSymbolGraph(
            projectId,
            resolvedPath,
            graph,
            changedFiles.map((f) => f.relativePath),
            removedRelPaths,
          );
          if (result.fullRebuildRequired) {
            // Meta vanished between checks — fall back to a full symbol rebuild.
            onProgress?.("Symbol graph meta missing — falling back to full rebuild");
            await rebuildGraph(resolvedPath, { skipSymbolGraph: false });
          } else {
            onProgress?.(
              `Symbol graph patched: +${result.symbolsDelta} symbols, ` +
                `+${result.edgesDelta} edges (${result.filesChanged} changed, ${result.filesRemoved} removed)`,
            );
          }
        } catch (incErr) {
          // Last-resort fallback: full rebuild. Never let watcher fail.
          const incMsg = incErr instanceof Error ? incErr.message : String(incErr);
          logger.warn("Incremental symbol-graph update failed; falling back to full rebuild", {
            projectPath: resolvedPath,
            error: incMsg,
          });
          await rebuildGraph(resolvedPath, { skipSymbolGraph: false });
        }
      }
    } catch (graphErr) {
      const graphMsg = graphErr instanceof Error ? graphErr.message : String(graphErr);
      logger.warn("Code graph build failed during incremental update (non-fatal)", { projectPath: resolvedPath, error: graphMsg });
      onProgress?.(`Code graph build failed (non-fatal): ${graphMsg}`);
    }
  }

  // Auto-index context artifacts if changed (non-fatal)
  try {
    const artifactConfig = await loadConfig(resolvedPath);
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
