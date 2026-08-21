// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { Lang, registerDynamicLanguage } from "@ast-grep/napi";
import { graphCollectionName, projectIdFromPath } from "../config.js";
import { ELIXIR_TEMPLATE_EXTENSIONS, EXTENSION_LANGUAGE_MAP, EXTRA_EXTENSIONS, getLanguageFromExtension, MAX_GRAPH_FILE_BYTES, toForwardSlash } from "../constants.js";
import type {
  CodeGraph, CodeGraphEdge, CodeGraphNode,
  SymbolEdge, SymbolGraphFilePayload, SymbolGraphMeta, SymbolNode, SymbolRef,
} from "../types.js";
import { ensureElixirTemplateParsers, isElixirTemplateExtension } from "./elixir-templates.js";
import { detectExtensionFromSource, resolveExtensionlessExtension } from "./extensionless.js";
import { loadPathAliases } from "./graph-aliases.js";
import { extractImports } from "./graph-imports.js";
import { buildCsNamespaceMap, buildDartPackageMap, buildElixirModuleMap, buildGoModuleInfo, buildJvmSuffixMap, buildPhpPsr4Map, buildPythonManifests, pythonRootsForFile, resolveImport } from "./graph-resolution.js";
import { computeUnresolvedPct, resolveCallSites } from "./graph-symbol-resolution.js";
import { extractSymbolsAndCalls, rawCallsToUnresolvedEdges } from "./graph-symbols.js";
import { createIgnoreFilter, shouldIgnore } from "./ignore.js";
import { logger } from "./logger.js";
import { deleteGraphData, describeQdrantError, getGraphMetadata, loadGraphData, saveGraphData } from "./qdrant.js";
import {
  dropSymbolGraphCache,
  SymbolGraphCache,
  setSymbolGraphCache,
} from "./symbol-graph-cache.js";
import {
  allNameShardKeys,
  contentHashOf,
  deleteSymbolGraphData,
  ensureSymbolGraphCollections,
  nameShardKey,
  reverseShardKey,
  saveFilePayloads,
  saveNameShard,
  saveReverseShard,
  saveSymbolGraphMeta,
} from "./symbol-graph-store.js";

// Re-export analysis functions for external consumers
export { findCircularDependencies, generateMermaidDiagram, getFileDependencies, getGraphStats, isImportResolutionLow } from "./graph-analysis.js";

// createRequire needed to load native addon packages in ESM
const esmRequire = createRequire(import.meta.url);

// ── Graph build progress tracking ────────────────────────────────────────

/**
 * Why a file the graph walk discovered did not get a node of its own — an
 * importer may still create a placeholder for it. Module-local:
 * the counts leave this file as a total plus a per-reason breakdown in the build
 * log, not as a type consumers branch on.
 */
type SkipReason = "oversized" | "vanished" | "read-failed" | "content-changed";

/** Progress details for an in-flight graph build operation */
export interface GraphBuildProgress {
  startedAt: number;       // Date.now()
  filesTotal: number;
  filesProcessed: number;
  /**
   * Files counted in `filesProcessed` that got no node of their own; an importer
   * may still have created a placeholder for them. Absent until the first skip.
   */
  filesSkipped?: number;
  phase: string;           // "scanning files" | "analyzing imports" | "persisting"
  error?: string;
}

/** Summary of a completed graph build operation */
export interface GraphBuildCompleted {
  completedAt: number;     // Date.now()
  durationMs: number;
  filesProcessed: number;
  /**
   * Files that got no node of their own during this build; an importer may still
   * have created a placeholder for them. Absent when none were skipped.
   */
  filesSkipped?: number;
  nodesCreated: number;
  edgesCreated: number;
  error?: string;
  /**
   * Set when the file-import graph was built and saved but the symbol graph
   * could not be persisted. That half-failure used to be logged and otherwise
   * dropped, so the build reported success while `codebase_impact` silently had
   * nothing to answer with; recording it here is what lets status say so.
   */
  symbolGraphError?: string;
}

/** Track which projects currently have a graph build in flight */
const graphBuildInProgress = new Map<string, GraphBuildProgress>();

/** In-flight build promises — allows callers to share a single build */
const graphBuildPromises = new Map<string, Promise<CodeGraph>>();

/** Track the last completed graph build per project */
const lastGraphBuildCompleted = new Map<string, GraphBuildCompleted>();

/** Check if a graph build is currently in progress for a project */
export function isGraphBuildInProgress(projectPath: string): boolean {
  return graphBuildInProgress.has(path.resolve(projectPath));
}

/** Get progress details for a graph build currently in progress */
export function getGraphBuildProgress(projectPath: string): GraphBuildProgress | null {
  return graphBuildInProgress.get(path.resolve(projectPath)) ?? null;
}

/** Get the last completed graph build for a project */
export function getLastGraphBuildCompleted(projectPath: string): GraphBuildCompleted | null {
  return lastGraphBuildCompleted.get(path.resolve(projectPath)) ?? null;
}

/** Get all projects currently building a graph */
export function getGraphBuildInProgressProjects(): string[] {
  return Array.from(graphBuildInProgress.keys());
}

// ── Graph cache (service-level, shared by tools and watcher) ─────────────

