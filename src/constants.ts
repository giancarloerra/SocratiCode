// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

import { createRequire } from "node:module";

// ── Package metadata ─────────────────────────────────────────────────────
const esmRequire = createRequire(import.meta.url);
const pkg = esmRequire("../package.json") as { version: string };
export const SOCRATICODE_VERSION: string = pkg.version;

// ── Embedding configuration ──────────────────────────────────────────────
// Embedding model and dimensions are now configured via environment variables.
// See src/services/embedding-config.ts for OLLAMA_MODE, OLLAMA_URL,
// EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, and OLLAMA_API_KEY.
// Defaults: nomic-embed-text with 768 dimensions via Docker Ollama on :11435.

// ── Qdrant configuration ────────────────────────────────────────────────

export const QDRANT_PORT = parseInt(process.env.QDRANT_PORT || "16333", 10);
export const QDRANT_GRPC_PORT = parseInt(process.env.QDRANT_GRPC_PORT || "16334", 10);
export const QDRANT_HOST = process.env.QDRANT_HOST || "localhost";
export const QDRANT_API_KEY = process.env.QDRANT_API_KEY || undefined;
/** Full URL for remote/cloud Qdrant instances (e.g. https://xyz.aws.cloud.qdrant.io:6333).
 *  When set, takes precedence over QDRANT_HOST + QDRANT_PORT. */
export const QDRANT_URL = process.env.QDRANT_URL || undefined;
/** `managed` = Docker-managed local Qdrant (default).
 *  `external` = user-provided remote or cloud Qdrant instance (no Docker management). */
export const QDRANT_MODE: "managed" | "external" =
  (process.env.QDRANT_MODE === "external" ? "external" : "managed");
export const QDRANT_CONTAINER_NAME = "socraticode-qdrant";
export const QDRANT_IMAGE = "qdrant/qdrant:v1.17.0";

/**
 * Optional prefix prepended to every Qdrant collection name SocratiCode
 * creates, queries or deletes. Useful when sharing one Qdrant instance with
 * other applications (Open-WebUI, custom RAG tools, etc.) or when running
 * multiple SocratiCode instances against one Qdrant for separation between
 * projects, environments, or per-user indexes.
 *
 * Default is the empty string, which keeps every collection name unchanged
 * from previous releases — fully backwards compatible.
 *
 * Validated at module load: Qdrant accepts only `[a-zA-Z0-9_-]` in
 * collection names, so the prefix must too. An invalid prefix throws
 * before any Qdrant call is made, with a message naming the offending
 * value so the misconfiguration is obvious.
 */
export const QDRANT_COLLECTION_PREFIX = (() => {
  const raw = process.env.QDRANT_COLLECTION_PREFIX || "";
  if (raw && !/^[a-zA-Z0-9_-]+$/.test(raw)) {
    throw new Error(
      `Invalid QDRANT_COLLECTION_PREFIX: "${raw}". Qdrant collection names ` +
      "accept only alphanumeric characters, underscore, and hyphen.",
    );
  }
  return raw;
})();

/**
 * Resolve the Qdrant REST port from a URL.
 * Returns the explicit port if present (e.g. `:8443`),
 * otherwise `443` for `https://` or `6333` for `http://`.
 */
export function resolveQdrantPort(url: string): number {
  const parsed = new URL(url);
  if (parsed.port) return parseInt(parsed.port, 10);
  return url.startsWith("https:") ? 443 : 6333;
}

// ── Ollama configuration ────────────────────────────────────────────────

export const OLLAMA_PORT = parseInt(process.env.OLLAMA_PORT || "11435", 10);
export const OLLAMA_HOST = process.env.OLLAMA_HOST || `http://localhost:${OLLAMA_PORT}`;
export const OLLAMA_CONTAINER_NAME = "socraticode-ollama";
export const OLLAMA_IMAGE = "ollama/ollama:latest";

// ── Search configuration ─────────────────────────────────────────────────

/** Default number of search results returned by codebase_search.
 *  Override via SEARCH_DEFAULT_LIMIT env var (1-50). */
