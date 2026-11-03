// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

/**
 * Unit tests for the "remove" tool handlers:
 *   - codebase_remove      (index-tools.ts)
 *   - codebase_graph_remove (graph-tools.ts)
 *   - codebase_context_remove (context-tools.ts)
 *
 * All external services are mocked — no Docker required.
 */

import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────

vi.mock("../../src/services/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ── indexer.js mock ──────────────────────────────────────────────────────

const mockIsIndexingInProgress = vi.fn((_path: string) => false);
const mockRequestCancellation = vi.fn((_path: string) => true);
const mockRemoveProjectIndex = vi.fn(async (_path: string) => {});
const mockGetIndexingProgress = vi.fn((_path: string) => null);
const mockSetIndexingProgress = vi.fn((..._args: unknown[]) => {});
const mockIndexProject = vi.fn(async (..._args: unknown[]) => ({ filesIndexed: 0, chunksCreated: 0, cancelled: false }));
const mockUpdateProjectIndex = vi.fn(async (..._args: unknown[]) => ({ added: 0, updated: 0, removed: 0, chunksCreated: 0, cancelled: false }));
const mockProjectReclamationInventory = vi.fn(
  async (): Promise<{ entries: unknown[]; unrecognisedMetadata: unknown[]; unattributedCollections: unknown[] }> => ({
    entries: [],
    unrecognisedMetadata: [],
    unattributedCollections: [],
  }),
);
const mockRemoveProjectReclamationEntry = vi.fn(async (..._args: unknown[]): Promise<unknown[]> => []);
const mockGetIndexingInProgressProjects = vi.fn((): string[] => []);
const mockInvalidateProjectHashesForIdentity = vi.fn((_identity: string) => {});

vi.mock("../../src/services/indexer.js", () => ({
  isIndexingInProgress: (...args: unknown[]) => mockIsIndexingInProgress(...(args as [string])),
  requestCancellation: (...args: unknown[]) => mockRequestCancellation(...(args as [string])),
  removeProjectIndex: (...args: unknown[]) => mockRemoveProjectIndex(...(args as [string])),
  getIndexingProgress: (...args: unknown[]) => mockGetIndexingProgress(...(args as [string])),
  setIndexingProgress: (...args: unknown[]) => mockSetIndexingProgress(...args),
  indexProject: (...args: unknown[]) => mockIndexProject(...args),
  updateProjectIndex: (...args: unknown[]) => mockUpdateProjectIndex(...args),
  getIndexingInProgressProjects: () => mockGetIndexingInProgressProjects(),
  invalidateProjectHashesForIdentity: (...args: unknown[]) => mockInvalidateProjectHashesForIdentity(...(args as [string])),
}));

// ── code-graph.js mock ──────────────────────────────────────────────────

const mockIsGraphBuildInProgress = vi.fn((_path: string) => false);
const mockAwaitGraphBuild = vi.fn(async (_path: string) => {});
const mockRemoveGraph = vi.fn(async (_path: string) => {});
const mockGetExistingGraph = vi.fn(async () => null);
const mockGetOrBuildGraph = vi.fn(async () => ({ nodes: [], edges: [] }));
const mockGetGraphBuildInProgressProjects = vi.fn((): string[] => []);
const mockInvalidateGraphCacheForIdentity = vi.fn((_identity: string) => {});

vi.mock("../../src/services/code-graph.js", () => ({
  isGraphBuildInProgress: (...args: unknown[]) => mockIsGraphBuildInProgress(...(args as [string])),
  awaitGraphBuild: (...args: unknown[]) => mockAwaitGraphBuild(...(args as [string])),
  invalidateGraphCache: vi.fn(),
  invalidateGraphCacheForIdentity: (...args: unknown[]) => mockInvalidateGraphCacheForIdentity(...(args as [string])),
  getGraphBuildInProgressProjects: () => mockGetGraphBuildInProgressProjects(),
  removeGraph: (...args: unknown[]) => mockRemoveGraph(...(args as [string])),
  // graph-tools imports — provide stubs for unused functions
  findCircularDependencies: vi.fn(() => []),
  generateMermaidDiagram: vi.fn(() => ""),
  getFileDependencies: vi.fn(() => ({ imports: [], importedBy: [] })),
  getGraphBuildProgress: vi.fn(() => null),
  getGraphStats: vi.fn(),
  getGraphStatus: vi.fn(async () => null),
  getLastGraphBuildCompleted: vi.fn(() => null),
  getExistingGraph: (...args: unknown[]) => mockGetExistingGraph(...args),
  getOrBuildGraph: (...args: unknown[]) => mockGetOrBuildGraph(...args),
  rebuildGraph: vi.fn(async () => ({ nodes: [], edges: [] })),
}));

// ── watcher.js mock ─────────────────────────────────────────────────────

const mockIsWatching = vi.fn((_path: string) => false);
const mockGetWatchedProjects = vi.fn((): string[] => []);
const mockStopWatching = vi.fn(async (_path: string) => {});
const mockStartWatching = vi.fn(async () => true);
const mockStartWatchingAutomatically = vi.fn(async () => true);

vi.mock("../../src/services/watcher.js", () => ({
  isWatching: (...args: unknown[]) => mockIsWatching(...(args as [string])),
  stopWatching: (...args: unknown[]) => mockStopWatching(...(args as [string])),
  startWatching: (...args: unknown[]) => mockStartWatching(...args),
  startWatchingAutomatically: (...args: unknown[]) => mockStartWatchingAutomatically(...args),
  getWatchedProjects: () => mockGetWatchedProjects(),
  ensureWatcherStarted: vi.fn(),
}));

// ── docker.js mock ──────────────────────────────────────────────────────

const mockEnsureQdrantReady = vi.fn(async () => ({ pulled: false, started: false }));

vi.mock("../../src/services/docker.js", () => ({
  ensureQdrantReady: (...args: unknown[]) => mockEnsureQdrantReady(...args),
  isDockerAvailable: vi.fn(async () => true),
}));

// ── embedding mocks ─────────────────────────────────────────────────────

vi.mock("../../src/services/embedding-config.js", () => ({
  getEmbeddingConfig: vi.fn(() => ({ embeddingModel: "test-model" })),
}));

vi.mock("../../src/services/embedding-provider.js", () => ({
  getEmbeddingProvider: vi.fn(async () => ({
    ensureReady: async () => ({ imagePulled: false, containerStarted: false, modelPulled: false }),
  })),
}));

vi.mock("../../src/services/index-profile.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ensureEffectiveEmbeddingReady: vi.fn(async () => ({
    imagePulled: false,
    containerStarted: false,
    modelPulled: false,
  })),
}));