/** In-memory graph cache keyed by resolved project path */
const graphCache = new Map<string, CodeGraph>();

/** Invalidate graph cache for a project (called by watcher on file changes) */
export function invalidateGraphCache(projectPath: string): void {
  graphCache.delete(path.resolve(projectPath));
}

/** Get a cached graph, or load from Qdrant, or build one */
export async function getOrBuildGraph(
  projectPath: string,
  extraExtensions?: Set<string>,
): Promise<CodeGraph> {
  const resolved = path.resolve(projectPath);
  const cached = graphCache.get(resolved);
  if (cached) {
    return cached;
  }

  // Try loading persisted graph from Qdrant
  const projectId = projectIdFromPath(resolved);
  const graphCollName = graphCollectionName(projectId);
  const persisted = await loadGraphData(graphCollName);
  if (persisted) {
    graphCache.set(resolved, persisted);
    return persisted;
  }

  const graph = await buildCodeGraph(resolved, extraExtensions);
  // Strip symbol fields when serving as a plain CodeGraph
  const plain: CodeGraph = { nodes: graph.nodes, edges: graph.edges };
  graphCache.set(resolved, plain);
  return plain;
}

/** Options for `rebuildGraph` controlling which layers are rebuilt. */
export interface RebuildGraphOptions {
  /** Extra file extensions to treat as graph nodes. */
  extraExtensions?: Set<string>;
  /**
   * When `true`, skip the symbol-graph extraction + persistence step entirely.
   * The file-import graph is still rebuilt and persisted. The caller is then
   * expected to update the symbol graph incrementally via
   * `updateChangedFilesSymbolGraph` from `symbol-graph-incremental.ts`.
   * Default: `false`.
   */
  skipSymbolGraph?: boolean;
}

/** Force-rebuild, cache, and persist a graph.
 * If a build is already in progress for this project, returns the existing
 * in-flight promise (deduplication — same as indexer concurrency guard).
 *
 * Backward-compatible: accepts either `extraExtensions` (legacy positional
 * Set) or a `RebuildGraphOptions` object.
 */
export async function rebuildGraph(
  projectPath: string,
  optsOrExtras?: Set<string> | RebuildGraphOptions,
): Promise<CodeGraph> {
  const resolved = path.resolve(projectPath);
  const opts: RebuildGraphOptions =
    optsOrExtras instanceof Set ? { extraExtensions: optsOrExtras } : (optsOrExtras ?? {});

  // Concurrency guard: if already building, return the existing promise
  const existing = graphBuildPromises.get(resolved);
  if (existing) {
    logger.info("Graph build already in progress, joining existing build", { projectPath: resolved });
    return existing;
  }

  // Start tracked build
  const promise = doRebuildGraph(resolved, opts);
  graphBuildPromises.set(resolved, promise);

  try {
    const graph = await promise;
    return graph;
  } finally {
    graphBuildPromises.delete(resolved);
  }
}

/** Internal: performs the actual graph rebuild with progress tracking */
async function doRebuildGraph(
  resolvedPath: string,
  opts: RebuildGraphOptions,
): Promise<CodeGraph> {
  const progress: GraphBuildProgress = {
    startedAt: Date.now(),
    filesTotal: 0,
    filesProcessed: 0,
    phase: "scanning files",
  };
  graphBuildInProgress.set(resolvedPath, progress);

  try {
    graphCache.delete(resolvedPath);
    const built = await buildCodeGraph(resolvedPath, opts.extraExtensions, progress);
    const graph: CodeGraph = { nodes: built.nodes, edges: built.edges };
    graphCache.set(resolvedPath, graph);

    // Persist file-import graph to Qdrant
    progress.phase = "persisting";
    const projectId = projectIdFromPath(resolvedPath);
    const graphCollName = graphCollectionName(projectId);
    await saveGraphData(graphCollName, resolvedPath, graph);

    // Build & persist symbol graph (resolution + sharded persistence) — unless
    // the caller asked to skip it (Phase F watcher path).
    let symbolGraphError: string | undefined;
    if (!opts.skipSymbolGraph) {
      try {
        progress.phase = "resolving symbols";
        resolveCallSites(graph, built.symbolsByFile, built.outgoingCallsByFile);

        progress.phase = "persisting symbols";
        await persistSymbolGraph(projectId, resolvedPath, built.symbolsByFile, built.outgoingCallsByFile);
      } catch (err) {
        // Keep returning the file-import graph: it is built and saved, and the
        // caller asked for it. But record WHY the symbol half is missing, with
        // the server's own reason (a bare "Bad Request" names nothing), so the
        // build is no longer reported as an unqualified success while
        // codebase_impact quietly has no data.
        symbolGraphError = describeQdrantError(err);
        logger.error("Symbol graph build failed (file-import graph saved)", {
          projectPath: resolvedPath,
          error: symbolGraphError,
        });
      }
    } else {
      // This build deliberately did not touch the symbol graph (the incremental
      // watcher path passes skipSymbolGraph), so it has no standing to declare
      // the symbol graph healthy. Carry any recorded failure forward, or a
      // single edited file after a failed persist would overwrite the record
      // with a clean one and hide a still-broken graph. Only the branch above,
      // an actual successful persist, clears it.
      symbolGraphError = lastGraphBuildCompleted.get(resolvedPath)?.symbolGraphError;
    }

    lastGraphBuildCompleted.set(resolvedPath, {
      completedAt: Date.now(),
      durationMs: Date.now() - progress.startedAt,
      filesProcessed: progress.filesProcessed,
      filesSkipped: progress.filesSkipped,
      nodesCreated: graph.nodes.length,
      edgesCreated: graph.edges.length,
      symbolGraphError,
    });

    return graph;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    progress.error = message;
    lastGraphBuildCompleted.set(resolvedPath, {
      completedAt: Date.now(),
      durationMs: Date.now() - progress.startedAt,
      filesProcessed: progress.filesProcessed,
      filesSkipped: progress.filesSkipped,
      nodesCreated: 0,
      edgesCreated: 0,
      error: message,
      // A build that died before (or during) the symbol-graph phase did not fix
      // it either, so preserve any failure the last build recorded. Reading it
      // back out of the map is deliberate: this catch is outside the scope of
      // the try's symbolGraphError, and the get resolves before the set.
      // Without this a transient outage would wipe the record, and the next
      // incremental build would carry the blank forward as "healthy".
      symbolGraphError: lastGraphBuildCompleted.get(resolvedPath)?.symbolGraphError,
    });
    throw err;
  } finally {
    graphBuildInProgress.delete(resolvedPath);
  }
}

