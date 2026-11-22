// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

/**
 * Publishing a symbol graph used to write its ~283 name and reverse shards one
 * shard at a time, and each write first retrieved the shard's previous primary
 * point to learn how many continuation parts to clean up — even for a staged
 * generation whose point ids cannot exist yet. `saveShardsForFreshGeneration`
 * writes a generation the caller just minted in a few coalesced requests with
 * no previous-part reads.
 *
 * The fake below is a real in-memory point store that counts every request, so
 * each test is a write-then-read round trip as well as a request-count check.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { QDRANT_UPSERT_BUDGET_BYTES, SYMBOL_SHARD_BULK_REQUEST_BYTES } from "../../src/constants.js";
import type { SymbolRef } from "../../src/types.js";

interface StoredPoint {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
}
interface UpsertRequest {
  collName: string;
  points: number;
  bytes: number;
  /** The payload of every point in the request, in order. */
  payloads: Array<Record<string, unknown>>;
}

const store = new Map<string, Map<string, StoredPoint>>(); // collection -> id -> point
const upserts: UpsertRequest[] = [];
const retrieves: Array<{ collName: string; ids: string[] }> = [];
const deletes: Array<{ collName: string; points: string[] }> = [];
let inFlightUpserts = 0;
let maxInFlightUpserts = 0;
/** When > 0, the Nth upsert request from now (1 = the next one) throws. */
let failUpsertAt = 0;
let upsertAttempts = 0;