// ── lock.js mock ────────────────────────────────────────────────────────

const mockIsProjectLocked = vi.fn(async (_path: string, _op: string) => false);
const mockIsProjectIdentityLocked = vi.fn(async (_identity: string, _op: string) => false);
const mockTerminateLockHolder = vi.fn(async (_path: string, _op: string) => ({ terminated: false, pid: null as number | null }));

vi.mock("../../src/services/lock.js", () => ({
  holdsProjectLock: vi.fn(() => false),
  isProjectLocked: (...args: unknown[]) => mockIsProjectLocked(...(args as [string, string])),
  isProjectIdentityLocked: (...args: unknown[]) => mockIsProjectIdentityLocked(...(args as [string, string])),
  terminateLockHolder: (...args: unknown[]) => mockTerminateLockHolder(...(args as [string, string])),
}));

// ── context-artifacts.js mock ───────────────────────────────────────────

const mockRemoveAllArtifacts = vi.fn(async (_path: string) => {});

vi.mock("../../src/services/context-artifacts.js", () => ({
  removeAllArtifacts: (...args: unknown[]) => mockRemoveAllArtifacts(...(args as [string])),
  loadConfig: vi.fn(async () => null),
  indexAllArtifacts: vi.fn(async () => ({ indexed: [], errors: [] })),
  ensureArtifactsIndexed: vi.fn(async () => ({ reindexed: [], upToDate: [], errors: [] })),
  searchArtifacts: vi.fn(async () => []),
  getContextIndexingInProgressProjects: () => mockGetContextIndexingInProgressProjects(),
}));

// ── reclamation-barrier.js / symbol-graph-cache.js mocks ────────────────

const mockGetContextIndexingInProgressProjects = vi.fn((): string[] => []);
const mockBarrierRelease = vi.fn(async () => {});
const mockBarrierCompromised = vi.fn(() => false);
type FakeBarrier = { isCompromised: () => boolean; release: () => Promise<void> };
const fakeBarrier = (): FakeBarrier => ({ isCompromised: mockBarrierCompromised, release: mockBarrierRelease });
const mockAcquireReclamationBarrier = vi.fn(async (_identity: string): Promise<FakeBarrier | null> => fakeBarrier());
const mockDropSymbolGraphCache = vi.fn((_identity: string) => {});

vi.mock("../../src/services/reclamation-barrier.js", () => ({
  acquireReclamationBarrier: (...args: unknown[]) => mockAcquireReclamationBarrier(...(args as [string])),
  WRITER_OPERATIONS: ["index", "watch", "graph", "context"],
}));

vi.mock("../../src/services/symbol-graph-cache.js", () => ({
  dropSymbolGraphCache: (...args: unknown[]) => mockDropSymbolGraphCache(...(args as [string])),
}));

// ── qdrant.js mock ──────────────────────────────────────────────────────