/** Persist the symbol graph: per-file payloads + sharded indices + meta. */
async function persistSymbolGraph(
  projectId: string,
  resolvedPath: string,
  symbolsByFile: Map<string, SymbolNode[]>,
  outgoingCallsByFile: Map<string, SymbolEdge[]>,
): Promise<void> {
  await ensureSymbolGraphCollections(projectId);

  // Build per-file payloads (need source bytes for contentHash).
  const payloads: SymbolGraphFilePayload[] = [];
  let totalSymbols = 0;
  let totalEdges = 0;
  for (const [relPath, symbols] of symbolsByFile.entries()) {
    const outgoingCalls = outgoingCallsByFile.get(relPath) ?? [];
    let language = "plaintext";
    const firstNonModule = symbols.find((s) => s.name !== "<module>");
    if (firstNonModule) language = firstNonModule.language;
    else language = symbols[0]?.language ?? language;

    let contentHash = "";
    try {
      const src = await fs.readFile(path.join(resolvedPath, relPath), "utf-8");
      contentHash = contentHashOf(src);
    } catch {
      // ignore
    }
    payloads.push({
      file: relPath, language, contentHash, symbols, outgoingCalls,
    });
    totalSymbols += symbols.filter((s) => s.name !== "<module>").length;
    totalEdges += outgoingCalls.length;
  }

  // Build sharded indices
  const nameShards = new Map<string, Record<string, SymbolRef[]>>();
  for (const key of allNameShardKeys()) nameShards.set(key, {});
  for (const [file, symbols] of symbolsByFile.entries()) {
    for (const sym of symbols) {
      if (sym.name === "<module>") continue;
      const shardKey = nameShardKey(sym.name);
      const shard = nameShards.get(shardKey);
      if (!shard) continue;
      const ref: SymbolRef = { file, id: sym.id };
      // Use hasOwn — `shard[sym.name]` would return Object.prototype.constructor
      // (a function) for symbol names like "constructor" / "toString" / "hasOwnProperty".
      const existing = Object.hasOwn(shard, sym.name) ? shard[sym.name] : undefined;
      if (existing) existing.push(ref);
      else shard[sym.name] = [ref];
    }
  }

  const reverseShards = new Map<number, Record<string, string[]>>();
  for (const [callerFile, edges] of outgoingCallsByFile.entries()) {
    for (const e of edges) {
      for (const calleeId of e.calleeCandidates) {
        const calleeFile = calleeId.split("::")[0];
        if (!calleeFile || calleeFile === callerFile) continue;
        const bucket = reverseShardKey(calleeFile);
        let shard = reverseShards.get(bucket);
        if (!shard) {
          shard = {};
          reverseShards.set(bucket, shard);
        }
        const existing = shard[calleeFile];
        if (existing) {
          if (!existing.includes(callerFile)) existing.push(callerFile);
        } else {
          shard[calleeFile] = [callerFile];
        }
      }
    }
  }

  // Persist
  await saveFilePayloads(projectId, payloads);
  for (const [shardKey, shard] of nameShards.entries()) {
    if (Object.keys(shard).length === 0) continue;
    await saveNameShard(projectId, shardKey, shard);
  }
  for (const [bucket, shard] of reverseShards.entries()) {
    if (Object.keys(shard).length === 0) continue;
    await saveReverseShard(projectId, bucket, shard);
  }

  const meta: SymbolGraphMeta = {
    projectId,
    symbolCount: totalSymbols,
    edgeCount: totalEdges,
    fileCount: symbolsByFile.size,
    unresolvedEdgePct: computeUnresolvedPct(outgoingCallsByFile),
    builtAt: Date.now(),
    schemaVersion: 1,
  };
  await saveSymbolGraphMeta(projectId, meta);

  // Replace cache entry
  const cache = new SymbolGraphCache(projectId, meta);
  setSymbolGraphCache(cache);

  logger.info("Symbol graph persisted", {
    projectId,
    files: meta.fileCount,
    symbols: meta.symbolCount,
    edges: meta.edgeCount,
    unresolvedPct: meta.unresolvedEdgePct.toFixed(1),
  });
}

