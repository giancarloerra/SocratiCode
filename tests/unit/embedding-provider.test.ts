// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited
import { afterEach, beforeEach, describe, expect, it, } from "vitest";
import { resetEmbeddingConfig } from "../../src/services/embedding-config.js";
import { getEmbeddingProvider, resetEmbeddingProvider } from "../../src/services/embedding-provider.js";

describe("embedding-provider", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetEmbeddingConfig();
    resetEmbeddingProvider();
    delete process.env.EMBEDDING_PROVIDER;
    delete process.env.OLLAMA_MODE;
    delete process.env.OLLAMA_URL;
    delete process.env.EMBEDDING_MODEL;
    delete process.env.EMBEDDING_DIMENSIONS;
    delete process.env.EMBEDDING_CONTEXT_LENGTH;
    delete process.env.OLLAMA_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.LMSTUDIO_URL;
    delete process.env.LMSTUDIO_API_KEY;
    delete process.env.LITELLM_URL;
    delete process.env.LITELLM_API_KEY;
    delete process.env.LITELLM_SEND_DIMENSIONS;
  });

  afterEach(() => {
    resetEmbeddingConfig();
    resetEmbeddingProvider();
    process.env = { ...originalEnv };
  });

  describe("factory", () => {
    it("defaults to TextEmbedderEmbeddingProvider", async () => {
      const provider = await getEmbeddingProvider();
      expect(provider.name).toBe("textembedder");
    });

    it("creates OllamaEmbeddingProvider when configured", async () => {
      process.env.EMBEDDING_PROVIDER = "ollama";
      const provider = await getEmbeddingProvider();
      expect(provider.name).toBe("ollama");
    });

    it("creates OpenAIEmbeddingProvider when configured", async () => {
      process.env.EMBEDDING_PROVIDER = "openai";
      const provider = await getEmbeddingProvider();
      expect(provider.name).toBe("openai");
    });

    it("creates GoogleEmbeddingProvider when configured", async () => {
      process.env.EMBEDDING_PROVIDER = "google";
      const provider = await getEmbeddingProvider();
      expect(provider.name).toBe("google");
    });

    it("creates LMStudioEmbeddingProvider when configured", async () => {
      process.env.EMBEDDING_PROVIDER = "lmstudio";
      process.env.EMBEDDING_MODEL = "nomic-embed-text-v1.5";
      process.env.EMBEDDING_DIMENSIONS = "768";
      const provider = await getEmbeddingProvider();
      expect(provider.name).toBe("lmstudio");
    });

    it("creates LiteLLMEmbeddingProvider when configured", async () => {
      process.env.EMBEDDING_PROVIDER = "litellm";
      process.env.LITELLM_API_KEY = "sk-master-test";
      process.env.EMBEDDING_MODEL = "text-embedding-3-small";
      process.env.EMBEDDING_DIMENSIONS = "1536";
      const provider = await getEmbeddingProvider();
      expect(provider.name).toBe("litellm");
    });

    it("caches provider instance", async () => {
      const p1 = await getEmbeddingProvider();
      const p2 = await getEmbeddingProvider();
      expect(p1).toBe(p2);
    });

    it("recreates provider when config changes", async () => {
      const p1 = await getEmbeddingProvider();
      expect(p1.name).toBe("textembedder");

      resetEmbeddingConfig();
      resetEmbeddingProvider();
      process.env.EMBEDDING_PROVIDER = "openai";

      const p2 = await getEmbeddingProvider();
      expect(p2.name).toBe("openai");
      expect(p2).not.toBe(p1);
    });
  });
});

