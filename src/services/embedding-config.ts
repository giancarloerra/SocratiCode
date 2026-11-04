// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited
/**
 * Embedding provider configuration — loaded from environment variables (MCP config).
 *
 * EMBEDDING_PROVIDER:
 *   - "ollama" (default): Use Ollama for embeddings (Docker or external).
 *   - "openai": Use OpenAI Embeddings API. Requires OPENAI_API_KEY.
 *   - "google": Use Google Generative AI Embedding API. Requires GOOGLE_API_KEY.
 *   - "lmstudio": Use a local LM Studio server (OpenAI-compatible). Requires
 *                 EMBEDDING_MODEL and EMBEDDING_DIMENSIONS to be set explicitly.
 *   - "litellm": Use a LiteLLM proxy server (OpenAI-compatible gateway in front of
 *                100+ underlying providers). Requires LITELLM_API_KEY,
 *                EMBEDDING_MODEL (must match an alias in the proxy's config.yaml),
 *                and EMBEDDING_DIMENSIONS (the alias's underlying dim).
 *
 * Ollama-specific:
 *   OLLAMA_MODE:
 *     - "auto" (default): Auto-detect. If Ollama is already running natively on port 11434,
 *       use it (external mode — fastest, GPU-accelerated on Mac/Windows). Otherwise fall back
 *       to a managed Docker container on port 11435. An explicit URL and API key
 *       select that external server without probing local Ollama.
 *     - "docker": Always use a managed Docker container on port 11435.
 *     - "external": User provides their own Ollama instance (native local, remote, etc.).
 *       SocratiCode will NOT create or manage Docker containers for Ollama.
 *       The user is responsible for having Ollama running at OLLAMA_URL.
 *   OLLAMA_URL:            Ollama API URL.
 *                          Default for docker mode: http://localhost:11435
 *                          Default for external mode: http://localhost:11434
 *   OLLAMA_API_KEY:        Optional API key for authenticated Ollama proxies.
 *   OLLAMA_MAX_CONNECTIONS: Max concurrent HTTP connections to Ollama.
 *                          Positive integer. Default: 4. Requests beyond the
 *                          cap queue client-side instead of opening sockets.
 *
 * Cloud provider-specific:
 *   OPENAI_API_KEY:        Required for openai provider.
 *   GOOGLE_API_KEY:        Required for google provider.
 *
 * LM Studio-specific:
 *   LMSTUDIO_URL:          OpenAI-compatible base URL for LM Studio's local server.
 *                          Default: http://localhost:1234/v1
 *   LMSTUDIO_API_KEY:      Optional API key. LM Studio's Local Server has no auth by default;
 *                          set this only if you've enabled an API key in LM Studio.
 *   LMSTUDIO_ALLOW_MISSING_MODEL_LISTING: Opt-in ("true" / "1" / "yes"). Accepts an
 *                          OpenAI-compatible server whose /v1/models endpoint is absent
 *                          (404/405) — e.g. HuggingFace Text Embeddings Inference — by
 *                          falling back to an /v1/embeddings probe. Default off.
 *                          Any other non-empty value is rejected with an error.
 *
 * LiteLLM-specific:
 *   LITELLM_URL:               OpenAI-compatible base URL of the LiteLLM proxy.
 *                              Default: http://localhost:4000/v1 (the /v1 suffix is required;
 *                              LiteLLM exposes /v1/embeddings under that prefix).
 *   LITELLM_API_KEY:           Required. Master key (general_settings.master_key) or a virtual
 *                              key issued via /key/generate. Unlike LM Studio, the proxy always
 *                              authenticates.
 *   LITELLM_SEND_DIMENSIONS:   Opt-in ("true" / "1" / "yes"). Forwards the OpenAI-style
 *                              `dimensions` parameter to the proxy for Matryoshka-aware
 *                              underlying models (text-embedding-3-*, voyage-3). Default off
 *                              because non-Matryoshka backends reject it.
 *
 * Shared:
 *   EMBEDDING_MODEL:       Model name (default depends on provider; required for lmstudio).
 *   EMBEDDING_DIMENSIONS:  Vector dimensions — must match the model (default depends on
 *                          provider; required for lmstudio).
 *   EMBEDDING_CONTEXT_LENGTH: Override context window in tokens (auto-detected for known models).
 *   EMBEDDING_QUERY_PREFIX:    Task prefix prepended to queries (default "search_query: ").
 *   EMBEDDING_DOCUMENT_PREFIX: Task prefix prepended to documents (default "search_document: ").
 *                              Both must match the model — see queryPrefix() below.
 *   EMBEDDING_DOCUMENT_INCLUDE_PATH: Whether the file path is embedded with the chunk
 *                              (default on). See documentIncludesPath() below.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { OLLAMA_PORT } from "../constants.js";
import { logger } from "./logger.js";

// ── Types ─────────────────────────────────────────────────────────────────

export type EmbeddingProvider = "ollama" | "openai" | "google" | "lmstudio" | "litellm";
export type OllamaMode = "docker" | "external" | "auto";

export interface EmbeddingConfig {
  /** Which embedding backend to use. */
  embeddingProvider: EmbeddingProvider;
  /** Ollama mode (only relevant when embeddingProvider is "ollama"). */
  ollamaMode: OllamaMode;
  /** Ollama API URL (only relevant when embeddingProvider is "ollama"). */
  ollamaUrl: string;
  /**
   * Per-origin cap on concurrent HTTP connections to Ollama. Node's default
   * fetch pool is unbounded, so concurrent embeds from several processes or
   * overlapping tool calls stack sockets without limit (issue 114); excess
   * requests queue on the bounded agent instead of opening new connections.
   */
  ollamaMaxConnections: number;
  /** LM Studio OpenAI-compatible base URL (only relevant when embeddingProvider is "lmstudio"). */
  lmstudioUrl: string;
  /** LiteLLM proxy OpenAI-compatible base URL (only relevant when embeddingProvider is "litellm"). */
  litellmUrl: string;
  /**
   * Accept an OpenAI-compatible server with no /v1/models endpoint (only relevant when
   * embeddingProvider is "lmstudio"). See LMSTUDIO_ALLOW_MISSING_MODEL_LISTING above.
   */
  allowMissingModelListing: boolean;
  embeddingModel: string;
  embeddingDimensions: number;
  /** Max context window in tokens. Used for client-side pre-truncation. */
  embeddingContextLength: number;
  /** Whether LiteLLM receives the output-dimension request parameter. */
  litellmSendDimensions: boolean;
  ollamaApiKey?: string;
}