vi.mock("../../src/services/qdrant.js", () => ({
  getCollectionInfo: vi.fn(async () => null),
  loadContextMetadata: vi.fn(async () => null),
  loadEffectiveIndexProfileForCollection: vi.fn(async () => ({
    embedding: { provider: "ollama", model: "test", dimensions: 3 },
  })),
  getProjectReclamationInventory: (...args: unknown[]) => mockProjectReclamationInventory(...args),
  removeProjectReclamationEntry: (...args: unknown[]) => mockRemoveProjectReclamationEntry(...args),
}));

vi.mock("../../src/services/symbol-graph-store.js", () => ({
  resetSymbolGraphCollectionCache: vi.fn(),
}));

// ── ollama.js mock ──────────────────────────────────────────────────────

vi.mock("../../src/services/ollama.js", () => ({
  ensureOllamaReady: vi.fn(async () => {}),
}));

// ── config.js mock ──────────────────────────────────────────────────────

vi.mock("../../src/config.js", () => ({
  projectIdFromPath: vi.fn(() => "test-project-id"),
  collectionName: vi.fn(() => "codebase_test-project-id"),
  contextCollectionName: vi.fn(() => "context_test"),
}));

// ── constants.js mock ───────────────────────────────────────────────────

vi.mock("../../src/constants.js", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, QDRANT_MODE: "managed" };
});

// ── Imports (after mocks) ────────────────────────────────────────────────

import { handleContextTool } from "../../src/tools/context-tools.js";
import { handleGraphTool } from "../../src/tools/graph-tools.js";
import { handleIndexTool } from "../../src/tools/index-tools.js";

// ── Tests ────────────────────────────────────────────────────────────────

const TEST_PATH = path.resolve("/tmp/test-project");

function reclamationEntry(overrides: Record<string, unknown> = {}) {
  return {
    identity: "old-index",
    projectPath: "/missing/project",
    canonicalPath: null,
    pathState: "absent-on-this-host",
    resourceCollections: ["codebase_old-index"],
    metadataRecords: [
      {
        pointId: "point-1",
        collectionName: "codebase_old-index",
        projectPath: "/missing/project",
        indexingStatus: "completed",
        lastIndexedAt: "2026-09-11T00:00:00.000Z",
        lastBuiltAt: null,
        builtByVersion: null,
      },
    ],
    inProgress: false,
    possibleSuperseded: false,
    requiresManualInspection: false,
    manualInspectionReasons: [],
    confirmationToken: "fresh-token",
    ...overrides,
  };
}

function inventoryOf(...entries: unknown[]) {
  return { entries, unrecognisedMetadata: [] as unknown[], unattributedCollections: [] as unknown[] };
}

describe("manual indexing mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SOCRATICODE_WATCHER;
  });

  afterEach(() => {
    delete process.env.SOCRATICODE_WATCHER;
  });

  it("rejects codebase_watch start in off mode before infrastructure or catch-up work", async () => {
    process.env.SOCRATICODE_WATCHER = "off";

    const result = await handleIndexTool("codebase_watch", {
      projectPath: TEST_PATH,
      action: "start",
    });

    expect(result).toContain("File watcher disabled by SOCRATICODE_WATCHER=off");
    expect(mockEnsureQdrantReady).not.toHaveBeenCalled();
    expect(mockUpdateProjectIndex).not.toHaveBeenCalled();
    expect(mockStartWatching).not.toHaveBeenCalled();
  });

  it("does not lazily build a missing graph in manual mode", async () => {
    process.env.SOCRATICODE_WATCHER = "manual";
    mockGetExistingGraph.mockResolvedValueOnce(null);

    const result = await handleGraphTool("codebase_graph_stats", {
      projectPath: TEST_PATH,
    });

    expect(result).toContain("Automatic graph creation is disabled");
    expect(result).toContain("codebase_graph_build");
    expect(mockGetExistingGraph).toHaveBeenCalledWith(TEST_PATH);
    expect(mockGetOrBuildGraph).not.toHaveBeenCalled();
  });

  it("preserves lazy graph creation in the default mode", async () => {
    await handleGraphTool("codebase_graph_stats", {
      projectPath: TEST_PATH,
    });

    expect(mockGetOrBuildGraph).toHaveBeenCalledWith(TEST_PATH);
    expect(mockGetExistingGraph).not.toHaveBeenCalled();
  });

  it("preserves post-update automatic watcher startup in the default mode", async () => {
    const result = await handleIndexTool("codebase_update", {
      projectPath: TEST_PATH,
    });

    expect(result).toContain("Updated project index");
    expect(mockStartWatchingAutomatically).toHaveBeenCalledWith(TEST_PATH);
    expect(mockStartWatching).not.toHaveBeenCalled();
  });

  it("preserves post-index automatic watcher startup in the default mode", async () => {
    const result = await handleIndexTool("codebase_index", {
      projectPath: TEST_PATH,
    });

    expect(result).toContain("Indexing started in the background");
    await vi.waitFor(() => {
      expect(mockStartWatchingAutomatically).toHaveBeenCalledWith(TEST_PATH);
    });
    expect(mockStartWatching).not.toHaveBeenCalled();
  });
});

