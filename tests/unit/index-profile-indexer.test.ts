// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CURRENT_INDEX_FORMAT_VERSION, type EffectiveIndexProfile } from "../../src/services/index-profile.js";

let collectionInfo: { pointsCount: number; status: string } | null = null;
let storedHashes: Map<string, string> | null = null;
let storedProfile: EffectiveIndexProfile | null = null;
let metadataWriteError: Error | null = null;
let tempRoot = "";

const savedMetadata: Array<{
  hashes: Map<string, string>;
  status: string;
  profile: EffectiveIndexProfile;
}> = [];
const deletedFiles: string[] = [];
const upsertedBatches: Array<Array<Record<string, unknown>>> = [];
const observedEmbeddingConfigs: Array<{
  provider: string;
  model: string;
  dimensions: number;
}> = [];
const observedCollectionDimensions: number[] = [];

vi.mock("../../src/services/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../src/services/embedding-provider.js", () => ({
  getEmbeddingProvider: vi.fn(async () => ({
    ensureReady: vi.fn(async () => ({
      modelPulled: false,
      containerStarted: false,
      imagePulled: false,
    })),
  })),
}));

vi.mock("../../src/services/embeddings.js", () => ({
  prepareDocumentText: vi.fn((
    content: string,
    filePath: string,
    profile: { documentPrefix: string; documentIncludesPath: boolean },
  ) => `${profile.documentPrefix}${profile.documentIncludesPath ? `${filePath}\n` : ""}${content}`),
  generateEmbeddings: vi.fn(async (texts: string[]) => {
    const { getEmbeddingConfig } = await import("../../src/services/embedding-config.js");
    const config = getEmbeddingConfig();
    observedEmbeddingConfigs.push({
      provider: config.embeddingProvider,
      model: config.embeddingModel,
      dimensions: config.embeddingDimensions,
    });
    return texts.map(() => Array.from({ length: config.embeddingDimensions }, () => 0.1));
  }),
}));

vi.mock("../../src/services/qdrant.js", () => ({
  deleteCollection: vi.fn(async () => undefined),
  deleteFileChunks: vi.fn(async (_collection: string, relativePath: string) => {
    deletedFiles.push(relativePath);
  }),
  deleteProjectMetadata: vi.fn(async () => undefined),
  ensureCollection: vi.fn(async () => {
    const { getEmbeddingConfig } = await import("../../src/services/embedding-config.js");
    observedCollectionDimensions.push(getEmbeddingConfig().embeddingDimensions);
  }),
  getCollectionInfo: vi.fn(async () => collectionInfo),
  getProjectMetadata: vi.fn(async () => null),
  // These fixtures record no metadata, so there is no persisted status either.
  // Returning null leaves the reconciliation gate closed, which is what these
  // tests assume: they exercise profile compatibility, not interrupted recovery.
  loadIndexingStatus: vi.fn(async () => null),
  listIndexedFilePaths: vi.fn(async () => new Set<string>()),
  loadProjectEffectiveProfile: vi.fn(async () => storedProfile),
  loadProjectHashes: vi.fn(async () =>
    storedHashes === null ? null : new Map(storedHashes),
  ),
  saveProjectMetadata: vi.fn(async (
    _collection: string,
    _projectPath: string,
    _filesTotal: number,
    _filesIndexed: number,
    hashes: Map<string, string>,
    status: string,
    profile: EffectiveIndexProfile,
  ) => {
    if (metadataWriteError) throw metadataWriteError;
    storedHashes = new Map(hashes);
    storedProfile = profile;
    savedMetadata.push({ hashes: new Map(hashes), status, profile });
  }),
  upsertPreEmbeddedChunks: vi.fn(async (
    _collection: string,
    points: Array<Record<string, unknown>>,
  ) => {
    upsertedBatches.push(points);
    return { pointsSkipped: 0 };
  }),
}));

vi.mock("../../src/services/code-graph.js", () => ({
  ensureDynamicLanguages: vi.fn(),
  getAstGrepLang: vi.fn(() => null),
  rebuildGraph: vi.fn(async () => ({ nodes: [], edges: [] })),
  removeGraph: vi.fn(async () => undefined),
  shouldRebuildGraph: vi.fn(async () => ({ rebuild: true, reason: "mocked", graphExists: true })),
}));

