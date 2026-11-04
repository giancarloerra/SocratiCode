// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Module mocks (hoisted — evaluated before imports) ────────────────────

// Make promisify a passthrough so execFileAsync === execFile (the mock below).
// This lets us control all child-process calls with a single vi.fn().
vi.mock("node:util", () => ({
  promisify: vi.fn(<T>(fn: T): T => fn),
}));

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("../../src/services/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Imports (after mocks are registered) ─────────────────────────────────

import { execFile } from "node:child_process";
import {
  ensureOllamaContainerReady,
  ensureQdrantReady,
  isDockerAvailable,
  isOllamaImagePresent,
  isOllamaRunning,
  isQdrantImagePresent,
  isQdrantRunning,
  pullOllamaImage,
  pullQdrantImage,
  resetOllamaContainerReadinessCache,
  resetQdrantReadinessCache,
  startQdrant,
} from "../../src/services/docker.js";

const mockExecFile = vi.mocked(execFile as unknown as (
  cmd: string,
  args: string[],
  opts: object
) => Promise<{ stdout: string; stderr: string }>);

// Shorthand: resolve with empty stdout/stderr (simulates a successful command)
const resolveOk = (stdout = "") =>
  mockExecFile.mockResolvedValueOnce({ stdout, stderr: "" });

// Shorthand: reject simulating a timed-out command
const rejectTimeout = () =>
  mockExecFile.mockRejectedValueOnce(
    Object.assign(new Error("timeout"), { killed: true }),
  );

// Shorthand: reject simulating a failed command with stderr
const rejectFailed = (stderr = "some docker error") =>
  mockExecFile.mockRejectedValueOnce(
    Object.assign(new Error("exit 1"), { stderr }),
  );

// ── isDockerAvailable ─────────────────────────────────────────────────────

describe("isDockerAvailable", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns true when docker info succeeds", async () => {
    resolveOk();
    expect(await isDockerAvailable()).toBe(true);
  });

  it("returns false when docker info fails", async () => {
    rejectFailed("Cannot connect to the Docker daemon");
    expect(await isDockerAvailable()).toBe(false);
  });
});

// ── isQdrantImagePresent ──────────────────────────────────────────────────

describe("isQdrantImagePresent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns true when docker images output contains qdrant/qdrant", async () => {
    resolveOk("qdrant/qdrant:v1.17.0\n");
    expect(await isQdrantImagePresent()).toBe(true);
  });

  it("returns false when docker images output does not contain qdrant/qdrant", async () => {
    resolveOk("ollama/ollama:latest\n");
    expect(await isQdrantImagePresent()).toBe(false);
  });

  it("returns false when docker command fails", async () => {
    rejectFailed();
    expect(await isQdrantImagePresent()).toBe(false);
  });
});

// ── isQdrantRunning ───────────────────────────────────────────────────────

describe("isQdrantRunning", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns true when docker ps output contains the container name", async () => {
    resolveOk("socraticode-qdrant\n");
    expect(await isQdrantRunning()).toBe(true);
  });

  it("returns false when container is not in docker ps output", async () => {
    resolveOk("some-other-container\n");
    expect(await isQdrantRunning()).toBe(false);
  });

  it("returns false when docker command fails", async () => {
    rejectFailed();
    expect(await isQdrantRunning()).toBe(false);
  });
});

// ── isOllamaImagePresent ──────────────────────────────────────────────────

describe("isOllamaImagePresent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns true when docker images output contains ollama/ollama", async () => {
    resolveOk("ollama/ollama:latest\n");
    expect(await isOllamaImagePresent()).toBe(true);
  });

  it("returns false when docker images output does not contain ollama/ollama", async () => {
    resolveOk("qdrant/qdrant:v1.17.0\n");
    expect(await isOllamaImagePresent()).toBe(false);
  });

  it("returns false when docker command fails", async () => {
    rejectFailed();
    expect(await isOllamaImagePresent()).toBe(false);
  });
});

// ── isOllamaRunning ───────────────────────────────────────────────────────

describe("isOllamaRunning", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns true when docker ps output contains the container name", async () => {
    resolveOk("socraticode-ollama\n");
    expect(await isOllamaRunning()).toBe(true);
  });

  it("returns false when container is not in docker ps output", async () => {
    resolveOk("other-container\n");
    expect(await isOllamaRunning()).toBe(false);
  });

  it("returns false when docker command fails", async () => {
    rejectFailed();
    expect(await isOllamaRunning()).toBe(false);
  });
});

// ── pullQdrantImage error paths ───────────────────────────────────────────

describe("pullQdrantImage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws a user-friendly timeout message when docker pull is killed", async () => {
    rejectTimeout();
    await expect(pullQdrantImage()).rejects.toThrow(
      "Qdrant image download timed out after 10 minutes",
    );
  });

  it("throws a user-friendly network error message on generic failure", async () => {
    rejectFailed("Network unreachable");
    await expect(pullQdrantImage()).rejects.toThrow(
      "Failed to download Qdrant image",
    );
  });

  it("calls onProgress callback before pulling", async () => {
    resolveOk();
    const progress: string[] = [];
    await pullQdrantImage((msg) => progress.push(msg));
    expect(progress[0]).toMatch(/Downloading Qdrant Docker image/);
  });
});

