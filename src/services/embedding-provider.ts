// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited
/**
 * Embedding provider factory.
 *
 * All embedding providers implement the EmbeddingProvider interface (defined
 * in embedding-types.ts), allowing the rest of the codebase to be agnostic
 * about which backend generates the vectors.
 *
 * Providers:
 *   - ollama   (default) — local Ollama (Docker or external)
 *   - openai   — OpenAI Embeddings API (text-embedding-3-small, etc.)
 *   - google   — Google Generative AI Embedding API (gemini-embedding-001, etc.)
 *   - lmstudio — local LM Studio server via OpenAI-compatible API
 *   - litellm  — LiteLLM proxy (OpenAI-compatible gateway in front of 100+ providers)
 *   - orcarouter — OrcaRouter gateway (OpenAI-compatible AI gateway in front of many providers)
 */

import type { InfraProgressCallback } from "./docker.js";
import { getEmbeddingConfig, type EmbeddingProvider as ProviderName } from "./embedding-config.js";
import { logger } from "./logger.js";

// Re-export types so existing consumers don't need to change their imports.
export type { EmbeddingHealthStatus, EmbeddingProvider, EmbeddingReadinessResult } from "./embedding-types.js";

import type { EmbeddingProvider } from "./embedding-types.js";

// ── Factory ──────────────────────────────────────────────────────────────

let _provider: EmbeddingProvider | null = null;
let _providerName: ProviderName | null = null;

/**
 * Get (or create) the active embedding provider singleton.
 * Provider is selected based on EMBEDDING_PROVIDER env var.
 * @param onProgress Optional callback for reporting infrastructure setup progress
 */
export async function getEmbeddingProvider(onProgress?: InfraProgressCallback): Promise<EmbeddingProvider> {
  const config = getEmbeddingConfig();

  // Recreate if provider changed (e.g. after config reset in tests)
  if (_provider && _providerName === config.embeddingProvider) {
    return _provider;
  }

  const name = config.embeddingProvider;
  logger.info("Initializing embedding provider", { provider: name });

  switch (name) {
    case "ollama": {
      // Dynamic imports avoid loading all provider SDKs at startup.
      const { OllamaEmbeddingProvider } = await import("./provider-ollama.js");
      _provider = new OllamaEmbeddingProvider(onProgress);
      break;
    }
    case "openai": {
      const { OpenAIEmbeddingProvider } = await import("./provider-openai.js");
      _provider = new OpenAIEmbeddingProvider();
      break;
    }
    case "google": {
      const { GoogleEmbeddingProvider } = await import("./provider-google.js");
      _provider = new GoogleEmbeddingProvider();
      break;
    }
    case "lmstudio": {
      const { LMStudioEmbeddingProvider } = await import("./provider-lmstudio.js");
      _provider = new LMStudioEmbeddingProvider();
      break;
    }
    case "litellm": {
      const { LiteLLMEmbeddingProvider } = await import("./provider-litellm.js");
      _provider = new LiteLLMEmbeddingProvider();
      break;
    }
    case "orcarouter": {
      const { OrcaRouterEmbeddingProvider } = await import("./provider-orcarouter.js");
      _provider = new OrcaRouterEmbeddingProvider();
      break;
    }
    default:
      throw new Error(
        `Unknown embedding provider: "${name}". Must be "ollama", "openai", "google", "lmstudio", "litellm", or "orcarouter".`,
      );
  }

  _providerName = name;
  // biome-ignore lint/style/noNonNullAssertion: _provider is guaranteed set by the switch above
  return _provider!;
}

/** Reset the provider singleton (for testing). */
export function resetEmbeddingProvider(): void {
  _provider = null;
  _providerName = null;
}
