// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  OLLAMA_CONTAINER_NAME,
  OLLAMA_HOST,
  OLLAMA_IMAGE,
  OLLAMA_PORT,
  QDRANT_API_KEY,
  QDRANT_CONTAINER_NAME,
  QDRANT_GRPC_PORT,
  QDRANT_HOST,
  QDRANT_IMAGE,
  QDRANT_MODE,
  QDRANT_PORT,
  QDRANT_URL,
} from "../constants.js";
import { ollamaDisplayOrigin } from "./embedding-config.js";
import { logger } from "./logger.js";

const execFileAsync = promisify(execFile);

/** Callback for reporting infrastructure setup progress to the user */
export type InfraProgressCallback = (message: string) => void;

async function run(cmd: string, args: string[], timeoutMs = 120_000): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync(cmd, args, { timeout: timeoutMs });
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string; killed?: boolean };
    if (e.killed) {
      throw new Error(`Command timed out after ${timeoutMs / 1000}s: ${cmd} ${args.join(" ")}`);
    }
    throw new Error(`Command failed: ${cmd} ${args.join(" ")}\n${e.stderr || e.message}`);
  }
}

// ── Docker ────────────────────────────────────────────────────────────────

/** Check if Docker CLI is reachable */
export async function isDockerAvailable(): Promise<boolean> {
  try {
    await run("docker", ["info"]);
    return true;
  } catch {
    return false;
  }
}

// ── Qdrant ────────────────────────────────────────────────────────────────

/** Check if the Qdrant Docker image is pulled */
export async function isQdrantImagePresent(): Promise<boolean> {
  try {
    const { stdout } = await run("docker", ["images", "--format", "{{.Repository}}:{{.Tag}}", QDRANT_IMAGE]);
    return stdout.includes("qdrant/qdrant");
  } catch {
    return false;
  }
}

/** Pull the Qdrant Docker image (may take several minutes on first launch) */
export async function pullQdrantImage(onProgress?: InfraProgressCallback): Promise<void> {
  onProgress?.("Downloading Qdrant Docker image (first time only, may take a few minutes)...");
  logger.info("Pulling Qdrant Docker image", { image: QDRANT_IMAGE });
  try {
    await run("docker", ["pull", QDRANT_IMAGE], 10 * 60_000); // 10 minute timeout for image pull
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("timed out")) {
      throw new Error(
        `Qdrant image download timed out after 10 minutes. Check your network connection and try again.`,
      );
    }
    throw new Error(
      `Failed to download Qdrant image. Check your network connection and available disk space.\nDetails: ${msg}`,
    );
  }
}

/** Check if the Qdrant container is running */
export async function isQdrantRunning(): Promise<boolean> {
  try {
    const { stdout } = await run("docker", [
      "ps", "--filter", `name=${QDRANT_CONTAINER_NAME}`, "--format", "{{.Names}}",
    ]);
    return stdout.trim().includes(QDRANT_CONTAINER_NAME);
  } catch {
    return false;
  }
}

/** Check if the Qdrant container exists (even if stopped) */
async function doesQdrantContainerExist(): Promise<boolean> {
  try {
    const { stdout } = await run("docker", [
      "ps", "-a", "--filter", `name=${QDRANT_CONTAINER_NAME}`, "--format", "{{.Names}}",
    ]);
    return stdout.trim().includes(QDRANT_CONTAINER_NAME);
  } catch {
    return false;
  }
}

