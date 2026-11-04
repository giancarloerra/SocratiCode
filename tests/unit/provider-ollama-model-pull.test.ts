// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEmbeddingConfig } from "../../src/services/embedding-config.js";
import { OllamaEmbeddingProvider, resetOllamaClient, resetOllamaReadinessCache } from "../../src/services/provider-ollama.js";

const sdk = vi.hoisted(() => ({ list: vi.fn(), pull: vi.fn() }));
vi.mock("ollama", () => ({
  Ollama: class {
    list = sdk.list;
    pull = sdk.pull;
  },
}));

describe("Ollama model-download deadline", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.stubEnv("EMBEDDING_PROVIDER", "ollama");
    vi.stubEnv("EMBEDDING_MODEL", "nomic-embed-text");
    vi.stubEnv("OLLAMA_MODE", "external");
    vi.stubEnv("OLLAMA_URL", "http://127.0.0.1:11434");
    vi.stubEnv("OLLAMA_API_KEY", "");
    resetEmbeddingConfig();
    resetOllamaClient();
    resetOllamaReadinessCache();
    sdk.list.mockReset().mockResolvedValue({ models: [] });
    sdk.pull.mockReset().mockResolvedValue({ status: "success" });
  });

  afterEach(() => {
    resetOllamaClient();
    resetOllamaReadinessCache();
    resetEmbeddingConfig();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("releases the deadline when the model download succeeds", async () => {
    await expect(new OllamaEmbeddingProvider().ensureReady()).resolves.toMatchObject({ modelPulled: true });
    expect(sdk.pull).toHaveBeenCalledWith({ model: "nomic-embed-text" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases the deadline and preserves the underlying download failure", async () => {
    sdk.pull.mockRejectedValue(new Error("fixture registry rejected the model"));
    await expect(new OllamaEmbeddingProvider().ensureReady()).rejects.toThrow(
      /Failed to download embedding model.*fixture registry rejected the model/s,
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retains the full fifteen-minute deadline for an unfinished download", async () => {
    sdk.pull.mockImplementation(() => new Promise(() => {}));
    const readiness = new OllamaEmbeddingProvider().ensureReady();
    const rejection = expect(readiness).rejects.toThrow("Embedding model download timed out after 15 minutes");
    let settled = false;
    void readiness.then(() => { settled = true; }, () => { settled = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(sdk.pull).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000 - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await rejection;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not start a download deadline for an already available model", async () => {
    sdk.list.mockResolvedValue({ models: [{ name: "nomic-embed-text:latest" }] });
    await expect(new OllamaEmbeddingProvider().ensureReady()).resolves.toMatchObject({ modelPulled: false });
    expect(sdk.pull).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