export const SEARCH_DEFAULT_LIMIT = Math.max(1, Math.min(50,
  parseInt(process.env.SEARCH_DEFAULT_LIMIT || "10", 10) || 10,
));

/** Default minimum RRF score threshold.
 *  Results below this score are filtered out. 0 disables filtering.
 *  Override via SEARCH_MIN_SCORE env var (0-1). */
export const SEARCH_MIN_SCORE = Math.max(0, Math.min(1,
  parseFloat(process.env.SEARCH_MIN_SCORE || "0.10") || 0,
));

// ── Chunking configuration ──────────────────────────────────────────────

export const CHUNK_SIZE = 100; // lines per chunk
export const CHUNK_OVERLAP = 10; // overlap lines between chunks
export const INDEX_BATCH_SIZE = 50; // files per batch for batched/resumable indexing

/** Maximum file size in bytes. Files larger than this are skipped during indexing.
 *  Default: 5 MB. Override via MAX_FILE_SIZE_MB env var. */
export const MAX_FILE_BYTES = Math.round(
  parseFloat(process.env.MAX_FILE_SIZE_MB || "5") * 1_000_000,
);

/** Maximum file size in bytes for code graph AST parsing.
 *  Graph parsing loads the entire file into memory for AST analysis,
 *  so the limit is lower than the indexing limit. Default: 1 MB. */
export const MAX_GRAPH_FILE_BYTES = 1_000_000;

/**
 * Qdrant's default `service.max_request_size_mb` (32 MiB), in bytes. A request
 * body over this is rejected with HTTP 400 before it reaches the collection, so
 * it is a hard ceiling on any single upsert, not a tuning knob we control: the
 * server enforces it and self-hosted deployments may set it lower.
 */
export const QDRANT_MAX_REQUEST_BYTES = 33_554_432;

/**
 * Byte budget we pack a single upsert body up to. Deliberately below
 * {@link QDRANT_MAX_REQUEST_BYTES} so the JSON envelope around the points
 * (and any server-side accounting that differs slightly from ours) still fits
 * under the hard ceiling.
 */
export const QDRANT_UPSERT_BUDGET_BYTES = 25_165_824;

/**
 * Maximum average line length (in characters) before a file is treated as
 * minified/bundled and switched to character-based chunking. Minified files
 * have very long lines that would make line-based chunks exceed the embedding
 * model's context window.
 */
export const MAX_AVG_LINE_LENGTH = 500;

/**
 * Hard character limit per chunk payload — the universal safety net applied
 * to every chunk regardless of chunking strategy (AST, line-based, or
 * character-based).
 *
 * Must be kept below CHARS_PER_TOKEN_ESTIMATE × model_context_length so that
 * the provider-level pretruncation always fires as a second line of defence.
 * At CHARS_PER_TOKEN_ESTIMATE=1.0 and a 2048-token context this means chunks
 * must be < 2048 chars. We use 2000 to leave headroom for the
 * `prepareDocumentText` path prefix (~50 chars) prepended at embed time.
 */
export const MAX_CHUNK_CHARS = 2000;

// ── Symbol-level call graph (Impact Analysis) ────────────────────────────

/** Maximum BFS depth for `codebase_impact` (blast radius) queries. */
export const MAX_IMPACT_DEPTH = 10;

/** Maximum DFS depth for `codebase_flow` (call-flow tracing) queries. */
export const MAX_FLOW_DEPTH = 10;

/** Number of name-index shards (a–z + `_` for everything else). */
export const SYMBOL_NAME_SHARDS = 27;

/** Number of reverse-call file-index shards (single-byte SHA1 prefix). */
export const SYMBOL_REVERSE_SHARDS = 256;

/** LRU capacity (in files) for lazy-loaded per-file symbol payloads. */
export const SYMBOL_FILE_LRU_SIZE = 500;

/**
 * Conventional entry-point function names per language. Used by
 * `detectEntryPoints()` heuristic #2.
 */