vi.mock("../../src/services/elixir-templates.js", () => ({
  analyzeElixirTemplate: vi.fn(() => null),
  ensureElixirTemplateParsers: vi.fn(async () => undefined),
  isElixirTemplateExtension: vi.fn(() => false),
}));

vi.mock("../../src/services/lock.js", () => ({
  acquireProjectLock: vi.fn(async () => true),
  // Consistent with the acquire above: a run that took the lock still holds it.
  // Without this the ownership guard on the listing refresh throws rather than
  // answering, and the refresh silently never happens.
  holdsProjectLock: vi.fn(() => true),
  releaseProjectLock: vi.fn(async () => undefined),
}));

vi.mock("../../src/services/symbol-graph-incremental.js", () => ({
  updateChangedFilesSymbolGraph: vi.fn(async () => ({ updated: 0, removed: 0 })),
}));

vi.mock("../../src/services/symbol-graph-store.js", () => ({
  loadSymbolGraphMeta: vi.fn(async () => null),
}));

const originalEnv = { ...process.env };

async function loadIndexer(overrides: Record<string, string> = {}) {
  vi.resetModules();
  process.env = {
    ...originalEnv,
    EMBEDDING_PROVIDER: "openai",
    EMBEDDING_MODEL: "requested-model",
    EMBEDDING_DIMENSIONS: "3",
    EMBEDDING_CONTEXT_LENGTH: "512",
    EMBEDDING_QUERY_PREFIX: "requested-query: ",
    EMBEDDING_DOCUMENT_PREFIX: "requested-document: ",
    EMBEDDING_DOCUMENT_INCLUDE_PATH: "false",
    MAX_CHUNK_CHARS: "20",
    MAX_FILE_SIZE_MB: "1",
    ...overrides,
  };
  return import("../../src/services/indexer.js");
}

/** Appears once, past the legacy cap, and nowhere else in the fixture. */
const OVER_CAP_MARKER = "zarquonLegacyTailMarker";

/**
 * A file past the 2,000-character legacy cap, short enough to stay one chunk.
 *
 * A fixture below the cap cannot tell the two representations apart: it is
 * stored whole either way. Only content that crosses the cap shows whether a
 * write to an existing collection truncates as its stored format 0/1 says, or
 * splits as format 2 would.
 */
function overCapText(): string {
  const filler = Array.from(
    { length: 80 },
    (_, i) => `line ${String(i).padStart(3, "0")}: settlement factor value ${i}`,
  ).join("\n");
  return `${filler}\n${OVER_CAP_MARKER}\n`;
}

async function createProject(relativePath: string, content: string): Promise<string> {
  const project = await fsp.mkdtemp(path.join(tempRoot, "project-"));
  const absolutePath = path.join(project, relativePath);
  await fsp.mkdir(path.dirname(absolutePath), { recursive: true });
  await fsp.writeFile(absolutePath, content);
  return project;
}

beforeEach(async () => {
  collectionInfo = null;
  storedHashes = null;
  storedProfile = null;
  metadataWriteError = null;
  savedMetadata.length = 0;
  deletedFiles.length = 0;
  upsertedBatches.length = 0;
  observedEmbeddingConfigs.length = 0;
  observedCollectionDimensions.length = 0;
  tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "socraticode-profile-indexer-"));
});

