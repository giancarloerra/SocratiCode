// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited
/**
 * Ollama embedding provider.
 *
 * Wraps the existing Ollama client logic (Docker or external)
 * into the EmbeddingProvider interface.
 */

import { BlockList, isIP } from "node:net";
import { Ollama } from "ollama";
import { Agent, fetch as undiciFetch } from "undici";
import type { InfraProgressCallback } from "./docker.js";
import { ensureOllamaContainerReady, isDockerAvailable, isOllamaImagePresent, isOllamaRunning, isQdrantRunning } from "./docker.js";
import { defaultOllamaUrl, getEmbeddingConfig, ollamaDisplayOrigin, parseOllamaUrl, setResolvedOllamaMode } from "./embedding-config.js";
import type { EmbeddingHealthStatus, EmbeddingProvider, EmbeddingReadinessResult } from "./embedding-types.js";
import { logger } from "./logger.js";

// ── Client management ────────────────────────────────────────────────────

let ollamaClient: Ollama | null = null;
let ollamaClientHost: string | null = null;
let ollamaClientConnections: number | null = null;
let ollamaClientApiKey: string | undefined;
let ollamaDispatcher: Agent | null = null;

const loopbackAddresses = new BlockList();
loopbackAddresses.addSubnet("127.0.0.0", 8, "ipv4");
loopbackAddresses.addAddress("::1", "ipv6");

class OllamaTransportError extends Error {}

function isAuthChallenge(status: number): boolean {
  return status === 401 || status === 403;
}

/** Keep keyed Ollama requests on HTTPS, except for explicitly supported loopback HTTP. */
function assertOllamaTransport(host: string, apiKey: string | undefined): void {
  if (!apiKey) return;
  const url = parseOllamaUrl(host);
  if (!url) {
    throw new TypeError("Invalid OLLAMA_URL. Configure a valid HTTPS URL or an HTTP loopback endpoint.");
  }
  if (url.protocol === "https:") return;
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const family = isIP(hostname);
  const loopback = hostname === "localhost" || hostname === "localhost." ||
    (family !== 0 && loopbackAddresses.check(hostname, family === 4 ? "ipv4" : "ipv6"));
  if (url.protocol !== "http:" || !loopback) {
    throw new OllamaTransportError("OLLAMA_API_KEY requires HTTPS for remote servers. Use an HTTPS OLLAMA_URL; HTTP is supported only for loopback endpoints when an API key is configured.");
  }
}

