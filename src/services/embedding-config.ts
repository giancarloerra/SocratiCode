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
 *   - "orcarouter": Use OrcaRouter (OpenAI-compatible AI gateway in front of many
 *                providers, model ids like google/gemini-embedding-001). Requires
 *                ORCAROUTER_API_KEY, EMBEDDING_MODEL (a provider/model id from the
 *                gateway's /v1/models), and EMBEDDING_DIMENSIONS (the chosen model's dim).
 *
 * Ollama-specific:
 *   OLLAMA_MODE:
 *     - "auto" (default): Auto-detect. If Ollama is already running natively on port 11434,
 *       use it (external mode — fastest, GPU-accelerated on Mac/Windows). Otherwise fall back
 *       to a managed Docker container on port 11435.
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
 * OrcaRouter-specific:
 *   ORCAROUTER_URL:            OpenAI-compatible base URL of the OrcaRouter gateway.
 *                              Default: https://api.orcarouter.ai/v1 (the /v1 suffix is required;
 *                              the gateway exposes /v1/embeddings under that prefix).
 *   ORCAROUTER_API_KEY:        Required. API key issued by OrcaRouter. Unlike LM Studio, the
 *                              gateway always authenticates.
 *   ORCAROUTER_SEND_DIMENSIONS: Opt-in ("true" / "1" / "yes"). Forwards the OpenAI-style
 *                              `dimensions` parameter to the gateway for Matryoshka-aware
 *                              underlying models (openai/text-embedding-3-*). Default off
 *                              because non-Matryoshka backends reject it.
 *
 * Shared:
 *   EMBEDDING_MODEL:       Model name (default depends on provider; required for lmstudio).
 *   EMBEDDING_DIMENSIONS:  Vector dimensions — must match the model (default depends on
 *                          provider; required for lmstudio).
 *   EMBEDDING_CONTEXT_LENGTH: Override context window in tokens (auto-detected for known models).
 */

import { logger } from "./logger.js";

// ── Types ─────────────────────────────────────────────────────────────────

export type EmbeddingProvider = "ollama" | "openai" | "google" | "lmstudio" | "litellm" | "orcarouter";
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
  /** OrcaRouter gateway OpenAI-compatible base URL (only relevant when embeddingProvider is "orcarouter"). */
  orcarouterUrl: string;
  embeddingModel: string;
  embeddingDimensions: number;
  /** Max context window in tokens. Used for client-side pre-truncation. */
  embeddingContextLength: number;
  ollamaApiKey?: string;
}

// ── Provider defaults ─────────────────────────────────────────────────────

/**
 * lmstudio, litellm, and orcarouter have empty defaults: there's no canonical
 * model — users pick one (the loaded LM Studio model, a proxy alias from
 * LiteLLM's config.yaml, or a provider/model id from OrcaRouter's /v1/models).
 * We fail-fast in loadEmbeddingConfig() when those providers are selected
 * without explicit EMBEDDING_MODEL / EMBEDDING_DIMENSIONS.
 */
const PROVIDER_DEFAULTS: Record<EmbeddingProvider, { model: string; dimensions: number }> = {
  ollama:   { model: "nomic-embed-text",        dimensions: 768  },
  openai:   { model: "text-embedding-3-small",  dimensions: 1536 },
  google:   { model: "gemini-embedding-001",    dimensions: 3072 },
  lmstudio: { model: "",                        dimensions: 0    },
  litellm:  { model: "",                        dimensions: 0    },
  orcarouter: { model: "",                      dimensions: 0    },
};

// ── Ollama mode defaults ──────────────────────────────────────────────────

const MODE_DEFAULTS: Record<OllamaMode, { url: string }> = {
  docker: { url: "http://localhost:11435" },
  external: { url: "http://localhost:11434" },
  // auto: probe localhost:11434 first; URL will be corrected by OllamaEmbeddingProvider.ensureReady()
  auto: { url: "http://localhost:11434" },
};

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
  // OrcaRouter model ids (provider/model namespace). These names match the
  // gateway's /v1/models, so EMBEDDING_MODEL values like
  // google/gemini-embedding-001 or openai/text-embedding-3-small auto-detect.
  "google/gemini-embedding-001": 2048,
  "openai/text-embedding-3-small": 8191,
  "openai/text-embedding-3-large": 8191,
  "openai/text-embedding-ada-002": 8191,
};

/** Guess context length from model name. Returns 0 if unknown. */
function guessContextLength(model: string): number {
  const base = model.replace(/:.*$/, ""); // strip :tag
  return MODEL_CONTEXT_LENGTHS[base] ?? 0;
}

