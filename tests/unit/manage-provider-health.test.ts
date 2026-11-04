// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEmbeddingConfig } from "../../src/services/embedding-config.js";
import { resetEmbeddingProvider } from "../../src/services/embedding-provider.js";
import { handleManageTool } from "../../src/tools/manage-tools.js";

const qdrant = vi.hoisted(() => ({ mode: "external" as "external" | "managed", running: true, list: vi.fn<() => Promise<string[]>>() }));
vi.mock("../../src/constants.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/constants.js")>(),
  get QDRANT_MODE() { return qdrant.mode; },
  QDRANT_URL: "http://127.0.0.1:6333",
}));
vi.mock("../../src/services/qdrant.js", () => ({ listCodebaseCollections: qdrant.list }));
vi.mock("../../src/services/docker.js", () => ({
  isDockerAvailable: async () => true,
  isQdrantRunning: async () => qdrant.running,
  isQdrantImagePresent: async () => true,
}));

describe("management diagnostics for Ollama transport errors", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.EMBEDDING_PROVIDER = "ollama";
    process.env.OLLAMA_MODE = "external";
    process.env.OLLAMA_URL = "http://192.0.2.10:11434";
    process.env.OLLAMA_API_KEY = "fixture-diagnostic-key";
    resetEmbeddingConfig();
    resetEmbeddingProvider();
    qdrant.mode = "external";
    qdrant.running = true;
    qdrant.list.mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    resetEmbeddingConfig();
    resetEmbeddingProvider();
    process.env = { ...originalEnv };
  });

  it.each(["codebase_health", "codebase_about"])("retains Qdrant results and the actionable Ollama error in %s", async (tool) => {
    const result = await handleManageTool(tool, {});
    expect(result).toMatch(/External Qdrant.*[Rr]eachable/);
    expect(result).toMatch(/OLLAMA_API_KEY.*HTTPS/);
    expect(result).not.toContain("Cannot reach external Qdrant");
    expect(result).not.toContain("fixture-diagnostic-key");
  });

  it.each(["codebase_health", "codebase_about"])("reports malformed Ollama configuration in %s without exposing it", async (tool) => {
    process.env.OLLAMA_URL = "http://[";
    resetEmbeddingConfig();
    const result = await handleManageTool(tool, {});
    expect(result).toContain("Invalid OLLAMA_URL");
    expect(result).not.toContain("Cannot reach external Qdrant");
    expect(result).not.toContain("fixture-diagnostic-key");
  });

  it("preserves the Qdrant failure diagnosis when Qdrant itself is unreachable", async () => {
    qdrant.list.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));
    expect(await handleManageTool("codebase_about", {})).toContain("Cannot reach external Qdrant");
  });

  it("retains a missing managed Qdrant result alongside the Ollama transport failure", async () => {
    qdrant.mode = "managed";
    qdrant.running = false;
    const result = await handleManageTool("codebase_about", {});
    expect(result).toContain("Qdrant not running");
    expect(result).toMatch(/OLLAMA_API_KEY.*HTTPS/);
  });

  it.each([
    ["codebase_health", "http://192.0.2.10:11434", /OLLAMA_API_KEY.*HTTPS/],
    ["codebase_about", "http://192.0.2.10:11434", /OLLAMA_API_KEY.*HTTPS/],
    ["codebase_health", "http://[", /Invalid OLLAMA_URL/],
    ["codebase_about", "http://[", /Invalid OLLAMA_URL/],
  ] as const)("retains managed Qdrant status and the Ollama error in %s for %s", async (tool, url, expected) => {
    qdrant.mode = "managed";
    process.env.OLLAMA_URL = url;
    resetEmbeddingConfig();
    const result = await handleManageTool(tool, {});
    expect(result).toMatch(/Qdrant.*[Rr]unning/);
    expect(result).toMatch(expected);
    expect(result).not.toContain("Could not check status");
    expect(result).not.toContain("fixture-diagnostic-key");
  });
});
