// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Lang, registerDynamicLanguage } from "@ast-grep/napi";
import { graphCollectionName, projectIdFromPath } from "../config.js";
import { ELIXIR_TEMPLATE_EXTENSIONS, EXTENSION_LANGUAGE_MAP, EXTRA_EXTENSIONS, getLanguageFromExtension, MAX_GRAPH_FILE_BYTES, toForwardSlash } from "../constants.js";
import type {
  CodeGraph, CodeGraphEdge, CodeGraphNode,
  SymbolEdge, SymbolGraphFilePayload, SymbolGraphMeta, SymbolNode, SymbolRef,
} from "../types.js";
import { ensureElixirTemplateParsers, isElixirTemplateExtension } from "./elixir-templates.js";
import { detectExtensionFromSource, resolveExtensionlessDetection } from "./extensionless.js";
import { loadPathAliases } from "./graph-aliases.js";
import { extractImports } from "./graph-imports.js";
import {
  createGraphInputRecorder,
  decideGraphRebuild,
  type GraphChangeSummary,
  type GraphInputRecord,
  type GraphInputRecorder,
  type GraphRebuildDecision,
  graphCapabilitiesHash,
  scanDirectory,
} from "./graph-inputs.js";
import { buildCsNamespaceMap, buildDartPackageMap, buildElixirModuleMap, buildGodotProjectIndexes, buildGodotUidIndexes, buildGoModuleInfo, buildJvmSuffixMap, buildPhpFqcnMap, buildPhpPsr4Map, buildPythonManifests, buildRustCrateMap, type ClassNameIndex, findGodotProjectRootForProject, findGodotRootForFile, type GodotUidIndex, parseGodotAutoloads, pythonRootsForFile, resolveImport } from "./graph-resolution.js";
import {
  computeUnresolvedPct,
  type GodotSymbolResolutionContext,
  resolveCallSites,
} from "./graph-symbol-resolution.js";
import {
  extractSymbolsAndCalls,
  type RustUseBinding,
  rawCallsToUnresolvedEdges,
} from "./graph-symbols.js";

import { createIgnoreFilter } from "./ignore.js";
import { logger } from "./logger.js";
import { gdscriptParserAvailable, setGdscriptParserAvailable } from "./parser-availability.js";
import { deleteGraphData, describeQdrantError, getGraphMetadata, loadGraphData, loadGraphInputs, saveGraphData } from "./qdrant.js";
import {
  dropSymbolGraphCache,
  SymbolGraphCache,
  setSymbolGraphCache,
} from "./symbol-graph-cache.js";
import {
  allNameShardKeys,
  cleanStaleGenerations,
  contentHashOf,
  coordinateProject,
  deleteGeneration,
  deleteSymbolGraphData,
  ensureSymbolGraphCollections,
  nameShardKey,
  registerStagingGeneration,
  reverseShardKeyForCallee,
  saveFilePayloads,
  saveNameShard,
  saveReverseShard,
  saveSymbolGraphMeta,
  unregisterStagingGeneration,
} from "./symbol-graph-store.js";

// Re-export analysis functions for external consumers
export { describeGraphBuilder, findCircularDependencies, generateMermaidDiagram, getFileDependencies, getGraphStats, isGraphBuilderStale, isImportResolutionLow } from "./graph-analysis.js";

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
  const existing = await getExistingGraph(projectPath);
  if (existing) return existing;

  const resolved = path.resolve(projectPath);
  const graph = await buildCodeGraph(resolved, extraExtensions);
  // Strip symbol fields when serving as a plain CodeGraph
  const plain: CodeGraph = { nodes: graph.nodes, edges: graph.edges };
  graphCache.set(resolved, plain);
  return plain;
}