describe("codebase_remove — stops all in-flight operations before deleting", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("removes index immediately when nothing is in-flight", async () => {
    const result = await handleIndexTool("codebase_remove", { projectPath: TEST_PATH });

    expect(result).toContain("Removed");
    expect(mockRemoveProjectIndex).toHaveBeenCalledOnce();
    expect(mockRequestCancellation).not.toHaveBeenCalled();
    expect(mockAwaitGraphBuild).not.toHaveBeenCalled();
  });

  it("stops the watcher before removing", async () => {
    mockIsWatching.mockReturnValueOnce(true);

    const result = await handleIndexTool("codebase_remove", { projectPath: TEST_PATH });

    expect(result).toContain("Removed");
    expect(mockStopWatching).toHaveBeenCalledOnce();
    // Watcher stopped before index removed
    expect(mockStopWatching.mock.invocationCallOrder[0])
      .toBeLessThan(mockRemoveProjectIndex.mock.invocationCallOrder[0]);
  });

  it("cancels in-progress indexing and waits for drain", async () => {
    // Simulate indexing that drains after cancellation
    let callCount = 0;
    mockIsIndexingInProgress.mockImplementation(() => {
      callCount++;
      // Return true for the initial check and first few polls, then false
      return callCount <= 3;
    });

    const result = await handleIndexTool("codebase_remove", { projectPath: TEST_PATH });

    expect(result).toContain("Removed");
    expect(mockRequestCancellation).toHaveBeenCalledOnce();
    expect(mockRemoveProjectIndex).toHaveBeenCalledOnce();
  });

  it("refuses remove if same-process indexing does not drain within timeout", async () => {
    vi.useFakeTimers();
    // Simulate indexing that never stops — handler must refuse to delete to prevent corruption
    mockIsIndexingInProgress.mockReturnValue(true);

    // Start the handler — it will block on the 5-minute drain loop
    const resultPromise = handleIndexTool("codebase_remove", { projectPath: TEST_PATH });

    // Advance past the 5-minute same-process drain timeout
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1_000);

    const result = await resultPromise;

    expect(result).toContain("Cannot remove");
    expect(result).toContain("indexing is still running");
    // Index must NOT be deleted — it's still being written to
    expect(mockRemoveProjectIndex).not.toHaveBeenCalled();
    expect(mockRequestCancellation).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("waits for in-flight graph build before removing", async () => {
    mockIsGraphBuildInProgress.mockReturnValueOnce(true);

    const result = await handleIndexTool("codebase_remove", { projectPath: TEST_PATH });

    expect(result).toContain("Removed");
    expect(mockAwaitGraphBuild).toHaveBeenCalledOnce();
    // Graph build awaited before index removed
    expect(mockAwaitGraphBuild.mock.invocationCallOrder[0])
      .toBeLessThan(mockRemoveProjectIndex.mock.invocationCallOrder[0]);
  });

  it("SIGTERMs a cross-process watcher and waits for lock release before removing", async () => {
    // Another process is holding the watch lock; releases it after SIGTERM
    mockIsProjectLocked
      .mockResolvedValueOnce(true)   // initial check: watch lock is held
      .mockResolvedValue(false);     // after SIGTERM: lock released on next poll
    mockTerminateLockHolder.mockResolvedValueOnce({ terminated: true, pid: 9999 });

    const result = await handleIndexTool("codebase_remove", { projectPath: TEST_PATH });

    expect(result).toContain("Removed");
    expect(mockTerminateLockHolder).toHaveBeenCalledWith(expect.any(String), "watch");
    expect(mockRemoveProjectIndex).toHaveBeenCalledOnce();
  });

  it("SIGTERMs a cross-process indexing operation and waits for lock release before removing", async () => {
    // Another process is holding the index lock; releases it after SIGTERM
    mockIsProjectLocked
      .mockResolvedValueOnce(false)  // watch lock check: not held
      .mockResolvedValueOnce(true)   // index lock check: held
      .mockResolvedValue(false);     // after SIGTERM: lock released on next poll
    mockTerminateLockHolder.mockResolvedValueOnce({ terminated: true, pid: 8888 });

    const result = await handleIndexTool("codebase_remove", { projectPath: TEST_PATH });

    expect(result).toContain("Removed");
    expect(mockTerminateLockHolder).toHaveBeenCalledWith(expect.any(String), "index");
    expect(mockRemoveProjectIndex).toHaveBeenCalledOnce();
  });

  it("handles all three: watcher + indexing + graph build", async () => {
    mockIsWatching.mockReturnValueOnce(true);
    let indexingCallCount = 0;
    mockIsIndexingInProgress.mockImplementation(() => {
      indexingCallCount++;
      return indexingCallCount <= 2;
    });
    mockIsGraphBuildInProgress.mockReturnValueOnce(true);

    const result = await handleIndexTool("codebase_remove", { projectPath: TEST_PATH });

    expect(result).toContain("Removed");
    expect(mockStopWatching).toHaveBeenCalledOnce();
    expect(mockRequestCancellation).toHaveBeenCalledOnce();
    expect(mockAwaitGraphBuild).toHaveBeenCalledOnce();
    expect(mockRemoveProjectIndex).toHaveBeenCalledOnce();
  });
});