export const ENTRY_POINT_NAMES: Record<string, Set<string>> = {
  javascript: new Set(["main"]),
  typescript: new Set(["main"]),
  python: new Set(["main"]),
  go: new Set(["main"]),
  rust: new Set(["main"]),
  java: new Set(["main"]),
  kotlin: new Set(["main"]),
  scala: new Set(["main"]),
  c: new Set(["main"]),
  cpp: new Set(["main"]),
  csharp: new Set(["Main"]),
  swift: new Set(["main"]),
  ruby: new Set(["main"]),
  php: new Set(["main"]),
  dart: new Set(["main"]),
};

// ── Path normalization ──────────────────────────────────────────────────

/**
 * Normalize path separators to forward slashes.
 * On POSIX this is a no-op; on Windows it replaces every `\` with `/`.
 * Used for graph node keys, fileSet entries, and query inputs so that
 * lookups succeed regardless of the host OS separator convention.
 */
export function toForwardSlash(p: string): string {
  return p.replace(/\\/g, "/");
}

// ── File type configuration ─────────────────────────────────────────────

/** Mixed templates parsed structurally; only captured expressions are parsed as Elixir. */
export const ELIXIR_TEMPLATE_EXTENSIONS = new Set([".heex", ".eex", ".leex"]);

export const SUPPORTED_EXTENSIONS = new Set([
  // JavaScript/TypeScript
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
  // Python
  ".py", ".pyw", ".pyi",
  // Java/Kotlin/Scala
  ".java", ".kt", ".kts", ".scala",
  // C/C++
  ".c", ".h", ".cpp", ".hpp", ".cc", ".hh", ".cxx",
  // C#
  ".cs",
  // Go
  ".go",
  // Rust
  ".rs",
  // Ruby
  ".rb",
  // PHP
  ".php",
  // Swift
  ".swift",
  // Shell
  ".sh", ".bash", ".zsh",
  // Web
  ".html", ".htm", ".css", ".scss", ".sass", ".less", ".styl", ".vue", ".svelte",
  // Config/Data
  ".json", ".yaml", ".yml", ".toml", ".xml", ".ini", ".cfg",
  // Docs
  ".md", ".mdx", ".rst", ".txt",
  // SQL
  ".sql",
  // Dart
  ".dart",
  // Elixir
  ".ex", ".exs", ...ELIXIR_TEMPLATE_EXTENSIONS,
  // Lua
  ".lua",
  // R
  ".r", ".R",
  // Dockerfile
  ".dockerfile",
]);

// ── Extra extensions (user-configurable) ─────────────────────────────────

/**
 * Parse a comma-separated list of file extensions into a Set.
 * Normalizes inputs: trims whitespace, ensures leading dot.
 * Example: ".tpl, .blade, hbs" → Set([".tpl", ".blade", ".hbs"])
 */
export function parseExtraExtensions(value?: string): Set<string> {
  if (!value?.trim()) return new Set();
  return new Set(
    value.split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0)
      .map((s) => (s.startsWith(".") ? s : `.${s}`)),
  );
}

/** Extra file extensions from EXTRA_EXTENSIONS env var (global default). */
export const EXTRA_EXTENSIONS = parseExtraExtensions(process.env.EXTRA_EXTENSIONS);

/**
 * Merge EXTRA_EXTENSIONS env var with an optional tool parameter value.
 * Returns the combined set of extra extensions.
 */
export function mergeExtraExtensions(toolParam?: string): Set<string> {
  if (!toolParam?.trim()) return EXTRA_EXTENSIONS;
  const toolExts = parseExtraExtensions(toolParam);
  if (EXTRA_EXTENSIONS.size === 0) return toolExts;
  return new Set([...EXTRA_EXTENSIONS, ...toolExts]);
}

/** Files that are always indexed regardless of extension */
export const SPECIAL_FILES = new Set([
  "Dockerfile",
  "Makefile",
  "Rakefile",
  "Gemfile",
  "Procfile",
  ".env.example",
  ".gitignore",
  ".dockerignore",
]);

