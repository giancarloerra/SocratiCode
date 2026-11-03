#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v3";
import { EXTENSION_LANGUAGE_MAP_INVALID, getWatcherMode, SOCRATICODE_VERSION } from "./constants.js";
import { startAutomaticCleanup } from "./services/auto-cleanup.js";
import { logger, setMcpLogSender } from "./services/logger.js";
import { autoResumeIndexedProjects, gracefulShutdown } from "./services/startup.js";
import { handleContextTool } from "./tools/context-tools.js";
import { handleGraphTool } from "./tools/graph-tools.js";
import { handleIndexTool } from "./tools/index-tools.js";
import { handleManageTool } from "./tools/manage-tools.js";
import { handleQueryTool } from "./tools/query-tools.js";

// Validate lifecycle configuration before the server accepts any tools. An
// invalid manual-mode value must never fall back to automatic index writes.
getWatcherMode();

const server = new McpServer(
  {
    name: "socraticode",
    version: SOCRATICODE_VERSION,
  },
  {
    capabilities: {
      tools: {},
      // Required for the log forwarding below: the SDK sends notifications/message
      // (and accepts logging/setLevel) only when the server declares it.
      logging: {},
    },
  },
);

// Forward every logger call as an MCP notifications/message so hosts like Cline
// display log lines in their UI (Cline's stderr path drops the content in non-DEV mode).
setMcpLogSender((params) => {
  server.server.sendLoggingMessage(params).catch(() => {
    // Ignore — transport may not be connected yet during startup.
  });
});

// ── Index tools ──────────────────────────────────────────────────────────

server.tool(
  "codebase_index",
  "Start indexing a codebase in the background. Returns immediately. Call codebase_status to poll progress until 100%. Do NOT search until indexing is complete. If already indexing, returns current progress.",
  {
    projectPath: z
      .string()
      .describe("Absolute path to the project directory. If omitted, uses the current working directory.")
      .optional(),
    extraExtensions: z
      .string()
      .describe("Comma-separated list of additional file extensions to index beyond the built-in set (e.g. '.tpl,.blade,.hbs'). Useful for projects with non-standard file extensions. Can also be set globally via EXTRA_EXTENSIONS env var.")
      .optional(),
  },
  async (args) => ({
    content: [{ type: "text", text: await handleIndexTool("codebase_index", args) }],
  }),
);

server.tool(
  "codebase_update",
  "Incrementally update an existing codebase index. Only re-indexes changed files. Runs synchronously. Use it to refresh a manual/off snapshot, working-tree edits before the next Git transition in git mode, or whenever an immediate catch-up is needed.",
  {
    projectPath: z
      .string()
      .describe("Absolute path to the project directory.")
      .optional(),
    extraExtensions: z
      .string()
      .describe("Comma-separated list of additional file extensions to index (e.g. '.tpl,.blade').")
      .optional(),
  },
  async (args) => ({
    content: [{ type: "text", text: await handleIndexTool("codebase_update", args) }],
  }),
);

server.tool(
  "codebase_remove",
  "Remove a project's codebase index entirely from the vector database. Safely stops the file watcher, cancels any in-progress indexing/update (with drain), and waits for any in-flight graph build before deleting.",
  {
    projectPath: z.string().describe("Absolute path to the project directory."),
  },
  async (args) => ({
    content: [{ type: "text", text: await handleIndexTool("codebase_remove", args) }],
  }),
);

server.tool(
  "codebase_prune",
  "Inventory stored project identities and their resources. Report-only by default. Applying requires an exact identity, the confirmation token from a fresh inventory, and an acknowledgement that no other host is writing to it; path absence on this host is advisory, not proof of abandonment.",
  {
    apply: z.boolean().optional().describe("Delete the selected identity only when true. Omit for the report-only inventory."),
    identity: z.string().optional().describe("Exact identity returned by codebase_prune."),
    confirmationToken: z.string().optional().describe("Opaque token returned for that identity by codebase_prune."),
    acknowledgeNoRemoteWriters: z.boolean().optional().describe("Required with apply. Locks on this host cannot see another host sharing the same Qdrant; true states that none is writing to this identity."),
  },
  async (args) => ({
    content: [{ type: "text", text: await handleIndexTool("codebase_prune", args) }],
  }),
);

