// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

/** Unit tests for context-tool routing and result formatting. */

import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────

vi.mock("../../src/services/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ── docker.js mock ───────────────────────────────────────────────────────

vi.mock("../../src/services/docker.js", () => ({
  ensureQdrantReady: vi.fn(async () => ({ pulled: false, started: false })),
  isDockerAvailable: vi.fn(async () => true),
}));

// ── qdrant.js mock ───────────────────────────────────────────────────────

const mockGetCollectionInfo = vi.fn(async (): Promise<{ pointsCount: number } | null> => null);

vi.mock("../../src/services/qdrant.js", () => ({
  getCollectionInfo: (...args: unknown[]) => mockGetCollectionInfo(...(args as [string])),
  loadContextMetadata: vi.fn(async () => null),
}));

// ── config.js mock ───────────────────────────────────────────────────────

vi.mock("../../src/config.js", () => ({
  projectIdFromPath: vi.fn(() => "test-project-id"),
  contextCollectionName: vi.fn(() => "context_test"),
}));

// ── indexer.js mock ──────────────────────────────────────────────────────

vi.mock("../../src/services/indexer.js", () => ({
  isIndexingInProgress: vi.fn(() => false),
}));

// ── context-artifacts.js mock ───────────────────────────────────────────

const mockIndexAllArtifacts = vi.fn(async (_path: string) => ({ indexed: [], errors: [] }));
const mockSearchArtifacts = vi.fn(async (_collection: string, _query: string, _limit: number) => []);
const mockEnsureArtifactsIndexed = vi.fn(async (_path: string) => ({
  reindexed: [],
  upToDate: [],
  errors: [],
}));

vi.mock("../../src/services/context-artifacts.js", () => ({
  loadConfig: vi.fn(async () => ({
    artifacts: [{ name: "test", type: "file", path: "test.md" }],
  })),
  indexAllArtifacts: (...args: unknown[]) => mockIndexAllArtifacts(...(args as [string])),
  searchArtifacts: (...args: unknown[]) => mockSearchArtifacts(...(args as [string, string, number])),
  ensureArtifactsIndexed: (...args: unknown[]) => mockEnsureArtifactsIndexed(...(args as [string])),
  removeAllArtifacts: vi.fn(async () => {}),
}));

// ── Imports (after mocks) ────────────────────────────────────────────────

import { handleContextTool } from "../../src/tools/context-tools.js";

// ── Tests ────────────────────────────────────────────────────────────────

const TEST_PATH = path.resolve("/tmp/test-project");

describe("context indexing and search ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCollectionInfo.mockResolvedValue(null);
  });

  it("delegates explicit indexing to the context artifact service", async () => {
    await handleContextTool("codebase_context_index", {
      projectPath: TEST_PATH,
    });

    expect(mockIndexAllArtifacts).toHaveBeenCalledOnce();
    expect(mockIndexAllArtifacts).toHaveBeenCalledWith(TEST_PATH);
  });

  it("delegates first-search indexing and search to the context artifact service", async () => {
    await handleContextTool("codebase_context_search", {
      projectPath: TEST_PATH,
      query: "test query",
    });

    expect(mockIndexAllArtifacts).toHaveBeenCalledOnce();
    expect(mockEnsureArtifactsIndexed).not.toHaveBeenCalled();
    expect(mockSearchArtifacts).toHaveBeenCalledOnce();
  });

  it("delegates staleness checks for an existing context collection", async () => {
    mockGetCollectionInfo.mockResolvedValue({ pointsCount: 1 });

    await handleContextTool("codebase_context_search", {
      projectPath: TEST_PATH,
      query: "test query",
    });

    expect(mockIndexAllArtifacts).not.toHaveBeenCalled();
    expect(mockEnsureArtifactsIndexed).toHaveBeenCalledOnce();
    expect(mockEnsureArtifactsIndexed).toHaveBeenCalledWith(TEST_PATH);
    expect(mockSearchArtifacts).toHaveBeenCalledOnce();
  });
});
