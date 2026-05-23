// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getEmbeddingConfig,
  loadEmbeddingConfig,
  resetEmbeddingConfig,
} from "../../src/services/embedding-config.js";

describe("embedding-config", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetEmbeddingConfig();
    // Clear all embedding-related env vars
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
    // Restore original env
    process.env = { ...originalEnv };
  });

  describe("defaults (no env vars)", () => {
    it("defaults to textembedder provider", () => {
      const config = loadEmbeddingConfig();
      expect(config.embeddingProvider).toBe("textembedder");
    });

    it("defaults model to landmark-lattice-v1", () => {
      const config = loadEmbeddingConfig();
      expect(config.embeddingModel).toBe("landmark-lattice-v1");
    });

    it("defaults dimensions to 768", () => {
      const config = loadEmbeddingConfig();
      expect(config.embeddingDimensions).toBe(768);
    });

    it("has no Ollama API key by default", () => {
      const config = loadEmbeddingConfig();
      expect(config.ollamaApiKey).toBeUndefined();
    });
  });

  describe("docker mode", () => {
    it("uses docker URL default when OLLAMA_MODE=docker", () => {
      process.env.OLLAMA_MODE = "docker";
      const config = loadEmbeddingConfig();
      expect(config.ollamaMode).toBe("docker");
      expect(config.ollamaUrl).toBe("http://localhost:11435");
    });

    it("allows overriding URL in docker mode", () => {
      process.env.OLLAMA_MODE = "docker";
      process.env.OLLAMA_URL = "http://custom:9999";
      const config = loadEmbeddingConfig();
      expect(config.ollamaUrl).toBe("http://custom:9999");
    });
  });

  describe("external mode", () => {
    it("uses external URL default when OLLAMA_MODE=external", () => {
      process.env.OLLAMA_MODE = "external";
      const config = loadEmbeddingConfig();
      expect(config.ollamaMode).toBe("external");
      expect(config.ollamaUrl).toBe("http://localhost:11434");
    });

    it("allows overriding URL in external mode", () => {
      process.env.OLLAMA_MODE = "external";
      process.env.OLLAMA_URL = "http://gpu-server:11434";
      const config = loadEmbeddingConfig();
      expect(config.ollamaUrl).toBe("http://gpu-server:11434");
    });
  });

  describe("model and dimensions overrides", () => {
    it("allows custom model", () => {
      process.env.EMBEDDING_MODEL = "mxbai-embed-large";
      const config = loadEmbeddingConfig();
      expect(config.embeddingModel).toBe("mxbai-embed-large");
    });

    it("allows custom dimensions", () => {
      process.env.EMBEDDING_DIMENSIONS = "1024";
      const config = loadEmbeddingConfig();
      expect(config.embeddingDimensions).toBe(1024);
    });

    it("parses dimensions as integer", () => {
      process.env.EMBEDDING_DIMENSIONS = "512";
      const config = loadEmbeddingConfig();
      expect(config.embeddingDimensions).toBe(512);
      expect(typeof config.embeddingDimensions).toBe("number");
    });
  });

  describe("API key", () => {
    it("reads OLLAMA_API_KEY when set", () => {
      process.env.OLLAMA_API_KEY = "test-key-123";
      const config = loadEmbeddingConfig();
      expect(config.ollamaApiKey).toBe("test-key-123");
    });

    it("is undefined when not set", () => {
      const config = loadEmbeddingConfig();
      expect(config.ollamaApiKey).toBeUndefined();
    });
  });

  describe("invalid mode", () => {
    it("throws for invalid OLLAMA_MODE", () => {
      process.env.OLLAMA_MODE = "invalid";
      expect(() => loadEmbeddingConfig()).toThrow(
        'Invalid OLLAMA_MODE: "invalid". Must be "docker", "external", or "auto".',
      );
    });
  });

  describe("singleton behavior", () => {
    it("caches config after first load", () => {
      const first = loadEmbeddingConfig();
      expect(first.embeddingProvider).toBe("textembedder");
      // Change env — should NOT affect cached config
      process.env.EMBEDDING_PROVIDER = "google";
      const second = loadEmbeddingConfig();
      expect(second).toBe(first); // same reference
      expect(second.embeddingProvider).toBe("textembedder");
    });

    it("getEmbeddingConfig returns same as loadEmbeddingConfig", () => {
      const loaded = loadEmbeddingConfig();
      const got = getEmbeddingConfig();
      expect(got).toBe(loaded);
    });

    it("resetEmbeddingConfig clears cache", () => {
      const first = loadEmbeddingConfig();
      expect(first.embeddingProvider).toBe("textembedder");

      resetEmbeddingConfig();
      process.env.EMBEDDING_PROVIDER = "google";
      const second = loadEmbeddingConfig();
      expect(second.embeddingProvider).toBe("google");
      expect(second).not.toBe(first);
    });
  });

  describe("full external config", () => {
    it("handles complete external config with all options", () => {
      process.env.EMBEDDING_PROVIDER = "ollama";
      process.env.OLLAMA_MODE = "external";
      process.env.OLLAMA_URL = "http://remote-gpu:11434";
      process.env.EMBEDDING_MODEL = "mxbai-embed-large";
      process.env.EMBEDDING_DIMENSIONS = "1024";
      process.env.OLLAMA_API_KEY = "secret";

      const config = loadEmbeddingConfig();
      expect(config).toEqual({
        embeddingProvider: "ollama",
        ollamaMode: "external",
        ollamaUrl: "http://remote-gpu:11434",
        lmstudioUrl: "http://localhost:1234/v1",
        litellmUrl: "http://localhost:4000/v1",
        embeddingModel: "mxbai-embed-large",
        embeddingDimensions: 1024,
        embeddingContextLength: 512,
        ollamaApiKey: "secret",
      });
    });
  });

  describe("embedding provider selection", () => {
    it("defaults to textembedder when EMBEDDING_PROVIDER is not set", () => {
      const config = loadEmbeddingConfig();
      expect(config.embeddingProvider).toBe("textembedder");
      expect(config.embeddingModel).toBe("landmark-lattice-v1");
      expect(config.embeddingDimensions).toBe(768);
    });

    it("selects openai provider with correct defaults", () => {
      process.env.EMBEDDING_PROVIDER = "openai";
      const config = loadEmbeddingConfig();
      expect(config.embeddingProvider).toBe("openai");
      expect(config.embeddingModel).toBe("text-embedding-3-small");
      expect(config.embeddingDimensions).toBe(1536);
      expect(config.embeddingContextLength).toBe(8191);
    });

    it("selects google provider with correct defaults", () => {
      process.env.EMBEDDING_PROVIDER = "google";
      const config = loadEmbeddingConfig();
      expect(config.embeddingProvider).toBe("google");
      expect(config.embeddingModel).toBe("gemini-embedding-001");
      expect(config.embeddingDimensions).toBe(3072);
      expect(config.embeddingContextLength).toBe(2048);
    });

    it("throws for invalid EMBEDDING_PROVIDER", () => {
      process.env.EMBEDDING_PROVIDER = "anthropic";
      expect(() => loadEmbeddingConfig()).toThrow(
        'Invalid EMBEDDING_PROVIDER: "anthropic". Must be "textembedder", "ollama", "openai", "google", "lmstudio", or "litellm".',
      );
    });

    it("allows overriding model for openai provider", () => {
      process.env.EMBEDDING_PROVIDER = "openai";
      process.env.EMBEDDING_MODEL = "text-embedding-3-large";
      const config = loadEmbeddingConfig();
      expect(config.embeddingModel).toBe("text-embedding-3-large");
      expect(config.embeddingContextLength).toBe(8191);
    });

    it("allows overriding dimensions for openai provider", () => {
      process.env.EMBEDDING_PROVIDER = "openai";
      process.env.EMBEDDING_DIMENSIONS = "256";
      const config = loadEmbeddingConfig();
      expect(config.embeddingDimensions).toBe(256);
    });

    it("uses context length for unknown model", () => {
      process.env.EMBEDDING_PROVIDER = "openai";
      process.env.EMBEDDING_MODEL = "custom-embed-model";
      const config = loadEmbeddingConfig();
      expect(config.embeddingContextLength).toBe(0);
    });

    it("allows explicit context length override for any provider", () => {
      process.env.EMBEDDING_PROVIDER = "google";
      process.env.EMBEDDING_CONTEXT_LENGTH = "4096";
      const config = loadEmbeddingConfig();
      expect(config.embeddingContextLength).toBe(4096);
    });
  });

  describe("lmstudio provider", () => {
    it("loads when EMBEDDING_MODEL and EMBEDDING_DIMENSIONS are set", () => {
      process.env.EMBEDDING_PROVIDER = "lmstudio";
      process.env.EMBEDDING_MODEL = "nomic-embed-text-v1.5";
      process.env.EMBEDDING_DIMENSIONS = "768";

      const config = loadEmbeddingConfig();
      expect(config.embeddingProvider).toBe("lmstudio");
      expect(config.embeddingModel).toBe("nomic-embed-text-v1.5");
      expect(config.embeddingDimensions).toBe(768);
    });

    it("defaults LMSTUDIO_URL to http://localhost:1234/v1", () => {
      process.env.EMBEDDING_PROVIDER = "lmstudio";
      process.env.EMBEDDING_MODEL = "nomic-embed-text-v1.5";
      process.env.EMBEDDING_DIMENSIONS = "768";

      const config = loadEmbeddingConfig();
      expect(config.lmstudioUrl).toBe("http://localhost:1234/v1");
    });

    it("respects LMSTUDIO_URL override", () => {
      process.env.EMBEDDING_PROVIDER = "lmstudio";
      process.env.EMBEDDING_MODEL = "nomic-embed-text-v1.5";
      process.env.EMBEDDING_DIMENSIONS = "768";
      process.env.LMSTUDIO_URL = "http://gpu-rig.local:5678/v1";

      const config = loadEmbeddingConfig();
      expect(config.lmstudioUrl).toBe("http://gpu-rig.local:5678/v1");
    });

    it("throws when EMBEDDING_MODEL is missing", () => {
      process.env.EMBEDDING_PROVIDER = "lmstudio";
      process.env.EMBEDDING_DIMENSIONS = "768";

      expect(() => loadEmbeddingConfig()).toThrow(
        /EMBEDDING_MODEL is required when EMBEDDING_PROVIDER=lmstudio/,
      );
    });

    it("throws when EMBEDDING_DIMENSIONS is missing", () => {
      process.env.EMBEDDING_PROVIDER = "lmstudio";
      process.env.EMBEDDING_MODEL = "nomic-embed-text-v1.5";

      expect(() => loadEmbeddingConfig()).toThrow(
        /EMBEDDING_DIMENSIONS is required when EMBEDDING_PROVIDER=lmstudio/,
      );
    });

    it("includes example dimensions in the error message for discoverability", () => {
      process.env.EMBEDDING_PROVIDER = "lmstudio";
      process.env.EMBEDDING_MODEL = "nomic-embed-text-v1.5";

      expect(() => loadEmbeddingConfig()).toThrow(
        /768 for nomic-embed-text-v1\.5/,
      );
    });

    it("does not require LMSTUDIO_API_KEY", () => {
      process.env.EMBEDDING_PROVIDER = "lmstudio";
      process.env.EMBEDDING_MODEL = "nomic-embed-text-v1.5";
      process.env.EMBEDDING_DIMENSIONS = "768";
      // Intentionally no LMSTUDIO_API_KEY — LM Studio's Local Server has no auth by default.

      expect(() => loadEmbeddingConfig()).not.toThrow();
    });

    it("respects EMBEDDING_CONTEXT_LENGTH override", () => {
      process.env.EMBEDDING_PROVIDER = "lmstudio";
      process.env.EMBEDDING_MODEL = "qwen3-embedding-8b";
      process.env.EMBEDDING_DIMENSIONS = "4096";
      process.env.EMBEDDING_CONTEXT_LENGTH = "32768";

      const config = loadEmbeddingConfig();
      expect(config.embeddingContextLength).toBe(32768);
    });
  });

  describe("litellm provider", () => {
    it("loads when API key, model, and dimensions are all set", () => {
      process.env.EMBEDDING_PROVIDER = "litellm";
      process.env.LITELLM_API_KEY = "sk-master-test";
      process.env.EMBEDDING_MODEL = "text-embedding-3-small";
      process.env.EMBEDDING_DIMENSIONS = "1536";

      const config = loadEmbeddingConfig();
      expect(config.embeddingProvider).toBe("litellm");
      expect(config.embeddingModel).toBe("text-embedding-3-small");
      expect(config.embeddingDimensions).toBe(1536);
    });

    it("defaults LITELLM_URL to http://localhost:4000/v1", () => {
      process.env.EMBEDDING_PROVIDER = "litellm";
      process.env.LITELLM_API_KEY = "sk-master-test";
      process.env.EMBEDDING_MODEL = "text-embedding-3-small";
      process.env.EMBEDDING_DIMENSIONS = "1536";

      const config = loadEmbeddingConfig();
      expect(config.litellmUrl).toBe("http://localhost:4000/v1");
    });

    it("respects LITELLM_URL override", () => {
      process.env.EMBEDDING_PROVIDER = "litellm";
      process.env.LITELLM_API_KEY = "sk-master-test";
      process.env.EMBEDDING_MODEL = "voyage-2";
      process.env.EMBEDDING_DIMENSIONS = "1024";
      process.env.LITELLM_URL = "https://litellm.internal:4001/v1";

      const config = loadEmbeddingConfig();
      expect(config.litellmUrl).toBe("https://litellm.internal:4001/v1");
    });

    it("throws when LITELLM_API_KEY is missing", () => {
      process.env.EMBEDDING_PROVIDER = "litellm";
      process.env.EMBEDDING_MODEL = "text-embedding-3-small";
      process.env.EMBEDDING_DIMENSIONS = "1536";

      expect(() => loadEmbeddingConfig()).toThrow(
        /LITELLM_API_KEY is required when EMBEDDING_PROVIDER=litellm/,
      );
    });

    it("throws when EMBEDDING_MODEL is missing", () => {
      process.env.EMBEDDING_PROVIDER = "litellm";
      process.env.LITELLM_API_KEY = "sk-master-test";
      process.env.EMBEDDING_DIMENSIONS = "1536";

      expect(() => loadEmbeddingConfig()).toThrow(
        /EMBEDDING_MODEL is required when EMBEDDING_PROVIDER=litellm/,
      );
    });

    it("throws when EMBEDDING_DIMENSIONS is missing", () => {
      process.env.EMBEDDING_PROVIDER = "litellm";
      process.env.LITELLM_API_KEY = "sk-master-test";
      process.env.EMBEDDING_MODEL = "text-embedding-3-small";

      expect(() => loadEmbeddingConfig()).toThrow(
        /EMBEDDING_DIMENSIONS is required when EMBEDDING_PROVIDER=litellm/,
      );
    });

    it("validates the API_KEY check before model/dimension checks", () => {
      // All three are missing — the API key error must surface first because it's
      // the only one a virtual-key user can fix without touching the proxy config.
      process.env.EMBEDDING_PROVIDER = "litellm";

      expect(() => loadEmbeddingConfig()).toThrow(
        /LITELLM_API_KEY is required/,
      );
    });

    it("includes example dimensions in the error message for discoverability", () => {
      process.env.EMBEDDING_PROVIDER = "litellm";
      process.env.LITELLM_API_KEY = "sk-master-test";
      process.env.EMBEDDING_MODEL = "text-embedding-3-small";

      expect(() => loadEmbeddingConfig()).toThrow(
        /1536 for text-embedding-3-small/,
      );
    });

    it("respects EMBEDDING_CONTEXT_LENGTH override for unknown proxy aliases", () => {
      process.env.EMBEDDING_PROVIDER = "litellm";
      process.env.LITELLM_API_KEY = "sk-master-test";
      process.env.EMBEDDING_MODEL = "team-internal-bge-large";
      process.env.EMBEDDING_DIMENSIONS = "1024";
      process.env.EMBEDDING_CONTEXT_LENGTH = "8192";

      const config = loadEmbeddingConfig();
      expect(config.embeddingContextLength).toBe(8192);
    });

    it("auto-detects context length when alias matches a well-known model name", () => {
      // LiteLLM aliases are usually named after the underlying model; the context-length
      // table lookup uses the alias verbatim, so the operator gets free auto-detection
      // when they keep names aligned.
      process.env.EMBEDDING_PROVIDER = "litellm";
      process.env.LITELLM_API_KEY = "sk-master-test";
      process.env.EMBEDDING_MODEL = "text-embedding-3-small";
      process.env.EMBEDDING_DIMENSIONS = "1536";

      const config = loadEmbeddingConfig();
      expect(config.embeddingContextLength).toBe(8191);
    });
  });
});