/**
 * Wait for any in-flight graph build to finish for a project.
 * Resolves immediately if no build is in progress.
 * Swallows errors — the caller typically wants to proceed regardless.
 */
export async function awaitGraphBuild(projectPath: string): Promise<void> {
  const resolved = path.resolve(projectPath);
  const promise = graphBuildPromises.get(resolved);
  if (promise) {
    try { await promise; } catch { /* swallow — caller proceeds regardless */ }
  }
}

/** Remove a persisted code graph from Qdrant and clear cache */
export async function removeGraph(projectPath: string): Promise<void> {
  const resolved = path.resolve(projectPath);
  graphCache.delete(resolved);
  const projectId = projectIdFromPath(resolved);
  const graphCollName = graphCollectionName(projectId);
  await deleteGraphData(graphCollName);
  await deleteSymbolGraphData(projectId);
  dropSymbolGraphCache(projectId);
  logger.info("Removed code graph", { projectPath: resolved });
}

/** Check if a graph exists (in cache or persisted) */
export async function hasGraph(projectPath: string): Promise<boolean> {
  const resolved = path.resolve(projectPath);
  if (graphCache.has(resolved)) return true;
  const projectId = projectIdFromPath(resolved);
  const graphCollName = graphCollectionName(projectId);
  const meta = await getGraphMetadata(graphCollName);
  return meta !== null;
}

/** Get graph metadata for status display */
export async function getGraphStatus(projectPath: string): Promise<{
  lastBuiltAt: string;
  nodeCount: number;
  edgeCount: number;
  /** Import specifiers captured across all files, resolved or not. Absent on
   * graphs persisted before this field was recorded. */
  importCount?: number;
  cached: boolean;
  symbol?: {
    fileCount: number;
    symbolCount: number;
    edgeCount: number;
    unresolvedEdgePct: number;
    builtAt: number;
  };
} | null> {
  const resolved = path.resolve(projectPath);
  const projectId = projectIdFromPath(resolved);
  const graphCollName = graphCollectionName(projectId);
  const meta = await getGraphMetadata(graphCollName);
  if (!meta) return null;

  // Best-effort symbol-graph stats
  let symbol: {
    fileCount: number;
    symbolCount: number;
    edgeCount: number;
    unresolvedEdgePct: number;
    builtAt: number;
  } | undefined;
  try {
    const { loadSymbolGraphMeta } = await import("./symbol-graph-store.js");
    const sm = await loadSymbolGraphMeta(projectId);
    if (sm) {
      symbol = {
        fileCount: sm.fileCount,
        symbolCount: sm.symbolCount,
        edgeCount: sm.edgeCount,
        unresolvedEdgePct: sm.unresolvedEdgePct,
        builtAt: sm.builtAt,
      };
    }
  } catch {
    // symbol graph optional
  }
  return {
    lastBuiltAt: meta.lastBuiltAt,
    nodeCount: meta.nodeCount,
    edgeCount: meta.edgeCount,
    importCount: meta.importCount,
    cached: graphCache.has(resolved),
    symbol,
  };
}

// ── Register dynamic language grammars ───────────────────────────────────

let dynamicLangsRegistered = false;
const loadedDynamicLanguages = new Set<string>();
const failedDynamicLanguages = new Map<string, string>();

/** Module export shape exposed by `@ast-grep/lang-*` packages. */
interface AstGrepLangModule {
  libraryPath: string;
  extensions: string[];
  languageSymbol?: string;
}

/** Snapshot of dynamic-language registration state, for diagnostics. */
export interface DynamicLanguageStatus {
  loaded: string[];
  failed: Array<{ name: string; error: string }>;
}

/** Returns which dynamic ast-grep grammars registered successfully and which failed. */
export function getDynamicLanguageStatus(): DynamicLanguageStatus {
  return {
    loaded: [...loadedDynamicLanguages].sort(),
    failed: [...failedDynamicLanguages.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, error]) => ({ name, error })),
  };
}