server.tool(
  "codebase_stop",
  "Gracefully stop an in-progress indexing operation. The current batch will finish and checkpoint, preserving all progress. Re-run codebase_index to resume from where it left off.",
  {
    projectPath: z
      .string()
      .describe("Absolute path to the project directory. If omitted, uses the current working directory.")
      .optional(),
  },
  async (args) => ({
    content: [{ type: "text", text: await handleIndexTool("codebase_stop", args) }],
  }),
);

server.tool(
  "codebase_watch",
  "Start/stop watching a project directory for file changes and automatically update the index. When starting, first runs an incremental update to catch up, then watches for changes. SOCRATICODE_WATCHER=manual allows explicit starts only; off and git reject file-watcher starts. In git mode, status reports Git refresh state and stop does not disable Git checks.",
  {
    projectPath: z
      .string()
      .describe("Absolute path to the project directory.")
      .optional(),
    action: z.enum(["start", "stop", "status"]).describe("start/stop watching, or get status of watchers."),
  },
  async (args) => ({
    content: [{ type: "text", text: await handleIndexTool("codebase_watch", args) }],
  }),
);

// ── Query tools ──────────────────────────────────────────────────────────

server.tool(
  "codebase_search",
  "Semantic search across an indexed codebase. Only use after codebase_index is complete (check codebase_status first). Returns relevant code chunks matching a natural language query.",
  {
    query: z.string().describe("Natural language search query (e.g. 'authentication middleware', 'database connection setup')."),
    projectPath: z
      .string()
      .describe("Absolute path to the project directory.")
      .optional(),
    limit: z
      .number()
      .min(1)
      .max(50)
      .describe("Maximum number of results to return. Default: 10 (override globally via SEARCH_DEFAULT_LIMIT env var).")
      .optional(),
    fileFilter: z
      .string()
      .describe("Filter results to one file, given exactly as a result header shows its path (e.g. 'src/index.ts'). Directories, globs, lists and bare names of files below the root match nothing.")
      .optional(),
    languageFilter: z
      .string()
      .describe("Filter results to one language, given exactly as a result header shows its label in brackets (e.g. 'typescript', 'python', 'go'); aliases such as 'ts' or 'py' match nothing.")
      .optional(),
    minScore: z
      .number()
      .min(0)
      .max(1)
      .describe("Minimum RRF score threshold (0-1). Results below this are filtered out. Default: 0.10 (override globally via SEARCH_MIN_SCORE env var). Set to 0 to disable filtering.")
      .optional(),
    includeLinked: z
      .boolean()
      .describe("When true, also search across linked projects defined in .socraticode.json or SOCRATICODE_LINKED_PROJECTS env var. Results include a project label showing which project each result came from. Default: false.")
      .optional(),
  },
  async (args) => ({
    content: [{ type: "text", text: await handleQueryTool("codebase_search", args) }],
  }),
);

server.tool(
  "codebase_status",
  "Check index status: chunk count, indexing progress (%), last completed operation, file watcher state. Call after codebase_index to poll until 100% complete.",
  {
    projectPath: z
      .string()
      .describe("Absolute path to the project directory.")
      .optional(),
  },
  async (args) => ({
    content: [{ type: "text", text: await handleQueryTool("codebase_status", args) }],
  }),
);

// ── Graph tools ──────────────────────────────────────────────────────────

server.tool(
  "codebase_graph_build",
  "Build a dependency graph of the codebase using static analysis (ast-grep). Maps import/require/export relationships between files. Runs in the background — call codebase_graph_status to poll progress until complete.",
  {
    projectPath: z
      .string()
      .describe("Absolute path to the project directory.")
      .optional(),
    extraExtensions: z
      .string()
      .describe("Comma-separated list of additional file extensions to include in the graph (e.g. '.tpl,.blade'). Files with non-standard extensions are included as leaf nodes (dependency targets). Can also be set globally via EXTRA_EXTENSIONS env var.")
      .optional(),
  },
  async (args) => ({
    content: [{ type: "text", text: await handleGraphTool("codebase_graph_build", args) }],
  }),
);