/** Start the Qdrant container, creating it if necessary */
export async function startQdrant(onProgress?: InfraProgressCallback): Promise<void> {
  if (await isQdrantRunning()) return;

  if (await doesQdrantContainerExist()) {
    onProgress?.("Starting existing Qdrant container...");
    logger.info("Starting existing Qdrant container");
    await run("docker", ["start", QDRANT_CONTAINER_NAME]);
    onProgress?.("Waiting for Qdrant to be ready...");
    await waitForService(`http://${QDRANT_HOST}:${QDRANT_PORT}/healthz`, "Qdrant");
    return;
  }

  onProgress?.("Creating and starting Qdrant container...");
  logger.info("Creating and starting Qdrant container", { port: QDRANT_PORT });
  try {
    await run("docker", [
      "run", "-d",
      "--name", QDRANT_CONTAINER_NAME,
      "-p", `${QDRANT_PORT}:6333`,
      "-p", `${QDRANT_GRPC_PORT}:6334`,
      "-v", "socraticode_qdrant_data:/qdrant/storage",
      "--restart", "unless-stopped",
      QDRANT_IMAGE,
    ]);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to start Qdrant container. Is port ${QDRANT_PORT} already in use?\nDetails: ${msg}`,
    );
  }

  onProgress?.("Waiting for Qdrant to be ready...");
  await waitForService(`http://${QDRANT_HOST}:${QDRANT_PORT}/healthz`, "Qdrant");
}

// ── Readiness cache ──────────────────────────────────────────────────────

const READINESS_TTL_MS = 60_000; // 60 seconds
let qdrantReadyAt = 0;

/** Reset the cached readiness state (e.g. after infra error or explicit restart) */
export function resetQdrantReadinessCache(): void {
  qdrantReadyAt = 0;
}

/** Ensure Qdrant is ready.
 * - managed mode: ensure Docker is available, image is pulled, container is running.
 * - external mode: validate config and health-check the remote endpoint.
 */
export async function ensureQdrantReady(onProgress?: InfraProgressCallback): Promise<{ started: boolean; pulled: boolean }> {
  // Fast path: recently verified as ready
  if (Date.now() - qdrantReadyAt < READINESS_TTL_MS) {
    return { started: false, pulled: false };
  }

  if (QDRANT_MODE === "external") {
    return ensureExternalQdrantReady(onProgress);
  }

  // ── managed mode: Docker-managed container ────────────────────────────
  let pulled = false;
  let started = false;

  if (!(await isDockerAvailable())) {
    throw new Error(
      "Docker is not available. Please install Docker Desktop (https://www.docker.com/products/docker-desktop/) and make sure it is running.",
    );
  }

  onProgress?.("Checking Qdrant vector database...");

  if (!(await isQdrantImagePresent())) {
    await pullQdrantImage(onProgress);
    pulled = true;
  }

  if (!(await isQdrantRunning())) {
    await startQdrant(onProgress);
    started = true;
  }

  qdrantReadyAt = Date.now();
  return { started, pulled };
}

/** Validate config and health-check an externally managed Qdrant instance. */
async function ensureExternalQdrantReady(onProgress?: InfraProgressCallback): Promise<{ started: boolean; pulled: boolean }> {
  // Require at least one of: QDRANT_URL or a non-default QDRANT_HOST
  if (!QDRANT_URL && QDRANT_HOST === "localhost") {
    throw new Error(
      "QDRANT_MODE=external requires QDRANT_URL (e.g. https://xyz.aws.cloud.qdrant.io:6333) " +
      "or QDRANT_HOST to be set to your remote Qdrant server's hostname.",
    );
  }

  const baseUrl = QDRANT_URL ? QDRANT_URL.replace(/\/$/, "") : `http://${QDRANT_HOST}:${QDRANT_PORT}`;
  const healthUrl = `${baseUrl}/healthz`;

  // If an api-key is configured, refuse to send it over a non-TLS connection.
  // Localhost loopback URLs are accepted because some users run authenticated
  // Qdrant locally during development. The URL is parsed (rather than checked
  // with startsWith) so that hostnames like "http://localhost.evil.com" are
  // not mistaken for loopback. Placed before the try/catch so the specific
  // error is not masked by the generic "Cannot reach" message below.
  if (QDRANT_API_KEY) {
    let parsed: URL | null = null;
    try {
      parsed = new URL(baseUrl);
    } catch {
      /* fall through: the unparseable URL will fail the reachability check */
    }
    const isHttps = parsed?.protocol === "https:";
    const isLoopback = parsed
      ? ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
      : false;
    if (parsed && !isHttps && !isLoopback) {
      throw new Error(
        `QDRANT_API_KEY is set but ${baseUrl} is not HTTPS. ` +
        "Refusing to send the API key over a non-TLS connection. " +
        "Use https://... for remote or cloud Qdrant (a localhost URL is also accepted for local development).",
      );
    }
  }

  onProgress?.(`Checking external Qdrant at ${baseUrl}...`);
  logger.info("Checking external Qdrant", { url: baseUrl });

  // Qdrant Cloud requires authentication on every endpoint, including /healthz
  // (returns 403 without an api-key header). Locally run Qdrant typically does
  // not, so the header is sent only when QDRANT_API_KEY is configured.
  const init: RequestInit | undefined = QDRANT_API_KEY
    ? { headers: { "api-key": QDRANT_API_KEY } }
    : undefined;

  try {
    // 5 retries × 1 s — fast fail for misconfiguration, brief grace for transient flakiness
    await waitForService(healthUrl, "Qdrant", 5, 1000, init);
  } catch {
    throw new Error(
      `Cannot reach external Qdrant at ${baseUrl}.\n` +
      "Verify that QDRANT_URL (or QDRANT_HOST/QDRANT_PORT) and QDRANT_API_KEY (if required) are correct and the server is reachable.",
    );
  }

  qdrantReadyAt = Date.now();
  return { started: false, pulled: false };
}

// ── Ollama ────────────────────────────────────────────────────────────────

/** Check if the Ollama Docker image is pulled */
export async function isOllamaImagePresent(): Promise<boolean> {
  try {
    const { stdout } = await run("docker", ["images", "--format", "{{.Repository}}:{{.Tag}}", OLLAMA_IMAGE]);
    return stdout.includes("ollama/ollama");
  } catch {
    return false;
  }
}

/** Pull the Ollama Docker image (may take several minutes on first launch) */
export async function pullOllamaImage(onProgress?: InfraProgressCallback): Promise<void> {
  onProgress?.("Downloading Ollama Docker image (first time only, may take a few minutes)...");
  logger.info("Pulling Ollama Docker image", { image: OLLAMA_IMAGE });
  try {
    await run("docker", ["pull", OLLAMA_IMAGE], 10 * 60_000); // 10 minute timeout for image pull
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("timed out")) {
      throw new Error(
        `Ollama image download timed out after 10 minutes. Check your network connection and try again.`,
      );
    }
    throw new Error(
      `Failed to download Ollama image. Check your network connection and available disk space.\nDetails: ${msg}`,
    );
  }
}

