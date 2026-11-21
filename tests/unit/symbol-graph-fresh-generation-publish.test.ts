// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

/**
 * The build-level half of the fresh-generation shard write: a real
 * `rebuildGraph` against an in-memory Qdrant. It checks what only the whole
 * pipeline can show — that a generation is published only after every batch of
 * its shards landed, that a failed later batch leaves the previous generation
 * serving and the staged one deleted, and that the symbol, impact and flow
 * tools answer identically whether a generation's shards were written in bulk
 * or one by one.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface StoredPoint {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
}
const store = new Map<string, Map<string, StoredPoint>>();
const indexRetrieves: string[][] = [];
let indexUpsertAttempts = 0;
/** When > 0, the Nth upsert to a symbol-graph index collection (1 = next) throws. */
let failIndexUpsertAt = 0;

const clientInstance = {
  getCollections: async () => ({ collections: Array.from(store.keys()).map((name) => ({ name })) }),
  createCollection: async (name: string) => {
    if (!store.has(name)) store.set(name, new Map());
  },
  createPayloadIndex: async () => ({}),
  deleteCollection: async (name: string) => {
    store.delete(name);
  },
  query: async () => ({ points: [] }),
  getCollection: async (name: string) => {
    const coll = store.get(name);
    if (!coll) throw Object.assign(new Error(`Collection ${name} does not exist`), { status: 404 });
    return { points_count: coll.size, status: "green", config: { params: { vectors: { size: 3 } } } };
  },
  upsert: async (name: string, body: { points: StoredPoint[] }) => {
    if (name.endsWith("_symgraph_index")) {
      indexUpsertAttempts++;
      if (failIndexUpsertAt > 0 && indexUpsertAttempts === failIndexUpsertAt) {
        throw Object.assign(new Error("Bad Request"), { status: 400 });
      }
    }
    const coll = store.get(name) ?? new Map<string, StoredPoint>();
    for (const p of body.points) coll.set(String(p.id), p);
    store.set(name, coll);
  },
  retrieve: async (name: string, opts: { ids: Array<string | number> }) => {
    if (name.endsWith("_symgraph_index")) indexRetrieves.push(opts.ids.map(String));
    const coll = store.get(name) ?? new Map<string, StoredPoint>();
    return opts.ids.map((id) => coll.get(String(id))).filter((p): p is StoredPoint => p !== undefined);
  },
  delete: async (
    name: string,
    opts: {
      points?: Array<string | number>;
      filter?: { must?: Array<{ key?: string; match?: { value?: string }; is_empty?: { key: string } }> };
    },
  ) => {
    const coll = store.get(name);
    if (!coll) return;
    for (const id of opts.points ?? []) coll.delete(String(id));
    for (const cond of opts.filter?.must ?? []) {
      for (const [id, pt] of Array.from(coll.entries())) {
        if (cond.key === "generation" && pt.payload?.generation === cond.match?.value) coll.delete(id);
        if (cond.is_empty?.key === "generation" && pt.payload?.generation == null) coll.delete(id);
      }
    }
  },
  scroll: async (name: string) => ({
    points: Array.from((store.get(name) ?? new Map<string, StoredPoint>()).values()),
    next_page_offset: null,
  }),
};

// The real qdrant.ts constructs its own client, which a module-level mock of
// qdrant.ts cannot reach; mocking the constructor routes the real persistence
// layer to the in-memory store.
vi.mock("@qdrant/js-client-rest", () => ({
  QdrantClient: function QdrantClient() {
    return clientInstance;
  },
}));

vi.mock("../../src/services/qdrant.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/services/qdrant.js")>();
  return {
    ...actual,
    getClient: () => clientInstance,
    describeQdrantError: (err: unknown) => (err instanceof Error ? err.message : String(err)),
  };
});

