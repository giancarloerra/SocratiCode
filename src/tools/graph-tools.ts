// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited
import path from "node:path";
import { projectIdFromPath } from "../config.js";
import { mergeExtraExtensions } from "../constants.js";
import { awaitGraphBuild, ensureDynamicLanguages, findCircularDependencies, generateMermaidDiagram, getDynamicLanguageStatus, getFileDependencies, getGraphBuildProgress, getGraphStats, getGraphStatus, getLastGraphBuildCompleted, getOrBuildGraph, isGraphBuildInProgress, isImportResolutionLow, rebuildGraph, removeGraph } from "../services/code-graph.js";
import { detectEntryPoints } from "../services/graph-entrypoints.js";
import {
  type FlowNode,
  getCallFlow,
  getImpactRadius,
  getSymbolContext,
  listSymbols,
  looksLikeFilePath,
} from "../services/graph-impact.js";
import { openInBrowser, writeInteractiveGraphFile } from "../services/graph-visualize-browser.js";
import { buildInteractiveGraphHtml } from "../services/graph-visualize-html.js";
import { logger } from "../services/logger.js";
import { getSymbolGraphCache } from "../services/symbol-graph-cache.js";
import { ensureWatcherStarted } from "../services/watcher.js";

/**
 * Tools that answer purely from the persisted symbol graph. If the last build
 * could not persist it, they read whatever cache survived, so their answers may
 * be stale or absent with nothing on screen to say why — the "0 callers, no
 * explanation" report behind #89. They get the failure prepended.
 */
const SYMBOL_GRAPH_TOOLS = new Set([
  "codebase_impact",
  "codebase_flow",
  "codebase_symbol",
  "codebase_symbols",
]);

export async function handleGraphTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const result = await dispatchGraphTool(name, args);
  if (!SYMBOL_GRAPH_TOOLS.has(name)) return result;
  const resolved = path.resolve((args.projectPath as string) || process.cwd());
  const symbolGraphError = getLastGraphBuildCompleted(resolved)?.symbolGraphError;
  if (!symbolGraphError) return result;
  return [
    `WARNING: the last graph build could not persist the symbol graph: ${symbolGraphError}`,
    "Results below may be stale or incomplete until a rebuild succeeds.",
    "",
    result,
  ].join("\n");
}