// ── Provider defaults ─────────────────────────────────────────────────────

/**
 * lmstudio and litellm have empty defaults: there's no canonical model — users
 * pick one (the loaded LM Studio model, or a proxy alias from LiteLLM's
 * config.yaml). We fail-fast in loadEmbeddingConfig() when those providers are
 * selected without explicit EMBEDDING_MODEL / EMBEDDING_DIMENSIONS.
 */
const PROVIDER_DEFAULTS: Record<EmbeddingProvider, { model: string; dimensions: number }> = {
  ollama:   { model: "nomic-embed-text",        dimensions: 768  },
  openai:   { model: "text-embedding-3-small",  dimensions: 1536 },
  google:   { model: "gemini-embedding-001",    dimensions: 3072 },
  lmstudio: { model: "",                        dimensions: 0    },
  litellm:  { model: "",                        dimensions: 0    },
};

// ── Ollama mode defaults ──────────────────────────────────────────────────

/** Authenticated Docker requests use the port published by the managed container. */
export function defaultOllamaUrl(mode: OllamaMode, apiKey: string | undefined): string {
  if (mode === "docker") return `http://localhost:${apiKey ? OLLAMA_PORT : 11435}`;
  return "http://localhost:11434";
}

/** Parse the endpoint forms supported by the Ollama SDK, including a bare host or :port. */
export function parseOllamaUrl(host: string): URL | undefined {
  try {
    if (host.startsWith(":")) return new URL(`http://127.0.0.1${host}`);
    if (host.includes("://")) return new URL(host);
    const url = new URL(`http://${host}`);
    if (!url.port) url.port = "11434";
    return url;
  } catch {
    return undefined;
  }
}