server.tool(
  "codebase_graph_query",
  "Query the code dependency graph for a specific file. Returns what the file imports and what files depend on it.",
  {
    projectPath: z
      .string()
      .describe("Absolute path to the project directory.")
      .optional(),
    filePath: z.string().describe("Relative path of the file to query (e.g. 'src/index.ts')."),
  },
  async (args) => ({
    content: [{ type: "text", text: await handleGraphTool("codebase_graph_query", args) }],
  }),
);

server.tool(
  "codebase_graph_stats",
  "Get statistics about the code dependency graph: total files, edges, most connected files, orphan files, circular dependencies.",
  {
    projectPath: z
      .string()
      .describe("Absolute path to the project directory.")
      .optional(),
  },
  async (args) => ({
    content: [{ type: "text", text: await handleGraphTool("codebase_graph_stats", args) }],
  }),
);

server.tool(
  "codebase_graph_circular",
  "Find circular dependencies in the codebase.",
  {
    projectPath: z
      .string()
      .describe("Absolute path to the project directory.")
      .optional(),
  },
  async (args) => ({
    content: [{ type: "text", text: await handleGraphTool("codebase_graph_circular", args) }],
  }),
);

server.tool(
  "codebase_graph_visualize",
  [
    "Visualise the code dependency graph. Two modes:",
    "  • mode=\"mermaid\" (default) — returns a Mermaid diagram (text) colour-coded by language, circular deps highlighted. Best for inline rendering inside chat, GitHub, or editors that render Mermaid.",
    "  • mode=\"interactive\" — writes a self-contained HTML page (vendored Cytoscape.js + Dagre, works offline) and opens it in the user's default browser. Shows the file graph and, when a symbol graph is available and fits, a Symbols toggle with the symbol-level call graph. Interactions: click node for sidebar with imports/dependents/symbols list; right-click node to highlight its blast radius (reverse-transitive closure); live search; layout switcher (Dagre / force / concentric / breadth-first / grid / circle); PNG export. Use this when the user asks for a visual/interactive view, wants to explore visually, or needs a shareable diagram.",
  ].join("\n"),
  {
    projectPath: z
      .string()
      .describe("Absolute path to the project directory.")
      .optional(),
    mode: z
      .enum(["mermaid", "interactive"])
      .describe("\"mermaid\" (default — text diagram) or \"interactive\" (browser-based explorer).")
      .optional(),
    open: z
      .boolean()
      .describe("In interactive mode, whether to auto-open the browser. Default true. Set false to just get the file path (useful in headless environments).")
      .optional(),
  },
  async (args) => ({
    content: [{ type: "text", text: await handleGraphTool("codebase_graph_visualize", args) }],
  }),
);

server.tool(
  "codebase_graph_remove",
  "Remove a project's persisted code graph. Waits for any in-flight graph build to finish first. The graph can be rebuilt with codebase_graph_build or will be rebuilt automatically on the next codebase_index.",
  {
    projectPath: z.string().describe("Absolute path to the project directory."),
  },
  async (args) => ({
    content: [{ type: "text", text: await handleGraphTool("codebase_graph_remove", args) }],
  }),
);

server.tool(
  "codebase_graph_status",
  "Check the status of the code dependency graph: build progress (if building), node/edge count, when it was last built, whether it's cached in memory. Use this to poll progress after calling codebase_graph_build.",
  {
    projectPath: z
      .string()
      .describe("Absolute path to the project directory.")
      .optional(),
  },
  async (args) => ({
    content: [{ type: "text", text: await handleGraphTool("codebase_graph_status", args) }],
  }),
);

// ── Impact analysis (symbol-level call graph) ───────────────────────────

server.tool(
  "codebase_impact",
  "Impact Analysis — return the BLAST RADIUS for a file or symbol. Lists every file (and, where helpful, function) that could break if you change the target. Polymorphic on target: a path-like string ('src/foo.ts') triggers file-mode; a name-like string ('validateUser') triggers symbol-mode. Use this BEFORE refactoring, renaming, or deleting code to know what depends on it.",
  {
    projectPath: z.string().describe("Absolute path to the project directory.").optional(),
    target: z.string().describe("Target file path (relative) OR symbol name.").optional(),
    file: z.string().describe("Optional file path to disambiguate the target symbol.").optional(),
    symbolId: z.string().describe("Exact symbol ID (e.g. 'src/foo.ts::validateUser#10') to disambiguate.").optional(),
    depth: z.number().describe("How many hops back to walk (default 3, max 10).").optional(),
    limit: z.number().int().min(1).describe("Maximum candidates to list when the target symbol is ambiguous. Omit to list all.").optional(),
  },
  async (args) => ({
    content: [{ type: "text", text: await handleGraphTool("codebase_impact", args) }],
  }),
);