vi.mock("../../src/services/qdrant.js", () => ({
  getClient: () => ({
    getCollections: async () => ({ collections: Array.from(store.keys()).map((name) => ({ name })) }),
    createCollection: async (name: string) => {
      if (!store.has(name)) store.set(name, new Map());
    },
    upsert: async (name: string, body: { points: StoredPoint[] }) => {
      upsertAttempts++;
      inFlightUpserts++;
      maxInFlightUpserts = Math.max(maxInFlightUpserts, inFlightUpserts);
      try {
        // Yield, so a caller that issued requests concurrently would overlap.
        await new Promise((resolve) => setImmediate(resolve));
        if (failUpsertAt > 0 && upsertAttempts === failUpsertAt) {
          throw Object.assign(new Error("Bad Request"), { status: 400 });
        }
        upserts.push({
          collName: name,
          points: body.points.length,
          bytes: Buffer.byteLength(JSON.stringify(body), "utf-8"),
          payloads: body.points.map((p) => p.payload),
        });
        const coll = store.get(name) ?? new Map<string, StoredPoint>();
        for (const p of body.points) coll.set(String(p.id), p);
        store.set(name, coll);
      } finally {
        inFlightUpserts--;
      }
    },
    retrieve: async (name: string, opts: { ids: Array<string | number> }) => {
      retrieves.push({ collName: name, ids: opts.ids.map(String) });
      const coll = store.get(name) ?? new Map<string, StoredPoint>();
      return opts.ids.map((id) => coll.get(String(id))).filter((p): p is StoredPoint => p !== undefined);
    },
    delete: async (name: string, opts: { points: Array<string | number> }) => {
      deletes.push({ collName: name, points: opts.points.map(String) });
      const coll = store.get(name);
      if (coll) for (const id of opts.points) coll.delete(String(id));
    },
  }),
  describeQdrantError: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

vi.mock("../../src/services/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { SYMBOL_REVERSE_SHARDS } from "../../src/constants.js";
import {
  allNameShardKeys,
  type FreshGenerationShards,
  LEGACY_SYMBOL_GRAPH_GENERATION,
  loadNameShard,
  loadReverseShard,
  registerStagingGeneration,
  resetGenerationLifecycleState,
  resetSymbolGraphCollectionCache,
  reverseShardHex,
  StorageReadError,
  SymbolGraphPointTooLargeError,
  saveNameShard,
  saveReverseShard,
  saveShardsForFreshGeneration,
  setActiveSymbolGraphGeneration,
} from "../../src/services/symbol-graph-store.js";

const PROJ = "freshgen";
const INDEX_COLL = `${PROJ}_symgraph_index`;
/** The 27 name keys plus the 256 reverse buckets. */
const ALL_SHARDS = 27 + SYMBOL_REVERSE_SHARDS;

function refsFor(name: string, count: number, pathLen = 60): SymbolRef[] {
  const refs: SymbolRef[] = [];
  for (let i = 0; i < count; i++) {
    const file = `src/${"x".repeat(pathLen)}/${name}${i}.java`;
    refs.push({ file, id: `${file}::${name}` });
  }
  return refs;
}

/** A record whose serialized size comfortably exceeds one part budget (~36 MB). */
function oversizedNameRecord(): Record<string, SymbolRef[]> {
  const record: Record<string, SymbolRef[]> = {};
  for (let n = 0; n < 200; n++) record[`getValue${n}`] = refsFor(`getValue${n}`, 1000);
  return record;
}

/** A name record of roughly `bytes` serialized size that still fits one point. */
function nameRecordOfSize(tag: string, bytes: number): Record<string, SymbolRef[]> {
  return { [tag]: [{ file: "src/a.ts", id: `src/a.ts::${"y".repeat(bytes)}` }] };
}

/**
 * One tiny record per name key and per reverse bucket. The return type is
 * inferred on purpose: it keeps the maps mutable, so a test can add a shard
 * before passing the result as a (read-only) FreshGenerationShards.
 */
function smallShards() {
  const nameShards = new Map<string, Record<string, SymbolRef[]>>();
  for (const key of allNameShardKeys()) {
    nameShards.set(key, { [`${key}fn`]: [{ file: "src/a.ts", id: `src/a.ts::${key}fn` }] });
  }
  const reverseShards = new Map<number, Record<string, string[]>>();
  for (let b = 0; b < SYMBOL_REVERSE_SHARDS; b++) {
    reverseShards.set(b, { [`src/f${b}.ts::callee`]: [`src/g${b}.ts::caller`] });
  }
  return { nameShards, reverseShards };
}

function pointsInIndex(): StoredPoint[] {
  return Array.from(store.get(INDEX_COLL)?.values() ?? []);
}

/** Stage a generation the way persistSymbolGraph does before it writes. */
function stage(generation: string): string {
  registerStagingGeneration(PROJ, generation);
  return generation;
}

function requestCounts(): { retrieves: number; upserts: number; deletes: number } {
  return { retrieves: retrieves.length, upserts: upserts.length, deletes: deletes.length };
}

describe("fresh-generation bulk shard write", () => {
  beforeEach(() => {
    store.clear();
    upserts.length = 0;
    retrieves.length = 0;
    deletes.length = 0;
    inFlightUpserts = 0;
    maxInFlightUpserts = 0;
    failUpsertAt = 0;
    upsertAttempts = 0;
    resetSymbolGraphCollectionCache();
    resetGenerationLifecycleState();
  });

  it("makes zero previous-part reads and a bounded number of writes for many small shards", async () => {
    const gen = stage("gen-small");
    await saveShardsForFreshGeneration(PROJ, gen, smallShards());

    expect(retrieves).toHaveLength(0);
    expect(deletes).toHaveLength(0);
    // 283 one-point shards at the 50-point cap: ceil(283 / 50) requests, not 283.
    expect(upserts).toHaveLength(Math.ceil(ALL_SHARDS / 50));
    expect(upserts.every((u) => u.points <= 50)).toBe(true);
    expect(upserts.reduce((n, u) => n + u.points, 0)).toBe(ALL_SHARDS);
    expect(upserts.every((u) => u.collName === INDEX_COLL)).toBe(true);
    // Strictly one request at a time: coalescing must not become concurrency.
    expect(maxInFlightUpserts).toBe(1);
  });

  it("is the pattern it replaces: the per-shard savers cost one read and one write per shard", async () => {
    // Pins the baseline the bulk path is measured against, and that the
    // rewrite path still looks up each shard's previous parts.
    const gen = "gen-sequential";
    const { nameShards, reverseShards } = smallShards();
    for (const [key, record] of nameShards) await saveNameShard(PROJ, key, record, gen);
    for (const [bucket, record] of reverseShards) await saveReverseShard(PROJ, bucket, record, gen);

    expect(retrieves).toHaveLength(ALL_SHARDS);
    expect(upserts).toHaveLength(ALL_SHARDS);
    expect(maxInFlightUpserts).toBe(1);
  });

  it("round-trips every shard through the existing readers", async () => {
    const gen = stage("gen-roundtrip");
    const shards = smallShards();
    await saveShardsForFreshGeneration(PROJ, gen, shards);

    for (const [key, record] of shards.nameShards) {
      expect(await loadNameShard(PROJ, key, gen)).toEqual(record);
    }
    for (const [bucket, record] of shards.reverseShards) {
      expect(await loadReverseShard(PROJ, bucket, gen)).toEqual(record);
    }
  });

  it("skips empty shards, as the per-shard callers always did", async () => {
    const gen = stage("gen-empty");
    await saveShardsForFreshGeneration(PROJ, gen, {
      nameShards: new Map<string, Record<string, SymbolRef[]>>([
        ["a", { alpha: [{ file: "src/a.ts", id: "src/a.ts::alpha" }] }],
        ["b", {}],
      ]),
      reverseShards: new Map([[3, {}]]),
    });

    expect(pointsInIndex()).toHaveLength(1);
    expect(await loadNameShard(PROJ, "b", gen)).toBeNull();
    expect(await loadReverseShard(PROJ, 3, gen)).toBeNull();
  });

  it("bounds each request by encoded bytes, well below the per-file payload budget", async () => {
    // 60 shards of ~40 KB (2.4 MB in all). The 50-point cap alone would put
    // them in two requests of ~1.6 MB; the byte bound keeps every request near
    // SYMBOL_SHARD_BULK_REQUEST_BYTES, so a Qdrant that is also serving searches
    // sees small requests rather than a few multi-MB ones.
    const gen = stage("gen-bytes");
    const nameShards = new Map<string, Record<string, SymbolRef[]>>();
    const keys = Array.from({ length: 60 }, (_, i) => `k${i}`);
    for (const key of keys) nameShards.set(key, nameRecordOfSize(`${key}Mid`, 40_000));
    await saveShardsForFreshGeneration(PROJ, gen, { nameShards, reverseShards: new Map() });

    expect(retrieves).toHaveLength(0);
    // The bound counts the serialized points; the body adds `{"points":[` and
    // `]}` and a comma between points (at most 13 + 49 bytes at 50 points), so
    // allow a small envelope on top.
    expect(upserts.every((u) => u.bytes <= SYMBOL_SHARD_BULK_REQUEST_BYTES + 100)).toBe(true);
    expect(upserts.length).toBeGreaterThan(2); // more than the 50-point cap alone would give
    expect(upserts.length).toBeLessThan(keys.length); // still coalesced, not one per shard
    expect(upserts.reduce((n, u) => n + u.points, 0)).toBe(keys.length);
    expect(maxInFlightUpserts).toBe(1);
    for (const key of keys) {
      expect(await loadNameShard(PROJ, key, gen)).toEqual(nameShards.get(key));
    }
  });

  it("sends a shard larger than the bound alone, and never beyond the per-file budget", async () => {
    // Eight ~7 MB shards: each exceeds the bound by itself, so none is combined
    // with another, and none is split (it fits one point under the budget).
    const gen = stage("gen-large-alone");
    const nameShards = new Map<string, Record<string, SymbolRef[]>>();
    for (const key of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
      nameShards.set(key, nameRecordOfSize(`${key}Big`, 7_000_000));
    }
    await saveShardsForFreshGeneration(PROJ, gen, { nameShards, reverseShards: new Map() });

    expect(retrieves).toHaveLength(0);
    expect(upserts).toHaveLength(8);
    expect(upserts.every((u) => u.points === 1 && u.bytes < QDRANT_UPSERT_BUDGET_BYTES)).toBe(true);
    for (const key of nameShards.keys()) {
      expect(await loadNameShard(PROJ, key, gen)).toEqual(nameShards.get(key));
    }
  });

  it("lets a small final part of a split shard share a request with the next shard", async () => {
    // The packer works on points, not shards. `big` nearly fills a part (the
    // part budget is QDRANT_UPSERT_BUDGET_BYTES less 1 KiB of envelope) and
    // `tail` cannot join it, so the shard splits into a ~25 MB part 0 and a
    // ~100 KB final part. Part 0 is over the bound and goes alone; the final
    // part is under it, so it rides with the next shard's point.
    const gen = stage("gen-final-part");
    const split: Record<string, SymbolRef[]> = {
      ...nameRecordOfSize("big", 25_100_000),
      ...nameRecordOfSize("tail", 100_000),
    };
    const next: Record<string, SymbolRef[]> = { alpha: [{ file: "src/a.ts", id: "src/a.ts::alpha" }] };
    await saveShardsForFreshGeneration(PROJ, gen, {
      nameShards: new Map([
        ["g", split],
        ["a", next],
      ]),
      reverseShards: new Map(),
    });

    const sent = upserts.map((u) => u.payloads.map((p) => `${p.shard}:${p.part ?? 0}`));
    expect(sent).toEqual([["g:0"], ["g:1", "a:0"]]);
    expect(upserts[1].bytes).toBeLessThanOrEqual(SYMBOL_SHARD_BULK_REQUEST_BYTES + 100);
    expect(retrieves).toHaveLength(0);
    // Sharing a request changes nothing about identity: both read back whole.
    expect(await loadNameShard(PROJ, "g", gen)).toEqual(split);
    expect(await loadNameShard(PROJ, "a", gen)).toEqual(next);
  });

  it("lets a small first part of a split shard share a request with the previous shard", async () => {
    // The same rule from the other side: splitting happens between whole
    // entries, so a small entry ahead of one that nearly fills a part becomes a
    // small part 0. It is under the bound, so it rides with the shard before it,
    // and the ~25 MB part 1 goes alone.
    const gen = stage("gen-first-part");
    const split: Record<string, SymbolRef[]> = {
      ...nameRecordOfSize("head", 100_000),
      ...nameRecordOfSize("big", 25_100_000),
    };
    const previous: Record<string, SymbolRef[]> = { alpha: [{ file: "src/a.ts", id: "src/a.ts::alpha" }] };
    await saveShardsForFreshGeneration(PROJ, gen, {
      nameShards: new Map([
        ["a", previous],
        ["g", split],
      ]),
      reverseShards: new Map(),
    });

    const sent = upserts.map((u) => u.payloads.map((p) => `${p.shard}:${p.part ?? 0}`));
    expect(sent).toEqual([["a:0", "g:0"], ["g:1"]]);
    expect(upserts[0].bytes).toBeLessThanOrEqual(SYMBOL_SHARD_BULK_REQUEST_BYTES + 100);
    expect(retrieves).toHaveLength(0);
    expect(await loadNameShard(PROJ, "a", gen)).toEqual(previous);
    expect(await loadNameShard(PROJ, "g", gen)).toEqual(split);
  });

  it("clamps an override above the per-file payload budget to that budget", async () => {
    const gen = stage("gen-clamp");
    const nameShards = new Map<string, Record<string, SymbolRef[]>>();
    // Eight ~7 MB shards would fit three to a request at the 24 MiB budget, but
    // an override of 1 GiB must not let them pack past it.
    for (const key of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
      nameShards.set(key, nameRecordOfSize(`${key}Big`, 7_000_000));
    }
    await saveShardsForFreshGeneration(
      PROJ,
      gen,
      { nameShards, reverseShards: new Map() },
      { budgetBytes: 1_073_741_824, maxPoints: 50 },
    );

    expect(upserts.length).toBeGreaterThan(1);
    expect(upserts.length).toBeLessThan(8);
    expect(upserts.every((u) => u.bytes < QDRANT_UPSERT_BUDGET_BYTES)).toBe(true);
  });

  it("keeps a multipart shard's identity, and reads it back whole, when coalesced with others", async () => {
    const gen = stage("gen-multipart");
    const big = oversizedNameRecord();
    const shards: FreshGenerationShards = {
      nameShards: new Map([
        ["g", big],
        ["a", { alpha: [{ file: "src/a.ts", id: "src/a.ts::alpha" }] }],
      ]),
      reverseShards: new Map([[7, { "src/c.ts::callee": ["src/d.ts::caller"] }]]),
    };
    await saveShardsForFreshGeneration(PROJ, gen, shards);

    expect(retrieves).toHaveLength(0);
    const parts = pointsInIndex().filter((p) => p.payload.kind === "name" && p.payload.shard === "g");
    expect(parts.length).toBeGreaterThan(1);
    const writeIds = new Set(parts.map((p) => p.payload.write));
    expect(writeIds.size).toBe(1);
    expect(typeof Array.from(writeIds)[0]).toBe("string");
    expect(parts.map((p) => p.payload.part).sort()).toEqual(parts.map((_, i) => i));
    expect(parts.every((p) => p.payload.parts === parts.length && p.payload.generation === gen)).toBe(true);
    // The small shards stay legacy-shaped single points.
    const small = pointsInIndex().find((p) => p.payload.shard === "a");
    expect(small?.payload).toEqual({
      kind: "name",
      shard: "a",
      nameToSymbols: { alpha: [{ file: "src/a.ts", id: "src/a.ts::alpha" }] },
      generation: gen,
    });

    expect(await loadNameShard(PROJ, "g", gen)).toEqual(big);
    expect(await loadNameShard(PROJ, "a", gen)).toEqual(shards.nameShards.get("a"));
    expect(await loadReverseShard(PROJ, 7, gen)).toEqual(shards.reverseShards.get(7));
  });

  it("still detects a continuation part from a different write", async () => {
    const gen = stage("gen-mixed");
    await saveShardsForFreshGeneration(PROJ, gen, {
      nameShards: new Map([["g", oversizedNameRecord()]]),
      reverseShards: new Map(),
    });

    const continuation = pointsInIndex().find((p) => p.payload.part === 1);
    expect(continuation).toBeDefined();
    if (continuation) continuation.payload = { ...continuation.payload, write: "some-other-write" };

    await expect(loadNameShard(PROJ, "g", gen)).rejects.toThrow(StorageReadError);
  });

  it("rejects an entry no part can hold before writing anything, naming the shard", async () => {
    const gen = stage("gen-oversize");
    const unplaceable: Record<string, SymbolRef[]> = { huge: refsFor("huge", 160_000, 100) };
    const shards: FreshGenerationShards = {
      nameShards: new Map([
        ["a", { alpha: [{ file: "src/a.ts", id: "src/a.ts::alpha" }] }],
        ["h", unplaceable],
      ]),
      reverseShards: new Map([[1, { "src/c.ts::callee": ["src/d.ts::caller"] }]]),
    };

    const err = await saveShardsForFreshGeneration(PROJ, gen, shards).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SymbolGraphPointTooLargeError);
    expect((err as Error).message).toContain("name index shard 'h'");
    // Serialized up front: the valid shards in the same call were not written either.
    expect(upserts).toHaveLength(0);
    expect(pointsInIndex()).toHaveLength(0);
  });

  it("yields to the event loop between shards while serializing, and still writes nothing when a later shard is invalid", async () => {
    // Serializing every shard before the first request is CPU work the
    // per-shard savers never did in one go (they awaited I/O between shards), so
    // other callbacks must get to run during it. A callback queued before the
    // call stands in for another request; the invalid last shard reports, via a
    // trap on its keys, whether that callback had run by the time the pass
    // reached it. Without a yield the whole pass is synchronous and it had not.
    const gen = stage("gen-yield");
    let ticked = false;
    let tickedBeforeLastShard: boolean | undefined;
    const invalidLast = new Proxy<Record<string, SymbolRef[]>>(
      { huge: refsFor("huge", 160_000, 100) },
      {
        ownKeys(target) {
          tickedBeforeLastShard ??= ticked;
          return Reflect.ownKeys(target);
        },
      },
    );
    const shards: FreshGenerationShards = {
      nameShards: new Map([
        ["a", { alpha: [{ file: "src/a.ts", id: "src/a.ts::alpha" }] }],
        ["b", { beta: [{ file: "src/b.ts", id: "src/b.ts::beta" }] }],
        ["h", invalidLast],
      ]),
      reverseShards: new Map(),
    };

    setImmediate(() => {
      ticked = true;
    });
    await expect(saveShardsForFreshGeneration(PROJ, gen, shards)).rejects.toThrow(SymbolGraphPointTooLargeError);

    expect(tickedBeforeLastShard).toBe(true);
    // The valid shards ahead of it were not written either.
    expect(upserts).toHaveLength(0);
    expect(pointsInIndex()).toHaveLength(0);
  });

  it("sizes every point before the first request, so the packer serializes nothing between requests", async () => {
    // Sizing a point means serializing it. That belongs in the preflight, which
    // yields to the event loop after each shard, and not in the packer, which
    // would otherwise serialize the next multi-MB point right after the previous
    // request returns. Three ~7 MB shards (each over the bound, so each its own
    // request) make the difference visible: count point serializations, and
    // compare the count when the first request body is built with the final one.
    const gen = stage("gen-sizing");
    const nameShards = new Map<string, Record<string, SymbolRef[]>>();
    for (const key of ["a", "b", "c"]) nameShards.set(key, nameRecordOfSize(`${key}Big`, 7_000_000));

    const realStringify = JSON.stringify as (...args: unknown[]) => string;
    let pointSerializations = 0;
    let atFirstRequest: number | undefined;
    const spy = vi.spyOn(JSON, "stringify").mockImplementation(((...args: unknown[]) => {
      const value = args[0];
      if (value && typeof value === "object") {
        if ("vector" in value) pointSerializations++;
        else if ("points" in value) atFirstRequest ??= pointSerializations; // the fake client building a request body
      }
      return realStringify.apply(JSON, args);
    }) as typeof JSON.stringify);
    try {
      await saveShardsForFreshGeneration(PROJ, gen, { nameShards, reverseShards: new Map() });
    } finally {
      spy.mockRestore();
    }

    expect(upserts).toHaveLength(3);
    expect(atFirstRequest).toBeDefined();
    expect(pointSerializations).toBe(atFirstRequest);
  });

  it("stops at the first failed request and sends nothing after it", async () => {
    const gen = stage("gen-fail");
    failUpsertAt = 2;
    await expect(saveShardsForFreshGeneration(PROJ, gen, smallShards())).rejects.toThrow("Bad Request");

    // 283 points are 6 requests; the second failed, so exactly one landed and
    // the third was never attempted.
    expect(upsertAttempts).toBe(2);
    expect(upserts).toHaveLength(1);
    expect(pointsInIndex()).toHaveLength(50);
  });

  describe("only for a caller-proven fresh generation", () => {
    const shards = (): FreshGenerationShards => ({
      nameShards: new Map([["a", { alpha: [{ file: "src/a.ts", id: "src/a.ts::alpha" }] }]]),
      reverseShards: new Map(),
    });

    async function expectRefused(generation: string, message: RegExp): Promise<void> {
      await expect(saveShardsForFreshGeneration(PROJ, generation, shards())).rejects.toThrow(message);
      expect(requestCounts()).toEqual({ retrieves: 0, upserts: 0, deletes: 0 });
    }

    it("refuses an empty generation", async () => {
      await expectRefused("", /real, newly minted generation/);
    });

    it("refuses the legacy generation, whose ids are the live un-generationed graph's", async () => {
      await expectRefused(LEGACY_SYMBOL_GRAPH_GENERATION, /real, newly minted generation/);
    });

    it("refuses a generation that was never registered as staging", async () => {
      await expectRefused("gen-unregistered", /not registered as a staging generation/);
    });

    it("refuses the generation the committed metadata names", async () => {
      const gen = stage("gen-active");
      setActiveSymbolGraphGeneration(PROJ, gen);
      await expectRefused(gen, /active symbol-graph generation/);
    });

    it("refuses a second write of the same generation, even after a failed first attempt", async () => {
      const gen = stage("gen-twice");
      failUpsertAt = 1;
      await expect(saveShardsForFreshGeneration(PROJ, gen, shards())).rejects.toThrow("Bad Request");

      failUpsertAt = 0;
      await expect(saveShardsForFreshGeneration(PROJ, gen, shards())).rejects.toThrow(/already been written/);
      expect(retrieves).toHaveLength(0);
    });
  });

  describe("equivalence with the per-shard savers", () => {
    /** A point with the identifiers that legitimately differ between writes removed. */
    function normalize(p: StoredPoint): Record<string, unknown> {
      const { generation: _generation, write, ...rest } = p.payload;
      return { ...rest, hasWrite: write !== undefined };
    }

    /** Index every point by what it is (kind, shard, part), not by its id. */
    function byIdentity(): Map<string, Record<string, unknown>> {
      const out = new Map<string, Record<string, unknown>>();
      for (const p of pointsInIndex()) {
        const shard = p.payload.kind === "name" ? String(p.payload.shard) : reverseShardHex(Number(p.payload.bucket));
        out.set(`${p.payload.generation}|${p.payload.kind}|${shard}|${p.payload.part ?? 0}`, normalize(p));
      }
      return out;
    }

    it("stores the same payloads as writing each shard on its own, single and multipart alike", async () => {
      const shards = smallShards();
      shards.nameShards.set("g", oversizedNameRecord());

      const bulkGen = stage("gen-bulk");
      await saveShardsForFreshGeneration(PROJ, bulkGen, shards);
      const sequentialGen = "gen-seq";
      for (const [key, record] of shards.nameShards) await saveNameShard(PROJ, key, record, sequentialGen);
      for (const [bucket, record] of shards.reverseShards) await saveReverseShard(PROJ, bucket, record, sequentialGen);

      const all = byIdentity();
      const strip = (gen: string) =>
        new Map(Array.from(all).filter(([k]) => k.startsWith(`${gen}|`)).map(([k, v]) => [k.slice(gen.length + 1), v]));
      const bulk = strip(bulkGen);
      const sequential = strip(sequentialGen);

      expect(bulk.size).toBeGreaterThan(ALL_SHARDS); // the multipart shard added parts
      expect(bulk).toEqual(sequential);
    });
  });

  describe("the rewrite path is unchanged", () => {
    it("still removes continuation parts a larger earlier write left behind", async () => {
      const gen = stage("gen-rewrite");
      await saveShardsForFreshGeneration(PROJ, gen, {
        nameShards: new Map([["g", oversizedNameRecord()]]),
        reverseShards: new Map(),
      });
      const before = pointsInIndex().length;
      expect(before).toBeGreaterThan(1);
      retrieves.length = 0;

      // A rewrite of an existing shard goes through the per-shard saver, whose
      // previous-part lookup is what finds and deletes the stale parts.
      const small = { alpha: [{ file: "src/a.ts", id: "src/a.ts::alpha" }] };
      await saveNameShard(PROJ, "g", small, gen);

      expect(retrieves).toHaveLength(1);
      expect(deletes).toHaveLength(1);
      expect(pointsInIndex()).toHaveLength(1);
      expect(await loadNameShard(PROJ, "g", gen)).toEqual(small);
    });
  });
});