export function ensureDynamicLanguages(): void {
  if (dynamicLangsRegistered) return;
  dynamicLangsRegistered = true;

  try {
    const survivors: Record<string, AstGrepLangModule> = {};

    const langPackages: Array<[string, string]> = [
      ["python",  "@ast-grep/lang-python"],
      ["go",      "@ast-grep/lang-go"],
      ["java",    "@ast-grep/lang-java"],
      ["rust",    "@ast-grep/lang-rust"],
      ["c",       "@ast-grep/lang-c"],
      ["cpp",     "@ast-grep/lang-cpp"],
      ["csharp",  "@ast-grep/lang-csharp"],
      ["ruby",    "@ast-grep/lang-ruby"],
      ["kotlin",  "@ast-grep/lang-kotlin"],
      ["swift",   "@ast-grep/lang-swift"],
      ["scala",   "@ast-grep/lang-scala"],
      ["bash",    "@ast-grep/lang-bash"],
      ["php",     "@ast-grep/lang-php"],
      ["lua",     "@ast-grep/lang-lua"],
      ["dart",    "@ast-grep/lang-dart"],
      ["elixir",  "@ast-grep/lang-elixir"],
    ];

    for (const [name, pkg] of langPackages) {
      try {
        const mod = esmRequire(pkg) as AstGrepLangModule;
        // Pre-validate the lazy `libraryPath` getter. `registerDynamicLanguage`
        // accesses this property for every entry it receives, and a single
        // throwing getter aborts the entire batch atomically (issue #43).
        // Touching the getter here, inside the per-grammar try/catch, isolates
        // a missing-prebuild failure to that one grammar so the rest can still
        // be registered. The getter caches its result inside the package, so
        // this is not duplicated work.
        void mod.libraryPath;
        survivors[name] = mod;
        loadedDynamicLanguages.add(name);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failedDynamicLanguages.set(name, message);
        logger.warn("ast-grep grammar failed to load", { name, error: message });
      }
    }

    if (Object.keys(survivors).length > 0) {
      registerDynamicLanguage(survivors);
      logger.info("Registered dynamic ast-grep languages", {
        languages: [...loadedDynamicLanguages].sort(),
      });
    } else {
      logger.warn(
        "No dynamic ast-grep grammars loaded; PHP, Python, JVM and other dynamic languages will fall through to <module>-only extraction",
      );
    }
    if (failedDynamicLanguages.size > 0) {
      logger.warn(
        "Some dynamic ast-grep grammars failed to load; affected languages will produce only <module>-level symbols",
        { failed: [...failedDynamicLanguages.keys()].sort() },
      );
    }
  } catch (err) {
    // Should be unreachable now that each grammar is validated independently,
    // but keep the outer guard so an unexpected throw cannot take the indexer
    // process down.
    logger.warn("Unexpected error in ensureDynamicLanguages", { error: String(err) });
  }
}

// ── Language mapping for ast-grep ────────────────────────────────────────

/** Map file extensions to ast-grep language identifiers */
const EXTENSION_TO_AST_GREP_LANG: Record<string, Lang | string> = {
  // Dynamic languages (string identifiers)
  ".py": "python", ".pyw": "python", ".pyi": "python",
  ".java": "java",
  ".kt": "kotlin", ".kts": "kotlin",
  ".scala": "scala",
  ".c": "c", ".h": "c",
  ".cpp": "cpp", ".hpp": "cpp", ".cc": "cpp", ".hh": "cpp", ".cxx": "cpp",
  ".cs": "csharp",
  ".go": "go",
  ".rs": "rust",
  ".rb": "ruby",
  ".php": "php",
  ".swift": "swift",
  ".dart": "dart",
  ".ex": "elixir", ".exs": "elixir",
  ".lua": "lua",
  ".sh": "bash", ".bash": "bash", ".zsh": "bash",
  // Composite languages (parsed via HTML + script re-parse)
  ".svelte": "svelte",
  ".vue": "vue",
  // Built-in languages (Lang enum)
  ".js": Lang.JavaScript, ".jsx": Lang.JavaScript, ".mjs": Lang.JavaScript, ".cjs": Lang.JavaScript,
  ".ts": Lang.TypeScript,
  ".tsx": Lang.Tsx,
  ".html": Lang.Html, ".htm": Lang.Html,
  ".css": Lang.Css, ".scss": Lang.Css, ".sass": Lang.Css, ".less": Lang.Css, ".styl": Lang.Css,
};

/**
 * Map a file extension to its ast-grep grammar (or null when none). An
 * EXTENSION_LANGUAGE_MAP override is resolved through the target language's
 * canonical extension, so a mapped extension (e.g. `.inc` → php) gets the same
 * grammar a native file of that language would, keeping symbol extraction and
 * AST chunking consistent with the language label.
 */
export function getAstGrepLang(
  ext: string,
  override: Map<string, string> = EXTENSION_LANGUAGE_MAP,
): Lang | string | null {
  // Match getLanguageFromExtension: normalize casing so override lookups (keys
  // are stored lowercased) and the grammar stay aligned with the label.
  const normalized = ext.toLowerCase();
  const target = override.get(normalized) ?? normalized;
  return EXTENSION_TO_AST_GREP_LANG[target] ?? null;
}

// ── Graph building ───────────────────────────────────────────────────────

/**
 * Get all source files in a project for graph analysis, with the detected
 * extension of every extensionless file admitted by content detection.
 *
 * Includes files with known AST grammars, mixed Elixir templates handled by their
 * dedicated parsers, and any extra extensions. Extensionless files are head-read
 * here to decide admission, and the extension that decision
 * used is returned in `detectedExts` so the build pass can reuse it instead of
 * reading the head again.
 *
 * `files` is sorted lexicographically. Node documents no readdir ordering, and a
 * depth-first walk additionally interleaves a directory's contents with the
 * sibling entries that sort after it — `a/x.ts` is yielded before `a.ts`.
 * Processing order determines node insertion order, and `buildJvmSuffixMap`'s
 * first-match-wins tie-break for duplicate class paths reads the set in that
 * order directly (`buildCsNamespaceMap` and `buildGoModuleInfo` sort their own
 * filtered views instead). Normalize here rather than leaving it to the traversal.
 */