/** Get a cached or persisted graph without creating one when it is absent. */
export async function getExistingGraph(projectPath: string): Promise<CodeGraph | null> {
  const resolved = path.resolve(projectPath);
  const cached = graphCache.get(resolved);
  if (cached) return cached;

  const projectId = projectIdFromPath(resolved);
  const graphCollName = graphCollectionName(projectId);
  const persisted = await loadGraphData(graphCollName);
  if (!persisted) return null;

  graphCache.set(resolved, persisted);
  return persisted;
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

/**
 * Whether an incremental update has to rebuild the code graph, and why.
 *
 * The answer comes from the record the last build left behind — the files it
 * read and the settings it read them under — never from a predicate describing
 * which files a graph is built from. There is no such predicate to keep in
 * step, which is the whole reason the build reports its own inputs.
 *
 * Conservative wherever the record cannot settle the question: a project with
 * no usable record rebuilds once and writes one, and so does any addition, any
 * settings change, and any recorded input that moved. Only a change proven to
 * touch nothing the build read is skipped.
 */
export async function shouldRebuildGraph(
  projectPath: string,
  change: GraphChangeSummary,
  extraExtensions?: Set<string>,
): Promise<GraphRebuildDecision> {
  const resolved = path.resolve(projectPath);
  try {
    const graphCollName = graphCollectionName(projectIdFromPath(resolved));
    const load = await loadGraphInputs(graphCollName);
    if (load.status === "absent") {
      // Nothing persisted: there is no graph here to refresh, and building one
      // is not something an update that indexed nothing should decide to do.
      return { rebuild: true, reason: "no code graph has been built yet", graphExists: false };
    }
    if (load.status === "failed") {
      // A graph is presumed to be there and nothing is known about it, which
      // is the most conservative of the three outcomes, not the quietest.
      return {
        rebuild: true,
        reason: `the graph's stored inputs could not be read: ${load.error}`,
        graphExists: true,
      };
    }
    return await decideGraphRebuild(
      resolved,
      load.value,
      change,
      extraExtensions ?? EXTRA_EXTENSIONS,
      await currentGraphCapabilities(),
    );
  } catch (err) {
    // Failing to answer is not an answer. Anything unexpected here leaves the
    // caller doing exactly what it did before this gate existed.
    logger.warn("Could not decide whether the code graph needs rebuilding — rebuilding", {
      projectPath: resolved,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      rebuild: true,
      reason: "the record of the last build could not be read",
      graphExists: true,
    };
  }
}

/**
 * The parsers this process actually has, as one hash.
 *
 * Read after {@link ensureDynamicLanguages} has run, which every path into the
 * build and the decision does first, so it describes the process answering
 * rather than some other one.
 */
export async function currentGraphCapabilities(): Promise<string> {
  return graphCapabilitiesHash({
    loadedGrammars: getDynamicLanguageStatus().loaded,
    gdscript: gdscriptParserAvailable,
    // Resolved unconditionally, not only where the project has templates: the
    // build and the decision have to answer this the same way or every Elixir
    // project rebuilds on every update. The loader memoises its own promise,
    // so this is a 10ms WASM load once per process and free thereafter — and
    // it is load-bearing, since both import and symbol extraction fall back to
    // a line/leaf approximation when the grammars are missing.
    elixirTemplates: await ensureElixirTemplateParsers(),
  });
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
    await saveGraphData(graphCollName, resolvedPath, graph, built.graphInputs);

    // Build & persist symbol graph (resolution + sharded persistence) — unless
    // the caller asked to skip it (Phase F watcher path).
    let symbolGraphError: string | undefined;
    if (!opts.skipSymbolGraph) {
      try {
        progress.phase = "resolving symbols";
        // Use the autoload table built by buildCodeGraph (per-project, merged
        // from all Godot project roots) for GDScript receiver-type resolution.
        resolveCallSites(
          graph,
          built.symbolsByFile,
          built.outgoingCallsByFile,
          built.rustBindingsByFile,
          built.rustCrateRootByFile,
          built.rustInlineScopedCalls,
          built.rustInlineDeclaredSymbols,
          built.rustCrateRootsByFile,
          built.autoloadTable,
          built.inferredTypesByFile,
          built.memberAssignmentsByFile,
          built.resToRepoPathMap,
          built.godotContext,
        );

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
  return coordinateProject(projectId, async () => {
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

    const newGeneration = randomUUID();
    registerStagingGeneration(projectId, newGeneration);

    const reverseShardSets = new Map<number, Map<string, Set<string>>>();
    for (const edges of outgoingCallsByFile.values()) {
      for (const e of edges) {
        for (const calleeId of e.calleeCandidates) {
          const bucket = reverseShardKeyForCallee(calleeId);
          let shard = reverseShardSets.get(bucket);
          if (!shard) {
            shard = new Map();
            reverseShardSets.set(bucket, shard);
          }
          let callers = shard.get(calleeId);
          if (!callers) {
            callers = new Set();
            shard.set(calleeId, callers);
          }
          callers.add(e.callerId);
        }
      }
    }

    const reverseShards = new Map<number, Record<string, string[]>>();
    for (const [bucket, shardSets] of reverseShardSets.entries()) {
      const shard: Record<string, string[]> = {};
      for (const [calleeId, callers] of shardSets.entries()) {
        shard[calleeId] = Array.from(callers);
      }
      reverseShards.set(bucket, shard);
    }

    try {
      // Persist all payloads and shards into the staged generation first
      await saveFilePayloads(projectId, payloads, newGeneration);
      for (const [shardKey, shard] of nameShards.entries()) {
        if (Object.keys(shard).length === 0) continue;
        await saveNameShard(projectId, shardKey, shard, newGeneration);
      }
      for (const [bucket, shard] of reverseShards.entries()) {
        if (Object.keys(shard).length === 0) continue;
        await saveReverseShard(projectId, bucket, shard, newGeneration);
      }

      // Activate that generation with one metadata-pointer write only after every staged write succeeds
      const meta: SymbolGraphMeta = {
        projectId,
        symbolCount: totalSymbols,
        edgeCount: totalEdges,
        fileCount: symbolsByFile.size,
        unresolvedEdgePct: computeUnresolvedPct(outgoingCallsByFile),
        builtAt: Date.now(),
        schemaVersion: 2,
        generation: newGeneration,
      };
      await saveSymbolGraphMeta(projectId, meta);

      // Replace cache entry
      const cache = new SymbolGraphCache(projectId, meta);
      setSymbolGraphCache(cache);

      // Safely retire superseded generations and clean abandoned staged generations
      await cleanStaleGenerations(projectId, newGeneration).catch((err) => {
        logger.warn("Failed to clean stale symbol-graph generations", {
          projectId,
          error: err instanceof Error ? err.message : String(err),
        });
      });

      logger.info("Symbol graph persisted", {
        projectId,
        files: meta.fileCount,
        symbols: meta.symbolCount,
        edges: meta.edgeCount,
        unresolvedPct: meta.unresolvedEdgePct.toFixed(1),
      });
    } catch (err) {
      // Staging failed: clean up the incomplete staged generation immediately
      await deleteGeneration(projectId, newGeneration).catch(() => {});
      throw err;
    } finally {
      unregisterStagingGeneration(projectId, newGeneration);
    }
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
  /** SocratiCode version that built this graph, which is not necessarily the
   * one serving it. Absent on graphs persisted before this field was
   * recorded. */
  builtByVersion?: string;
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
    builtByVersion: meta.builtByVersion,
    cached: graphCache.has(resolved),
    symbol,
  };
}

// ── Register dynamic language grammars ───────────────────────────────────

let dynamicLangsRegistered = false;
/**
 * The declaration map a path written inside an inline `mod { … }` block is
 * answered with: empty, because the file's own declarations are not in that
 * block's scope. Shared and never written.
 */
const EMPTY_DECLARED_MODS: Map<string, string> = new Map();

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

/**
 * Whether the GDScript tree-sitter parser was successfully registered.
 * tree-sitter-gdscript ships platform-specific prebuilds; on platforms
 * without a compatible artifact (e.g. linux-arm64) this stays false so
 * callers can skip AST processing and use syntax-aware fallback extraction.
 */
export { gdscriptParserAvailable } from "./parser-availability.js";

/**
 * Preflight the tree-sitter-gdscript native addon in an isolated child
 * process. This validates three things that a simple accessSync cannot:
 *
 *   1. The N-API addon loads (require does not throw).
 *   2. It exposes a tree-sitter language object.
 *   3. ast-grep can load its `tree_sitter_gdscript` symbol and parse a snippet.
 *
 * Running in a child process is essential because
 * `registerDynamicLanguage` replaces all globally registered languages on
 * each call — a failed registration in the parent would wipe out the
 * other dynamic languages before we even try to batch them.
 *
 * The child resolves `node-gyp-build` from the tree-sitter-gdscript
 * package's own context (via createRequire rooted at its package.json),
 * so it does not rely on npm's hoisted node_modules layout.
 *
 * @param gdscriptPkgPath - Absolute path to tree-sitter-gdscript/package.json
 * @returns The resolved native artifact path on success, null on failure.
 */
function preflightGdscriptAddon(gdscriptPkgPath: string): string | null {
  const preflightScript = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "gdscript-preflight.cjs",
  );
  try {
    const stdout = execFileSync(process.execPath, [preflightScript, gdscriptPkgPath], {
      timeout: 10_000,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    // On success the preflight prints: "PREFLIGHT: OK <nativePath>"
    const match = stdout.match(/^PREFLIGHT: OK (.+)$/m);
    if (match) return match[1];
    // If we get here, exit code was 0 but output was unexpected
    logger.warn("GDScript preflight: unexpected output", { stdout });
    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Extract stderr from the child process error
    const stderr = (err as { stderr?: string })?.stderr?.trim() ?? message;
    failedDynamicLanguages.set("gdscript", stderr);
    logger.warn("GDScript preflight failed", { error: stderr });
    return null;
  }
}

export function ensureDynamicLanguages(): void {
  if (dynamicLangsRegistered) return;

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

  // Phase 1: Pre-validate each @ast-grep/lang-* grammar individually.
  // A throwing libraryPath getter is isolated to its own grammar so the
  // rest can still be registered. We do NOT add to loadedDynamicLanguages
  // yet — that happens only after the batch succeeds.
  const survivors: Record<string, AstGrepLangModule> = {};
  const pendingLoaded = new Set<string>();

  for (const [name, pkg] of langPackages) {
    try {
      const mod = esmRequire(pkg) as AstGrepLangModule;
      // Pre-validate the lazy `libraryPath` getter. registerDynamicLanguage
      // accesses this property for every entry, and a single throwing
      // getter aborts the entire batch atomically (issue #43).
      void mod.libraryPath;
      survivors[name] = mod;
      pendingLoaded.add(name);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failedDynamicLanguages.set(name, message);
      logger.warn("ast-grep grammar failed to load", { name, error: message });
    }
  }

  // Phase 2: Preflight the GDScript native addon in an isolated child
  // process. This validates the N-API addon loads, exports
  // tree_sitter_gdscript, and ast-grep can parse with it — without
  // risking the parent process's global language registry.
  let gdscriptNativePath: string | null = null;
  try {
    const gdscriptPkgPath = esmRequire.resolve("tree-sitter-gdscript/package.json");
    gdscriptNativePath = preflightGdscriptAddon(gdscriptPkgPath);
    if (gdscriptNativePath) {
      survivors.gdscript = {
        libraryPath: gdscriptNativePath,
        extensions: ["gd"],
        languageSymbol: "tree_sitter_gdscript",
      };
      pendingLoaded.add("gdscript");
    }
    // If preflight returned null, the failure was already recorded in
    // failedDynamicLanguages by preflightGdscriptAddon.
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    failedDynamicLanguages.set("gdscript", message);
    logger.warn("ast-grep grammar failed to load", { name: "gdscript", error: message });
  }

  // Phase 3: Register all validated grammars in a single batch call.
  // registerDynamicLanguage replaces all previously registered languages
  // on each call, so every grammar must be in this one batch.
  if (Object.keys(survivors).length > 0) {
    try {
      registerDynamicLanguage(survivors);
      // Batch succeeded — mark all survivors as loaded and clear any
      // stale failure entries from a previous failed attempt.
      for (const name of pendingLoaded) {
        loadedDynamicLanguages.add(name);
        failedDynamicLanguages.delete(name);
      }
      if (survivors.gdscript) {
        setGdscriptParserAvailable(true);
      }
      logger.info("Registered dynamic ast-grep languages", {
        languages: [...loadedDynamicLanguages].sort(),
      });
    } catch (err) {
      // Batch failed — every candidate in the batch is affected.
      // Record failure for all pending languages and keep retry
      // state accurate by NOT setting dynamicLangsRegistered.
      const message = err instanceof Error ? err.message : String(err);
      for (const name of pendingLoaded) {
        failedDynamicLanguages.set(name, message);
      }
      logger.warn(
        "Dynamic language batch registration failed; all candidates affected",
        { error: message, candidates: [...pendingLoaded].sort() },
      );
      // Do NOT set dynamicLangsRegistered — allow a retry on next call.
      return;
    }
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

  dynamicLangsRegistered = true;
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
  ".gd": "gdscript",
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
  recorder?: GraphInputRecorder,
): Promise<{ files: string[]; detectedExts: Map<string, string> }> {
  const ig = createIgnoreFilter(projectPath);
  // The ignore files shaped this walk, so they are inputs to the graph as much
  // as any source file is: a rule added to one can add or remove nodes without
  // a single source file changing. The filter hands over the bytes it was
  // built from, so this records the state the walk actually ran under rather
  // than whatever a second read would find.
  if (recorder) {
    for (const source of ig.sources) {
      recorder.read(path.join(projectPath, source.path), source.content);
    }
    // An environment root is excluded because of a marker inside it, and the
    // walk never enters it — so nothing below would ever be listed, and the
    // parent's listing does not move when the marker goes. List the root
    // itself: `pyvenv.cfg` disappearing is then an entry-name change like any
    // other, and the subtree it re-admits is not missed.
    for (const environment of ig.environments) {
      const absolute = path.join(projectPath, environment);
      try {
        const entries = await fs.readdir(absolute, { withFileTypes: true });
        recorder.directory(absolute, scanDirectory(ig, projectPath, absolute, entries).listing);
      } catch {
        // A directory, so it is re-checked with a `readdir` like any other —
        // the file bucket's readability test would answer a question nobody
        // asked of it.
        recorder.unreadableDirectory(absolute);
      }
    }
  }
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
      // The subtree contributed nothing, and nothing else records that it was
      // even reached: the parent's listing holds this directory's name either
      // way, so a subtree that becomes listable would otherwise add nodes with
      // no recorded input having moved.
      recorder?.unreadableDirectory(dir);
      return;
    }

    // The listing itself is an input: it is the only read that can tell the
    // next update a file appeared — including the ones no index holds, like a
    // nested `go.mod` or a `.uid` sidecar. The filter is applied here, once,
    // by the same function the rebuild check re-reads the directory with, and
    // the walk iterates what it kept rather than asking the filter again.
    const { kept, listing } = scanDirectory(ig, projectPath, dir, entries);
    recorder?.directory(dir, listing);

    for (const entry of kept) {
      const fullPath = path.join(dir, entry.name);
      const relPath = toForwardSlash(path.relative(projectPath, fullPath));

      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        // Mixed Elixir templates use dedicated parsers, not the Elixir grammar.
        // Godot resource files (.tscn/.tres) have no AST grammar but use tokenizer-based
        // import extraction for [ext_resource] declarations.
        const isGodotResource = ext === ".tscn" || ext === ".tres";
        // .uid sidecar files contain UID strings for Godot's uid:// path
        // resolution. They are not graph nodes themselves, but they must
        // be in the file set so buildGodotUidIndexes can read them.
        const isGodotUid = ext === ".uid";
        if (getAstGrepLang(ext) !== null || extras.has(ext) || ELIXIR_TEMPLATE_EXTENSIONS.has(ext) || isGodotResource || isGodotUid) {
          files.push(relPath);
        } else if (ext === "" && (includeDotFiles || !entry.name.startsWith("."))) {
          // Extensionless: admit only when detection yields a grammar-bearing
          // canonical extension. `.txt`-detected files stay out of the graph:
          // we don't start adding grammar-less extensionless leaf nodes (only
          // extra-extension files and mixed Elixir templates are grammar-less).
          // Extensionless dotfiles are skipped unless INCLUDE_DOT_FILES, to stay
          // consistent with the index (see includeDotFiles above).
          const { extension: detected, head, unreadable } = await resolveExtensionlessDetection(fullPath);
          if (detected && getAstGrepLang(detected) !== null) {
            files.push(relPath);
            detectedExts.set(relPath, detected);
          } else if (unreadable) {
            // The head-read threw. Nothing was scored, so there is no head to
            // watch — but the file becoming readable could make it a node, and
            // no other bucket would move when it does.
            recorder?.unreadable(fullPath);
          } else if (head !== null) {
            // Read to decide, and turned away. Those bytes decided the shape of
            // the file set, so they are what is watched — the head, not the
            // whole file (which was never read) and not the size (which a
            // same-length edit can flip the answer without moving).
            recorder?.head(fullPath, head);
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
  autoloadTable?: Map<string, string>;
  resToRepoPathMap: Map<string, string>;
  godotContext?: GodotSymbolResolutionContext;
  inferredTypesByFile: Map<string, Map<string, Array<{ type: string; startLine: number; endLine: number }>>>;
  memberAssignmentsByFile: Map<string, Array<{ receiver: string; memberName: string; valueType: string }>>;
  /** Rust `use` bindings per file — resolution input only, never persisted. */
  rustBindingsByFile: Map<string, RustUseBinding[]>;
  /** Rust file → its crate's directory prefix. Resolution input only. */
  rustCrateRootByFile: Map<string, string>;
  /** Rust file → every target root its parsed Cargo manifest declares. */
  rustCrateRootsByFile: Map<string, string[]>;
  /**
   * The call edges whose qualifier is rooted in an inline `mod` — a scope with
   * no file to name. Resolution leaves them unresolved. Held by identity, so
   * nothing about it reaches an edge or the store.
   */
  rustInlineScopedCalls: Set<SymbolEdge>;
  /**
   * The ids of the Rust symbols declared inside an inline `mod`. A path
   * anchored at a file's own module cannot reach them, so resolution drops
   * them from that path's candidates. Resolution input only, never persisted.
   */
  rustInlineDeclaredSymbols: Map<string, string>;
  /**
   * Every input this build consumed, for the next incremental update to check
   * a change against. Reported from the build rather than described beside it,
   * so no second answer to "does this file contribute to the graph?" exists to
   * drift from this one.
   */
  graphInputs: GraphInputRecord;
}> {
  ensureDynamicLanguages();

  const resolvedPath = path.resolve(projectPath);
  const recorder = createGraphInputRecorder(resolvedPath);
  const effectiveExtras = extraExtensions ?? EXTRA_EXTENSIONS;
  const aliases = await loadPathAliases(resolvedPath, recorder);
  const { files, detectedExts } = await getGraphableFiles(resolvedPath, extraExtensions, recorder);
  const fileSet = new Set(files);
  if (files.some((file) => isElixirTemplateExtension(path.extname(file)))) {
    await ensureElixirTemplateParsers();
  }

  // Build GDScript class_name index once for O(1) extends resolution.
  // Scans all .gd files in a single pass; avoids 68k+ redundant reads for
  // large Godot projects where every file has an extends statement.
  // Per-Godot-project: each project.godot root gets its own class_name index
  // so class names in one Godot project don't leak into another.
  const hasGdscript = files.some((f) => f.endsWith(".gd"));
  const hasGodotFiles = hasGdscript || files.some((f) => f.endsWith(".tscn") || f.endsWith(".tres"));
  const godotRootCache = new Map<string, string | null>();
  // Per-project Godot indexes: maps each Godot project root to its scoped
  // class_name index. Used for per-file res:// and extends resolution.
  const godotProjectIndexes = hasGodotFiles
    ? buildGodotProjectIndexes(resolvedPath, fileSet, godotRootCache, recorder)
    : undefined;
  // Per-project UID indexes: maps each Godot project root to its scoped
  // uid:// → relative path index. Used for uid:// resolution in GDScript
  // and Godot resource files. Godot prefers UIDs over text paths.
  const godotProjectUidIndexes = hasGodotFiles
    ? buildGodotUidIndexes(resolvedPath, fileSet, godotRootCache, recorder)
    : undefined;

  // Symbol resolution needs the same nearest-project boundary as import
  // resolution. Keep each project's class names, autoloads, and res:// root
  // isolated so duplicate names in sibling or nested projects cannot cross.
  let godotContext: GodotSymbolResolutionContext | undefined;
  if (hasGodotFiles) {
    const projectRootByFile = new Map<string, string>();
    for (const relPath of files) {
      if (!relPath.endsWith(".gd") && !relPath.endsWith(".tscn") && !relPath.endsWith(".tres")) {
        continue;
      }
      const root = findGodotRootForFile(
        path.join(resolvedPath, relPath),
        godotProjectIndexes,
        godotRootCache,
      );
      if (root) projectRootByFile.set(relPath, root);
    }

    const projectsByRoot = new Map<string, {
      rootOffset: string;
      classNameIndex: ReadonlyMap<string, string>;
      autoloadTable: ReadonlyMap<string, string>;
    }>();
    for (const [godotRoot, classNameIndex] of godotProjectIndexes ?? []) {
      const rootOffset = toForwardSlash(path.relative(resolvedPath, godotRoot));
      const autoloadTable = new Map<string, string>();
      for (const [name, resourcePath] of parseGodotAutoloads(godotRoot, recorder)) {
        const repoPath = rootOffset ? `${rootOffset}/${resourcePath}` : resourcePath;
        autoloadTable.set(name, repoPath);
      }
      projectsByRoot.set(godotRoot, { rootOffset, classNameIndex, autoloadTable });
    }
    if (projectsByRoot.size > 0) {
      godotContext = { projectRootByFile, projectsByRoot };
    }
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
  const inferredTypesByFile = new Map<string, Map<string, Array<{ type: string; startLine: number; endLine: number }>>>();
  const memberAssignmentsByFile = new Map<string, Array<{ receiver: string; memberName: string; valueType: string }>>();
  const rustBindingsByFile = new Map<string, RustUseBinding[]>();
  const rustInlineScopedCalls = new Set<SymbolEdge>();
  const rustInlineDeclaredSymbols = new Map<string, string>();

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
  //
  // The declaration-derived FQCN map backs it up. A package that registers its
  // namespaces at run time (`$loader->addNamespace(...)`) and declares
  // `"autoload": {}` has no map to read, so PSR-4 answers nothing for it and
  // every one of its files stayed orphaned — the WordPress-plugin norm (issue
  // #120). Consulted only after a PSR-4 miss, so the manifest stays the
  // authority wherever one exists.
  const hasPhp = files.some((f) => path.extname(f).toLowerCase() === ".php");
  const phpPsr4Map = hasPhp ? buildPhpPsr4Map(resolvedPath, recorder) : undefined;
  const phpFqcnMap = hasPhp ? buildPhpFqcnMap(fileSet, resolvedPath, recorder) : undefined;

  // Build a namespace lookup map for C# projects. Each `namespace X.Y.Z` block
  // (or file-scoped `namespace X.Y.Z;`) is recorded so `using X.Y.Z;` directives
  // can be resolved to the file(s) that contribute to that namespace. Without
  // this, every C# import resolved to null and the file graph was empty.
  const hasCs = files.some((f) => path.extname(f).toLowerCase() === ".cs");
  const csNamespaceMap = hasCs ? buildCsNamespaceMap(fileSet, resolvedPath, recorder) : undefined;

  // Build Go module-resolution info from every go.mod in the tree (issue
  // #45 for a root-level go.mod; issue #82 for nested modules in a
  // monorepo). Without this, every Go import resolved to null and Go
  // projects produced an empty file graph. buildGoModuleInfo discovers
  // go.mod itself (independently of the graphable file set) and returns
  // one entry per module, or an empty array when none parse; the resolver
  // treats an empty/undefined result as "no Go resolution available" and
  // behaves exactly as it did before this feature for those cases.
  const hasGo = files.some((f) => f.endsWith(".go"));
  const goModuleInfo = hasGo ? buildGoModuleInfo(fileSet, resolvedPath, recorder) : undefined;

  // Map each in-repo Dart package name to its root, from every pubspec.yaml
  // in the tree (discovered by walking, like go.mod — pubspec.yaml is never
  // in the graphable file set). Flutter code imports intra-project files as
  // `package:<name>/...` by convention, so without this map those imports
  // all resolved to null and Dart projects lost nearly every file-graph edge
  // (issue #106). An empty/undefined map keeps the resolver's old behavior:
  // every `package:` import stays unresolved.
  const hasDart = files.some((f) => path.extname(f).toLowerCase() === ".dart");
  const dartPackageMap = hasDart ? buildDartPackageMap(resolvedPath, recorder) : undefined;

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
  const pythonManifests = hasPython ? buildPythonManifests(resolvedPath, recorder) : [];
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
  const elixirModuleMap = hasElixir ? buildElixirModuleMap(fileSet, resolvedPath, recorder) : undefined;

  // Record every crate the tree declares, from each Cargo.toml (discovered by
  // walking, like go.mod and pubspec.yaml — Cargo.toml is never in the
  // graphable file set). A Rust path names a position in a module tree
  // (`crate::`, `super::`) or another crate by name, neither of which the
  // resolver could follow without knowing where each crate's root module sits:
  // every specifier containing `::` resolved to null, so the file graph held
  // only bare `mod` declarations. An empty list keeps `mod`, `super` and `self`
  // resolving from the file's own position, as before.
  const hasRust = files.some((f) => path.extname(f).toLowerCase() === ".rs");
  const rustCrates = hasRust ? buildRustCrateMap(fileSet, resolvedPath, recorder) : undefined;

  // Which crate each Rust file belongs to, as a path prefix. `crate::` is
  // relative to a crate's own root module, so resolution needs the boundary —
  // and the manifests are what draw it. Deriving it from the path instead
  // means guessing at a layout: a marker like `src/` misses a crate that has
  // no `src/` directory (ripgrep) and misreads one whose sources start at the
  // project root (tokio), and the guess fails silently in both.
  //
  // The owning crate is the one whose directory contains the file and is
  // deepest, with the workspace root at `"."` ranking as no depth at all —
  // the same rule the import resolver settled on. A crate at the root confines
  // nothing, which is correct: there is only one crate to be in.
  const rustCrateRootByFile = new Map<string, string>();
  const rustCrateRootsByFile = new Map<string, string[]>();
  if (rustCrates && rustCrates.length > 0) {
    const depthOf = (crate: { dir: string }): number => (crate.dir === "." ? 0 : crate.dir.length);
    const ranked = [...rustCrates].sort((a, b) => depthOf(b) - depthOf(a));
    for (const relPath of files) {
      if (!relPath.endsWith(".rs")) continue;
      const owner = ranked.find((c) => c.dir === "." || relPath.startsWith(`${c.dir}/`));
      if (owner) {
        rustCrateRootByFile.set(relPath, owner.dir === "." ? "" : `${owner.dir}/`);
        // Only a parsed manifest is complete enough to make absence a verdict.
        // An unreadable manifest contributes convention roots for import
        // recovery, but those roots must not hide a custom target it could not
        // declare to us.
        if (!owner.manifestUnread) rustCrateRootsByFile.set(relPath, [...owner.roots]);
      }
    }
  }

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

    // .uid sidecar files are in the file set for UID index building but
    // are not graph nodes — they contain no code, just a UID string.
    if (ext === ".uid") {
      if (progress) progress.filesProcessed++;
      continue;
    }

    // Extra extensions with no parser are included as leaf nodes so they can be
    // targets of import edges, but we skip import extraction since we can't
    // parse them. Godot resource files (.tscn/.tres) are an exception: they
    // have no AST grammar but use tokenizer-based import extraction for
    // [ext_resource] declarations, so they pass through to
    // the extraction path below.
    const isGodotResource = ext === ".tscn" || ext === ".tres";
    const isGodotUid = ext === ".uid";
    // Sidecars stay in fileSet so the UID index can read them, but they are
    // metadata rather than graph nodes and never enter the source-read path.
    if (isGodotUid) {
      if (progress) progress.filesProcessed++;
      continue;
    }
    if (!lang && !isElixirTemplate && !isGodotResource) {
      const absolutePath = path.join(resolvedPath, relPath);
      // A leaf node is made from its path alone — nothing here reads it — so
      // only its presence is recorded. Its content reaching the graph would
      // mean it had a parser, which is the branch above.
      recorder.present(absolutePath);
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
        // The size is what excluded it, so the size is what is watched: a file
        // that shrinks under the limit becomes a node the next build.
        recorder.present(absolutePath, stat.size);
        continue;
      }
      source = await fs.readFile(absolutePath, "utf-8");
      recorder.read(absolutePath, source);
    } catch (err) {
      // ENOENT means the file vanished between discovery and this read; anything
      // else is a real fault worth the error text. Both drop the file, so both
      // count — unlike a discovery-time detection miss, which keeps the file out
      // of `files` entirely, leaving nothing here to count.
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") recordSkip(relPath, "vanished");
      else recordSkip(relPath, "read-failed", { error: err instanceof Error ? err.message : String(err) });
      // Tried and failed, which is not the same as deliberately not opened: a
      // file that starts being readable starts being a node.
      recorder.unreadable(absolutePath);
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

    const extractionLang = lang ?? (isGodotResource ? "godot-resource" : "elixir-template");
    const importInfos = extractImports(source, extractionLang, ext);

    // Extract symbols & raw call sites in the same pass
    try {
      const extracted = extractSymbolsAndCalls(source, extractionLang, ext, relPath);
      symbolsByFile.set(relPath, extracted.symbols);
      const edges = rawCallsToUnresolvedEdges(extracted.rawCalls);
      outgoingCallsByFile.set(relPath, edges);
      // One edge per raw call, in order, so the call at `i` is the edge at `i`.
      // The flag stays out of the edge itself: it is resolution's business and
      // the store must not grow a field for it.
      for (let i = 0; i < extracted.rawCalls.length; i++) {
        if (extracted.rawCalls[i].qualifierRootedInInlineMod) rustInlineScopedCalls.add(edges[i]);
      }
      // Same reason, one level down: which declarations sit inside an inline
      // `mod` is visible in the extractor and nowhere after it.
      if (extracted.inlineModSymbolIds) {
        for (const [id, owner] of extracted.inlineModSymbolIds) {
          rustInlineDeclaredSymbols.set(id, owner);
        }
      }
      if (extracted.bindings && extracted.bindings.length > 0) {
        rustBindingsByFile.set(relPath, extracted.bindings);
      }
      if (extracted.inferredTypes && extracted.inferredTypes.size > 0) {
        inferredTypesByFile.set(relPath, extracted.inferredTypes);
      }
      if (extracted.memberAssignments && extracted.memberAssignments.length > 0) {
        memberAssignmentsByFile.set(relPath, extracted.memberAssignments);
      }
    } catch (err) {
      logger.debug("Symbol extraction failed (continuing)", {
        file: relPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Which modules this file brings into the tree by declaring them. A Rust
    // path with an unanchored head can only reach a module the file declares,
    // and the declaration is the only evidence of that in the source: matching
    // a neighbouring file by name instead let a third-party head capture the
    // import whenever a file of that name happened to exist.
    //
    // The name comes from the declaration itself and not from its specifier.
    // Reading the specifier's last segment got both ends wrong: a
    // `#[path = "custom.rs"] mod foo;` recorded `custom.rs` and lost every
    // `use foo::Item;` in that file, and a `mod bar;` written inside
    // `mod outer { … }` recorded `bar` as if the file declared it — which
    // handed a same-named neighbouring file back the capture this gate exists
    // to stop. Both checked with cargo 1.70.0 and 1.98.0: the attribute form
    // compiles with `foo` in scope, and at the file's own level a name
    // declared inside an inline block reaches the dependency instead, or
    // fails with E0432 when there is none.
    // The map carries the file with the name, because half the declarations
    // move it: `#[path = "custom.rs"] mod foo;` names `foo` and files it at
    // `custom.rs`, and a resolver holding only the name looks for `src/foo.rs`,
    // finds nothing, and falls through to a library called `foo` if the
    // workspace has one — an edge into an unrelated crate. Where the
    // declaration does not move anything, the value is the name itself.
    const declaredMods = new Map<string, string>();
    for (const imp of importInfos) {
      if (imp.declaredName) declaredMods.set(imp.declaredName, imp.moduleSpecifier);
    }

    // Per-file Godot project root and scoped class_name index.
    // Computed once per file, outside the import loop, since the root
    // does not change between imports from the same file.
    // Each Godot source file resolves res:// and extends relative to its
    // nearest project.godot ancestor, with class_name lookups scoped to
    // that same project. This supports repos with multiple Godot projects.
    // When per-project indexes are available but a file has no project.godot
    // ancestor, both root and index are null/undefined — class_name and
    // res:// resolution are skipped for that file, matching Godot's
    // project-scoped semantics.
    // Non-Godot files skip this lookup entirely (the parameters are ignored
    // by their resolveImport case) to avoid unnecessary filesystem walks.
    let fileGodotRoot: string | null | undefined;
    let fileClassNameIndex: ClassNameIndex | undefined;
    let fileUidIndex: GodotUidIndex | undefined;
    const isGodotFile = language === "gdscript" || language === "godot-resource";
    if (godotProjectIndexes && isGodotFile) {
      fileGodotRoot = findGodotRootForFile(absolutePath, godotProjectIndexes, godotRootCache);
      if (fileGodotRoot) {
        fileClassNameIndex = godotProjectIndexes.get(fileGodotRoot);
        fileUidIndex = godotProjectUidIndexes?.get(fileGodotRoot);
      }
      // fileClassNameIndex stays undefined when no project root is found,
      // preventing cross-project class_name leakage.
    }
    // Non-Godot files or projects without Godot indexes: fileClassNameIndex
    // and fileGodotRoot stay undefined — resolveImport ignores them.

    for (const imp of importInfos) {
      node.imports.push(imp.moduleSpecifier);

      // Try to resolve to a project file
      // CSS imports from <style> blocks use CSS resolution even when the source file is Svelte/Vue
      const resolutionLanguage = imp.isCssImport ? "css" : language;
      // A bare path written inside an inline `mod { … }` block is answered
      // without the file's declarations: they are not in that block's scope,
      // and handing them over drew an edge rustc rejects with E0432. The map is
      // emptied rather than omitted — omitting it turns the gate off entirely,
      // which is the looser reading, not a stricter one. Edition 2015 is
      // unaffected: there the path is absolute from the crate root and never
      // consulted the map to begin with.
      const scopedMods = imp.fromInlineBlock ? EMPTY_DECLARED_MODS : declaredMods;
      const resolved = resolveImport(imp.moduleSpecifier, absolutePath, resolvedPath, fileSet, resolutionLanguage, aliases, jvmSuffixMap, csNamespaceMap, goModuleInfo, phpPsr4Map, dartPackageMap, pythonRootsFor(relPath), elixirModuleMap, phpFqcnMap, rustCrates, scopedMods, imp.isModuleDeclaration === true, fileClassNameIndex, fileGodotRoot, fileUidIndex, imp.fallbackSpecifier, imp.godotImportKind);
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

  // Preserve the single-project fields introduced with GDScript symbol
  // resolution for direct callers. Multi-project builds deliberately leave
  // them empty: no unscoped map can represent duplicate autoload names or
  // duplicate res:// paths safely, and `godotContext` carries the complete
  // caller-scoped representation used by the production resolver.
  let autoloadTable: Map<string, string> | undefined;
  const resToRepoPathMap = new Map<string, string>();
  if (godotContext?.projectsByRoot.size === 1) {
    const [godotRoot, project] = godotContext.projectsByRoot.entries().next().value as [
      string,
      { rootOffset: string; autoloadTable: ReadonlyMap<string, string> },
    ];
    autoloadTable = new Map(project.autoloadTable);
    const prefix = project.rootOffset ? `${project.rootOffset}/` : "";
    for (const [repoPath, ownerRoot] of godotContext.projectRootByFile) {
      if (ownerRoot !== godotRoot) continue;
      const resourcePath = prefix && repoPath.startsWith(prefix)
        ? repoPath.slice(prefix.length)
        : repoPath;
      resToRepoPathMap.set(resourcePath, repoPath);
    }
  } else if (!godotContext) {
    const godotRoot = findGodotProjectRootForProject(resolvedPath);
    if (godotRoot) {
      const rootOffset = toForwardSlash(path.relative(resolvedPath, godotRoot));
      autoloadTable = new Map();
      for (const [name, resourcePath] of parseGodotAutoloads(godotRoot, recorder)) {
        const repoPath = rootOffset ? `${rootOffset}/${resourcePath}` : resourcePath;
        autoloadTable.set(name, repoPath);
        resToRepoPathMap.set(resourcePath, repoPath);
      }
    }
  }

  return {
    nodes: Array.from(nodesMap.values()),
    edges,
    symbolsByFile,
    outgoingCallsByFile,
    autoloadTable,
    resToRepoPathMap,
    godotContext,
    inferredTypesByFile,
    memberAssignmentsByFile,
    rustBindingsByFile,
    rustCrateRootByFile,
    rustCrateRootsByFile,
    rustInlineScopedCalls,
    rustInlineDeclaredSymbols,
    graphInputs: recorder.finish(effectiveExtras, await currentGraphCapabilities()),
  };
}