describe("OpenAIEmbeddingProvider", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetEmbeddingConfig();
    resetEmbeddingProvider();
    delete process.env.EMBEDDING_PROVIDER;
    delete process.env.OPENAI_API_KEY;
    delete process.env.EMBEDDING_MODEL;
    delete process.env.EMBEDDING_DIMENSIONS;
  });

  afterEach(() => {
    resetEmbeddingConfig();
    resetEmbeddingProvider();
    process.env = { ...originalEnv };
  });

  it("throws when OPENAI_API_KEY is not set", async () => {
    process.env.EMBEDDING_PROVIDER = "openai";
    const provider = await getEmbeddingProvider();
    await expect(provider.ensureReady()).rejects.toThrow("OPENAI_API_KEY");
  });

  it("reports missing API key in health check", async () => {
    process.env.EMBEDDING_PROVIDER = "openai";
    const provider = await getEmbeddingProvider();
    const health = await provider.healthCheck();
    expect(health.available).toBe(false);
    expect(health.modelReady).toBe(false);
    expect(health.statusLines.some((l) => l.includes("Missing"))).toBe(true);
  });
});

describe("GoogleEmbeddingProvider", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetEmbeddingConfig();
    resetEmbeddingProvider();
    delete process.env.EMBEDDING_PROVIDER;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.EMBEDDING_MODEL;
    delete process.env.EMBEDDING_DIMENSIONS;
  });

  afterEach(() => {
    resetEmbeddingConfig();
    resetEmbeddingProvider();
    process.env = { ...originalEnv };
  });

  it("throws when GOOGLE_API_KEY is not set", async () => {
    process.env.EMBEDDING_PROVIDER = "google";
    const provider = await getEmbeddingProvider();
    await expect(provider.ensureReady()).rejects.toThrow("GOOGLE_API_KEY");
  });

  it("reports missing API key in health check", async () => {
    process.env.EMBEDDING_PROVIDER = "google";
    const provider = await getEmbeddingProvider();
    const health = await provider.healthCheck();
    expect(health.available).toBe(false);
    expect(health.modelReady).toBe(false);
    expect(health.statusLines.some((l) => l.includes("Missing"))).toBe(true);
  });
});

describe("LMStudioEmbeddingProvider", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetEmbeddingConfig();
    resetEmbeddingProvider();
    delete process.env.EMBEDDING_PROVIDER;
    delete process.env.EMBEDDING_MODEL;
    delete process.env.EMBEDDING_DIMENSIONS;
    delete process.env.EMBEDDING_CONTEXT_LENGTH;
    delete process.env.LMSTUDIO_URL;
    delete process.env.LMSTUDIO_API_KEY;
  });

  afterEach(() => {
    resetEmbeddingConfig();
    resetEmbeddingProvider();
    process.env = { ...originalEnv };
  });

  it("ensureReady throws an actionable error when LM Studio is unreachable", async () => {
    process.env.EMBEDDING_PROVIDER = "lmstudio";
    process.env.EMBEDDING_MODEL = "nomic-embed-text-v1.5";
    process.env.EMBEDDING_DIMENSIONS = "768";
    // Point at a deliberately closed port so the request fails fast.
    process.env.LMSTUDIO_URL = "http://127.0.0.1:1/v1";

    const provider = await getEmbeddingProvider();
    await expect(provider.ensureReady()).rejects.toThrow(
      /LM Studio is not reachable at http:\/\/127\.0\.0\.1:1\/v1/,
    );
  });

  it("healthCheck reports unreachable LM Studio without throwing", async () => {
    process.env.EMBEDDING_PROVIDER = "lmstudio";
    process.env.EMBEDDING_MODEL = "nomic-embed-text-v1.5";
    process.env.EMBEDDING_DIMENSIONS = "768";
    process.env.LMSTUDIO_URL = "http://127.0.0.1:1/v1";

    const provider = await getEmbeddingProvider();
    const health = await provider.healthCheck();

    expect(health.available).toBe(false);
    expect(health.modelReady).toBe(false);
    expect(health.statusLines.some((l) => l.includes("LM Studio") && l.includes("Not reachable"))).toBe(true);
  });

  it("does not require LMSTUDIO_API_KEY to construct the provider", async () => {
    process.env.EMBEDDING_PROVIDER = "lmstudio";
    process.env.EMBEDDING_MODEL = "nomic-embed-text-v1.5";
    process.env.EMBEDDING_DIMENSIONS = "768";
    // Intentionally no LMSTUDIO_API_KEY.

    const provider = await getEmbeddingProvider();
    expect(provider.name).toBe("lmstudio");
  });
});

