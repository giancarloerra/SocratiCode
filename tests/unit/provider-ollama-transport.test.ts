// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as docker from "../../src/services/docker.js";
import { resetEmbeddingConfig } from "../../src/services/embedding-config.js";
import { OllamaEmbeddingProvider, resetAutoDetectionCache, resetOllamaClient, resetOllamaReadinessCache } from "../../src/services/provider-ollama.js";

const sdk = vi.hoisted(() => ({ constructed: vi.fn() }));
vi.mock("../../src/constants.js", async (original) => ({
  ...await original<typeof import("../../src/constants.js")>(), OLLAMA_PORT: 15678,
}));
vi.mock("ollama", () => ({
  Ollama: class {
    constructor(options: unknown) {
      sdk.constructed(options);
    }
    async embed() {
      return { embeddings: [[0.1, 0.2]] };
    }
    async list() {
      return { models: [{ name: "nomic-embed-text:latest" }] };
    }
  },
}));

describe("Ollama API-key transport", () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    process.env.EMBEDDING_PROVIDER = "ollama";
    process.env.EMBEDDING_MODEL = "nomic-embed-text";
    process.env.OLLAMA_MODE = "external";
    process.env.OLLAMA_API_KEY = "fixture-transport-key";
    resetEmbeddingConfig();
    resetOllamaClient();
    resetOllamaReadinessCache();
    sdk.constructed.mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetAutoDetectionCache();
    resetOllamaClient();
    resetOllamaReadinessCache();
    resetEmbeddingConfig();
    process.env = { ...originalEnv };
  });

  it.each(["ensureReady", "healthCheck"] as const)("uses the configured keyed server during %s in default auto mode", async (method) => {
    delete process.env.OLLAMA_MODE;
    process.env.OLLAMA_URL = "https://ollama.example:11434";
    process.env.OLLAMA_HOST = "https://alternate.example:11434";
    const discover = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", discover);

    await new OllamaEmbeddingProvider()[method]();

    expect(sdk.constructed).toHaveBeenCalledWith(expect.objectContaining({
      host: "https://ollama.example:11434",
      headers: { Authorization: "Bearer fixture-transport-key" },
    }));
    expect(discover).not.toHaveBeenCalled();
  });

  it.each(["auto", "external"])("uses the keyed OLLAMA_HOST when OLLAMA_URL is absent in %s mode", async (mode) => {
    process.env.OLLAMA_MODE = mode;
    delete process.env.OLLAMA_URL;
    process.env.OLLAMA_HOST = "https://alternate.example:11434";
    const discover = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", discover);

    await new OllamaEmbeddingProvider().healthCheck();

    expect(sdk.constructed).toHaveBeenCalledWith(expect.objectContaining({
      host: "https://alternate.example:11434",
      headers: { Authorization: "Bearer fixture-transport-key" },
    }));
    expect(discover).not.toHaveBeenCalled();
  });

  it.each(["OLLAMA_URL", "OLLAMA_HOST"])("still discovers native Ollama in auto mode with %s and no key", async (setting) => {
    delete process.env.OLLAMA_MODE;
    delete process.env.OLLAMA_API_KEY;
    delete process.env.OLLAMA_URL;
    delete process.env.OLLAMA_HOST;
    process.env[setting] = "https://ollama.example:11434";
    const discover = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", discover);

    await new OllamaEmbeddingProvider().healthCheck();

    expect(discover).toHaveBeenCalledWith("http://localhost:11434/api/tags", expect.anything());
    expect(sdk.constructed).toHaveBeenCalledWith(expect.objectContaining({
      host: "http://localhost:11434", headers: undefined,
    }));
  });

  it.each([401, 403])("keeps a keyed native server on port 11434 after a %i challenge", async (status) => {
    delete process.env.OLLAMA_MODE;
    delete process.env.OLLAMA_URL;
    delete process.env.OLLAMA_HOST;
    const discover = vi.fn().mockResolvedValue({ ok: false, status });
    vi.stubGlobal("fetch", discover);
    const dockerCheck = vi.spyOn(docker, "isDockerAvailable").mockResolvedValue(false);
    try {
      const provider = new OllamaEmbeddingProvider();
      await provider.healthCheck();
      await provider.embed(["protected native server"]);
      expect(discover.mock.calls[0][1].headers).toBeUndefined();
      expect(dockerCheck).not.toHaveBeenCalled();
      expect(sdk.constructed).toHaveBeenCalledWith(expect.objectContaining({
        host: "http://localhost:11434", headers: { Authorization: "Bearer fixture-transport-key" },
      }));
    } finally {
      dockerCheck.mockRestore();
    }
  });

  it.each(["docker", "auto"])("sends managed Ollama credentials to the configured container port in %s mode", async (mode) => {
    process.env.OLLAMA_MODE = mode;
    delete process.env.OLLAMA_URL;
    delete process.env.OLLAMA_HOST;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const available = vi.spyOn(docker, "isDockerAvailable").mockResolvedValue(false);
    try {
      const provider = new OllamaEmbeddingProvider();
      await provider.healthCheck();
      await provider.embed(["transport fixture"]);
      expect(sdk.constructed).toHaveBeenCalledWith(expect.objectContaining({
        host: "http://localhost:15678", headers: { Authorization: "Bearer fixture-transport-key" },
      }));
    } finally {
      available.mockRestore();
    }
  });

  it.each([
    "https://ollama.example:11434",
    "https://192.0.2.10:11434",
    "http://localhost:11434",
    "http://localhost.:11434",
    "http://127.0.0.1:11434",
    "http://127.12.34.56:11434",
    "http://[::1]:11434",
    "http://[::ffff:127.0.0.1]:11434",
    "http://2130706433:11434",
    "localhost:11434",
    "[::1]:11434",
    ":11434",
  ])("preserves HTTPS and loopback support for %s", async (url) => {
    process.env.OLLAMA_URL = url;
    await expect(new OllamaEmbeddingProvider().embed(["transport fixture"])).resolves.toEqual([[0.1, 0.2]]);
    expect(sdk.constructed).toHaveBeenCalledWith(expect.objectContaining({
      host: url,
      headers: { Authorization: "Bearer fixture-transport-key" },
    }));
  });

  it.each([
    "http://192.0.2.10:11434",
    "192.0.2.10:11434",
    "http://gpu-server.example:11434",
    "http://localhost.evil.example:11434",
    "http://127.0.0.1.example:11434",
    "http://[2001:db8::1]:11434",
    "http://[::ffff:192.0.2.10]:11434",
    "ftp://localhost:11434",
  ])("rejects insecure keyed endpoints before constructing a client: %s", async (url) => {
    process.env.OLLAMA_URL = url;
    await expect(new OllamaEmbeddingProvider().embed(["transport fixture"])).rejects.toThrow(/OLLAMA_API_KEY.*HTTPS/);
    expect(sdk.constructed).not.toHaveBeenCalled();
  });

  it.each(["ensureReady", "healthCheck"] as const)("preserves the transport error from %s", async (method) => {
    process.env.OLLAMA_URL = "http://192.0.2.10:11434";
    await expect(new OllamaEmbeddingProvider()[method]()).rejects.toThrow(/OLLAMA_API_KEY.*HTTPS/);
    expect(sdk.constructed).not.toHaveBeenCalled();
  });

  it("preserves remote HTTP when no key is configured", async () => {
    process.env.OLLAMA_URL = "http://192.0.2.10:11434";
    delete process.env.OLLAMA_API_KEY;
    await expect(new OllamaEmbeddingProvider().embed(["transport fixture"])).resolves.toEqual([[0.1, 0.2]]);
    expect(sdk.constructed).toHaveBeenCalledWith(expect.objectContaining({ headers: undefined }));
  });

  it("reports malformed keyed URLs without including the key or URL", async () => {
    process.env.OLLAMA_URL = "http://[";
    await expect(new OllamaEmbeddingProvider().embed(["transport fixture"])).rejects.toThrow("Invalid OLLAMA_URL");
    expect(sdk.constructed).not.toHaveBeenCalled();
  });
});