/** Map file extension to human-readable language name */
/** Canonical file-extension → language-label map. */
const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
  ".ts": "typescript", ".tsx": "typescript",
  ".py": "python", ".pyw": "python", ".pyi": "python",
  ".java": "java", ".kt": "kotlin", ".kts": "kotlin", ".scala": "scala",
  ".c": "c", ".h": "c", ".cpp": "cpp", ".hpp": "cpp", ".cc": "cpp", ".hh": "cpp", ".cxx": "cpp",
  ".cs": "csharp",
  ".go": "go",
  ".rs": "rust",
  ".rb": "ruby",
  ".php": "php",
  ".swift": "swift",
  ".sh": "shell", ".bash": "shell", ".zsh": "shell",
  ".html": "html", ".htm": "html",
  ".css": "css", ".scss": "scss", ".sass": "sass", ".less": "less", ".styl": "stylus",
  ".vue": "vue", ".svelte": "svelte",
  ".json": "json", ".yaml": "yaml", ".yml": "yaml",
  ".toml": "toml", ".xml": "xml",
  ".md": "markdown", ".mdx": "markdown", ".rst": "rst",
  ".sql": "sql",
  ".dart": "dart",
  ".ex": "elixir", ".exs": "elixir",
  ".heex": "elixir", ".eex": "elixir", ".leex": "elixir",
  ".lua": "lua",
  ".r": "r", ".R": "r",
  ".dockerfile": "dockerfile",
};

/**
 * Language name → a canonical extension that already carries that language's
 * label and AST grammar in {@link EXTENSION_TO_LANGUAGE} / `getAstGrepLang`.
 * Used by EXTENSION_LANGUAGE_MAP so a custom extension inherits BOTH the label
 * and the grammar consistently, without us re-encoding the (deliberately
 * different) vocabularies of the two maps (`shell` vs `bash`, `Lang` enums for
 * JS/TS/HTML/CSS). Only languages with an AST grammar are listed — mapping to
 * anything else would give no benefit over EXTRA_EXTENSIONS.
 */
const LANGUAGE_TO_CANONICAL_EXT: Record<string, string> = {
  javascript: ".js", js: ".js",
  typescript: ".ts", ts: ".ts",
  tsx: ".tsx",
  python: ".py", py: ".py",
  java: ".java",
  kotlin: ".kt",
  scala: ".scala",
  c: ".c",
  cpp: ".cpp", "c++": ".cpp",
  csharp: ".cs", "c#": ".cs",
  go: ".go", golang: ".go",
  rust: ".rs",
  ruby: ".rb",
  php: ".php",
  swift: ".swift",
  dart: ".dart",
  elixir: ".ex",
  lua: ".lua",
  shell: ".sh", bash: ".sh", sh: ".sh",
  html: ".html",
  css: ".css", scss: ".scss", sass: ".sass", less: ".less", stylus: ".styl",
  vue: ".vue",
  svelte: ".svelte",
};

/**
 * Parse the `EXTENSION_LANGUAGE_MAP` env var (format `.inc:php,.module:php`).
 * Returns a map of input extension → canonical extension of the target
 * language, plus the list of entries that were rejected (malformed, or a
 * target language with no AST grammar) so the caller can warn loudly.
 * Extensions are normalized (lowercased, leading dot ensured); a repeated
 * extension takes its last value.
 */
export function parseExtensionLanguageMap(value?: string): {
  map: Map<string, string>;
  invalid: string[];
} {
  const map = new Map<string, string>();
  const invalid: string[] = [];
  if (!value?.trim()) return { map, invalid };

  for (const pair of value.split(",")) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(":");
    // Need a non-empty extension before ":" and a non-empty language after it.
    if (idx <= 0 || idx === trimmed.length - 1) {
      invalid.push(trimmed);
      continue;
    }
    const rawExt = trimmed.slice(0, idx).trim().toLowerCase();
    const lang = trimmed.slice(idx + 1).trim().toLowerCase();
    if (!rawExt || !lang) {
      invalid.push(trimmed);
      continue;
    }
    const ext = rawExt.startsWith(".") ? rawExt : `.${rawExt}`;
    const canonical = LANGUAGE_TO_CANONICAL_EXT[lang];
    if (!canonical) {
      invalid.push(trimmed);
      continue;
    }
    map.set(ext, canonical);
  }
  return { map, invalid };
}

const _extensionLanguageMap = parseExtensionLanguageMap(process.env.EXTENSION_LANGUAGE_MAP);

