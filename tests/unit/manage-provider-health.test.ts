// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEmbeddingConfig } from "../../src/services/embedding-config.js";
import { resetEmbeddingProvider } from "../../src/services/embedding-provider.js";
import { handleManageTool } from "../../src/tools/manage-tools.js";

const qdrant = vi.hoisted(() => ({ list: vi.fn<() => Promise<string[]>>() }));
vi.mock("../../src/constants.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/constants.js")>(),
  QDRANT_MODE: "external",
  QDRANT_URL: "http://127.0.0.1:6333",
}));
vi.mock("../../src/services/qdrant.js", () => ({ listCodebaseCollections: qdrant.list }));

describe("management diagnostics for Ollama transport errors", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.EMBEDDING_PROVIDER = "ollama";
    process.env.OLLAMA_MODE = "external";
    process.env.OLLAMA_URL = "http://192.0.2.10:11434";
    process.env.OLLAMA_API_KEY = "fixture-diagnostic-key";
    resetEmbeddingConfig();
    resetEmbeddingProvider();
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
});