export async function getGraphableFiles(
  projectPath: string,
  extraExts?: Set<string>,
): Promise<{ files: string[]; detectedExts: Map<string, string> }> {
  const ig = createIgnoreFilter(projectPath);
  const extras = extraExts ?? EXTRA_EXTENSIONS;
  const files: string[] = [];
  const detectedExts = new Map<string, string>();
  // Match getIndexableFiles' dotfile policy (glob dot:false by default) so the
  // graph and the index admit the same extensionless *dotfiles* — otherwise a
  // dot-named file like .bashrc/.profile would be graphed but never indexed
  // (this walk sees dotfiles; the index's glob does not). (Files nested under a
  // dot-directory are a separate, pre-existing divergence, not handled here.)
  const includeDotFiles = (process.env.INCLUDE_DOT_FILES ?? "false").toLowerCase() === "true";

  async function walk(dir: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      // Every file under an unreadable directory leaves the walk here, before it
      // has a path of its own to report, so none of them reach the build loop's
      // skip accounting — this log is their only trace. ENOENT stays quiet for a
      // directory removed mid-walk, which has nothing left to graph, but not for
      // the project root: there it means the whole project is missing, and the
      // build would otherwise report a clean empty graph.
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== "ENOENT" || dir === projectPath) {
        logger.debug("Could not read directory in graph discovery (subtree omitted)", {
          dir: toForwardSlash(path.relative(projectPath, dir)) || ".",
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = toForwardSlash(path.relative(projectPath, fullPath));

      if (shouldIgnore(ig, entry.isDirectory() ? `${relPath}/` : relPath)) continue;

      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        // Mixed Elixir templates use dedicated parsers, not the Elixir grammar.
        if (getAstGrepLang(ext) !== null || extras.has(ext) || ELIXIR_TEMPLATE_EXTENSIONS.has(ext)) {
          files.push(relPath);
        } else if (ext === "" && (includeDotFiles || !entry.name.startsWith("."))) {
          // Extensionless: admit only when detection yields a grammar-bearing
          // canonical extension. `.txt`-detected files stay out of the graph:
          // we don't start adding grammar-less extensionless leaf nodes (only
          // extra-extension files and mixed Elixir templates are grammar-less).
          // Extensionless dotfiles are skipped unless INCLUDE_DOT_FILES, to stay
          // consistent with the index (see includeDotFiles above).
          const detected = await resolveExtensionlessExtension(fullPath);
          if (detected && getAstGrepLang(detected) !== null) {
            files.push(relPath);
            detectedExts.set(relPath, detected);
          }
        }
      }
    }
  }

  await walk(projectPath);
  files.sort();
  return { files, detectedExts };
}

/**
 * Build a code graph for a project using ast-grep for polyglot support.
 * Files with extra extensions (no AST grammar) are included as leaf nodes
 * that can be targets of import edges from other files.
 *
 * Also extracts symbols and call sites in the same pass — returned via
 * `symbolsByFile` / `outgoingCallsByFile` and persisted by `doRebuildGraph`.
 */