/**
 * Custom extension → canonical extension overrides from EXTENSION_LANGUAGE_MAP.
 * Consulted by `getLanguageFromExtension`, `getAstGrepLang`, and the indexable
 * checks so a mapped extension is treated as its target language end to end
 * (label, AST chunking, symbols, call graph, discovery).
 */
export const EXTENSION_LANGUAGE_MAP = _extensionLanguageMap.map;

/** Entries from EXTENSION_LANGUAGE_MAP that were rejected (warned at startup). */
export const EXTENSION_LANGUAGE_MAP_INVALID = _extensionLanguageMap.invalid;

/**
 * Map a file extension to a language label. An EXTENSION_LANGUAGE_MAP override
 * is resolved through the target language's canonical extension so the label
 * matches what a native file of that language would get.
 */
export function getLanguageFromExtension(
  ext: string,
  override: Map<string, string> = EXTENSION_LANGUAGE_MAP,
): string {
  // Normalize so a caller passing an uppercase ext still matches the
  // (lowercased) override keys; the only case-sensitive built-in key, `.R`,
  // collapses to `.r` with the same value, so this changes nothing else.
  const normalized = ext.toLowerCase();
  const target = override.get(normalized) ?? normalized;
  return EXTENSION_TO_LANGUAGE[target] || "plaintext";
}

// ── Extensionless file detection ──────────────────────────────────────────

/**
 * Bytes of file head inspected for extensionless language detection. Read by the
 * two functions that bound a detection window — `readFileHead` on disk and
 * `detectExtensionFromSource` in memory — so every site that decides an
 * extensionless file's language scores the same bytes and cannot disagree about it.
 */
export const DETECT_HEAD_BYTES = 8192;

/**
 * Whether content-based detection of extensionless files is enabled.
 * Default ON (strictly additive — only adds files, never removes). `INDEX_EXTENSIONLESS=false` or `=0`
 * restores the pre-detection behavior (extensionless files are never indexed
 * unless their exact name is in {@link SPECIAL_FILES}). Read lazily so a mixed
 * fleet reads one value per scan and tests can toggle it via `vi.stubEnv`.
 */
export function indexExtensionlessEnabled(): boolean {
  const v = (process.env.INDEX_EXTENSIONLESS ?? "").trim().toLowerCase();
  return v !== "false" && v !== "0";
}

/** Shebang interpreter basename → canonical extension (Stage 1). */
const INTERPRETER_TO_EXT: Record<string, string> = {
  sh: ".sh", bash: ".sh", zsh: ".sh", dash: ".sh", ksh: ".sh", ash: ".sh",
  python: ".py",
  node: ".js", nodejs: ".js",
  ruby: ".rb",
  php: ".php",
  lua: ".lua",
};

/** Interpreter-position wrappers whose real interpreter is a later token. */
const SHEBANG_WRAPPERS = new Set(["env", "with-contenv", "nice", "sudo", "doas", "time"]);

/**
 * Per-wrapper flags that consume the following token as their argument.
 * Wrapper-specific because the same flag differs by tool: `nice -n <prio>`
 * consumes an argument, but `sudo -n` (non-interactive) is boolean — a global
 * set would let `sudo -n python3` swallow the interpreter.
 */
const WRAPPER_ARG_FLAGS: Record<string, Set<string>> = {
  nice: new Set(["-n"]),
  sudo: new Set(["-u"]),
  doas: new Set(["-u"]),
  env: new Set(["-u"]),
};

/** Content-sniff pattern tables (Stage 2); most patterns are multiline-anchored
 *  (the trailing shell parameter-expansion pattern is a deliberate substring match). */
