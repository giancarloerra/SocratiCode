// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited
/**
 * OrcaRouter embedding provider.
 *
 * OrcaRouter (https://www.orcarouter.ai) is an OpenAI-compatible AI gateway
 * that exposes a provider/model namespace (google/gemini-embedding-001,
 * orcarouter/fusion, openai/text-embedding-3-small, ...) behind a single
 * /v1/embeddings endpoint. Model ids use the same provider/name shape as
 * OpenRouter, and the gateway combines adaptive routing, automatic failover,
 * zero-markup inference, observability, guardrails, and agent-tool governance.
 *
 * This provider is intentionally separate from `provider-litellm.ts` because:
 *   - OrcaRouter is a managed SaaS gateway with a well-known base URL, not a
 *     user-hosted proxy, so ORCAROUTER_URL defaults to api.orcarouter.ai.
 *   - Model ids carry a provider/ prefix (google/...), so the /v1/models
 *     membership check matches the operator's full model id, not a local alias.
 *   - Whether the `dimensions` parameter is honoured depends on the underlying
 *     provider the gateway routes to, so we make it opt-in via
 *     ORCAROUTER_SEND_DIMENSIONS (same reasoning as LITELLM_SEND_DIMENSIONS).
 *   - Health check messaging points at gateway-side issues (API key validity,
 *     model id not in /v1/models) rather than at a self-hosted proxy.
 *
 * Required env when using this provider:
 *   EMBEDDING_PROVIDER=orcarouter
 *   ORCAROUTER_API_KEY=<api-key>
 *   EMBEDDING_MODEL=<provider/model-id-from-orcarouter-v1-models>
 *   EMBEDDING_DIMENSIONS=<dim-of-chosen-model>
 *
 * Optional env:
 *   ORCAROUTER_URL=https://api.orcarouter.ai/v1   (default; must include /v1 suffix)
 *   ORCAROUTER_SEND_DIMENSIONS=true               (opt-in; forwards `dimensions` to the
 *                                                 gateway for Matryoshka-aware models like
 *                                                 openai/text-embedding-3-*. Default false
 *                                                 because non-Matryoshka backends raise on it.)
 *   EMBEDDING_CONTEXT_LENGTH=<tokens>             (defaults to 2048 if model unknown)
 */

import OpenAI from "openai";
import { getEmbeddingConfig } from "./embedding-config.js";
import type { EmbeddingHealthStatus, EmbeddingProvider, EmbeddingReadinessResult } from "./embedding-types.js";
import { logger } from "./logger.js";

// ── Constants ───────────────────────────────────────────────────────────

/**
 * Conservative batch size — OrcaRouter is a gateway in front of an arbitrary
 * backend, so the practical batch ceiling depends on whichever provider the
 * model id resolves to (an OpenAI id tolerates 512+, a Gemini id 100+). 256
 * sits between the OpenAI (512) and LM Studio (64) defaults and rarely
 * triggers gateway-level rate limiting on commercial backends.
 */
const ORCAROUTER_BATCH_SIZE = 256;

/**
 * Conservative chars-per-token ratio for code. Same value as provider-openai
 * and provider-litellm; the gateway does not retokenize on the hop.
 */
const CHARS_PER_TOKEN_ESTIMATE = 3.0;

/**
 * Fallback context length when EMBEDDING_CONTEXT_LENGTH is unset and the model
 * id is not in the known-models table. 2048 is a safe lower bound across the
 * common embedding backends OrcaRouter routes to (Gemini 2048, OpenAI 8191,
 * Voyage 16k, BGE 512). Underestimating only triggers extra client-side
 * truncation; never a request-rejection.
 */
const DEFAULT_CONTEXT_LENGTH = 2048;

// ── Client management ───────────────────────────────────────────────────

let orcarouterClient: OpenAI | null = null;
let orcarouterBaseUrl: string | null = null;
let orcarouterApiKey: string | null = null;

function getClient(): OpenAI {
  const config = getEmbeddingConfig();
  const baseUrl = config.orcarouterUrl;
  // Read the key from the live env so test harnesses that mutate process.env
  // between calls observe the change without an explicit reset.
  const apiKey = process.env.ORCAROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ORCAROUTER_API_KEY environment variable is required when using the OrcaRouter embedding provider. " +
      "Set it in your MCP config env block.",
    );
  }
  if (!orcarouterClient || orcarouterBaseUrl !== baseUrl || orcarouterApiKey !== apiKey) {
    orcarouterClient = new OpenAI({
      apiKey,
      baseURL: baseUrl,
    });
    orcarouterBaseUrl = baseUrl;
    orcarouterApiKey = apiKey;
  }
  return orcarouterClient;
}