server.tool(
  "codebase_flow",
  "Trace the EXECUTION FLOW forward from an entry point — what does this code call into? With NO args, returns a ranked list of auto-detected entry points (orphans with outgoing calls, conventional names like main(), framework routes, tests). With an entrypoint argument, returns the call tree.",
  {
    projectPath: z.string().describe("Absolute path to the project directory.").optional(),
    entrypoint: z.string().describe("Symbol name to trace from. Omit to list auto-detected entry points.").optional(),
    file: z.string().describe("Optional file hint to disambiguate the symbol.").optional(),
    depth: z.number().describe("Maximum DFS depth (default 5, max 10).").optional(),
    limit: z.number().int().min(1).describe("Maximum candidates to list when the entrypoint is ambiguous. Omit to list all.").optional(),
  },
  async (args) => ({
    content: [{ type: "text", text: await handleGraphTool("codebase_flow", args) }],
  }),
);

server.tool(
  "codebase_symbol",
  "360° view of a symbol: definition, kind, callers, callees, confidence levels. Use to understand a function or class before changing it.",
  {
    projectPath: z.string().describe("Absolute path to the project directory.").optional(),
    name: z.string().describe("Symbol name (e.g. 'validateUser')."),
    file: z.string().describe("Optional file hint to disambiguate when the name is not unique.").optional(),
    limit: z.number().int().min(1).describe("Maximum definitions to resolve when the name is not unique. Omit to resolve all.").optional(),
  },
  async (args) => ({
    content: [{ type: "text", text: await handleGraphTool("codebase_symbol", args) }],
  }),
);

server.tool(
  "codebase_symbols",
  "List symbols in a file, or search by name across the project. Use to discover what exists before drilling into a single symbol with codebase_symbol.",
  {
    projectPath: z.string().describe("Absolute path to the project directory.").optional(),
    file: z.string().describe("Relative file path — list all symbols in this file.").optional(),
    query: z.string().describe("Substring to match against symbol names project-wide.").optional(),
    limit: z.number().describe("Maximum results (default 200).").optional(),
  },
  async (args) => ({
    content: [{ type: "text", text: await handleGraphTool("codebase_symbols", args) }],
  }),
);

// ── Context artifact tools ───────────────────────────────────────────────

server.tool(
  "codebase_context",
  "List all context artifacts defined in .socraticodecontextartifacts.json — database schemas, API specs, infra configs, architecture docs, etc. Shows each artifact's name, description, path, and index status. Use this to discover what project knowledge is available beyond source code.",
  {
    projectPath: z
      .string()
      .describe("Absolute path to the project directory. If omitted, uses the current working directory.")
      .optional(),
  },
  async (args) => ({
    content: [{ type: "text", text: await handleContextTool("codebase_context", args) }],
  }),
);

server.tool(
  "codebase_context_search",
  "Semantic search across context artifacts (database schemas, API specs, infra configs, etc.) defined in .socraticodecontextartifacts.json. Auto-indexes on first use and auto-detects stale artifacts. Use this to find relevant infrastructure or domain knowledge.",
  {
    query: z.string().describe("Natural language search query (e.g. 'tables related to billing', 'authentication endpoints', 'deployment resource limits')."),
    projectPath: z
      .string()
      .describe("Absolute path to the project directory.")
      .optional(),
    artifactName: z
      .string()
      .describe("Filter search to a specific artifact by name (e.g. 'database-schema'). Omit to search across all artifacts.")
      .optional(),
    limit: z
      .number()
      .min(1)
      .max(50)
      .describe("Maximum number of results to return. Default: 10.")
      .optional(),
    minScore: z
      .number()
      .min(0)
      .max(1)
      .describe("Minimum RRF score threshold (0-1). Results below this are filtered out. Default: 0.10 (override globally via SEARCH_MIN_SCORE env var). Set to 0 to disable filtering.")
      .optional(),
  },
  async (args) => ({
    content: [{ type: "text", text: await handleContextTool("codebase_context_search", args) }],
  }),
);