// ── Singleton ─────────────────────────────────────────────────────────────

let _config: EmbeddingConfig | null = null;

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
    rawProvider !== "litellm" &&
    rawProvider !== "orcarouter"
  ) {
    throw new Error(
      `Invalid EMBEDDING_PROVIDER: "${rawProvider}". Must be "ollama", "openai", "google", "lmstudio", "litellm", or "orcarouter".`,
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

  // OrcaRouter model ids are provider/model names defined by the gateway — there
  // is no canonical default model name and the dimension depends on which model
  // id the operator chooses. Authentication is mandatory (the gateway enforces
  // it even for read-only /v1/models). Fail fast on each missing piece so the
  // operator gets a single, specific error rather than a generic 401 / 404 from
  // the gateway at first embed().
  if (embeddingProvider === "orcarouter") {
    if (!process.env.ORCAROUTER_API_KEY) {
      throw new Error(
        "ORCAROUTER_API_KEY is required when EMBEDDING_PROVIDER=orcarouter. " +
        "Set it to an OrcaRouter API key from the OrcaRouter dashboard.",
      );
    }
    if (!process.env.EMBEDDING_MODEL) {
      throw new Error(
        "EMBEDDING_MODEL is required when EMBEDDING_PROVIDER=orcarouter. " +
        "Set it to a provider/model id from the gateway's /v1/models (e.g. " +
        "EMBEDDING_MODEL=google/gemini-embedding-001 or EMBEDDING_MODEL=orcarouter/fusion).",
      );
    }
    if (!process.env.EMBEDDING_DIMENSIONS) {
      throw new Error(
        "EMBEDDING_DIMENSIONS is required when EMBEDDING_PROVIDER=orcarouter. " +
        "The chosen model id determines the output dimension — set this to the model's " +
        "output dim (e.g. 3072 for google/gemini-embedding-001, 1536 for " +
        "openai/text-embedding-3-small).",
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
  const ollamaMode: OllamaMode = rawMode;
  const modeDefaults = MODE_DEFAULTS[ollamaMode];

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

  _config = {
    embeddingProvider,
    ollamaMode,
    ollamaUrl: process.env.OLLAMA_URL || modeDefaults.url,
    lmstudioUrl: process.env.LMSTUDIO_URL || "http://localhost:1234/v1",
    litellmUrl: process.env.LITELLM_URL || "http://localhost:4000/v1",
    orcarouterUrl: process.env.ORCAROUTER_URL || "https://api.orcarouter.ai/v1",
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
    ollamaApiKey: process.env.OLLAMA_API_KEY || undefined,
    ollamaMaxConnections,
  };

  logger.info("Embedding config loaded", {
    embeddingProvider: _config.embeddingProvider,
    ...(embeddingProvider === "ollama" ? {
      ollamaMode: _config.ollamaMode,
      ollamaUrl: _config.ollamaUrl,
      ollamaMaxConnections: _config.ollamaMaxConnections,
    } : {}),
    ...(embeddingProvider === "lmstudio" ? {
      lmstudioUrl: _config.lmstudioUrl,
    } : {}),
    ...(embeddingProvider === "litellm" ? {
      litellmUrl: _config.litellmUrl,
      sendDimensions: !!process.env.LITELLM_SEND_DIMENSIONS,
    } : {}),
    ...(embeddingProvider === "orcarouter" ? {
      orcarouterUrl: _config.orcarouterUrl,
      sendDimensions: !!process.env.ORCAROUTER_SEND_DIMENSIONS,
    } : {}),
    embeddingModel: _config.embeddingModel,
    embeddingDimensions: _config.embeddingDimensions,
    embeddingContextLength: _config.embeddingContextLength || "auto",
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
              : embeddingProvider === "orcarouter"
                ? process.env.ORCAROUTER_API_KEY
                : undefined),
  });

  return _config;
}

/** Get the current embedding configuration (loads if not yet loaded). */
export function getEmbeddingConfig(): EmbeddingConfig {
  return loadEmbeddingConfig();
}

/**
 * Update the resolved Ollama mode and URL after auto-detection.
 * Called by OllamaEmbeddingProvider when OLLAMA_MODE=auto resolves.
 */
export function setResolvedOllamaMode(mode: "docker" | "external", url: string): void {
  if (_config) {
    _config.ollamaMode = mode;
    _config.ollamaUrl = url;
  }
}

/** Reset config cache (for testing). */
export function resetEmbeddingConfig(): void {
  _config = null;
}