/** Reset client (for testing or ORCAROUTER_URL / ORCAROUTER_API_KEY hot-swap). */
export function resetOrcaRouterClient(): void {
  orcarouterClient = null;
  orcarouterBaseUrl = null;
  orcarouterApiKey = null;
}

// ── Pre-truncation ──────────────────────────────────────────────────────

function pretruncateTexts(texts: string[], contextLength: number): string[] {
  if (contextLength <= 0) return texts;
  const maxChars = Math.floor(contextLength * CHARS_PER_TOKEN_ESTIMATE);
  return texts.map((t) => (t.length > maxChars ? t.substring(0, maxChars) : t));
}

// ── Auth-error detection ────────────────────────────────────────────────

/**
 * The OpenAI SDK surfaces 401/403 from the gateway as APIError subclasses with
 * a `.status` field. We don't import those classes (avoids a hard dep on the
 * SDK's private subclass exports) and instead duck-type on `.status`.
 */
function isAuthError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const status = (err as { status?: unknown }).status;
  return status === 401 || status === 403;
}

// ── Provider class ──────────────────────────────────────────────────────

export class OrcaRouterEmbeddingProvider implements EmbeddingProvider {
  readonly name = "orcarouter";

  async ensureReady(): Promise<EmbeddingReadinessResult> {
    const config = getEmbeddingConfig();
    // Fail fast with our own message before letting the SDK construct the client.
    const client = getClient();

    // Step 1 — connectivity + auth. Three failure modes share a single round trip:
    // gateway unreachable (DNS/connection refused), bad credentials (401/403), or
    // gateway reachable but mis-configured (500/etc.). Distinguish them so the
    // operator gets a directly actionable hint.
    //
    // Iterate the SDK's auto-paginated AsyncIterable rather than reading
    // .data directly. OrcaRouter today returns the entire model list in one
    // page, so this is functionally a no-op; it keeps the membership check
    // correct if the gateway ever paginates /v1/models the way the OpenAI SDK
    // already expects.
    const allModelIds: string[] = [];
    try {
      for await (const m of client.models.list()) {
        allModelIds.push(m.id);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isAuthError(err)) {
        throw new Error(
          `OrcaRouter rejected the request at ${config.orcarouterUrl} with an authentication error. ` +
          "Check that ORCAROUTER_API_KEY is valid and has access to the embedding models. " +
          `Underlying error: ${message}`,
        );
      }
      throw new Error(
        `OrcaRouter is not reachable at ${config.orcarouterUrl}. ` +
        "Make sure the gateway is reachable from your network and ORCAROUTER_URL is correct " +
        "(the URL must include the /v1 suffix). " +
        `Underlying error: ${message}`,
      );
    }

    // Step 2 — model id registered. OrcaRouter's /v1/models returns the full
    // provider/model namespace; if the configured EMBEDDING_MODEL is missing the
    // gateway will return a NotFoundError on every embed() call, which is opaque
    // under high concurrency. Fail early with a hint that points at the model id
    // rather than at the underlying provider.
    const modelRegistered = allModelIds.includes(config.embeddingModel);
    if (!modelRegistered) {
      const known = allModelIds.slice(0, 10).join(", ");
      throw new Error(
        `OrcaRouter is reachable at ${config.orcarouterUrl} but the embedding model ` +
        `"${config.embeddingModel}" is not registered on the gateway. ` +
        "Set EMBEDDING_MODEL to a model id from OrcaRouter's /v1/models (e.g. " +
        "google/gemini-embedding-001 or orcarouter/fusion) and retry. " +
        (known ? `Currently registered models: ${known}.` : "The gateway currently has no registered models."),
      );
    }

    logger.info("OrcaRouter embedding provider ready", {
      baseUrl: config.orcarouterUrl,
      model: config.embeddingModel,
      sendDimensions: shouldSendDimensions(),
    });
    // OrcaRouter is a managed SaaS gateway — no containers, no model pulls.
    return { modelPulled: false, containerStarted: false, imagePulled: false };
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const config = getEmbeddingConfig();
    const client = getClient();
    const contextLength = config.embeddingContextLength > 0
      ? config.embeddingContextLength
      : DEFAULT_CONTEXT_LENGTH;
    const truncated = pretruncateTexts(texts, contextLength);

    if (truncated.length <= ORCAROUTER_BATCH_SIZE) {
      return this._embedBatch(client, truncated, config.embeddingModel, config.embeddingDimensions);
    }

    const results: number[][] = [];
    for (let i = 0; i < truncated.length; i += ORCAROUTER_BATCH_SIZE) {
      const batch = truncated.slice(i, i + ORCAROUTER_BATCH_SIZE);
      const embeddings = await this._embedBatch(client, batch, config.embeddingModel, config.embeddingDimensions);
      results.push(...embeddings);
    }
    return results;
  }