describe("LiteLLMEmbeddingProvider", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetEmbeddingConfig();
    resetEmbeddingProvider();
    delete process.env.EMBEDDING_PROVIDER;
    delete process.env.EMBEDDING_MODEL;
    delete process.env.EMBEDDING_DIMENSIONS;
    delete process.env.EMBEDDING_CONTEXT_LENGTH;
    delete process.env.LITELLM_URL;
    delete process.env.LITELLM_API_KEY;
    delete process.env.LITELLM_SEND_DIMENSIONS;
  });

  afterEach(() => {
    resetEmbeddingConfig();
    resetEmbeddingProvider();
    process.env = { ...originalEnv };
  });

  it("config validation rejects construction when LITELLM_API_KEY is missing", async () => {
    // The API key is checked at config-load time (loadEmbeddingConfig), not at
    // factory invocation, so the throw surfaces inside getEmbeddingProvider().
    process.env.EMBEDDING_PROVIDER = "litellm";
    process.env.EMBEDDING_MODEL = "text-embedding-3-small";
    process.env.EMBEDDING_DIMENSIONS = "1536";
    // Intentionally no LITELLM_API_KEY.

    await expect(getEmbeddingProvider()).rejects.toThrow(/LITELLM_API_KEY is required/);
  });

  it("ensureReady throws an actionable error when the proxy is unreachable", async () => {
    process.env.EMBEDDING_PROVIDER = "litellm";
    process.env.LITELLM_API_KEY = "sk-master-test";
    process.env.EMBEDDING_MODEL = "text-embedding-3-small";
    process.env.EMBEDDING_DIMENSIONS = "1536";
    // Closed port → SDK fails fast with a connection error, not an auth error.
    process.env.LITELLM_URL = "http://127.0.0.1:1/v1";

    const provider = await getEmbeddingProvider();
    await expect(provider.ensureReady()).rejects.toThrow(
      /LiteLLM proxy is not reachable at http:\/\/127\.0\.0\.1:1\/v1/,
    );
  });

  it("healthCheck reports missing API key without making any network call", async () => {
    process.env.EMBEDDING_PROVIDER = "litellm";
    process.env.LITELLM_API_KEY = "sk-master-test";
    process.env.EMBEDDING_MODEL = "text-embedding-3-small";
    process.env.EMBEDDING_DIMENSIONS = "1536";
    // Even with a deliberately closed port, missing-key path must short-circuit
    // before the SDK attempts a connection, so the test stays deterministic.
    process.env.LITELLM_URL = "http://127.0.0.1:1/v1";

    const provider = await getEmbeddingProvider();
    // Now drop the key for the health-check call only — the provider re-reads
    // process.env on each invocation (intentional, see provider-litellm.ts).
    delete process.env.LITELLM_API_KEY;

    const health = await provider.healthCheck();
    expect(health.available).toBe(false);
    expect(health.modelReady).toBe(false);
    expect(health.statusLines.some((l) => l.includes("LiteLLM API key") && l.includes("Missing"))).toBe(true);
  });

  it("healthCheck reports unreachable proxy without throwing", async () => {
    process.env.EMBEDDING_PROVIDER = "litellm";
    process.env.LITELLM_API_KEY = "sk-master-test";
    process.env.EMBEDDING_MODEL = "text-embedding-3-small";
    process.env.EMBEDDING_DIMENSIONS = "1536";
    process.env.LITELLM_URL = "http://127.0.0.1:1/v1";

    const provider = await getEmbeddingProvider();
    const health = await provider.healthCheck();

    expect(health.available).toBe(false);
    expect(health.modelReady).toBe(false);
    expect(
      health.statusLines.some(
        (l) => l.includes("LiteLLM") && l.includes("Not reachable"),
      ),
    ).toBe(true);
  });
});