// ── pullOllamaImage error paths ───────────────────────────────────────────

describe("pullOllamaImage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws a user-friendly timeout message when docker pull is killed", async () => {
    rejectTimeout();
    await expect(pullOllamaImage()).rejects.toThrow(
      "Ollama image download timed out after 10 minutes",
    );
  });

  it("throws a user-friendly network error message on generic failure", async () => {
    rejectFailed("Network unreachable");
    await expect(pullOllamaImage()).rejects.toThrow(
      "Failed to download Ollama image",
    );
  });

  it("calls onProgress callback before pulling", async () => {
    resolveOk();
    const progress: string[] = [];
    await pullOllamaImage((msg) => progress.push(msg));
    expect(progress[0]).toMatch(/Downloading Ollama Docker image/);
  });
});

// ── startQdrant error paths ───────────────────────────────────────────────

describe("startQdrant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws a port-conflict message when docker run fails", async () => {
    // isQdrantRunning → false (ps returns empty)
    resolveOk("");
    // doesQdrantContainerExist → false (ps -a returns empty)
    resolveOk("");
    // docker run → fails
    rejectFailed("port is already allocated");

    await expect(startQdrant()).rejects.toThrow(
      "Failed to start Qdrant container",
    );
  });

  it("skips creation and returns when Qdrant is already running", async () => {
    // isQdrantRunning returns true
    resolveOk("socraticode-qdrant");
    // No further docker calls should be needed
    await startQdrant();
    // execFile called exactly once (for isQdrantRunning)
    expect(mockExecFile).toHaveBeenCalledTimes(1);
  });
});

it("keeps the configured Ollama readiness path out of Docker logs", async () => {
  const host = "http://127.0.0.1:11435/private-proxy-path";
  vi.resetModules();
  vi.doMock("../../src/constants.js", async (original) => ({
    ...await original<typeof import("../../src/constants.js")>(), OLLAMA_HOST: host,
  }));
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
  try {
    const { startOllama } = await import("../../src/services/docker.js");
    const { logger } = await import("../../src/services/logger.js");
    resolveOk(); // stopped
    resolveOk("socraticode-ollama"); // existing container
    resolveOk(); // docker start
    await startOllama();
    expect(fetch).toHaveBeenCalledWith(`${host}/api/tags`, undefined);
    expect(logger.info).toHaveBeenCalledWith("Waiting for Ollama to be ready", { url: "http://127.0.0.1:11435" });
  } finally {
    fetch.mockRestore();
    vi.doUnmock("../../src/constants.js");
    vi.resetModules();
  }
});

// ── ensureQdrantReady (managed mode) — readiness cache ───────────────────

describe("ensureQdrantReady managed mode cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetQdrantReadinessCache();
  });

  it("fast-paths on the second call without invoking docker", async () => {
    // First call: docker info + images + ps all succeed; skip actual start by
    // reporting image present and container already running.
    resolveOk(); // docker info → available
    resolveOk("qdrant/qdrant:v1.17.0"); // images → present
    resolveOk("socraticode-qdrant"); // ps → running

    const first = await ensureQdrantReady();
    expect(first).toMatchObject({ started: false, pulled: false });

    const callsAfterFirst = mockExecFile.mock.calls.length;

    // Second call should be served from cache — no new docker calls
    const second = await ensureQdrantReady();
    expect(second).toMatchObject({ started: false, pulled: false });
    expect(mockExecFile).toHaveBeenCalledTimes(callsAfterFirst);
  });

  it("throws when Docker is not available in managed mode", async () => {
    rejectFailed("Cannot connect to daemon"); // docker info fails
    await expect(ensureQdrantReady()).rejects.toThrow("Docker is not available");
  });
});

// ── resetOllamaContainerReadinessCache ────────────────────────────────────

describe("resetOllamaContainerReadinessCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetOllamaContainerReadinessCache();
  });

  it("forces a re-check after reset", async () => {
    // Prime the cache: docker info + images + ps all succeed
    resolveOk(); // docker info
    resolveOk("ollama/ollama:latest"); // images
    resolveOk("socraticode-ollama"); // ps

    const first = await ensureOllamaContainerReady();
    expect(first).toMatchObject({ started: false, pulled: false });

    const callsAfterFirst = mockExecFile.mock.calls.length;

    // Reset: next call must re-check
    resetOllamaContainerReadinessCache();
    resolveOk(); // docker info again
    resolveOk("ollama/ollama:latest"); // images again
    resolveOk("socraticode-ollama"); // ps again

    await ensureOllamaContainerReady();
    expect(mockExecFile.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });
});

// ── ensureQdrantReady (external mode) ────────────────────────────────────
// These tests use vi.resetModules() + vi.doMock() to reload docker.ts with
// QDRANT_MODE=external and controlled constants.  They must run in isolation.