export function ollamaDisplayOrigin(host: string): string {
  return parseOllamaUrl(host)?.origin ?? "(invalid Ollama endpoint)";
}

/**
 * Well-known model context lengths (in tokens).
 * Used for client-side pre-truncation to work around Ollama
 * batch truncation bugs (see https://github.com/ollama/ollama/issues/12710)
 * and to stay within cloud provider limits.
 */
const MODEL_CONTEXT_LENGTHS: Record<string, number> = {
  // Ollama models
  "nomic-embed-text": 2048,
  "mxbai-embed-large": 512,
  "snowflake-arctic-embed": 512,
  "all-minilm": 256,
  // OpenAI models
  "text-embedding-3-small": 8191,
  "text-embedding-3-large": 8191,
  "text-embedding-ada-002": 8191,
  // Google models
  "gemini-embedding-001": 2048,
};

/** Guess context length from model name. Returns 0 if unknown. */
function guessContextLength(model: string): number {
  const base = model.replace(/:.*$/, ""); // strip :tag
  return MODEL_CONTEXT_LENGTHS[base] ?? 0;
}

// ── Task prefixes ─────────────────────────────────────────────────────────

/**
 * Defaults for the task prefixes prepended to text before embedding.
 *
 * Embedding models disagree about these — some want a prefix, some want a
 * different one, some want none:
 * - nomic-embed-text:            `search_query: ` / `search_document: ` (these defaults)
 * - intfloat/multilingual-e5-*:  `query: ` / `passage: `
 * - cl-nagoya/ruri-v3-*:         `検索クエリ: ` / `検索文書: `
 * - BAAI/bge-m3:                 no prefix at all
 *
 * Sending the wrong prefix measurably hurts retrieval quality, so both sides
 * are configurable. The defaults reproduce the previous nomic-embed-text
 * behaviour, so an index built before these variables existed stays valid.
 */
const DEFAULT_QUERY_PREFIX = "search_query: ";
const DEFAULT_DOCUMENT_PREFIX = "search_document: ";

/**
 * Task prefix for queries, from `EMBEDDING_QUERY_PREFIX`.
 *
 * `??`, not `||`: an explicit empty string is a meaningful value ("no prefix",
 * which bge-m3 requires) and `||` would silently replace it with the default.
 * Read lazily so tests can toggle it via `vi.stubEnv`.
 */
export function queryPrefix(): string {
  return process.env.EMBEDDING_QUERY_PREFIX ?? DEFAULT_QUERY_PREFIX;
}

/**
 * Task prefix for documents, from `EMBEDDING_DOCUMENT_PREFIX`. Change it only
 * together with {@link queryPrefix}; an asymmetric pair ranks badly. Existing
 * collections retain their persisted effective pair until freshly indexed.
 */
export function documentPrefix(): string {
  return process.env.EMBEDDING_DOCUMENT_PREFIX ?? DEFAULT_DOCUMENT_PREFIX;
}

// ── Boolean env vars ──────────────────────────────────────────────────────

/**
 * Parse a boolean env var: case-insensitive and whitespace-tolerant, with
 * "true" / "1" / "yes" enabling and "false" / "0" / "no" disabling. Unset,
 * empty, and whitespace-only all mean "not configured", so the caller's
 * default applies.
 *
 * Anything else throws, naming the variable and the value. A typo such as
 * "ture" is a request for the flag to be on, and silently treating it as off
 * would leave the operator debugging the behaviour they thought they had
 * disabled the flag out of.
 */
function parseBooleanEnv(name: string, raw: string | undefined, defaultValue: boolean): boolean {
  if (!raw) return defaultValue;
  const v = raw.trim().toLowerCase();
  if (v === "") return defaultValue;
  if (v === "true" || v === "1" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "no") return false;
  throw new Error(
    `Invalid ${name}: "${raw}". Must be "true", "1", "yes", "false", "0", or "no" ` +
    `(case-insensitive), or left unset.`,
  );
}

/** Preserve LiteLLM's released opt-in semantics for this existing flag. */
function litellmDimensionsEnabled(raw: string | undefined): boolean {
  if (!raw) return false;
  const value = raw.toLowerCase();
  return value === "true" || value === "1" || value === "yes";
}