afterEach(async () => {
  process.env = { ...originalEnv };
  await fsp.rm(tempRoot, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe("code-index effective profile compatibility", () => {
  it("persists a legacy profile without changing points when source files are unchanged", async () => {
    const indexer = await loadIndexer();
    const content = "unchanged source";
    const project = await createProject("notes.txt", content);
    collectionInfo = { pointsCount: 1, status: "green" };
    storedHashes = new Map([["notes.txt", indexer.hashContent(content)]]);

    const result = await indexer.updateProjectIndex(project);

    expect(result).toMatchObject({ added: 0, updated: 0, removed: 0, chunksCreated: 0 });
    expect(deletedFiles).toEqual([]);
    expect(upsertedBatches).toEqual([]);
    expect(savedMetadata.at(-1)?.profile).toMatchObject({
      source: "legacy-adopted",
      indexFormatVersion: 0,
      queryPrefix: "search_query: ",
      documentPrefix: "search_document: ",
      documentIncludesPath: true,
      maxChunkChars: 2000,
    });
  });

  it("adds newly supported Godot files to an existing index without re-indexing unchanged files", async () => {
    const indexer = await loadIndexer();
    const { legacyIndexProfile } = await import("../../src/services/index-profile.js");
    const unchangedContent = "existing source";
    const project = await createProject("notes.txt", unchangedContent);
    await fsp.writeFile(path.join(project, "player.gd"), "extends Node\n");
    await fsp.writeFile(path.join(project, "level.tscn"), "[gd_scene format=3]\n");
    await fsp.writeFile(path.join(project, "material.tres"), "[gd_resource format=3]\n");
    collectionInfo = { pointsCount: 1, status: "green" };
    storedProfile = legacyIndexProfile("code");
    storedProfile.extensionLanguageMap = {};
    storedHashes = new Map([["notes.txt", indexer.hashContent(unchangedContent)]]);

    const result = await indexer.updateProjectIndex(project);

    expect(result).toMatchObject({ added: 3, updated: 0, removed: 0 });
    expect(deletedFiles).toEqual([]);
    const finalHashes = savedMetadata.at(-1)?.hashes;
    expect(finalHashes?.size).toBe(4);
    expect([...(finalHashes?.keys() ?? [])].sort()).toEqual([
      "level.tscn",
      "material.tres",
      "notes.txt",
      "player.gd",
    ]);
  });

  it("replaces a changed legacy file with the legacy document representation", async () => {
    const indexer = await loadIndexer();
    const content = "changed source content that is deliberately longer than twenty characters";
    const project = await createProject("notes.txt", content);
    collectionInfo = { pointsCount: 1, status: "green" };
    storedHashes = new Map([["notes.txt", indexer.hashContent("old source")]]);

    const result = await indexer.updateProjectIndex(project);

    expect(result.updated).toBe(1);
    expect(deletedFiles).toEqual(["notes.txt"]);
    const points = upsertedBatches.flat();
    expect(points).toHaveLength(1);
    expect(points[0].bm25Text).toBe(`search_document: notes.txt\n${content}`);
    expect((points[0].payload as { content: string }).content.length).toBeGreaterThan(20);
    expect(savedMetadata.at(-1)?.profile.source).toBe("legacy-adopted");
  });

  it("truncates an over-cap changed file while the collection stores format 0", async () => {
    const indexer = await loadIndexer({ MAX_CHUNK_CHARS: "2000" });
    const content = overCapText();
    expect(content.length).toBeGreaterThan(2000);
    expect(content.slice(0, 2000)).not.toContain(OVER_CAP_MARKER);
    const project = await createProject("notes.txt", content);
    collectionInfo = { pointsCount: 1, status: "green" };
    storedHashes = new Map([["notes.txt", indexer.hashContent("old source")]]);

    const result = await indexer.updateProjectIndex(project);

    expect(result.updated).toBe(1);
    const points = upsertedBatches.flat();
    expect(points).toHaveLength(1);
    const stored = (points[0].payload as { content: string }).content;
    expect(stored).toHaveLength(2000);
    expect(stored).not.toContain(OVER_CAP_MARKER);
    // The emitted representation and the persisted profile agree: an update
    // must not write format-2 chunks into a collection still declaring 0.
    expect(savedMetadata.at(-1)?.profile).toMatchObject({
      source: "legacy-adopted",
      indexFormatVersion: 0,
    });
  });

  it("truncates a newly discovered over-cap file while the collection stores format 0", async () => {
    const indexer = await loadIndexer({ MAX_CHUNK_CHARS: "2000" });
    const unchangedContent = "existing source";
    const project = await createProject("notes.txt", unchangedContent);
    await fsp.writeFile(path.join(project, "added.txt"), overCapText());
    collectionInfo = { pointsCount: 1, status: "green" };
    storedHashes = new Map([["notes.txt", indexer.hashContent(unchangedContent)]]);

    const result = await indexer.updateProjectIndex(project);

    expect(result).toMatchObject({ added: 1, updated: 0 });
    const points = upsertedBatches.flat();
    expect(points).toHaveLength(1);
    const stored = (points[0].payload as { content: string }).content;
    expect(stored).toHaveLength(2000);
    expect(stored).not.toContain(OVER_CAP_MARKER);
    expect(savedMetadata.at(-1)?.profile.indexFormatVersion).toBe(0);
  });

  it("splits the same over-cap changed file once the collection stores format 2", async () => {
    const indexer = await loadIndexer({ MAX_CHUNK_CHARS: "2000" });
    const { requestedIndexProfile } = await import("../../src/services/index-profile.js");
    const content = overCapText();
    const project = await createProject("notes.txt", content);
    collectionInfo = { pointsCount: 1, status: "green" };
    storedProfile = requestedIndexProfile("code");
    storedHashes = new Map([["notes.txt", indexer.hashContent("old source")]]);

    const result = await indexer.updateProjectIndex(project);

    expect(result.updated).toBe(1);
    const points = upsertedBatches.flat();
    expect(points.length).toBeGreaterThan(1);
    const stored = points.map((point) => (point.payload as { content: string }).content);
    expect(stored.some((text) => text.includes(OVER_CAP_MARKER))).toBe(true);
    for (const text of stored) expect(text.length).toBeLessThanOrEqual(2000);
    expect(savedMetadata.at(-1)?.profile.indexFormatVersion).toBe(CURRENT_INDEX_FORMAT_VERSION);
  });

  it("splits a newly discovered over-cap file once the collection stores format 2", async () => {
    const indexer = await loadIndexer({ MAX_CHUNK_CHARS: "2000" });
    const { requestedIndexProfile } = await import("../../src/services/index-profile.js");
    const unchangedContent = "existing source";
    const project = await createProject("notes.txt", unchangedContent);
    await fsp.writeFile(path.join(project, "added.txt"), overCapText());
    collectionInfo = { pointsCount: 1, status: "green" };
    storedProfile = requestedIndexProfile("code");
    storedHashes = new Map([["notes.txt", indexer.hashContent(unchangedContent)]]);

    const result = await indexer.updateProjectIndex(project);

    expect(result).toMatchObject({ added: 1, updated: 0 });
    const points = upsertedBatches.flat();
    expect(points.length).toBeGreaterThan(1);
    const stored = points.map((point) => (point.payload as { content: string }).content);
    expect(stored.some((text) => text.includes(OVER_CAP_MARKER))).toBe(true);
    for (const text of stored) expect(text.length).toBeLessThanOrEqual(2000);
    expect(savedMetadata.at(-1)?.profile.indexFormatVersion).toBe(CURRENT_INDEX_FORMAT_VERSION);
  });

  it("does not mutate vectors when the mandatory profile checkpoint fails", async () => {
    const indexer = await loadIndexer();
    const project = await createProject("notes.txt", "changed source content");
    collectionInfo = { pointsCount: 1, status: "green" };
    storedHashes = new Map([["notes.txt", indexer.hashContent("old source")]]);
    metadataWriteError = new Error("metadata write forbidden");

    await expect(indexer.updateProjectIndex(project)).rejects.toThrow(
      "metadata write forbidden",
    );

    expect(deletedFiles).toEqual([]);
    expect(upsertedBatches).toEqual([]);
  });

  it("continues using an adopted provider and model after requested values change", async () => {
    const indexer = await loadIndexer();
    const { legacyIndexProfile } = await import("../../src/services/index-profile.js");
    const adopted = legacyIndexProfile("code");
    adopted.embedding = {
      provider: "google",
      model: "adopted-model",
      dimensions: 4,
      contextLength: 1024,
      litellmSendDimensions: false,
    };
    const content = "changed source";
    const project = await createProject("notes.txt", content);
    collectionInfo = { pointsCount: 1, status: "green" };
    storedProfile = adopted;
    storedHashes = new Map([["notes.txt", indexer.hashContent("old source")]]);

    await indexer.updateProjectIndex(project);

    expect(observedEmbeddingConfigs).toContainEqual({
      provider: "google",
      model: "adopted-model",
      dimensions: 4,
    });
    expect(savedMetadata.at(-1)?.profile.embedding).toEqual(adopted.embedding);
  });

  it("keeps the stored profile for an empty collection until explicit removal", async () => {
    const indexer = await loadIndexer();
    const { legacyIndexProfile } = await import("../../src/services/index-profile.js");
    const project = await createProject(
      "notes.txt",
      "fresh source content that is deliberately longer than twenty characters",
    );
    collectionInfo = { pointsCount: 0, status: "green" };
    storedProfile = legacyIndexProfile("code", 7);
    storedHashes = new Map([["stale.txt", "stale-hash"]]);

    await indexer.indexProject(project);

    const effective = savedMetadata.at(-1)?.profile;
    expect(effective).toMatchObject({
      source: "legacy-adopted",
      indexFormatVersion: 0,
      queryPrefix: "search_query: ",
      documentPrefix: "search_document: ",
      documentIncludesPath: true,
      maxChunkChars: 2000,
    });
    expect(observedCollectionDimensions).toContain(7);
    const points = upsertedBatches.flat();
    expect(points.length).toBeGreaterThan(0);
    expect(points.every((point) =>
      (point.payload as { content: string }).content.length > 20
    )).toBe(true);
    expect(points.every((point) =>
      String(point.bm25Text).startsWith("search_document: notes.txt\n")
    )).toBe(true);
  });

  it("activates the requested profile after collection removal even if stale metadata remains", async () => {
    const indexer = await loadIndexer();
    const { legacyIndexProfile } = await import("../../src/services/index-profile.js");
    const project = await createProject(
      "notes.txt",
      "fresh source content that is deliberately longer than twenty characters",
    );
    collectionInfo = null;
    storedProfile = legacyIndexProfile("code");
    storedHashes = new Map([["stale.txt", "stale-hash"]]);

    await indexer.indexProject(project);

    expect(savedMetadata.at(-1)?.profile).toMatchObject({
      source: "fresh",
      // The current format version, whatever it is: this asserts that a fresh
      // index is stamped with this build's version, not a particular number.
      indexFormatVersion: CURRENT_INDEX_FORMAT_VERSION,
      queryPrefix: "requested-query: ",
      documentPrefix: "requested-document: ",
      documentIncludesPath: false,
      maxChunkChars: 20,
    });
    expect(savedMetadata.at(-1)?.hashes.has("stale.txt")).toBe(false);
    const points = upsertedBatches.flat();
    expect(points.length).toBeGreaterThan(0);
    expect(points.every((point) =>
      String(point.bm25Text).startsWith("requested-document: ") &&
      !String(point.bm25Text).includes("notes.txt\n")
    )).toBe(true);
  });

  it("keeps pending extension mapping and file-size changes inactive", async () => {
    const indexer = await loadIndexer({
      EXTENSION_LANGUAGE_MAP: ".js:python",
      MAX_FILE_SIZE_MB: "0.000001",
    });
    const { legacyIndexProfile } = await import("../../src/services/index-profile.js");
    const effective = legacyIndexProfile("code");
    effective.extensionLanguageMap = {};
    effective.maxFileBytes = 1_000_000;
    const content = "const value = 2;";
    const project = await createProject("app.js", content);
    collectionInfo = { pointsCount: 1, status: "green" };
    storedProfile = effective;
    storedHashes = new Map([["app.js", indexer.hashContent("const value = 1;")]]);

    const result = await indexer.updateProjectIndex(project);

    expect(result).toMatchObject({ updated: 1, removed: 0 });
    const points = upsertedBatches.flat();
    expect(points).toHaveLength(1);
    expect((points[0].payload as { language: string }).language).toBe("javascript");
    expect(savedMetadata.at(-1)?.profile.extensionLanguageMap).toEqual({});
    expect(savedMetadata.at(-1)?.profile.maxFileBytes).toBe(1_000_000);
  });

  it("removes old chunks and hashes when a file exceeds the effective size limit", async () => {
    const indexer = await loadIndexer();
    const { legacyIndexProfile } = await import("../../src/services/index-profile.js");
    const effective = legacyIndexProfile("code");
    effective.maxFileBytes = 10;
    const project = await createProject("notes.txt", "content larger than ten bytes");
    collectionInfo = { pointsCount: 1, status: "green" };
    storedProfile = effective;
    storedHashes = new Map([["notes.txt", "old-hash"]]);

    const result = await indexer.updateProjectIndex(project);

    expect(result).toMatchObject({ updated: 0, removed: 1, chunksCreated: 0 });
    expect(deletedFiles).toEqual(["notes.txt"]);
    expect(savedMetadata.at(-1)?.hashes.has("notes.txt")).toBe(false);
    expect(upsertedBatches).toEqual([]);
  });

  it("checkpoints the new hash when changed content produces zero chunks", async () => {
    const indexer = await loadIndexer();
    const { legacyIndexProfile } = await import("../../src/services/index-profile.js");
    const project = await createProject("notes.txt", "   \n\t\n");
    collectionInfo = { pointsCount: 1, status: "green" };
    storedProfile = legacyIndexProfile("code");
    storedHashes = new Map([["notes.txt", indexer.hashContent("old source")]]);

    const first = await indexer.updateProjectIndex(project);
    const deleteCount = deletedFiles.length;
    const second = await indexer.updateProjectIndex(project);

    expect(first).toMatchObject({ updated: 1, chunksCreated: 0 });
    expect(second).toMatchObject({ updated: 0, chunksCreated: 0 });
    expect(deletedFiles).toHaveLength(deleteCount);
    expect(savedMetadata.at(-1)?.hashes.get("notes.txt")).toBe(
      indexer.hashContent("   \n\t\n"),
    );
  });

  it("invokes exactly one full graph rebuild on a file update without double rebuilding", async () => {
    const indexer = await loadIndexer();
    const { legacyIndexProfile } = await import("../../src/services/index-profile.js");
    const { rebuildGraph } = await import("../../src/services/code-graph.js");
    const project = await createProject("notes.txt", "new changed content");
    collectionInfo = { pointsCount: 1, status: "green" };
    storedProfile = legacyIndexProfile("code");
    storedHashes = new Map([["notes.txt", indexer.hashContent("old source")]]);

    vi.mocked(rebuildGraph).mockClear();
    const result = await indexer.updateProjectIndex(project);

    expect(result.updated).toBe(1);
    expect(vi.mocked(rebuildGraph)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(rebuildGraph)).toHaveBeenCalledWith(project, { skipSymbolGraph: false });
  });

  it("does not rebuild the graph when no graph input changed", async () => {
    // The wiring, not the decision — that is covered against real builds in
    // graph-input-invalidation.test.ts. What this pins is that a "no" reaches
    // the gate and stops the rebuild, and that the update still succeeds.
    const indexer = await loadIndexer();
    const { legacyIndexProfile } = await import("../../src/services/index-profile.js");
    const { rebuildGraph, shouldRebuildGraph } = await import("../../src/services/code-graph.js");
    const project = await createProject("notes.txt", "new changed content");
    collectionInfo = { pointsCount: 1, status: "green" };
    storedProfile = legacyIndexProfile("code");
    storedHashes = new Map([["notes.txt", indexer.hashContent("old source")]]);

    vi.mocked(rebuildGraph).mockClear();
    vi.mocked(shouldRebuildGraph).mockResolvedValueOnce({
      rebuild: false,
      reason: "no graph input changed",
      graphExists: true,
    });
    const result = await indexer.updateProjectIndex(project);

    expect(result.updated).toBe(1);
    expect(vi.mocked(rebuildGraph)).not.toHaveBeenCalled();
  });

  it("asks with the change the update actually made", async () => {
    // A decision taken on the wrong change set is worse than no decision, so
    // pin what the gate hands over: the new hash for the changed file, the
    // addition flag, and a hash lookup answering from the updated map.
    const indexer = await loadIndexer();
    const { legacyIndexProfile } = await import("../../src/services/index-profile.js");
    const { shouldRebuildGraph } = await import("../../src/services/code-graph.js");
    const project = await createProject("notes.txt", "new changed content");
    collectionInfo = { pointsCount: 1, status: "green" };
    storedProfile = legacyIndexProfile("code");
    storedHashes = new Map([["notes.txt", indexer.hashContent("old source")]]);

    vi.mocked(shouldRebuildGraph).mockClear();
    await indexer.updateProjectIndex(project);

    expect(vi.mocked(shouldRebuildGraph)).toHaveBeenCalledTimes(1);
    const [askedPath, change] = vi.mocked(shouldRebuildGraph).mock.calls[0];
    expect(askedPath).toBe(project);
    expect(change.hasAdditions).toBe(false);
    expect(change.changed.get("notes.txt")).toBe(indexer.hashContent("new changed content"));
    expect(change.removed.size).toBe(0);
    expect(change.unreadable.size).toBe(0);
    expect(change.knownHash("notes.txt")).toBe(indexer.hashContent("new changed content"));
  });

  it("rebuilds on a recorded input the index never saw change", async () => {
    // The counters are all zero — nothing indexable moved — which is exactly
    // the shape of a commit touching only `go.mod` or `.gitignore`. The record
    // is what says the graph is now wrong, so the gate has to be reachable.
    const indexer = await loadIndexer();
    const { legacyIndexProfile } = await import("../../src/services/index-profile.js");
    const { rebuildGraph, shouldRebuildGraph } = await import("../../src/services/code-graph.js");
    const project = await createProject("notes.txt", "unchanged");
    collectionInfo = { pointsCount: 1, status: "green" };
    storedProfile = legacyIndexProfile("code");
    storedHashes = new Map([["notes.txt", indexer.hashContent("unchanged")]]);

    vi.mocked(rebuildGraph).mockClear();
    vi.mocked(shouldRebuildGraph).mockResolvedValueOnce({
      rebuild: true,
      reason: "graph input changed: go.mod",
      graphExists: true,
    });
    const result = await indexer.updateProjectIndex(project);

    expect(result).toMatchObject({ added: 0, updated: 0, removed: 0 });
    expect(vi.mocked(rebuildGraph)).toHaveBeenCalledTimes(1);
  });

  it("rebuilds a graph whose record is missing even when nothing was indexed", async () => {
    // The compatibility rule: a graph with no usable record rebuilds once and
    // populates it, with no migration and nothing for anyone to run. Gating
    // that on the index having moved would leave a legacy graph never
    // populating on a project whose commits happen to touch nothing indexable.
    const indexer = await loadIndexer();
    const { legacyIndexProfile } = await import("../../src/services/index-profile.js");
    const { rebuildGraph, shouldRebuildGraph } = await import("../../src/services/code-graph.js");
    const project = await createProject("notes.txt", "unchanged");
    collectionInfo = { pointsCount: 1, status: "green" };
    storedProfile = legacyIndexProfile("code");
    storedHashes = new Map([["notes.txt", indexer.hashContent("unchanged")]]);

    for (const reason of [
      "no usable record of what the graph was built from",
      "the graph's stored inputs could not be read: connection refused",
    ]) {
      vi.mocked(rebuildGraph).mockClear();
      vi.mocked(shouldRebuildGraph).mockResolvedValueOnce({
        rebuild: true,
        reason,
        graphExists: true,
      });
      const result = await indexer.updateProjectIndex(project);

      expect(result).toMatchObject({ added: 0, updated: 0, removed: 0 });
      expect(vi.mocked(rebuildGraph), reason).toHaveBeenCalledTimes(1);
    }
  });

  it("does not build a graph that does not exist when nothing was indexed", async () => {
    // The one case that stays suppressed. Rebuilding with nothing persisted is
    // building a first graph, which an update that indexed nothing should not
    // decide to do — and which `codebase_index` or an update that changes
    // something will do anyway.
    const indexer = await loadIndexer();
    const { legacyIndexProfile } = await import("../../src/services/index-profile.js");
    const { rebuildGraph, shouldRebuildGraph } = await import("../../src/services/code-graph.js");
    const project = await createProject("notes.txt", "unchanged");
    collectionInfo = { pointsCount: 1, status: "green" };
    storedProfile = legacyIndexProfile("code");
    storedHashes = new Map([["notes.txt", indexer.hashContent("unchanged")]]);

    vi.mocked(rebuildGraph).mockClear();
    vi.mocked(shouldRebuildGraph).mockResolvedValueOnce({
      rebuild: true,
      reason: "no code graph has been built yet",
      graphExists: false,
    });
    await indexer.updateProjectIndex(project);

    expect(vi.mocked(rebuildGraph)).not.toHaveBeenCalled();
  });

});