const PYTHON_PATTERNS: RegExp[] = [
  /^from\s+\.*(?:[A-Za-z_][\w.]*)?\s+import\s/m,
  /^import\s+[A-Za-z_][\w.]*(?:\s*,\s*[A-Za-z_][\w.]*)*\s*$/m,
  /^\s*def\s+\w+\s*\([^)]*\)\s*(?:->[^:]+)?:/m,
  /^\s*class\s+\w+(?:\([^)]*\))?\s*:/m,
];
const SHELL_PATTERNS: RegExp[] = [
  /^\s*set\s+-[euxo]/m,
  /^\s*if\s+\[\[?\s.*\]\]?\s*;\s*then\b/m,
  /^\s*(?:fi|esac|done)\s*$/m,
  /^\s*function\s+\w+/m,
  /^\s*\w+\s*\(\)\s*\{/m,
  /\$\{?\d|\$\{[A-Za-z_]/,
];

/** POSIX/Windows-safe basename for a shebang interpreter path. */
function shebangBasename(p: string): string {
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1];
}

/**
 * Map an interpreter basename to a canonical ext (with version normalization).
 * Any shebang with an unmapped interpreter still yields `.txt` (a declared
 * script indexed as searchable plaintext).
 */
function interpreterToExt(interpreter: string): string {
  const exact = INTERPRETER_TO_EXT[interpreter];
  if (exact) return exact;
  // Version normalization: strip a trailing [\d.]+ run plus any CPython
  // ABI-flag suffix — d (debug), m (pymalloc), u (wide-unicode) — so
  // python3.6 → python and python3.7dm → python. Never reduce to empty (a
  // stray numeric arg is not an interpreter).
  const stripped = interpreter.replace(/[\d.]+[dmu]*$/, "");
  if (stripped && stripped !== interpreter) {
    const mapped = INTERPRETER_TO_EXT[stripped];
    if (mapped) return mapped;
  }
  return ".txt";
}

/** Resolve a shebang line (the whole first line, incl. `#!`) to a canonical ext. */
function detectFromShebang(firstLine: string): string {
  const tokens = firstLine.slice(2).trim().split(/\s+/).filter((t) => t.length > 0);
  let candidate = tokens.length > 0 ? shebangBasename(tokens[0]) : "";
  let i = 1;

  while (SHEBANG_WRAPPERS.has(candidate)) {
    const argFlags = WRAPPER_ARG_FLAGS[candidate];
    let next = "";
    while (i < tokens.length) {
      const tok = tokens[i];
      if (tok.startsWith("-")) {
        i += argFlags?.has(tok) ? 2 : 1; // consume flag (+ its arg for this wrapper)
        continue;
      }
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tok)) {
        i += 1; // VAR=value environment assignment
        continue;
      }
      next = shebangBasename(tok);
      i += 1;
      break;
    }
    if (!next) return ".txt"; // ran out of tokens — declared script, no interpreter
    candidate = next;
  }
  return interpreterToExt(candidate);
}

/** Score a language's pattern table: count of distinct patterns that match. */
function countPatternHits(patterns: RegExp[], text: string): number {
  let n = 0;
  for (const re of patterns) if (re.test(text)) n++;
  return n;
}

/**
 * Detect a canonical file extension for an extensionless file from the first
 * ~8 KiB of its content. Returns `.sh`, `.py`, `.js`, `.rb`, `.php`, `.lua`,
 * `.txt`, or `null` (not indexable code). PURE — no I/O.
 *
 * A NUL byte (0x00) survives UTF-8/latin1 decoding as U+0000, so the Stage-0
 * binary guard on the decoded string is equivalent to a raw-byte check and
 * also rejects UTF-16 (its interleaved NUL bytes).
 */
export function detectExtensionlessExtension(contentHead: string): string | null {
  // Stage 0 — binary guard (rejects binaries and UTF-16).
  if (contentHead.includes("\u0000")) return null;

  // Stage 1 — shebang.
  if (contentHead.startsWith("#!")) {
    const firstLine = contentHead.split("\n", 1)[0];
    return detectFromShebang(firstLine);
  }

  // Stage 2 — content sniff. Score both languages, then decide by precedence:
  // Compute both counts before deciding, since the Python test compares
  // pyHits against shHits (so the decision is not per-language-independent).
  const pyHits = countPatternHits(PYTHON_PATTERNS, contentHead);
  const shHits = countPatternHits(SHELL_PATTERNS, contentHead);
  if (pyHits >= 1 && pyHits >= shHits) return ".py";
  if (shHits >= 2) return ".sh";
  return null;
}