/**
 * Whether the file path is embedded alongside the chunk content, from
 * `EMBEDDING_DOCUMENT_INCLUDE_PATH`.
 *
 * The path is part of the text handed to the vector store, so it feeds both the
 * dense embedding and the BM25 sparse vector built from that same string.
 * Turning it off therefore removes path-derived tokens from lexical search too,
 * and for context artifacts it drops the `context:<name>:<path>` identifier
 * those chunks carry. Path tokens help path-shaped queries but add noise on
 * prose-heavy corpora.
 *
 * Defaults to on, which is the pre-existing behaviour, so an index built before
 * the variable existed stays valid. Read lazily so tests can toggle it via
 * `vi.stubEnv`.
 */
export function documentIncludesPath(): boolean {
  return parseBooleanEnv(
    "EMBEDDING_DOCUMENT_INCLUDE_PATH",
    process.env.EMBEDDING_DOCUMENT_INCLUDE_PATH,
    true,
  );
}

// ── Singleton ─────────────────────────────────────────────────────────────

let _config: EmbeddingConfig | null = null;
const effectiveConfigStorage = new AsyncLocalStorage<EmbeddingConfig>();

/**
 * Load embedding configuration from environment variables.
 * Called once on first access; cached thereafter.
 */
export function loadEmbeddingConfig(): EmbeddingConfig {
  if (_config) return _config;

  // ── Provider ────────────────────────────────────────────────────────
  const rawProvider = process.env.EMBEDDING_PROVIDER || "ollama";
  if (
    rawProvider !== "ollama" &&
    rawProvider !== "openai" &&
    rawProvider !== "google" &&
    rawProvider !== "lmstudio" &&
    rawProvider !== "litellm"
  ) {
    throw new Error(
      `Invalid EMBEDDING_PROVIDER: "${rawProvider}". Must be "ollama", "openai", "google", "lmstudio", or "litellm".`,
    );
  }
  const embeddingProvider: EmbeddingProvider = rawProvider;
  const providerDefaults = PROVIDER_DEFAULTS[embeddingProvider];

  // LM Studio has no sensible defaults — model and dimensions vary per loaded model.
  // Fail fast with an actionable message rather than silently sending empty values.
  if (embeddingProvider === "lmstudio") {
    if (!process.env.EMBEDDING_MODEL) {
      throw new Error(
        "EMBEDDING_MODEL is required when EMBEDDING_PROVIDER=lmstudio. " +
        "LM Studio has no built-in default — set it to the model identifier shown in " +
        "LM Studio's Local Server tab (e.g. EMBEDDING_MODEL=nomic-embed-text-v1.5).",
      );
    }
    if (!process.env.EMBEDDING_DIMENSIONS) {
      throw new Error(
        "EMBEDDING_DIMENSIONS is required when EMBEDDING_PROVIDER=lmstudio. " +
        "Different LM Studio models have different output dimensions — check the model card " +
        "and set EMBEDDING_DIMENSIONS accordingly (e.g. 768 for nomic-embed-text-v1.5, " +
        "1024 for bge-large-en-v1.5, 4096 for qwen3-embedding-8b).",
      );
    }
  }

  // LiteLLM proxy aliases are user-defined in config.yaml — there is no canonical
  // default model name and the underlying dimension depends on which provider the
  // alias resolves to. Authentication is also mandatory (the proxy enforces it
  // even for read-only /v1/models). Fail fast on each missing piece so the
  // operator gets a single, specific error rather than a generic 401 / 404 from
  // the proxy at first embed().
  if (embeddingProvider === "litellm") {
    if (!process.env.LITELLM_API_KEY) {
      throw new Error(
        "LITELLM_API_KEY is required when EMBEDDING_PROVIDER=litellm. " +
        "Set it to the proxy's master key (general_settings.master_key in config.yaml) " +
        "or to a virtual key issued via LiteLLM's /key/generate endpoint.",
      );
    }
    if (!process.env.EMBEDDING_MODEL) {
      throw new Error(
        "EMBEDDING_MODEL is required when EMBEDDING_PROVIDER=litellm. " +
        "Set it to a model_name from your LiteLLM config.yaml (e.g. EMBEDDING_MODEL=text-embedding-3-small " +
        "if your proxy aliases that name; LiteLLM rewrites the call to whichever litellm_params.model " +
        "is configured under that alias).",
      );
    }
    if (!process.env.EMBEDDING_DIMENSIONS) {
      throw new Error(
        "EMBEDDING_DIMENSIONS is required when EMBEDDING_PROVIDER=litellm. " +
        "The proxy alias maps to an underlying model whose dimension we cannot infer — set this to the " +
        "underlying model's output dim (e.g. 1536 for text-embedding-3-small, 1024 for voyage-2, " +
        "768 for nomic-embed-text-v1.5).",
      );
    }
  }

  // ── Ollama mode (only relevant for ollama provider) ─────────────────
  const rawMode = process.env.OLLAMA_MODE || "auto";
  if (rawMode !== "docker" && rawMode !== "external" && rawMode !== "auto") {
    throw new Error(
      `Invalid OLLAMA_MODE: "${rawMode}". Must be "docker", "external", or "auto".`,
    );
  }
  const ollamaApiKey = process.env.OLLAMA_API_KEY || undefined;
  const ollamaUrl = process.env.OLLAMA_URL || (ollamaApiKey ? process.env.OLLAMA_HOST : undefined);
  const ollamaMode: OllamaMode = rawMode === "auto" && ollamaUrl && ollamaApiKey ? "external" : rawMode;

  // ── Model & dimensions (provider-specific defaults) ─────────────────
  const embeddingModel = process.env.EMBEDDING_MODEL || providerDefaults.model;
  const rawDimensions = Number(
    process.env.EMBEDDING_DIMENSIONS || providerDefaults.dimensions,
  );
  if (!Number.isInteger(rawDimensions) || rawDimensions <= 0) {
    throw new Error(
      `Invalid EMBEDDING_DIMENSIONS: "${process.env.EMBEDDING_DIMENSIONS}". Must be a positive integer.`,
    );
  }
  const embeddingDimensions = rawDimensions;

  const rawMaxConnections = Number(process.env.OLLAMA_MAX_CONNECTIONS || 4);
  if (!Number.isInteger(rawMaxConnections) || rawMaxConnections <= 0) {
    throw new Error(
      `Invalid OLLAMA_MAX_CONNECTIONS: "${process.env.OLLAMA_MAX_CONNECTIONS}". Must be a positive integer.`,
    );
  }
  const ollamaMaxConnections = rawMaxConnections;

  const contextLengthEnv = process.env.EMBEDDING_CONTEXT_LENGTH;

  // ── Document text composition ───────────────────────────────────────
  // Resolved here, rather than only at the point of use, so that the values are
  // logged where a misconfiguration can be spotted — inside a tool call, where
  // the message reaches the host. For EMBEDDING_DOCUMENT_INCLUDE_PATH that also
  // means an invalid value is reported there rather than at module evaluation.
  const resolvedQueryPrefix = queryPrefix();
  const resolvedDocumentPrefix = documentPrefix();
  const querySet = process.env.EMBEDDING_QUERY_PREFIX !== undefined;
  const documentSet = process.env.EMBEDDING_DOCUMENT_PREFIX !== undefined;
  const includesPath = documentIncludesPath();

  _config = {
    embeddingProvider,
    ollamaMode,
    ollamaUrl: ollamaUrl || defaultOllamaUrl(ollamaMode, ollamaApiKey),
    lmstudioUrl: process.env.LMSTUDIO_URL || "http://localhost:1234/v1",
    litellmUrl: process.env.LITELLM_URL || "http://localhost:4000/v1",
    allowMissingModelListing: parseBooleanEnv(
      "LMSTUDIO_ALLOW_MISSING_MODEL_LISTING",
      process.env.LMSTUDIO_ALLOW_MISSING_MODEL_LISTING,
      false,
    ),
    embeddingModel,
    embeddingDimensions,
    embeddingContextLength: contextLengthEnv
      ? (() => {
          const parsed = Number(contextLengthEnv);
          if (!Number.isInteger(parsed) || parsed <= 0) {
            throw new Error(
              `Invalid EMBEDDING_CONTEXT_LENGTH: "${contextLengthEnv}". Must be a positive integer.`,
            );
          }
          return parsed;
        })()
      : guessContextLength(embeddingModel),
    litellmSendDimensions: litellmDimensionsEnabled(process.env.LITELLM_SEND_DIMENSIONS),
    ollamaApiKey,
    ollamaMaxConnections,
  };

  logger.info("Embedding config loaded", {
    embeddingProvider: _config.embeddingProvider,
    ...(embeddingProvider === "ollama" ? {
      ollamaMode: _config.ollamaMode,
      ollamaUrl: ollamaDisplayOrigin(_config.ollamaUrl),
      ollamaMaxConnections: _config.ollamaMaxConnections,
    } : {}),
    ...(embeddingProvider === "lmstudio" ? {
      lmstudioUrl: _config.lmstudioUrl,
      allowMissingModelListing: _config.allowMissingModelListing,
    } : {}),
    ...(embeddingProvider === "litellm" ? {
      litellmUrl: _config.litellmUrl,
      sendDimensions: _config.litellmSendDimensions,
    } : {}),
    embeddingModel: _config.embeddingModel,
    embeddingDimensions: _config.embeddingDimensions,
    embeddingContextLength: _config.embeddingContextLength || "auto",
    queryPrefix: resolvedQueryPrefix,
    documentPrefix: resolvedDocumentPrefix,
    documentIncludesPath: includesPath,
    hasApiKey: !!(embeddingProvider === "ollama"
      ? _config.ollamaApiKey
      : embeddingProvider === "openai"
        ? process.env.OPENAI_API_KEY
        : embeddingProvider === "google"
          ? process.env.GOOGLE_API_KEY
          : embeddingProvider === "lmstudio"
            ? process.env.LMSTUDIO_API_KEY
            : embeddingProvider === "litellm"
              ? process.env.LITELLM_API_KEY
              : undefined),
  });

  // The query and document encoders have to agree, so moving one prefix
  // without the other degrades ranking silently. Say so rather than let the
  // results quietly get worse.
  if (querySet !== documentSet) {
    logger.warn(
      "Only one side of the embedding task prefixes is set: EMBEDDING_QUERY_PREFIX and EMBEDDING_DOCUMENT_PREFIX should be set together. Existing collections retain their effective pair; use codebase_remove, then codebase_index, to activate the requested pair.",
      { queryPrefixSet: querySet, documentPrefixSet: documentSet },
    );
  }

  return _config;
}