/** Check if the Ollama container is running */
export async function isOllamaRunning(): Promise<boolean> {
  try {
    const { stdout } = await run("docker", [
      "ps", "--filter", `name=${OLLAMA_CONTAINER_NAME}`, "--format", "{{.Names}}",
    ]);
    return stdout.trim().includes(OLLAMA_CONTAINER_NAME);
  } catch {
    return false;
  }
}

/** Check if the Ollama container exists (even if stopped) */
async function doesOllamaContainerExist(): Promise<boolean> {
  try {
    const { stdout } = await run("docker", [
      "ps", "-a", "--filter", `name=${OLLAMA_CONTAINER_NAME}`, "--format", "{{.Names}}",
    ]);
    return stdout.trim().includes(OLLAMA_CONTAINER_NAME);
  } catch {
    return false;
  }
}

/** Start the Ollama container, creating it if necessary */
export async function startOllama(onProgress?: InfraProgressCallback): Promise<void> {
  if (await isOllamaRunning()) return;

  if (await doesOllamaContainerExist()) {
    onProgress?.("Starting existing Ollama container...");
    logger.info("Starting existing Ollama container");
    await run("docker", ["start", OLLAMA_CONTAINER_NAME]);
    onProgress?.("Waiting for Ollama to be ready...");
    await waitForService(`${OLLAMA_HOST}/api/tags`, "Ollama");
    return;
  }

  onProgress?.("Creating and starting Ollama container...");
  logger.info("Creating and starting Ollama container", { port: OLLAMA_PORT });
  try {
    await run("docker", [
      "run", "-d",
      "--name", OLLAMA_CONTAINER_NAME,
      "-p", `${OLLAMA_PORT}:11434`,
      "-v", "socraticode_ollama_data:/root/.ollama",
      "--restart", "unless-stopped",
      OLLAMA_IMAGE,
    ]);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to start Ollama container. Is port ${OLLAMA_PORT} already in use?\nDetails: ${msg}`,
    );
  }

  onProgress?.("Waiting for Ollama to be ready...");
  await waitForService(`${OLLAMA_HOST}/api/tags`, "Ollama");
}

let ollamaContainerReadyAt = 0;

/** Reset the cached readiness state for Ollama container */
export function resetOllamaContainerReadinessCache(): void {
  ollamaContainerReadyAt = 0;
}

/** Ensure Docker is available, Ollama image is pulled, and Ollama container is running */
export async function ensureOllamaContainerReady(onProgress?: InfraProgressCallback): Promise<{ started: boolean; pulled: boolean }> {
  // Fast path: recently verified as ready
  if (Date.now() - ollamaContainerReadyAt < READINESS_TTL_MS) {
    return { started: false, pulled: false };
  }

  let pulled = false;
  let started = false;

  if (!(await isDockerAvailable())) {
    throw new Error(
      "Docker is not available. Please install Docker Desktop (https://www.docker.com/products/docker-desktop/) and make sure it is running.",
    );
  }

  onProgress?.("Checking Ollama embedding service...");

  if (!(await isOllamaImagePresent())) {
    await pullOllamaImage(onProgress);
    pulled = true;
  }

  if (!(await isOllamaRunning())) {
    await startOllama(onProgress);
    started = true;
  }

  ollamaContainerReadyAt = Date.now();
  return { started, pulled };
}

// ── Shared ────────────────────────────────────────────────────────────────

/** Wait for an HTTP service to respond with 200.
 *
 * `init` is forwarded to fetch(), allowing callers to attach headers (e.g. an
 * `api-key` header for Qdrant Cloud, whose /healthz endpoint requires auth).
 */
async function waitForService(url: string, serviceName: string, retries = 30, delayMs = 1000, init?: RequestInit): Promise<void> {
  logger.info(`Waiting for ${serviceName} to be ready`, { url: serviceName === "Ollama" ? ollamaDisplayOrigin(url) : url });
  for (let i = 0; i < retries; i++) {
    try {
      const resp = await fetch(url, init);
      if (resp.ok) {
        logger.info(`${serviceName} is ready`);
        return;
      }
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`${serviceName} did not become ready in time (${retries * delayMs / 1000}s)`);
}