async function dispatchGraphTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const projectPath = path.resolve((args.projectPath as string) || process.cwd());

  // Auto-start watcher on any graph interaction (fire-and-forget)
  ensureWatcherStarted(projectPath);

  switch (name) {
    case "codebase_graph_build": {
      const resolved = path.resolve(projectPath);

      // Concurrency guard: if already building, show progress
      if (isGraphBuildInProgress(resolved)) {
        const progress = getGraphBuildProgress(resolved);
        const lines = [
          `⚠ Graph build already in progress for: ${resolved}`,
        ];
        if (progress) {
          const elapsed = ((Date.now() - progress.startedAt) / 1000).toFixed(0);
          const pct = progress.filesTotal > 0
            ? ` (${Math.round((progress.filesProcessed / progress.filesTotal) * 100)}%)`
            : "";
          const skippedNote = progress.filesSkipped ? ` — ${progress.filesSkipped} skipped` : "";
          lines.push(`Phase: ${progress.phase}`);
          lines.push(`Progress: ${progress.filesProcessed}/${progress.filesTotal} files${pct}${skippedNote}`);
          lines.push(`Elapsed: ${elapsed}s`);
        }
        lines.push("", "Call codebase_graph_status to check progress.");
        return lines.join("\n");
      }

      // Fire-and-forget: start graph build in the background
      const extraExts = mergeExtraExtensions(args.extraExtensions as string | undefined);
      rebuildGraph(resolved, extraExts.size > 0 ? extraExts : undefined)
        .then((graph) => {
          logger.info("Background graph build completed", {
            projectPath: resolved,
            nodes: graph.nodes.length,
            edges: graph.edges.length,
            filesSkipped: getLastGraphBuildCompleted(resolved)?.filesSkipped ?? 0,
          });
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          logger.error("Background graph build failed", { projectPath: resolved, error: message });
        });

      return [
        `Graph build started in the background for: ${resolved}`,
        "",
        "IMPORTANT: The graph is now building asynchronously.",
        "Call codebase_graph_status to check progress. Keep calling it periodically until the build completes.",
        "Once complete, you can use codebase_graph_query, codebase_graph_stats, etc. to explore the graph.",
      ].join("\n");
    }

    case "codebase_graph_query": {
      const filePath = args.filePath as string;
      const graph = await getOrBuildGraph(projectPath);
      const deps = getFileDependencies(graph, filePath);

      const lines = [`Dependencies for: ${filePath}\n`];

      if (deps.imports.length === 0 && deps.importedBy.length === 0) {
        lines.push("No dependency information found for this file.");
        lines.push("Make sure codebase_graph_build has been run and the file path is relative.");
      } else {
        if (deps.imports.length > 0) {
          lines.push(`Imports (${deps.imports.length}):`);
          for (const imp of deps.imports) {
            lines.push(`  → ${imp}`);
          }
        }

        if (deps.importedBy.length > 0) {
          lines.push(`\nImported by (${deps.importedBy.length}):`);
          for (const dep of deps.importedBy) {
            lines.push(`  ← ${dep}`);
          }
        }
      }

      return lines.join("\n");
    }

    case "codebase_graph_stats": {
      const graph = await getOrBuildGraph(projectPath);

      if (graph.nodes.length === 0) {
        return "No graph data available. Run codebase_graph_build first.";
      }

      const stats = getGraphStats(graph);

      const lines = [
        `Code Graph Statistics for: ${projectPath}\n`,
        `Total files: ${stats.totalFiles}`,
        `Total dependency edges: ${stats.totalEdges}`,
        `Average dependencies per file: ${stats.avgDependencies.toFixed(1)}`,
        `Circular dependency chains: ${stats.circularDeps}`,
      ];

      if (Object.keys(stats.languageBreakdown).length > 0) {
        lines.push("", "Languages:");
        for (const [lang, count] of Object.entries(stats.languageBreakdown).sort((a, b) => b[1] - a[1])) {
          lines.push(`  ${lang}: ${count} files`);
        }
      }

      lines.push("", `Most connected files (top 10):`);
      for (const f of stats.mostConnected) {
        lines.push(`  ${f.file}: ${f.connections} connections`);
      }

      if (stats.orphans.length > 0) {
        lines.push("");
        lines.push(`Orphan files (no dependencies, showing first 20):`);
        for (const f of stats.orphans.slice(0, 20)) {
          lines.push(`  ${f}`);
        }
        if (stats.orphans.length > 20) {
          lines.push(`  ... and ${stats.orphans.length - 20} more`);
        }
      }

      return lines.join("\n");
    }

    case "codebase_graph_circular": {
      const graph = await getOrBuildGraph(projectPath);
      const cycles = findCircularDependencies(graph);

      if (cycles.length === 0) {
        return "No circular dependencies found.";
      }

      const lines = [`Found ${cycles.length} circular dependency chain(s):\n`];
      for (let i = 0; i < Math.min(cycles.length, 20); i++) {
        lines.push(`Cycle ${i + 1}: ${cycles[i].join(" → ")}`);
      }
      if (cycles.length > 20) {
        lines.push(`\n... and ${cycles.length - 20} more cycles`);
      }

      return lines.join("\n");
    }

    case "codebase_graph_visualize": {
      const graph = await getOrBuildGraph(projectPath);

      if (graph.nodes.length === 0) {
        return "No graph data available. Run codebase_graph_build first.";
      }

      const rawMode = String(args.mode ?? "mermaid").toLowerCase();
      if (rawMode !== "mermaid" && rawMode !== "interactive") {
        return `Invalid mode "${rawMode}". Must be "mermaid" (default — returns Mermaid text) or "interactive" (generates a self-contained HTML page and opens it in the browser).`;
      }

      if (rawMode === "interactive") {
        const projectId = projectIdFromPath(projectPath);
        const projectName = path.basename(projectPath);
        const { html, stats } = await buildInteractiveGraphHtml({ projectPath, projectName, projectId, graph });
        const file = await writeInteractiveGraphFile(projectId, html);
        const noOpenRequested = args.open === false || args.open === "false";
        const openResult = noOpenRequested ? { opened: false as const } : await openInBrowser(file);

        const lines = [
          `Interactive dependency graph for: ${projectPath}`,
          `File written: ${file}`,
          `Stats: ${stats.files} files · ${stats.fileEdges} edges · symbol view: ${stats.symbolMode}${stats.symbolMode === "full" ? ` (${stats.symbols} symbols / ${stats.symbolEdges} calls)` : ""}`,
        ];
        if (noOpenRequested) {
          lines.push("", "Browser auto-open skipped (open=false). Open the file above manually.");
        } else if (openResult.opened) {
          lines.push("", "Opened in your default browser. If nothing appears, open the file path above manually.");
        } else {
          lines.push("", `Could not auto-open a browser (${openResult.error}). Open the file path above manually.`);
        }
        lines.push(
          "",
          "Interactions:",
          "  • Click a node → sidebar with file/symbol details, symbols list, and action buttons.",
          "  • Right-click a node → highlight its blast radius (reverse-transitive closure).",
          "  • Toggle Files ↔ Symbols at the top (Symbols disabled on gigantic repos — use codebase_impact for those).",
          "  • Search box filters nodes live; layout dropdown switches between Dagre / force / concentric / grid.",
          "  • Export PNG button produces a shareable image of the current view.",
        );
        return lines.join("\n");
      }

      const mermaid = generateMermaidDiagram(graph);
      return [
        `Dependency graph for: ${projectPath}`,
        `(${graph.nodes.length} files, ${graph.edges.length} edges)`,
        "",
        "```mermaid",
        mermaid,
        "```",
      ].join("\n");
    }

    case "codebase_graph_remove": {
      // Wait for any in-flight graph build to finish before removing
      if (isGraphBuildInProgress(projectPath)) {
        logger.info("Waiting for in-flight graph build to finish before removing graph", { projectPath });
        await awaitGraphBuild(projectPath);
      }
      await removeGraph(projectPath);
      return `Removed code graph for: ${projectPath}`;
    }

    case "codebase_graph_status": {
      const resolved = path.resolve(projectPath);

      // Trigger grammar registration so the diagnostic block below reflects
      // the real loader state. Idempotent and cheap after the first call.
      ensureDynamicLanguages();
      const grammarStatus = getDynamicLanguageStatus();
      const renderGrammarBlock = (): string[] => {
        if (grammarStatus.loaded.length === 0 && grammarStatus.failed.length === 0) {
          return [];
        }
        const block: string[] = ["", "AST grammars:"];
        if (grammarStatus.loaded.length > 0) {
          block.push(`  Loaded (${grammarStatus.loaded.length}): ${grammarStatus.loaded.join(", ")}`);
        }
        if (grammarStatus.failed.length > 0) {
          block.push(`  Failed (${grammarStatus.failed.length}):`);
          for (const f of grammarStatus.failed) {
            block.push(`    - ${f.name}: ${f.error}`);
          }
          block.push(
            "  Symbols and imports for failed languages will be empty until the underlying load error is resolved.",
          );
        }
        return block;
      };

      // Show in-flight build progress if building
      if (isGraphBuildInProgress(resolved)) {
        const progress = getGraphBuildProgress(resolved);
        if (!progress) return "No progress data available.";
        const elapsed = ((Date.now() - progress.startedAt) / 1000).toFixed(0);
        const pct = progress.filesTotal > 0
          ? Math.round((progress.filesProcessed / progress.filesTotal) * 100)
          : 0;

        const buildingLines = [
          `Code Graph Status for: ${resolved}`,
          "",
          `Status: BUILDING`,
          `Phase: ${progress.phase}`,
          `Progress: ${progress.filesProcessed}/${progress.filesTotal} files (${pct}%)${progress.filesSkipped ? ` — ${progress.filesSkipped} skipped` : ""}`,
          `Elapsed: ${elapsed}s`,
          ...renderGrammarBlock(),
          "",
          "The graph is being built in the background.",
          "Call codebase_graph_status again to check progress.",
        ];
        return buildingLines.join("\n");
      }

      // Show last completed build info if available
      const lastBuild = getLastGraphBuildCompleted(resolved);

      const graphInfo = await getGraphStatus(resolved);
      if (!graphInfo) {
        const lines = [`No code graph found for: ${resolved}`];
        if (lastBuild?.error) {
          lines.push(`Last build failed: ${lastBuild.error}`);
        }
        lines.push("Run codebase_graph_build or codebase_index to create one.");
        lines.push(...renderGrammarBlock());
        return lines.join("\n");
      }

      // READY is emitted on graph existence alone, so a graph that resolved
      // almost none of the imports it captured looks exactly like a healthy
      // one, and consumers that gate on status send users to tools that answer
      // empty — which reads as "nothing depends on this" rather than "the
      // resolver failed" (issue #107). Stated directly beneath the edge count
      // it qualifies, so the number is never read on its own. Deliberately not
      // a DEGRADED status: a hard state would false-positive on legitimately
      // orphan-heavy projects.
      const renderImportResolutionBlock = (): string[] => {
        // Captured before the predicate rather than asserted after it: the
        // predicate already rejects an absent count, but TypeScript cannot
        // narrow through the call, and an assertion here would keep compiling
        // while printing "undefined" if the predicate ever started accepting
        // one.
        const captured = graphInfo.importCount;
        if (captured === undefined) return [];
        if (!isImportResolutionLow(graphInfo.edgeCount, captured)) return [];
        const pct = ((graphInfo.edgeCount / captured) * 100).toFixed(1);
        return [
          `Import resolution: ${graphInfo.edgeCount} of ${captured} captured imports resolved to project files (${pct}%)`,
          "  Most imports did not resolve, so codebase_graph_query, codebase_graph_stats and codebase_impact will under-report dependencies — an empty answer there means unresolved, not independent.",
          "  Expected when a project's imports are mostly external (stdlib, third-party); otherwise the resolver may not support this project's layout.",
        ];
      };

      const ago = ((Date.now() - new Date(graphInfo.lastBuiltAt).getTime()) / 1000).toFixed(0);
      const lines = [
        `Code Graph Status for: ${resolved}`,
        "",
        `Status: READY`,
        `Files (nodes): ${graphInfo.nodeCount}`,
        `Dependencies (edges): ${graphInfo.edgeCount}`,
        ...renderImportResolutionBlock(),
        `Last built: ${graphInfo.lastBuiltAt} (${ago}s ago)`,
        `In-memory cache: ${graphInfo.cached ? "yes" : "no (will load from storage on next query)"}`,
      ];

      if (lastBuild) {
        lines.push(`Last build duration: ${(lastBuild.durationMs / 1000).toFixed(1)}s`);
        if (lastBuild.filesSkipped) {
          lines.push(`Files skipped: ${lastBuild.filesSkipped}`);
        }
        if (lastBuild.symbolGraphError) {
          // The file-import graph above is real; the symbol half is not. Say so
          // here rather than letting codebase_impact answer "0 callers" as if
          // that were a finding.
          lines.push(
            `Symbol graph FAILED to persist: ${lastBuild.symbolGraphError}`,
            "  Symbol-level tools (codebase_impact, codebase_flow, codebase_symbol) will be incomplete or empty until a rebuild succeeds.",
          );
        }
      }

      if (graphInfo.symbol) {
        const sm = graphInfo.symbol;
        lines.push("");
        lines.push("Symbol graph (Impact Analysis):");
        lines.push(`  Files: ${sm.fileCount}`);
        lines.push(`  Symbols: ${sm.symbolCount}`);
        lines.push(`  Call edges: ${sm.edgeCount}`);
        lines.push(`  Unresolved: ${sm.unresolvedEdgePct.toFixed(1)}%`);
      }

      lines.push(...renderGrammarBlock());

      return lines.join("\n");
    }

    case "codebase_impact": {
      const target = (args.target as string)?.trim();
      if (!target) return "Missing required argument: target";
      const depth = typeof args.depth === "number" ? args.depth : 3;
      const projectId = projectIdFromPath(projectPath);
      const cache = await getSymbolGraphCache(projectId);
      if (!cache) {
        return "No symbol graph found. Run codebase_graph_build (or codebase_index) first.";
      }
      const result = await getImpactRadius(cache, target, depth);
      const lines = [
        `Blast radius for ${result.targetKind}: ${result.target}`,
        `Depth: ${result.depth}    Total impacted files: ${result.totalFiles}`,
        "",
      ];
      if (result.totalFiles === 0) {
        lines.push("No callers found — nothing else depends on this.");
      } else {
        for (const [hop, files] of result.filesByDepth.entries()) {
          lines.push(`Hop ${hop} (${files.length} files):`);
          for (const f of files) lines.push(`  - ${f}`);
          lines.push("");
        }
      }
      return lines.join("\n").trimEnd();
    }

    case "codebase_flow": {
      const projectId = projectIdFromPath(projectPath);
      const cache = await getSymbolGraphCache(projectId);
      if (!cache) {
        return "No symbol graph found. Run codebase_graph_build (or codebase_index) first.";
      }
      const entrypoint = (args.entrypoint as string | undefined)?.trim();

      // Zero-arg mode → ranked entry-point list
      if (!entrypoint) {
        // Build a fresh detection using the file graph + per-file payloads from the cache.
        // For efficiency we only list entry points by walking known symbols via the name index.
        const fileGraph = await getOrBuildGraph(projectPath);
        const nameIndex = await cache.getNameIndex();
        const seenFiles = new Set<string>();
        const payloads = [];
        for (const refs of nameIndex.values()) {
          for (const ref of refs) {
            if (seenFiles.has(ref.file)) continue;
            seenFiles.add(ref.file);
            const p = await cache.getFilePayload(ref.file);
            if (p) payloads.push(p);
          }
        }
        const entries = detectEntryPoints(fileGraph, payloads);
        if (entries.length === 0) {
          return "No entry points detected. The codebase may not have orphan files, conventional main() functions, or framework routes.";
        }
        const lines = [`Detected ${entries.length} entry point(s):`, ""];
        for (const e of entries.slice(0, 50)) {
          lines.push(`  ${e.name} (${e.file}${e.line ? `:${e.line}` : ""}) — ${e.reason}`);
        }
        if (entries.length > 50) lines.push(`  ... and ${entries.length - 50} more`);
        lines.push("", "Pass `entrypoint` to trace forward call flow from any of these.");
        return lines.join("\n");
      }

      // Resolve symbol name → id via name index (file hint disambiguates)
      const nameIndex = await cache.getNameIndex();
      let refs = nameIndex.get(entrypoint) ?? [];
      const fileHint = (args.file as string | undefined)?.trim();
      if (fileHint) refs = refs.filter((r) => r.file === fileHint);
      if (refs.length === 0) {
        return `No symbol named "${entrypoint}" found${fileHint ? ` in ${fileHint}` : ""}.`;
      }
      if (refs.length > 1) {
        const lines = [`Symbol "${entrypoint}" is ambiguous (${refs.length} matches). Pass \`file\` to disambiguate:`, ""];
        for (const r of refs) lines.push(`  - ${r.file}`);
        return lines.join("\n");
      }
      const depth = typeof args.depth === "number" ? args.depth : 5;
      const tree = await getCallFlow(cache, refs[0].id, depth);
      if (!tree) return `Could not load symbol "${entrypoint}".`;

      const lines = [`Call flow from ${tree.symbolName} (${tree.file}:${tree.line})`, ""];
      renderFlowTree(tree, "", true, lines);
      return lines.join("\n");
    }

    case "codebase_symbol": {
      const symName = (args.name as string)?.trim();
      if (!symName) return "Missing required argument: name";
      const fileHint = (args.file as string | undefined)?.trim();
      const projectId = projectIdFromPath(projectPath);
      const cache = await getSymbolGraphCache(projectId);
      if (!cache) {
        return "No symbol graph found. Run codebase_graph_build (or codebase_index) first.";
      }
      const ctxs = await getSymbolContext(cache, symName, fileHint);
      if (ctxs.length === 0) {
        return `No symbol named "${symName}" found${fileHint ? ` in ${fileHint}` : ""}.`;
      }
      const lines: string[] = [];
      for (const ctx of ctxs) {
        lines.push(`Symbol: ${ctx.symbol.qualifiedName} (${ctx.symbol.kind})`);
        lines.push(`Defined: ${ctx.symbol.file}:${ctx.symbol.line}–${ctx.symbol.endLine}  [${ctx.symbol.language}]`);
        lines.push("");
        lines.push(`Callers (${ctx.callers.length}):`);
        if (ctx.callers.length === 0) lines.push("  (none — possibly an entry point or unused)");
        else for (const c of ctx.callers.slice(0, 30)) lines.push(`  ← ${c.file}:${c.line}`);
        if (ctx.callers.length > 30) lines.push(`  ... and ${ctx.callers.length - 30} more`);
        lines.push("");
        lines.push(`Callees (${ctx.callees.length}):`);
        if (ctx.callees.length === 0) lines.push("  (none)");
        else for (const c of ctx.callees.slice(0, 30)) {
          lines.push(`  → ${c.name} [${c.confidence}${c.resolved.length > 0 ? `, ${c.resolved.length} candidate(s)` : ""}]`);
        }
        if (ctx.callees.length > 30) lines.push(`  ... and ${ctx.callees.length - 30} more`);
        lines.push("---");
      }
      return lines.join("\n").replace(/---\n?$/, "").trimEnd();
    }

    case "codebase_symbols": {
      const file = (args.file as string | undefined)?.trim();
      const query = (args.query as string | undefined)?.trim();
      const limit = typeof args.limit === "number" ? args.limit : 200;
      const projectId = projectIdFromPath(projectPath);
      const cache = await getSymbolGraphCache(projectId);
      if (!cache) {
        return "No symbol graph found. Run codebase_graph_build (or codebase_index) first.";
      }
      const symbols = await listSymbols(cache, { file, query, limit });
      if (symbols.length === 0) {
        return file
          ? `No symbols found in ${file}.`
          : query
            ? `No symbols matching "${query}".`
            : "No symbols found.";
      }
      const lines = [
        file ? `Symbols in ${file} (${symbols.length}):` : `Symbols matching "${query ?? "*"}" (${symbols.length}):`,
        "",
      ];
      for (const s of symbols) {
        lines.push(`  ${s.kind.padEnd(11)} ${s.qualifiedName.padEnd(40)} ${s.file}:${s.line}`);
      }
      return lines.join("\n");
    }

    default:
      return `Unknown tool: ${name}`;
  }
}

/** Render a FlowNode subtree using ASCII tree characters. */
function renderFlowTree(
  node: FlowNode,
  prefix: string,
  isLast: boolean,
  out: string[],
): void {
  const branch = isLast ? "└── " : "├── ";
  const suffix = node.truncatedReason
    ? ` [truncated: ${node.truncatedReason}]`
    : "";
  out.push(`${prefix}${branch}${node.symbolName} (${node.file}:${node.line})${suffix}`);
  const childPrefix = prefix + (isLast ? "    " : "│   ");
  for (let i = 0; i < node.children.length; i++) {
    renderFlowTree(node.children[i], childPrefix, i === node.children.length - 1, out);
  }
}

// Mark deprecated import as used to satisfy lint when no other reference exists
void looksLikeFilePath;
