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
    delete process.env.OLLAMA_MAX_CONNECTIONS;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.LMSTUDIO_URL;
    delete process.env.LMSTUDIO_API_KEY;
    delete process.env.LITELLM_URL;
    delete process.env.LITELLM_API_KEY;
    delete process.env.LITELLM_SEND_DIMENSIONS;
    delete process.env.ORCAROUTER_URL;
    delete process.env.ORCAROUTER_API_KEY;
    delete process.env.ORCAROUTER_SEND_DIMENSIONS;
  });

  afterEach(() => {
    resetEmbeddingConfig();
    // Restore original env
    process.env = { ...originalEnv };
  });

  describe("defaults (no env vars)", () => {
    it("defaults to ollama provider", () => {
      const config = loadEmbeddingConfig();
      expect(config.embeddingProvider).toBe("ollama");
    });

    it("defaults to auto mode", () => {
      const config = loadEmbeddingConfig();
      expect(config.ollamaMode).toBe("auto");
    });

    it("defaults URL to localhost:11434 in auto mode", () => {
      const config = loadEmbeddingConfig();
      expect(config.ollamaUrl).toBe("http://localhost:11434");
    });

    it("defaults model to nomic-embed-text", () => {
      const config = loadEmbeddingConfig();
      expect(config.embeddingModel).toBe("nomic-embed-text");
    });

    it("defaults dimensions to 768", () => {
      const config = loadEmbeddingConfig();
      expect(config.embeddingDimensions).toBe(768);
    });

    it("has no API key by default", () => {
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

  describe("OLLAMA_MAX_CONNECTIONS", () => {
    it("defaults to 4", () => {
      expect(loadEmbeddingConfig().ollamaMaxConnections).toBe(4);
    });

    it("honours a custom positive integer", () => {
      process.env.OLLAMA_MAX_CONNECTIONS = "8";
      expect(loadEmbeddingConfig().ollamaMaxConnections).toBe(8);
    });

    it("throws for a non-integer or non-positive value", () => {
      // A silently-clamped bad value would hide a config typo behind a
      // working pool of the wrong size; the loader must refuse instead.
      for (const bad of ["0", "-2", "four", "2.5"]) {
        resetEmbeddingConfig();
        process.env.OLLAMA_MAX_CONNECTIONS = bad;
        expect(() => loadEmbeddingConfig(), bad).toThrow(
          `Invalid OLLAMA_MAX_CONNECTIONS: "${bad}". Must be a positive integer.`,
        );
      }
    });
  });

  describe("singleton behavior", () => {
    it("caches config after first load", () => {
      const first = loadEmbeddingConfig();
      // Change env — should NOT affect cached config
      process.env.OLLAMA_MODE = "external";
      const second = loadEmbeddingConfig();
      expect(second).toBe(first); // same reference
      expect(second.ollamaMode).toBe("auto");
    });

    it("getEmbeddingConfig returns same as loadEmbeddingConfig", () => {
      const loaded = loadEmbeddingConfig();
      const got = getEmbeddingConfig();
      expect(got).toBe(loaded);
    });

    it("resetEmbeddingConfig clears cache", () => {
      const first = loadEmbeddingConfig();
      expect(first.ollamaMode).toBe("auto");

      resetEmbeddingConfig();
      process.env.OLLAMA_MODE = "external";
      const second = loadEmbeddingConfig();
      expect(second.ollamaMode).toBe("external");
      expect(second).not.toBe(first);
    });
  });

  describe("full external config", () => {
    it("handles complete external config with all options", () => {
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
        orcarouterUrl: "https://api.orcarouter.ai/v1",
        embeddingModel: "mxbai-embed-large",
        embeddingDimensions: 1024,
        embeddingContextLength: 512,
        ollamaApiKey: "secret",
        ollamaMaxConnections: 4,
      });
    });
  });

  describe("embedding provider selection", () => {
    it("defaults to ollama when EMBEDDING_PROVIDER is not set", () => {
      const config = loadEmbeddingConfig();
      expect(config.embeddingProvider).toBe("ollama");
      expect(config.embeddingModel).toBe("nomic-embed-text");
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
        'Invalid EMBEDDING_PROVIDER: "anthropic". Must be "ollama", "openai", "google", "lmstudio", "litellm", or "orcarouter".',
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

  describe("orcarouter provider", () => {
    it("loads when API key, model, and dimensions are all set", () => {
      process.env.EMBEDDING_PROVIDER = "orcarouter";
      process.env.ORCAROUTER_API_KEY = "or_test_key";
      process.env.EMBEDDING_MODEL = "google/gemini-embedding-001";
      process.env.EMBEDDING_DIMENSIONS = "3072";

      const config = loadEmbeddingConfig();
      expect(config.embeddingProvider).toBe("orcarouter");
      expect(config.embeddingModel).toBe("google/gemini-embedding-001");
      expect(config.embeddingDimensions).toBe(3072);
    });

    it("defaults ORCAROUTER_URL to https://api.orcarouter.ai/v1", () => {
      process.env.EMBEDDING_PROVIDER = "orcarouter";
      process.env.ORCAROUTER_API_KEY = "or_test_key";
      process.env.EMBEDDING_MODEL = "google/gemini-embedding-001";
      process.env.EMBEDDING_DIMENSIONS = "3072";

      const config = loadEmbeddingConfig();
      expect(config.orcarouterUrl).toBe("https://api.orcarouter.ai/v1");
    });

    it("respects ORCAROUTER_URL override", () => {
      process.env.EMBEDDING_PROVIDER = "orcarouter";
      process.env.ORCAROUTER_API_KEY = "or_test_key";
      process.env.EMBEDDING_MODEL = "openai/text-embedding-3-small";
      process.env.EMBEDDING_DIMENSIONS = "1536";
      process.env.ORCAROUTER_URL = "https://orcarouter.internal:443/v1";

      const config = loadEmbeddingConfig();
      expect(config.orcarouterUrl).toBe("https://orcarouter.internal:443/v1");
    });

    it("throws when ORCAROUTER_API_KEY is missing", () => {
      process.env.EMBEDDING_PROVIDER = "orcarouter";
      process.env.EMBEDDING_MODEL = "google/gemini-embedding-001";
      process.env.EMBEDDING_DIMENSIONS = "3072";

      expect(() => loadEmbeddingConfig()).toThrow(
        /ORCAROUTER_API_KEY is required when EMBEDDING_PROVIDER=orcarouter/,
      );
    });

    it("throws when EMBEDDING_MODEL is missing", () => {
      process.env.EMBEDDING_PROVIDER = "orcarouter";
      process.env.ORCAROUTER_API_KEY = "or_test_key";
      process.env.EMBEDDING_DIMENSIONS = "3072";

      expect(() => loadEmbeddingConfig()).toThrow(
        /EMBEDDING_MODEL is required when EMBEDDING_PROVIDER=orcarouter/,
      );
    });

    it("throws when EMBEDDING_DIMENSIONS is missing", () => {
      process.env.EMBEDDING_PROVIDER = "orcarouter";
      process.env.ORCAROUTER_API_KEY = "or_test_key";
      process.env.EMBEDDING_MODEL = "google/gemini-embedding-001";

      expect(() => loadEmbeddingConfig()).toThrow(
        /EMBEDDING_DIMENSIONS is required when EMBEDDING_PROVIDER=orcarouter/,
      );
    });

    it("validates the API_KEY check before model/dimension checks", () => {
      // All three are missing — the API key error must surface first so the
      // operator sees the most fundamental missing piece.
      process.env.EMBEDDING_PROVIDER = "orcarouter";

      expect(() => loadEmbeddingConfig()).toThrow(
        /ORCAROUTER_API_KEY is required/,
      );
    });

    it("includes example model ids in the model error message for discoverability", () => {
      process.env.EMBEDDING_PROVIDER = "orcarouter";
      process.env.ORCAROUTER_API_KEY = "or_test_key";
      process.env.EMBEDDING_DIMENSIONS = "3072";

      expect(() => loadEmbeddingConfig()).toThrow(
        /google\/gemini-embedding-001/,
      );
    });

    it("includes example dimensions in the error message for discoverability", () => {
      process.env.EMBEDDING_PROVIDER = "orcarouter";
      process.env.ORCAROUTER_API_KEY = "or_test_key";
      process.env.EMBEDDING_MODEL = "google/gemini-embedding-001";

      expect(() => loadEmbeddingConfig()).toThrow(
        /3072 for google\/gemini-embedding-001/,
      );
    });

    it("auto-detects context length when model id matches a well-known name", () => {
      process.env.EMBEDDING_PROVIDER = "orcarouter";
      process.env.ORCAROUTER_API_KEY = "or_test_key";
      process.env.EMBEDDING_MODEL = "openai/text-embedding-3-small";
      process.env.EMBEDDING_DIMENSIONS = "1536";

      const config = loadEmbeddingConfig();
      expect(config.embeddingContextLength).toBe(8191);
    });

    it("auto-detects context length for gemini-embedding model ids", () => {
      process.env.EMBEDDING_PROVIDER = "orcarouter";
      process.env.ORCAROUTER_API_KEY = "or_test_key";
      process.env.EMBEDDING_MODEL = "google/gemini-embedding-001";
      process.env.EMBEDDING_DIMENSIONS = "3072";

      const config = loadEmbeddingConfig();
      expect(config.embeddingContextLength).toBe(2048);
    });

    it("respects EMBEDDING_CONTEXT_LENGTH override for unknown model ids", () => {
      process.env.EMBEDDING_PROVIDER = "orcarouter";
      process.env.ORCAROUTER_API_KEY = "or_test_key";
      process.env.EMBEDDING_MODEL = "orcarouter/fusion";
      process.env.EMBEDDING_DIMENSIONS = "3072";
      process.env.EMBEDDING_CONTEXT_LENGTH = "8192";

      const config = loadEmbeddingConfig();
      expect(config.embeddingContextLength).toBe(8192);
    });
  });
});