server.tool(
  "codebase_context_index",
  "Index or re-index all context artifacts defined in .socraticodecontextartifacts.json. Chunks and embeds artifact content into the vector database for semantic search. Usually not needed — codebase_context_search auto-indexes on first use.",
  {
    projectPath: z
      .string()
      .describe("Absolute path to the project directory.")
      .optional(),
  },
  async (args) => ({
    content: [{ type: "text", text: await handleContextTool("codebase_context_index", args) }],
  }),
);

server.tool(
  "codebase_context_remove",
  "Remove all indexed context artifacts for a project from the vector database. Blocked while indexing is in progress — use codebase_stop or wait for the operation to finish first.",
  {
    projectPath: z.string().describe("Absolute path to the project directory."),
  },
  async (args) => ({
    content: [{ type: "text", text: await handleContextTool("codebase_context_remove", args) }],
  }),
);

// ── Management tools ─────────────────────────────────────────────────────

server.tool(
  "codebase_health",
  "Check the health of all infrastructure: Docker, Qdrant container, Ollama, and embedding model. Use this to diagnose setup issues.",
  {},
  async (args) => ({
    content: [{ type: "text", text: await handleManageTool("codebase_health", args) }],
  }),
);

server.tool(
  "codebase_list_projects",
  "List all projects that have been indexed (have collections in Qdrant).",
  {},
  async (args) => ({
    content: [{ type: "text", text: await handleManageTool("codebase_list_projects", args) }],
  }),
);

server.tool(
  "codebase_about",
  "Display information about SocratiCode — what it is, its tools and how to use it. Use this to get a quick overview of the MCP tools and their purpose.",
  {},
  async (args) => ({
    content: [{ type: "text", text: await handleManageTool("codebase_about", args) }],
  }),
);

// ── Start server ─────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Surface any EXTENSION_LANGUAGE_MAP entries we had to drop (malformed, or a
  // target language with no AST grammar) rather than silently ignoring them.
  if (EXTENSION_LANGUAGE_MAP_INVALID.length > 0) {
    logger.warn(
      "EXTENSION_LANGUAGE_MAP: ignored invalid entries. Each must be `<ext>:<language>` " +
      "with a language SocratiCode has an AST grammar for (e.g. .inc:php).",
      { ignored: EXTENSION_LANGUAGE_MAP_INVALID },
    );
  }

  // Auto-resume watchers and incremental updates for already-indexed projects
  // Fire-and-forget — runs in background, non-blocking, non-fatal
  autoResumeIndexedProjects();
  startAutomaticCleanup();

  // ── Process-level error handlers ─────────────────────────────────────

  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled promise rejection", {
      error: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });

  process.on("uncaughtException", (err) => {
    logger.error("Uncaught exception", {
      error: err.message,
      stack: err.stack,
    });
    // Uncaught exceptions leave the process in an undefined state — exit
    process.exit(1);
  });

  // ── Graceful shutdown ────────────────────────────────────────────────

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return; // prevent double shutdown
    shuttingDown = true;
    await gracefulShutdown(signal, () => server.close());
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // ── Stdin pipe-break detection ─────────────────────────────────────────
  // When the MCP host (e.g. Cline/VS Code) closes its side of the stdio pipe,
  // Node.js may emit 'end', 'error', or 'close' on stdin depending on how
  // abruptly the pipe was severed. A clean close emits 'end'; an abrupt
  // break (e.g. heavy I/O during indexing) may skip 'end' and only emit
  // 'error' + 'close'. Listen for all three to catch every scenario.
  // The shuttingDown guard in shutdown() prevents double-shutdown.
  process.stdin.on("end", () => shutdown("stdin EOF"));
  process.stdin.on("error", () => shutdown("stdin error"));
  process.stdin.on("close", () => shutdown("stdin close"));
  // Log lines go to stdout as notifications/message. Once the host has closed
  // its end, that write fails with EPIPE; unhandled, the error would exit the
  // process in the middle of shutdown instead of letting it finish.
  process.stdout.on("error", () => shutdown("stdout error"));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