describe("codebase_prune — explicit identity reclamation", () => {
  const applyFor = (entry: { identity: string; confirmationToken: string }, overrides: Record<string, unknown> = {}) => ({
    apply: true,
    identity: entry.identity,
    confirmationToken: entry.confirmationToken,
    acknowledgeNoRemoteWriters: true,
    ...overrides,
  });

  beforeEach(() => {
    vi.resetAllMocks();
    mockIsIndexingInProgress.mockReturnValue(false);
    mockIsWatching.mockReturnValue(false);
    mockIsProjectIdentityLocked.mockResolvedValue(false);
    mockGetIndexingInProgressProjects.mockReturnValue([]);
    mockGetWatchedProjects.mockReturnValue([]);
    mockGetGraphBuildInProgressProjects.mockReturnValue([]);
    mockGetContextIndexingInProgressProjects.mockReturnValue([]);
    mockBarrierRelease.mockResolvedValue(undefined);
    mockBarrierCompromised.mockReturnValue(false);
    mockAcquireReclamationBarrier.mockResolvedValue(fakeBarrier());
    mockRemoveProjectReclamationEntry.mockResolvedValue([]);
    mockProjectReclamationInventory.mockResolvedValue(inventoryOf());
  });

  it("reports path states as observations and lists what needs a person, with point ids", async () => {
    mockProjectReclamationInventory.mockResolvedValueOnce({
      entries: [
        reclamationEntry(),
        reclamationEntry({
          identity: "remote-index",
          projectPath: "/network/project",
          pathState: "unknown/inaccessible",
          possibleSuperseded: true,
          inProgress: true,
          requiresManualInspection: true,
          manualInspectionReasons: ["metadata records disagree about the path: /network/project, /other"],
          confirmationToken: "remote-token",
        }),
      ],
      unrecognisedMetadata: [
        { pointId: "point-9", collectionName: "weird_thing", projectPath: null, reason: "collectionName is outside the configured prefix or not a known resource family" },
      ],
      unattributedCollections: [
        { name: "context_docs_symgraph_file", reason: "name fits context_docs (symgraph) or docs_symgraph_file (family) and the store does not settle which", candidateIdentities: ["context_docs", "docs_symgraph_file"] },
      ],
    });

    const result = await handleIndexTool("codebase_prune", {});

    expect(result).toContain("absent-on-this-host");
    expect(result).toContain("unknown/inaccessible");
    expect(result).toContain("not proof that an identity is stale");
    expect(result).toContain("possible-superseded");
    expect(result).toContain("Indexing in progress");
    expect(result).toContain("Metadata: codebase_old-index [point point-1] status=completed");
    expect(result).toContain("point point-9: collectionName=weird_thing projectPath=(none) — collectionName is outside the configured prefix");
    expect(result).toContain("context_docs_symgraph_file — name fits context_docs (symgraph) or docs_symgraph_file (family)");
    expect(result).toContain("Manual inspection required: metadata records disagree");
    expect(result).not.toContain("candidate");
  });

  it("refuses to apply without the shared-store acknowledgement, before reading anything", async () => {
    const entry = reclamationEntry();
    const result = await handleIndexTool("codebase_prune", applyFor(entry, { acknowledgeNoRemoteWriters: undefined }));

    expect(result).toContain("acknowledgeNoRemoteWriters");
    expect(mockProjectReclamationInventory).not.toHaveBeenCalled();
    expect(mockAcquireReclamationBarrier).not.toHaveBeenCalled();
    expect(mockRemoveProjectReclamationEntry).not.toHaveBeenCalled();
  });

  it("requires a fresh token for the exact inventoried identity", async () => {
    mockProjectReclamationInventory.mockResolvedValueOnce(inventoryOf(reclamationEntry({ confirmationToken: "new-token" })));

    const result = await handleIndexTool("codebase_prune", applyFor({ identity: "old-index", confirmationToken: "old-token" }));

    expect(result).toContain("inventory changed");
    expect(mockAcquireReclamationBarrier).not.toHaveBeenCalled();
    expect(mockRemoveProjectReclamationEntry).not.toHaveBeenCalled();
  });

  it("refuses an identity whose metadata reports indexing in progress", async () => {
    const entry = reclamationEntry({ inProgress: true });
    mockProjectReclamationInventory.mockResolvedValueOnce(inventoryOf(entry));

    const result = await handleIndexTool("codebase_prune", applyFor(entry));

    expect(result).toContain("indexing in progress");
    expect(mockRemoveProjectReclamationEntry).not.toHaveBeenCalled();
  });

  it("refuses an identity that cannot be established safely", async () => {
    const entry = reclamationEntry({
      requiresManualInspection: true,
      manualInspectionReasons: ["metadata records disagree about the path: /a, /b"],
    });
    mockProjectReclamationInventory.mockResolvedValueOnce(inventoryOf(entry));

    const result = await handleIndexTool("codebase_prune", applyFor(entry));

    expect(result).toContain("cannot be established safely (metadata records disagree about the path: /a, /b)");
    expect(mockRemoveProjectReclamationEntry).not.toHaveBeenCalled();
  });

  it("refuses every candidate of an unattributed collection, before any delete", async () => {
    const reason = "collection context_docs_symgraph_meta fits this identity and another; the store does not settle which";
    const candidates = [
      reclamationEntry({ identity: "context_docs", requiresManualInspection: true, manualInspectionReasons: [reason], confirmationToken: "t1" }),
      reclamationEntry({ identity: "docs_symgraph_meta", requiresManualInspection: true, manualInspectionReasons: [reason], confirmationToken: "t2" }),
    ];
    mockProjectReclamationInventory.mockResolvedValue({
      entries: candidates,
      unrecognisedMetadata: [],
      unattributedCollections: [{ name: "context_docs_symgraph_meta", reason, candidateIdentities: ["context_docs", "docs_symgraph_meta"] }],
    });

    for (const entry of candidates) {
      const result = await handleIndexTool("codebase_prune", applyFor(entry));
      expect(result).toContain(`Refusing to delete ${entry.identity}: its identity cannot be established safely`);
      expect(result).toContain("context_docs_symgraph_meta fits this identity and another");
    }
    expect(mockAcquireReclamationBarrier).not.toHaveBeenCalled();
    expect(mockRemoveProjectReclamationEntry).not.toHaveBeenCalled();
  });

  it("stops deleting when the barrier is lost mid-cleanup, and never reports success", async () => {
    const entry = reclamationEntry({ resourceCollections: ["codebase_old-index", "codegraph_old-index"] });
    mockProjectReclamationInventory.mockResolvedValue(inventoryOf(entry));
    mockRemoveProjectReclamationEntry.mockImplementationOnce(async (_entry: unknown, mayContinue?: unknown) => {
      const ask = mayContinue as () => boolean;
      expect(ask()).toBe(true);
      // The barrier is lost while the first delete is in flight.
      mockBarrierCompromised.mockReturnValue(true);
      expect(ask()).toBe(false);
      return [
        { resource: "codebase_old-index", kind: "collection", outcome: "deleted" },
        { resource: "codegraph_old-index", kind: "collection", outcome: "skipped", error: "the reclamation barrier was lost before this write" },
        { resource: "codebase_old-index [point point-1]", kind: "metadata", outcome: "skipped", error: "the reclamation barrier was lost before this write" },
      ];
    });

    const result = await handleIndexTool("codebase_prune", applyFor(entry));

    expect(result).toContain("Cleanup for old-index is incomplete");
    expect(result).toContain("barrier was lost during cleanup");
    expect(result).toContain("skipped: collection codegraph_old-index");
    expect(result).not.toContain("Removed all");
    expect(mockBarrierRelease).toHaveBeenCalledTimes(1);
  });

  it("treats a lock that cannot be inspected as held", async () => {
    const entry = reclamationEntry();
    mockProjectReclamationInventory.mockResolvedValueOnce(inventoryOf(entry));
    mockIsProjectIdentityLocked.mockRejectedValueOnce(new Error("Could not inspect the index lock for old-index: EACCES"));

    const result = await handleIndexTool("codebase_prune", applyFor(entry));

    expect(result).toContain("Refusing to delete old-index: Could not inspect the index lock");
    expect(mockAcquireReclamationBarrier).not.toHaveBeenCalled();
    expect(mockRemoveProjectReclamationEntry).not.toHaveBeenCalled();
  });

  it("refuses while another process holds a writer lock", async () => {
    const entry = reclamationEntry();
    mockProjectReclamationInventory.mockResolvedValueOnce(inventoryOf(entry));
    mockIsProjectIdentityLocked.mockImplementation(async (_identity: string, operation: string) => operation === "watch");

    const result = await handleIndexTool("codebase_prune", applyFor(entry));

    expect(result).toContain("watch lock is held by another process");
    expect(mockRemoveProjectReclamationEntry).not.toHaveBeenCalled();
  });

  it.each([
    ["a graph build", mockGetGraphBuildInProgressProjects, "graph build is in progress"],
    ["context indexing", mockGetContextIndexingInProgressProjects, "context artifacts are being indexed"],
    ["an indexer", mockGetIndexingInProgressProjects, "indexing is in progress"],
    ["a watcher", mockGetWatchedProjects, "a watcher is running"],
  ])("refuses while %s is active on the stored path", async (_what, registry, message) => {
    const entry = reclamationEntry();
    mockProjectReclamationInventory.mockResolvedValueOnce(inventoryOf(entry));
    registry.mockReturnValue(["/missing/project"]);

    const result = await handleIndexTool("codebase_prune", applyFor(entry));

    expect(result).toContain(message);
    expect(mockRemoveProjectReclamationEntry).not.toHaveBeenCalled();
  });

  it("refuses when the barrier cannot be taken", async () => {
    const entry = reclamationEntry();
    mockProjectReclamationInventory.mockResolvedValueOnce(inventoryOf(entry));
    mockAcquireReclamationBarrier.mockResolvedValueOnce(null);

    const result = await handleIndexTool("codebase_prune", applyFor(entry));

    expect(result).toContain("barrier");
    expect(mockRemoveProjectReclamationEntry).not.toHaveBeenCalled();
  });

  it("catches a writer that starts after the former final check, and releases the barrier", async () => {
    const entry = reclamationEntry();
    mockProjectReclamationInventory.mockResolvedValue(inventoryOf(entry));
    mockGetIndexingInProgressProjects.mockReturnValueOnce([]).mockReturnValueOnce(["/missing/project"]);

    const result = await handleIndexTool("codebase_prune", applyFor(entry));

    expect(result).toContain("indexing is in progress");
    expect(mockAcquireReclamationBarrier).toHaveBeenCalledWith("old-index");
    expect(mockRemoveProjectReclamationEntry).not.toHaveBeenCalled();
    expect(mockBarrierRelease).toHaveBeenCalledTimes(1);
  });

  it("refuses when a barrier lock was lost before the delete", async () => {
    const entry = reclamationEntry();
    mockProjectReclamationInventory.mockResolvedValue(inventoryOf(entry));
    mockBarrierCompromised.mockReturnValue(true);

    const result = await handleIndexTool("codebase_prune", applyFor(entry));

    expect(result).toContain("barrier was lost");
    expect(mockRemoveProjectReclamationEntry).not.toHaveBeenCalled();
    expect(mockBarrierRelease).toHaveBeenCalledTimes(1);
  });

  it.each(["graph", "context"])("refuses while another process holds the %s lock", async (operation) => {
    const entry = reclamationEntry();
    mockProjectReclamationInventory.mockResolvedValueOnce(inventoryOf(entry));
    mockIsProjectIdentityLocked.mockImplementation(async (_identity: string, candidate: string) => candidate === operation);

    const result = await handleIndexTool("codebase_prune", applyFor(entry));

    expect(result).toContain(`${operation} lock is held by another process`);
    expect(mockRemoveProjectReclamationEntry).not.toHaveBeenCalled();
  });

  it("refuses when the inventory changed between the preview and the barrier", async () => {
    const entry = reclamationEntry();
    mockProjectReclamationInventory
      .mockResolvedValueOnce(inventoryOf(entry))
      .mockResolvedValueOnce(inventoryOf(reclamationEntry({ confirmationToken: "moved-token" })));

    const result = await handleIndexTool("codebase_prune", applyFor(entry));

    expect(result).toContain("inventory changed");
    expect(mockRemoveProjectReclamationEntry).not.toHaveBeenCalled();
    expect(mockBarrierRelease).toHaveBeenCalledTimes(1);
  });

  it("reports every resource and what is still stored when cleanup partially fails", async () => {
    const entry = reclamationEntry({ resourceCollections: ["codebase_old-index", "context_old-index"] });
    mockProjectReclamationInventory
      .mockResolvedValueOnce(inventoryOf(entry))
      .mockResolvedValueOnce(inventoryOf(entry))
      .mockResolvedValueOnce(inventoryOf(reclamationEntry({ resourceCollections: ["context_old-index"], metadataRecords: [] })));
    mockRemoveProjectReclamationEntry.mockResolvedValueOnce([
      { resource: "codebase_old-index", kind: "collection", outcome: "deleted" },
      { resource: "context_old-index", kind: "collection", outcome: "failed", error: "connection reset" },
      { resource: "codebase_old-index", kind: "metadata", outcome: "deleted" },
    ]);

    const result = await handleIndexTool("codebase_prune", applyFor(entry));

    expect(result).toContain("Cleanup for old-index is incomplete");
    expect(result).toContain("deleted: collection codebase_old-index");
    expect(result).toContain("failed: collection context_old-index (connection reset)");
    expect(result).toContain("Still stored after deletion:");
    expect(result).toContain("collection context_old-index");
    expect(mockBarrierRelease).toHaveBeenCalledTimes(1);
  });

  it("reports incomplete when the identity is still stored after every delete succeeded", async () => {
    const entry = reclamationEntry();
    mockProjectReclamationInventory.mockResolvedValue(inventoryOf(entry));
    mockRemoveProjectReclamationEntry.mockResolvedValueOnce([
      { resource: "codebase_old-index", kind: "collection", outcome: "deleted" },
      { resource: "codebase_old-index", kind: "metadata", outcome: "deleted" },
    ]);

    const result = await handleIndexTool("codebase_prune", applyFor(entry));

    expect(result).toContain("Cleanup for old-index is incomplete");
    expect(result).toContain("metadata codebase_old-index [point point-1]");
  });

  it("deletes under the barrier, invalidates by identity, and reports success only when nothing remains", async () => {
    const entry = reclamationEntry();
    mockProjectReclamationInventory
      .mockResolvedValueOnce(inventoryOf(entry))
      .mockResolvedValueOnce(inventoryOf(entry))
      .mockResolvedValueOnce(inventoryOf());
    mockRemoveProjectReclamationEntry.mockResolvedValueOnce([
      { resource: "codebase_old-index", kind: "collection", outcome: "deleted" },
      { resource: "codebase_old-index", kind: "metadata", outcome: "deleted" },
    ]);

    const result = await handleIndexTool("codebase_prune", applyFor(entry));

    expect(result).toContain("Removed all inventoried resources for identity: old-index");
    expect(mockRemoveProjectReclamationEntry).toHaveBeenCalledWith(entry, expect.any(Function));
    expect(mockInvalidateGraphCacheForIdentity).toHaveBeenCalledWith("old-index");
    expect(mockInvalidateProjectHashesForIdentity).toHaveBeenCalledWith("old-index");
    expect(mockDropSymbolGraphCache).toHaveBeenCalledWith("old-index");
    expect(mockBarrierRelease).toHaveBeenCalledTimes(1);
    const order = [
      mockAcquireReclamationBarrier.mock.invocationCallOrder[0],
      mockRemoveProjectReclamationEntry.mock.invocationCallOrder[0],
      mockBarrierRelease.mock.invocationCallOrder[0],
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("is safe to repeat after all resources have gone", async () => {
    const result = await handleIndexTool("codebase_prune", applyFor({ identity: "old-index", confirmationToken: "former-token" }));

    expect(result).toContain("Nothing to delete");
    expect(mockAcquireReclamationBarrier).not.toHaveBeenCalled();
    expect(mockRemoveProjectReclamationEntry).not.toHaveBeenCalled();
  });
});

describe("codebase_graph_remove — waits for in-flight graph build", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("removes graph immediately when no build is in-flight", async () => {
    const result = await handleGraphTool("codebase_graph_remove", { projectPath: TEST_PATH });

    expect(result).toContain("Removed");
    expect(mockRemoveGraph).toHaveBeenCalledOnce();
    expect(mockAwaitGraphBuild).not.toHaveBeenCalled();
  });

  it("awaits in-flight graph build before removing", async () => {
    mockIsGraphBuildInProgress.mockReturnValueOnce(true);

    const result = await handleGraphTool("codebase_graph_remove", { projectPath: TEST_PATH });

    expect(result).toContain("Removed");
    expect(mockAwaitGraphBuild).toHaveBeenCalledOnce();
    expect(mockRemoveGraph).toHaveBeenCalledOnce();
    // Await happened before remove
    expect(mockAwaitGraphBuild.mock.invocationCallOrder[0])
      .toBeLessThan(mockRemoveGraph.mock.invocationCallOrder[0]);
  });

  it("still removes graph even if the awaited build had failed", async () => {
    mockIsGraphBuildInProgress.mockReturnValueOnce(true);
    // awaitGraphBuild swallows errors internally — mock it as resolving normally
    // (the real implementation catches and swallows any rejection)
    mockAwaitGraphBuild.mockResolvedValueOnce(undefined);

    const result = await handleGraphTool("codebase_graph_remove", { projectPath: TEST_PATH });

    expect(result).toContain("Removed");
    expect(mockAwaitGraphBuild).toHaveBeenCalledOnce();
    expect(mockRemoveGraph).toHaveBeenCalledOnce();
  });
});

describe("codebase_context_remove — guards against concurrent indexing", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("removes artifacts when nothing is in-flight", async () => {
    const result = await handleContextTool("codebase_context_remove", { projectPath: TEST_PATH });

    expect(result).toContain("Removed");
    expect(mockRemoveAllArtifacts).toHaveBeenCalledOnce();
  });

  it("refuses removal when indexing is in progress", async () => {
    mockIsIndexingInProgress.mockReturnValueOnce(true);

    const result = await handleContextTool("codebase_context_remove", { projectPath: TEST_PATH });

    expect(result).toContain("Cannot remove");
    expect(result).toContain("indexing is in progress");
    expect(mockRemoveAllArtifacts).not.toHaveBeenCalled();
  });

  it("suggests using codebase_stop when blocked", async () => {
    mockIsIndexingInProgress.mockReturnValueOnce(true);

    const result = await handleContextTool("codebase_context_remove", { projectPath: TEST_PATH });

    expect(result).toContain("codebase_stop");
  });
});