  async embedSingle(text: string): Promise<number[]> {
    const results = await this.embed([text]);
    if (results.length === 0) {
      throw new Error("Embedding failed: no result returned");
    }
    return results[0];
  }

  async healthCheck(): Promise<EmbeddingHealthStatus> {
    const config = getEmbeddingConfig();
    const lines: string[] = [];
    const icon = (ok: boolean) => (ok ? "[OK]" : "[MISSING]");

    const hasKey = !!process.env.ORCAROUTER_API_KEY;
    lines.push(
      `${icon(hasKey)} OrcaRouter API key: ` +
      (hasKey ? "Configured" : "Missing — set ORCAROUTER_API_KEY in your MCP config"),
    );
    if (!hasKey) {
      return { available: false, modelReady: false, statusLines: lines };
    }

    try {
      const client = getClient();
      // Same auto-pagination treatment as ensureReady — see the comment there
      // for why we iterate rather than reading .data directly.
      const allModelIds: string[] = [];
      for await (const m of client.models.list()) {
        allModelIds.push(m.id);
      }
      lines.push(`${icon(true)} OrcaRouter: Reachable at ${config.orcarouterUrl}`);

      const modelRegistered = allModelIds.includes(config.embeddingModel);
      lines.push(
        `${icon(modelRegistered)} Embedding model (${config.embeddingModel}): ` +
        (modelRegistered
          ? "Registered on the gateway"
          : "Not registered — set EMBEDDING_MODEL to a model id from /v1/models"),
      );

      return { available: true, modelReady: modelRegistered, statusLines: lines };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isAuthError(err)) {
        lines.push(`${icon(false)} OrcaRouter: Auth rejected at ${config.orcarouterUrl} (${message})`);
      } else {
        lines.push(`${icon(false)} OrcaRouter: Not reachable at ${config.orcarouterUrl} (${message})`);
      }
      return { available: false, modelReady: false, statusLines: lines };
    }
  }

  private async _embedBatch(
    client: OpenAI,
    texts: string[],
    model: string,
    dimensions: number,
  ): Promise<number[][]> {
    // Forwarding `dimensions` is opt-in (ORCAROUTER_SEND_DIMENSIONS=true). The
    // gateway forwards it to the underlying provider verbatim — Matryoshka-aware
    // models (openai/text-embedding-3-*) accept it; others (Gemini, BGE, Cohere)
    // reject the request. Default off keeps the provider compatible with arbitrary
    // model ids.
    //
    // `encoding_format: "float"` is REQUIRED. The OpenAI SDK (6.x+) defaults to
    // `encoding_format: "base64"` and unconditionally decodes the response with
    // toFloat32Array(). The gateway forwards the original provider's response,
    // which for many backends (Gemini, BGE-via-TEI, custom HF wrappers) is a JSON
    // float array. The SDK's decode path then runs `Buffer.from(<array>, 'base64')`,
    // Node.js silently drops the encoding for array inputs and clamps each float
    // (<1.0) to uint8 0, producing a zero buffer reinterpreted as a Float32Array
    // of zeros. This is the same bug fixed for LM Studio in commit bb141a0 and
    // applied to LiteLLM in provider-litellm.ts; the failure mode reproduces
    // against any gateway alias whose backend doesn't re-encode to base64.
    // Setting `encoding_format: "float"` makes the SDK skip the decode step.
    const response = await client.embeddings.create({
      model,
      input: texts,
      encoding_format: "float",
      ...(shouldSendDimensions() ? { dimensions } : {}),
    });
    const sorted = response.data.sort((a, b) => a.index - b.index);
    return sorted.map((d) => d.embedding);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

function shouldSendDimensions(): boolean {
  const raw = process.env.ORCAROUTER_SEND_DIMENSIONS;
  if (!raw) return false;
  const v = raw.toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}