import { projectIdFromPath, symgraphFileCollectionName, symgraphIndexCollectionName } from "../../src/config.js";
import { SYMBOL_REVERSE_SHARDS } from "../../src/constants.js";
import {
  ensureDynamicLanguages,
  getLastGraphBuildCompleted,
  invalidateGraphCache,
  rebuildGraph,
} from "../../src/services/code-graph.js";
import {
  getSymbolGraphCache,
  resetSymbolGraphCacheRegistry,
  SymbolGraphCache,
  setSymbolGraphCache,
} from "../../src/services/symbol-graph-cache.js";
import {
  allNameShardKeys,
  listStoredGenerations,
  loadFilePayload,
  loadNameShard,
  loadReverseShard,
  loadSymbolGraphMeta,
  resetSymbolGraphCollectionCache,
  saveFilePayloads,
  saveNameShard,
  saveReverseShard,
  saveSymbolGraphMeta,
} from "../../src/services/symbol-graph-store.js";
import { handleGraphTool } from "../../src/tools/graph-tools.js";
import type { SymbolGraphFilePayload, SymbolGraphMeta } from "../../src/types.js";

/** A ring of files, each exporting `fnN` and calling `fn(N+1)`: many shards. */
function writeRing(root: string, files: number): void {
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  for (let i = 0; i < files; i++) {
    const next = (i + 1) % files;
    fs.writeFileSync(
      path.join(root, "src", `f${i}.ts`),
      `import { ${letter(next)}Fn${next} } from "./f${next}.js";\nexport function ${letter(i)}Fn${i}(): number { return ${letter(next)}Fn${next}(); }\n`,
    );
  }
}

/** Spread names across the alphabet so several name shards are non-empty. */
function letter(i: number): string {
  return String.fromCharCode("a".charCodeAt(0) + (i % 26));
}