/** Get the current embedding configuration (loads if not yet loaded). */
export function getEmbeddingConfig(): EmbeddingConfig {
  return effectiveConfigStorage.getStore() ?? loadEmbeddingConfig();
}

/**
 * Run one embedding operation with collection-specific output-shaping values.
 * Connectivity and credentials stay sourced from the live runtime config; only
 * values that define the vector space are overridden. AsyncLocalStorage keeps
 * concurrent searches for differently-profiled collections isolated.
 */
export function withEmbeddingConfig<T>(
  overrides: Pick<
    EmbeddingConfig,
    | "embeddingProvider"
    | "embeddingModel"
    | "embeddingDimensions"
    | "embeddingContextLength"
    | "litellmSendDimensions"
  >,
  operation: () => T,
): T {
  return effectiveConfigStorage.run(
    { ...loadEmbeddingConfig(), ...overrides },
    operation,
  );
}

/**
 * Update the resolved Ollama mode and URL after auto-detection.
 * Called by OllamaEmbeddingProvider when OLLAMA_MODE=auto resolves.
 */
export function setResolvedOllamaMode(mode: "docker" | "external", url: string): void {
  const effective = effectiveConfigStorage.getStore();
  if (effective) {
    effective.ollamaMode = mode;
    effective.ollamaUrl = url;
  }
  if (_config) {
    _config.ollamaMode = mode;
    _config.ollamaUrl = url;
  }
}

/** Reset config cache (for testing). */
export function resetEmbeddingConfig(): void {
  _config = null;
}