describe("ensureQdrantReady external mode", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  async function loadDockerWithExternalMode(overrides: Record<string, unknown> = {}) {
    // Reset module cache so docker.ts re-imports the mocked constants below
    vi.resetModules();
    vi.doMock("../../src/constants.js", async (importOriginal) => {
      const original = await importOriginal<Record<string, unknown>>();
      return {
        ...original,
        QDRANT_MODE: "external",
        QDRANT_URL: "",
        QDRANT_HOST: "localhost",
        QDRANT_PORT: 16333,
        ...overrides,
      };
    });
    vi.doMock("../../src/services/logger.js", () => ({
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    }));
    vi.doMock("node:child_process", () => ({ execFile: vi.fn() }));
    vi.doMock("node:util", () => ({ promisify: <T>(fn: T): T => fn }));

    const docker = await import("../../src/services/docker.js");
    docker.resetQdrantReadinessCache();
    return docker;
  }

  it("throws when QDRANT_URL is not set and QDRANT_HOST is localhost", async () => {
    const docker = await loadDockerWithExternalMode();
    await expect(docker.ensureQdrantReady()).rejects.toThrow(
      "QDRANT_MODE=external requires QDRANT_URL",
    );
  });

  it("returns { started: false, pulled: false } when external Qdrant is reachable", async () => {
    const docker = await loadDockerWithExternalMode({
      QDRANT_URL: "http://remote-qdrant:6333",
      QDRANT_HOST: "remote-qdrant",
    });

    // Mock fetch so the health check immediately succeeds
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({ ok: true } as Response);

    const result = await docker.ensureQdrantReady();
    expect(result).toEqual({ started: false, pulled: false });

    fetchSpy.mockRestore();
  });

  it("throws 'Cannot reach external Qdrant' when health check fails", async () => {
    const docker = await loadDockerWithExternalMode({
      QDRANT_URL: "http://unreachable-qdrant:6333",
      QDRANT_HOST: "unreachable-qdrant",
    });

    // Mock fetch to always fail (simulates unreachable server)
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(docker.ensureQdrantReady()).rejects.toThrow(
      "Cannot reach external Qdrant",
    );

    fetchSpy.mockRestore();
  }, 30_000); // allow up to 30s for the retry loop (5 retries × 1s)

  it("throws 'Cannot reach external Qdrant' when health endpoint returns non-ok", async () => {
    const docker = await loadDockerWithExternalMode({
      QDRANT_URL: "http://bad-qdrant:6333",
      QDRANT_HOST: "bad-qdrant",
    });

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({ ok: false, status: 503 } as Response);

    await expect(docker.ensureQdrantReady()).rejects.toThrow(
      "Cannot reach external Qdrant",
    );

    fetchSpy.mockRestore();
  }, 30_000);

  it("sends api-key header to /healthz when QDRANT_API_KEY is configured", async () => {
    const docker = await loadDockerWithExternalMode({
      QDRANT_URL: "https://cloud-qdrant.example:6333",
      QDRANT_HOST: "cloud-qdrant.example",
      QDRANT_API_KEY: "secret-key-xyz",
    });

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({ ok: true } as Response);

    const result = await docker.ensureQdrantReady();
    expect(result).toEqual({ started: false, pulled: false });

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://cloud-qdrant.example:6333/healthz",
      expect.objectContaining({
        headers: expect.objectContaining({ "api-key": "secret-key-xyz" }),
      }),
    );

    fetchSpy.mockRestore();
  });

  it("omits api-key header when QDRANT_API_KEY is not set", async () => {
    const docker = await loadDockerWithExternalMode({
      QDRANT_URL: "http://local-qdrant:6333",
      QDRANT_HOST: "local-qdrant",
      // Explicitly undefined so the test does not pick up a real
      // QDRANT_API_KEY from the developer's shell environment.
      QDRANT_API_KEY: undefined,
    });

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({ ok: true } as Response);

    await docker.ensureQdrantReady();

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://local-qdrant:6333/healthz",
      undefined,
    );

    fetchSpy.mockRestore();
  });

  it("rejects QDRANT_API_KEY over plain HTTP for non-loopback hosts", async () => {
    const docker = await loadDockerWithExternalMode({
      QDRANT_URL: "http://remote-qdrant.example:6333",
      QDRANT_HOST: "remote-qdrant.example",
      QDRANT_API_KEY: "secret-key-xyz",
    });

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({ ok: true } as Response);

    await expect(docker.ensureQdrantReady()).rejects.toThrow(
      /QDRANT_API_KEY is set but .* is not HTTPS/,
    );
    // The guard runs before the readiness probe, so fetch is never called.
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  it("allows QDRANT_API_KEY over plain HTTP when host is localhost (local dev)", async () => {
    const docker = await loadDockerWithExternalMode({
      QDRANT_URL: "http://localhost:6333",
      QDRANT_HOST: "localhost",
      QDRANT_API_KEY: "secret-key-xyz",
    });

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({ ok: true } as Response);

    await expect(docker.ensureQdrantReady()).resolves.toEqual({
      started: false,
      pulled: false,
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:6333/healthz",
      expect.objectContaining({
        headers: expect.objectContaining({ "api-key": "secret-key-xyz" }),
      }),
    );

    fetchSpy.mockRestore();
  });
});