/** Reuse a bounded client only while its endpoint, connection limit and credential match. */
function getClient(): Ollama {
  const config = getEmbeddingConfig();
  if (
    !ollamaClient ||
    ollamaClientHost !== config.ollamaUrl ||
    ollamaClientConnections !== config.ollamaMaxConnections ||
    ollamaClientApiKey !== config.ollamaApiKey
  ) {
    assertOllamaTransport(config.ollamaUrl, config.ollamaApiKey);
    // An orphaned pool keeps its idle sockets until they time out, so close
    // the previous dispatcher whenever the client is rebuilt. close() stops
    // the old agent accepting new dispatches immediately and lets in-flight
    // requests finish, so during a rebuild the old pool only shrinks while
    // the new one grows: the brief overlap is bounded by the two caps and
    // resolves itself, and no request is aborted. Serialising the swap would
    // buy nothing beyond that and would force this accessor async.
    const previous = ollamaDispatcher;
    if (previous) {
      previous.close().catch((err: unknown) => {
        logger.debug("Closing previous Ollama dispatcher failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
    // Node's default fetch pool has no per-origin connection cap, so
    // concurrent embeds from several server processes or overlapping tool
    // calls stack sockets to Ollama without limit (issue 114). A bounded
    // undici Agent caps them; requests beyond the cap queue on the agent.
    // The Agent must be paired with undici's own fetch: handing it to the
    // built-in fetch fails its dispatcher handler validation.
    const dispatcher = new Agent({
      connections: config.ollamaMaxConnections,
      keepAliveTimeout: 30_000,
      keepAliveMaxTimeout: 30_000,
    });
    ollamaDispatcher = dispatcher;
    const transportDispatcher = config.ollamaApiKey
      ? dispatcher.compose((dispatch) => (options, handler) => {
        // Fetch dispatches redirects separately. Apply the configured transport
        // policy before each destination receives any request content.
        assertOllamaTransport(String(options.origin), config.ollamaApiKey);
        return dispatch(options, handler);
      })
      : dispatcher;
    ollamaClient = new Ollama({
      host: config.ollamaUrl,
      headers: config.ollamaApiKey ? { Authorization: `Bearer ${config.ollamaApiKey}` } : undefined,
      // undici's Response type predates the global one (no .bytes()), so the
      // wrapper cannot satisfy `typeof fetch` structurally; the runtime shape
      // is what the ollama client consumes and matches.
      fetch: (async (input: Parameters<typeof undiciFetch>[0], init?: Parameters<typeof undiciFetch>[1]) => {
        try {
          const response = await undiciFetch(input, { ...init, dispatcher: transportDispatcher });
          if (config.ollamaApiKey && isAuthChallenge(response.status)) {
            await response.body?.cancel();
            const reason = response.status === 401 ? "Unauthorized" : "Forbidden";
            throw new OllamaTransportError(`Ollama authentication failed (HTTP ${response.status} ${reason}). Check OLLAMA_API_KEY and server permissions.`);
          }
          return response;
        } catch (error) {
          // Preserve the actionable policy failure rather than Fetch's generic
          // "fetch failed" message. Other transport failures keep their cause.
          if (error instanceof TypeError && error.cause instanceof OllamaTransportError) throw error.cause;
          // Fetch includes the full URL when rejecting embedded credentials.
          if (error instanceof TypeError && parseOllamaUrl(config.ollamaUrl)?.username) {
            throw new TypeError("Ollama cannot use credentials embedded in the URL. Use OLLAMA_API_KEY instead.");
          }
          throw error;
        }
      }) as unknown as typeof fetch,
    });
    ollamaClientHost = config.ollamaUrl;
    ollamaClientConnections = config.ollamaMaxConnections;
    ollamaClientApiKey = config.ollamaApiKey;
  }
  return ollamaClient;
}

/** Drop the cached client and drain its connection pool. */
export function resetOllamaClient(): void {
  const previous = ollamaDispatcher;
  ollamaClient = null;
  ollamaClientHost = null;
  ollamaClientConnections = null;
  ollamaClientApiKey = undefined;
  ollamaDispatcher = null;
  if (previous) {
    previous.close().catch((err: unknown) => {
      logger.debug("Closing Ollama dispatcher failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }
}

// ── Availability checks ─────────────────────────────────────────────────

/** Check if Ollama is reachable */
export async function isOllamaAvailable(): Promise<boolean> {
  try {
    const client = getClient();
    await client.list();
    return true;
  } catch (error) {
    if (error instanceof OllamaTransportError) throw error;
    return false;
  }
}

/** Check if the embedding model is already pulled */
export async function isModelAvailable(): Promise<boolean> {
  try {
    const config = getEmbeddingConfig();
    const client = getClient();
    const models = await client.list();
    return models.models.some(
      (m) => m.name === config.embeddingModel || m.name.startsWith(`${config.embeddingModel}:`),
    );
  } catch (error) {
    if (error instanceof OllamaTransportError) throw error;
    return false;
  }
}

/** Pull the embedding model */
export async function pullModel(): Promise<void> {
  const config = getEmbeddingConfig();
  logger.info("Pulling embedding model", { model: config.embeddingModel });
  const client = getClient();
  await client.pull({ model: config.embeddingModel });
}

// ── Pre-truncation ──────────────────────────────────────────────────────

/**
 * Conservative chars-per-token ratio for code.
 * Dense minified code ({, }, ;, :, =, . etc.) has close to 1 char per token.
 * Using 1.0 is the safe lower bound and ensures pretruncateTexts always fires
 * before reaching the model's context limit, complementing the MAX_CHUNK_CHARS
 * cap applied during chunking.
 */
const CHARS_PER_TOKEN_ESTIMATE = 1.0;

/** Timeout for pulling the embedding model (15 minutes) */
const MODEL_PULL_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Pre-truncate texts to stay within the model's context window.
 * Works around an Ollama bug where server-side truncation fails for
 * certain texts and hangs entirely for batched requests.
 * See: https://github.com/ollama/ollama/issues/12710
 */
function pretruncateTexts(texts: string[], contextLength: number): string[] {
  if (contextLength <= 0) return texts;
  const maxChars = Math.floor(contextLength * CHARS_PER_TOKEN_ESTIMATE);
  return texts.map((t) => (t.length > maxChars ? t.substring(0, maxChars) : t));
}

// ── Readiness cache ──────────────────────────────────────────────────────

const READINESS_TTL_MS = 60_000;
let ollamaReadyAt = 0;
let ollamaReadyIdentity: string | null = null;

/** Reset the cached readiness state */
export function resetOllamaReadinessCache(): void {
  ollamaReadyAt = 0;
  ollamaReadyIdentity = null;
}

// ── Auto-detection (OLLAMA_MODE=auto) ────────────────────────────────────

/** Whether the auto-detection probe has run yet */
let _autoDetected = false;
let _autoDetectedMode: "docker" | "external" | null = null;
let _autoDetectedUrl: string | null = null;

/**
 * Probe localhost:11434 to see if a native Ollama is already running.
 * Result is cached after the first check. Uses a 2s timeout to avoid
 * blocking startup on machines with no native Ollama.
 * Calls setResolvedOllamaMode() to update the config singleton in place.
 */
async function detectNativeOllama(): Promise<boolean> {
  if (_autoDetected && _autoDetectedMode && _autoDetectedUrl) {
    // Async-local effective profiles do not share mutable config objects. Apply
    // the cached probe result to the current operation as well as reusing it.
    setResolvedOllamaMode(_autoDetectedMode, _autoDetectedUrl);
    return _autoDetectedMode === "external";
  }
  _autoDetected = true;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2_000);
    const resp = await fetch("http://localhost:11434/api/tags", { signal: controller.signal });
    clearTimeout(timeoutId);
    // A protected native listener is present. Authenticate there through the guarded client.
    if (resp.ok || (getEmbeddingConfig().ollamaApiKey && isAuthChallenge(resp.status))) {
      _autoDetectedMode = "external";
      _autoDetectedUrl = "http://localhost:11434";
      logger.info("Auto-mode: native Ollama detected at http://localhost:11434 — using external mode (GPU-accelerated if available)");
      setResolvedOllamaMode(_autoDetectedMode, _autoDetectedUrl);
      return true;
    }
  } catch {
    // not reachable
  }
  _autoDetectedMode = "docker";
  _autoDetectedUrl = defaultOllamaUrl("docker", getEmbeddingConfig().ollamaApiKey);
  logger.info("Auto-mode: no native Ollama found — using managed Docker container");
  setResolvedOllamaMode(_autoDetectedMode, _autoDetectedUrl);
  return false;
}

/** Reset the auto-detection cache (for testing). */
export function resetAutoDetectionCache(): void {
  _autoDetected = false;
  _autoDetectedMode = null;
  _autoDetectedUrl = null;
}

// ── Provider class ──────────────────────────────────────────────────────

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly name = "ollama";
  private onProgress?: InfraProgressCallback;

  constructor(onProgress?: InfraProgressCallback) {
    this.onProgress = onProgress;
  }

  async ensureReady(): Promise<EmbeddingReadinessResult> {
    // Resolve auto-mode before anything else (probes localhost:11434, updates config in place)
    let config = getEmbeddingConfig();
    if (config.ollamaMode === "auto") {
      await detectNativeOllama();
      config = getEmbeddingConfig();
    }

    assertOllamaTransport(config.ollamaUrl, config.ollamaApiKey);
    const readinessIdentity = JSON.stringify({
      url: config.ollamaUrl,
      apiKey: config.ollamaApiKey,
      model: config.embeddingModel,
      dimensions: config.embeddingDimensions,
    });
    if (
      ollamaReadyIdentity === readinessIdentity &&
      Date.now() - ollamaReadyAt < READINESS_TTL_MS
    ) {
      return { modelPulled: false, containerStarted: false, imagePulled: false };
    }
    let modelPulled = false;
    let containerStarted = false;
    let imagePulled = false;

    if (config.ollamaMode === "docker") {
      const containerResult = await ensureOllamaContainerReady(this.onProgress);
      containerStarted = containerResult.started;
      imagePulled = containerResult.pulled;
    }

    if (!(await isOllamaAvailable())) {
      if (config.ollamaMode === "external") {
        throw new Error(
          `Ollama is not reachable at ${ollamaDisplayOrigin(config.ollamaUrl)}. ` +
          `Make sure Ollama is running (e.g. "ollama serve") or check OLLAMA_URL in your MCP config.`,
        );
      } else {
        throw new Error(
          "Ollama container is running but not responding. Check Docker logs: docker logs socraticode-ollama",
        );
      }
    }

    if (!(await isModelAvailable())) {
      this.onProgress?.(`Downloading embedding model '${config.embeddingModel}' (first time only, may take a few minutes)...`);
      await this.pullModelWithTimeout(config.embeddingModel);
      modelPulled = true;
    }

    ollamaReadyAt = Date.now();
    ollamaReadyIdentity = readinessIdentity;
    return { modelPulled, containerStarted, imagePulled };
  }

  /** Pull the embedding model with a timeout to prevent infinite hangs */
  private async pullModelWithTimeout(model: string): Promise<void> {
    logger.info("Pulling embedding model", { model });
    const client = getClient();

    const pullPromise = client.pull({ model });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error(
          `Embedding model download timed out after ${MODEL_PULL_TIMEOUT_MS / 60_000} minutes. ` +
          `The model '${model}' may be too large or the network is slow. Try again.`,
        )),
        MODEL_PULL_TIMEOUT_MS,
      );
    });

    try {
      await Promise.race([pullPromise, timeoutPromise]);
      logger.info("Embedding model pulled successfully", { model });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("timed out")) throw error;
      throw new Error(
        `Failed to download embedding model '${model}'. ` +
        `Check that the model name is correct and Ollama is responsive.\nDetails: ${msg}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    const config = getEmbeddingConfig();
    const client = getClient();
    // Fall back to a conservative 2048-token window for models not in the
    // known-models table (guessContextLength returns 0 for unknown models,
    // which would disable pretruncateTexts and risk "input length exceeds
    // context length" errors from Ollama).
    const contextLength = config.embeddingContextLength > 0 ? config.embeddingContextLength : 2048;
    const truncated = pretruncateTexts(texts, contextLength);
    const response = await client.embed({ model: config.embeddingModel, input: truncated, truncate: true });
    return response.embeddings;
  }

  async embedSingle(text: string): Promise<number[]> {
    const results = await this.embed([text]);
    return results[0];
  }

  async healthCheck(): Promise<EmbeddingHealthStatus> {
    // Resolve auto-mode first if not yet done
    const rawConfig = getEmbeddingConfig();
    if (rawConfig.ollamaMode === "auto") {
      await detectNativeOllama();
    }
    const config = getEmbeddingConfig();
    assertOllamaTransport(config.ollamaUrl, config.ollamaApiKey);
    const lines: string[] = [];
    const icon = (ok: boolean) => (ok ? "[OK]" : "[MISSING]");

    if (config.ollamaMode === "docker") {
      const docker = await isDockerAvailable();
      lines.push(`${icon(docker)} Docker: ${docker ? "Running" : "Not found — install from https://docker.com"}`);

      if (docker) {
        const [_qdrantRunning, ollamaRunning, ollamaImage] = await Promise.all([
          isQdrantRunning(),
          isOllamaRunning(),
          isOllamaImagePresent(),
        ]);
        lines.push(`${icon(ollamaImage)} Ollama image: ${ollamaImage ? "Pulled" : "Not pulled — will be pulled on first index"}`);
        lines.push(`${icon(ollamaRunning)} Ollama container: ${ollamaRunning ? "Running" : "Not running — will be started on first index"}`);

        const ollamaReachable = ollamaRunning ? await isOllamaAvailable() : false;
        const modelReady = ollamaReachable ? await isModelAvailable() : false;
        lines.push(`${icon(modelReady)} Embedding model (${config.embeddingModel}): ${modelReady ? "Available" : "Not pulled — will be pulled on first index"}`);

        return { available: ollamaReachable, modelReady, statusLines: lines };
      }

      return { available: false, modelReady: false, statusLines: lines };
    }

    // External mode
    const available = await isOllamaAvailable();
    lines.push(`${icon(available)} Ollama (external): ${available ? "Reachable" : "Not reachable"} at ${ollamaDisplayOrigin(config.ollamaUrl)}`);

    const modelReady = available ? await isModelAvailable() : false;
    lines.push(`${icon(modelReady)} Embedding model (${config.embeddingModel}): ${modelReady ? "Available" : "Not available — will be pulled on first index"}`);

    return { available, modelReady, statusLines: lines };
  }
}