describe("symbol-graph publication with the fresh-generation shard write", () => {
  let root: string;
  let projectId: string;

  beforeEach(() => {
    ensureDynamicLanguages();
    store.clear();
    indexRetrieves.length = 0;
    indexUpsertAttempts = 0;
    failIndexUpsertAt = 0;
    resetSymbolGraphCollectionCache();
    resetSymbolGraphCacheRegistry();
    root = path.resolve(fs.mkdtempSync(path.join(os.tmpdir(), "freshgen-publish-")));
    projectId = projectIdFromPath(root);
    invalidateGraphCache(root);
  });

  afterEach(() => {
    invalidateGraphCache(root);
    fs.rmSync(root, { recursive: true, force: true });
  });

  function indexPoints(): StoredPoint[] {
    return Array.from(store.get(symgraphIndexCollectionName(projectId))?.values() ?? []);
  }

  it("publishes a built graph without reading any shard's previous parts", async () => {
    writeRing(root, 120);
    await rebuildGraph(root);

    expect(getLastGraphBuildCompleted(root)?.symbolGraphError).toBeUndefined();
    const meta = await loadSymbolGraphMeta(projectId);
    expect(meta?.generation).toBeDefined();
    expect(indexPoints().length).toBeGreaterThan(50); // enough shards to need several requests
    // The one read of the index collection a build may make is none at all.
    expect(indexRetrieves).toHaveLength(0);
    expect(indexUpsertAttempts).toBe(Math.ceil(indexPoints().length / 50));
  });

  it("does not publish when a later batch fails: the previous generation keeps serving and the staged one is deleted", async () => {
    writeRing(root, 120);
    await rebuildGraph(root);
    const first = await loadSymbolGraphMeta(projectId);
    expect(first?.generation).toBeDefined();
    const firstGeneration = first?.generation as string;

    // Change the graph so the next build has something different to publish,
    // then fail its SECOND index request: the first batch has already landed.
    writeRing(root, 121);
    indexUpsertAttempts = 0;
    failIndexUpsertAt = 2;
    invalidateGraphCache(root);
    await rebuildGraph(root);

    expect(indexUpsertAttempts).toBe(2); // the third request was never sent
    expect(getLastGraphBuildCompleted(root)?.symbolGraphError).toContain("Bad Request");
    const after = await loadSymbolGraphMeta(projectId);
    expect(after?.generation).toBe(firstGeneration);
    expect(after?.fileCount).toBe(first?.fileCount);
    // The first batch of the failed generation was written, then removed.
    expect(await listStoredGenerations(projectId)).toEqual([firstGeneration]);
    // And the old generation still answers.
    const payload = await loadFilePayload(projectId, "src/f0.ts", firstGeneration);
    expect(payload?.symbols.some((s) => s.name === "aFn0")).toBe(true);
    const oldShard = await loadNameShard(projectId, "a", firstGeneration);
    expect(oldShard).not.toBeNull();
    // Every index point left behind belongs to the previous generation: whatever
    // the failed build had already written was removed with its generation.
    expect(new Set(indexPoints().map((p) => p.payload.generation))).toEqual(new Set([firstGeneration]));
  });

  it("answers symbol, impact and flow lookups identically whether shards were written in bulk or one by one", async () => {
    writeRing(root, 40);
    await rebuildGraph(root);
    const bulkMeta = (await loadSymbolGraphMeta(projectId)) as SymbolGraphMeta;
    const bulkGeneration = bulkMeta.generation as string;

    const lookups = async (): Promise<string[]> => [
      await handleGraphTool("codebase_symbol", { name: "aFn0", projectPath: root }),
      await handleGraphTool("codebase_symbol", { name: "kFn10", projectPath: root }),
      await handleGraphTool("codebase_impact", { target: "aFn0", projectPath: root }),
      await handleGraphTool("codebase_impact", { target: "zFn25", projectPath: root }),
      await handleGraphTool("codebase_flow", { entrypoint: "aFn0", projectPath: root }),
      await handleGraphTool("codebase_flow", { entrypoint: "dFn3", projectPath: root }),
    ];
    const viaBulk = await lookups();
    // The fixture must actually have something to find, or equality proves nothing.
    expect(viaBulk[0]).toContain("src/f39.ts"); // aFn0's caller, found through a reverse shard
    expect(viaBulk[0]).toContain("bFn1"); // and its callee
    expect(viaBulk[4]).toContain("bFn1"); // the flow from aFn0 reaches its callee

    // Republish the same graph through the per-shard savers under a new generation.
    const sequentialGeneration = "sequential-generation";
    const payloads: SymbolGraphFilePayload[] = [];
    for (let i = 0; i < 40; i++) {
      const p = await loadFilePayload(projectId, `src/f${i}.ts`, bulkGeneration);
      if (p) payloads.push(p);
    }
    expect(payloads).toHaveLength(40);
    await saveFilePayloads(projectId, payloads, sequentialGeneration);
    for (const key of allNameShardKeys()) {
      const shard = await loadNameShard(projectId, key, bulkGeneration);
      if (shard && Object.keys(shard).length > 0) await saveNameShard(projectId, key, shard, sequentialGeneration);
    }
    for (let bucket = 0; bucket < SYMBOL_REVERSE_SHARDS; bucket++) {
      const shard = await loadReverseShard(projectId, bucket, bulkGeneration);
      if (shard && Object.keys(shard).length > 0) await saveReverseShard(projectId, bucket, shard, sequentialGeneration);
    }
    const sequentialMeta: SymbolGraphMeta = { ...bulkMeta, generation: sequentialGeneration };
    await saveSymbolGraphMeta(projectId, sequentialMeta);
    setSymbolGraphCache(new SymbolGraphCache(projectId, sequentialMeta));

    expect((await getSymbolGraphCache(projectId))?.meta.generation).toBe(sequentialGeneration);
    expect(await lookups()).toEqual(viaBulk);
  });

  it("leaves the file payload collection on the same generation as the shards", async () => {
    writeRing(root, 5);
    await rebuildGraph(root);
    const meta = await loadSymbolGraphMeta(projectId);
    const fileGenerations = new Set(
      Array.from(store.get(symgraphFileCollectionName(projectId))?.values() ?? []).map((p) => p.payload.generation),
    );
    const indexGenerations = new Set(indexPoints().map((p) => p.payload.generation));
    expect(fileGenerations).toEqual(new Set([meta?.generation]));
    expect(indexGenerations).toEqual(new Set([meta?.generation]));
  });
});