export async function buildCodeGraph(
  projectPath: string,
  extraExtensions?: Set<string>,
  progress?: GraphBuildProgress,
): Promise<CodeGraph & {
  symbolsByFile: Map<string, SymbolNode[]>;
  outgoingCallsByFile: Map<string, SymbolEdge[]>;
}> {
  ensureDynamicLanguages();

  const resolvedPath = path.resolve(projectPath);
  const aliases = await loadPathAliases(resolvedPath);
  const { files, detectedExts } = await getGraphableFiles(resolvedPath, extraExtensions);
  const fileSet = new Set(files);
  if (files.some((file) => isElixirTemplateExtension(path.extname(file)))) {
    await ensureElixirTemplateParsers();
  }

  if (progress) {
    progress.filesTotal = files.length;
    progress.phase = "analyzing imports";
  }

  logger.info("Building code graph", { projectPath: resolvedPath, fileCount: files.length });

  const nodesMap = new Map<string, CodeGraphNode>();
  const edges: CodeGraphEdge[] = [];
  const symbolsByFile = new Map<string, SymbolNode[]>();
  const outgoingCallsByFile = new Map<string, SymbolEdge[]>();

  // Per-reason counts, holding only the reasons that actually fired — the build log
  // emits `skipReasons` straight from this map, so it never carries a zero.
  const skipsByReason = new Map<SkipReason, number>();
  let filesSkipped = 0;
  const recordSkip = (file: string, reason: SkipReason, detail?: Record<string, unknown>): void => {
    logger.debug("Skipping file in graph build", { file, reason, ...detail });
    skipsByReason.set(reason, (skipsByReason.get(reason) ?? 0) + 1);
    filesSkipped++;
    if (progress) {
      progress.filesProcessed++;
      progress.filesSkipped = filesSkipped;
    }
  };

  // Build a suffix lookup map for JVM multi-module projects (Java/Kotlin/Scala).
  // This resolves FQNs like com.example.Foo when the class lives under a nested
  // src/main/java/ tree (e.g. module-a/sub/src/main/java/com/example/Foo.java).
  // Cost: O(n) once here, O(1) per import lookup (negligible vs. full AST parse).
  const hasJvm = files.some((f) => {
    const e = path.extname(f).toLowerCase();
    return e === ".java" || e === ".kt" || e === ".kts" || e === ".scala";
  });
  const jvmSuffixMap = hasJvm ? buildJvmSuffixMap(fileSet) : undefined;

  // Build the PSR-4 prefix map for PHP projects. A namespace carries no path
  // information, so without the declared mapping every `use` statement that
  // does not happen to mirror the directory layout resolved to null — which is
  // all of them in a Composer monorepo, where each package declares its own
  // PSR-4 root under `packages/<name>/src`.
  const hasPhp = files.some((f) => path.extname(f).toLowerCase() === ".php");
  const phpPsr4Map = hasPhp ? buildPhpPsr4Map(resolvedPath) : undefined;

  // Build a namespace lookup map for C# projects. Each `namespace X.Y.Z` block
  // (or file-scoped `namespace X.Y.Z;`) is recorded so `using X.Y.Z;` directives
  // can be resolved to the file(s) that contribute to that namespace. Without
  // this, every C# import resolved to null and the file graph was empty.
  const hasCs = files.some((f) => path.extname(f).toLowerCase() === ".cs");
  const csNamespaceMap = hasCs ? buildCsNamespaceMap(fileSet, resolvedPath) : undefined;

  // Build Go module-resolution info from every go.mod in the tree (issue
  // #45 for a root-level go.mod; issue #82 for nested modules in a
  // monorepo). Without this, every Go import resolved to null and Go
  // projects produced an empty file graph. buildGoModuleInfo discovers
  // go.mod itself (independently of the graphable file set) and returns
  // one entry per module, or an empty array when none parse; the resolver
  // treats an empty/undefined result as "no Go resolution available" and
  // behaves exactly as it did before this feature for those cases.
  const hasGo = files.some((f) => f.endsWith(".go"));
  const goModuleInfo = hasGo ? buildGoModuleInfo(fileSet, resolvedPath) : undefined;

  // Map each in-repo Dart package name to its root, from every pubspec.yaml
  // in the tree (discovered by walking, like go.mod — pubspec.yaml is never
  // in the graphable file set). Flutter code imports intra-project files as
  // `package:<name>/...` by convention, so without this map those imports
  // all resolved to null and Dart projects lost nearly every file-graph edge
  // (issue #106). An empty/undefined map keeps the resolver's old behavior:
  // every `package:` import stays unresolved.
  const hasDart = files.some((f) => path.extname(f).toLowerCase() === ".dart");
  const dartPackageMap = hasDart ? buildDartPackageMap(resolvedPath) : undefined;

  // Record the import roots every pyproject.toml in the tree implies, plus the
  // workspace members each declares (discovered by walking, like go.mod and
  // pubspec.yaml — pyproject.toml is never in the graphable file set). A
  // workspace package's modules live under its own `src/`, which the
  // resolver's project-root probe cannot reach, so without these roots every
  // cross-package import — and every package's own absolute self-import —
  // resolved to null and the file graph came out all but empty (issue #107).
  // An empty list keeps the resolver's old behavior exactly.
  const hasPython = files.some(
    (f) => getLanguageFromExtension(path.extname(f).toLowerCase()) === "python",
  );
  const pythonManifests = hasPython ? buildPythonManifests(resolvedPath) : [];
  // Which roots apply, and in what order, depends on where the importing file
  // sits, so it is resolved per directory rather than once for the project —
  // cached because a package directory typically holds many files.
  const pythonRootsByDir = new Map<string, string[]>();
  const pythonRootsFor = (relPath: string): string[] | undefined => {
    if (pythonManifests.length === 0) return undefined;
    const dir = toForwardSlash(path.dirname(relPath));
    let roots = pythonRootsByDir.get(dir);
    if (!roots) {
      roots = pythonRootsForFile(pythonManifests, dir);
      pythonRootsByDir.set(dir, roots);
    }
    return roots;
  };

  // Elixir module names do not imply paths. Resolve directives against
  // in-project `defmodule` declarations.
  const hasElixir = files.some((f) => [".ex", ".exs"].includes(path.extname(f).toLowerCase()));
  const elixirModuleMap = hasElixir ? buildElixirModuleMap(fileSet, resolvedPath) : undefined;

  for (const relPath of files) {
    let ext = path.extname(relPath).toLowerCase();
    let lang = getAstGrepLang(ext);
    const isElixirTemplate = isElixirTemplateExtension(ext);
    const wasExtensionless = ext === "";

    // Extensionless entries carry the extension discovery detected when it
    // head-read them to decide admission; reuse it so the file clears the
    // grammar-less-leaf gate below without a second head-read — without it an
    // extensionless file would become a leaf node instead of being parsed or
    // counted. What it is actually parsed as comes from the re-detection on the
    // read bytes further down, which supersedes this one. Discovery admits an
    // extensionless path only together with a grammar-bearing detection, so the
    // guard below narrows types rather than handling a case that can occur.
    if (!lang && wasExtensionless) {
      const detected = detectedExts.get(relPath);
      const detectedLang = detected ? getAstGrepLang(detected) : null;
      if (!detected || !detectedLang) continue;
      ext = detected;
      lang = detectedLang;
    }

    // Extra extensions with no parser are included as leaf nodes so they can be
    // targets of import edges, but we skip
    // import extraction since we can't parse them.
    if (!lang && !isElixirTemplate) {
      const absolutePath = path.join(resolvedPath, relPath);
      if (!nodesMap.has(relPath)) {
        nodesMap.set(relPath, {
          filePath: absolutePath,
          relativePath: relPath,
          imports: [],
          exports: [],
          dependencies: [],
          dependents: [],
        });
      }
      if (progress) progress.filesProcessed++;
      continue;
    }

    const absolutePath = path.join(resolvedPath, relPath);

    let source: string;
    try {
      const stat = await fs.stat(absolutePath);
      if (stat.size > MAX_GRAPH_FILE_BYTES) {
        recordSkip(relPath, "oversized", { size: stat.size, limit: MAX_GRAPH_FILE_BYTES });
        continue;
      }
      source = await fs.readFile(absolutePath, "utf-8");
    } catch (err) {
      // ENOENT means the file vanished between discovery and this read; anything
      // else is a real fault worth the error text. Both drop the file, so both
      // count — unlike a discovery-time detection miss, which keeps the file out
      // of `files` entirely, leaving nothing here to count.
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") recordSkip(relPath, "vanished");
      else recordSkip(relPath, "read-failed", { error: err instanceof Error ? err.message : String(err) });
      continue;
    }

    // Detection ran on a head-read during discovery, so content may have changed
    // before this read. Re-detect on the bytes about to be parsed and parse under
    // the grammar those bytes call for: the fresh answer describes what is in
    // hand, so it supersedes discovery's rather than being compared to it. Only
    // content that no longer detects as a grammar-bearing language has nothing to
    // parse with, and that is the skip — labelling it from the stale detection
    // would write junk imports and symbols into the graph.
    if (wasExtensionless) {
      const redetected = detectExtensionFromSource(source);
      const redetectedLang = redetected ? getAstGrepLang(redetected) : null;
      if (!redetected || !redetectedLang) {
        recordSkip(relPath, "content-changed", { atDiscovery: ext, redetected });
        continue;
      }
      ext = redetected;
      lang = redetectedLang;
    }

    const language = getLanguageFromExtension(ext);

    // get() may return a placeholder an earlier importer created, whose
    // dependents are already populated — keep it rather than replacing it.
    let node = nodesMap.get(relPath);
    if (!node) {
      node = {
        filePath: absolutePath,
        relativePath: relPath,
        imports: [],
        exports: [],
        dependencies: [],
        dependents: [],
      };
      nodesMap.set(relPath, node);
    }
    // Record the (post-detection) language so display/stats sites don't have to
    // re-derive it from the path — which silently mislabels extensionless files
    // as plaintext.
    node.language = language;

    const extractionLang = lang ?? "elixir-template";
    const importInfos = extractImports(source, extractionLang, ext);

    // Extract symbols & raw call sites in the same pass
    try {
      const extracted = extractSymbolsAndCalls(source, extractionLang, ext, relPath);
      symbolsByFile.set(relPath, extracted.symbols);
      outgoingCallsByFile.set(relPath, rawCallsToUnresolvedEdges(extracted.rawCalls));
    } catch (err) {
      logger.debug("Symbol extraction failed (continuing)", {
        file: relPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    for (const imp of importInfos) {
      node.imports.push(imp.moduleSpecifier);

      // Try to resolve to a project file
      // CSS imports from <style> blocks use CSS resolution even when the source file is Svelte/Vue
      const resolutionLanguage = imp.isCssImport ? "css" : language;
      const resolved = resolveImport(imp.moduleSpecifier, absolutePath, resolvedPath, fileSet, resolutionLanguage, aliases, jvmSuffixMap, csNamespaceMap, goModuleInfo, phpPsr4Map, dartPackageMap, pythonRootsFor(relPath), elixirModuleMap);
      if (resolved) {
        node.dependencies.push(resolved);

        // Ensure target node exists
        if (!nodesMap.has(resolved)) {
          // A target may be skipped when its own turn comes and so never build
          // its own node; carry the discovery-detected language here, since the
          // path alone would report an extensionless script as plaintext.
          const targetExt = detectedExts.get(resolved);
          nodesMap.set(resolved, {
            filePath: path.join(resolvedPath, resolved),
            relativePath: resolved,
            imports: [],
            exports: [],
            dependencies: [],
            dependents: [],
            language: targetExt ? getLanguageFromExtension(targetExt) : undefined,
          });
        }
        nodesMap.get(resolved)?.dependents.push(relPath);

        edges.push({
          source: relPath,
          target: resolved,
          type: imp.isDynamic ? "dynamic-import" : "import",
        });
      }
    }

    if (progress) progress.filesProcessed++;
  }

  logger.info("Code graph built", {
    nodes: nodesMap.size,
    edges: edges.length,
    filesSkipped,
    ...(skipsByReason.size > 0 ? { skipReasons: Object.fromEntries(skipsByReason) } : {}),
  });

  return {
    nodes: Array.from(nodesMap.values()),
    edges,
    symbolsByFile,
    outgoingCallsByFile,
  };
}
