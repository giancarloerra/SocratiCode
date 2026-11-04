// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

/**
 * `listCodebaseCollections()` enumerates the metadata collection, and both
 * halves of how it did so were wrong.
 *
 * It issued a single `limit: 100` scroll with no cursor, so a deployment with
 * more than a hundred metadata points silently lost every entry past the
 * hundredth — from a list the manage tools present as complete.
 *
 * It also asked for the whole payload to read one string. Metadata points carry
 * the project's entire path-to-hash map, so the request scaled with the size of
 * every indexed repository rather than with the number of projects.
 */

import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface ScrollOptions {
  limit?: number;
  offset?: unknown;
  with_payload?: unknown;
  with_vector?: unknown;
}

/** Every scroll issued against the metadata collection, in order. */
let scrollCalls: ScrollOptions[] = [];
/** Metadata points the fake backend holds, paged out `limit` at a time. */
let metadataPoints: Array<{ id: number; payload: Record<string, unknown> }> = [];
/** Scroll attempts (1-based) that should throw, to exercise retry and failure. */
let failAttempts = new Set<number>();
/** When true the backend keeps handing back the cursor it was given. */
let stallCursor = false;
let attempt = 0;
let deletedCollections: string[] = [];
let deletedMetadata: unknown[] = [];
let collectionDeleteFailures = new Set<string>();
/** Collections whose deletion answers not-found, as Qdrant does for one already gone. */
let collectionsAlreadyGone = new Set<string>();
let metadataDeleteError: Error | null = null;
/** Collection names the fake backend lists. */
let collectionNames: string[] = [];
const mockRealpath = vi.fn(async (value: string) => value);

vi.mock("../../src/services/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../src/services/qdrant-client-compat.js", () => ({
  ensureQdrantClientCompatibility: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  default: { realpath: (...args: unknown[]) => mockRealpath(...args) },
}));

/**
 * Qdrant's `next_page_offset` is an opaque point id, not an index. The fake
 * mints string cursors so nothing under test can quietly depend on arithmetic
 * that only works for numbers.
 */
function cursorFor(index: number): string {
  return `point-${index}`;
}

function indexFromCursor(offset: unknown): number {
  if (typeof offset !== "string") return 0;
  return Number.parseInt(offset.slice("point-".length), 10);
}

vi.mock("@qdrant/js-client-rest", () => ({
  QdrantClient: class {
    async getCollections() {
      return { collections: collectionNames.map((name) => ({ name })) };
    }
    async scroll(_name: string, opts: ScrollOptions) {
      scrollCalls.push(opts);
      attempt++;
      if (failAttempts.has(attempt)) {
        throw new Error(`scroll attempt ${attempt} failed`);
      }
      const limit = opts.limit ?? 100;
      const start = indexFromCursor(opts.offset);
      const page = metadataPoints.slice(start, start + limit);
      const end = start + limit;
      const next = stallCursor
        ? (opts.offset ?? cursorFor(0))
        : end < metadataPoints.length
          ? cursorFor(end)
          : null;
      // Mirror Qdrant's contract: honour the payload projection, so a test that
      // reads a field the caller did not ask for sees it absent.
      const include =
        opts.with_payload && typeof opts.with_payload === "object"
          ? ((opts.with_payload as { include?: string[] }).include ?? null)
          : null;
      return {
        points: page.map((pt) => ({
          id: pt.id,
          payload:
            include === null
              ? pt.payload
              : Object.fromEntries(include.map((k) => [k, pt.payload[k]])),
        })),
        next_page_offset: next,
      };
    }
    async deleteCollection(name: string) {
      if (collectionDeleteFailures.has(name)) throw new Error(`cannot delete ${name}`);
      if (collectionsAlreadyGone.has(name)) throw Object.assign(new Error(`Collection ${name} doesn't exist!`), { status: 404 });
      deletedCollections.push(name);
    }
    async delete(_name: string, request: unknown) {
      if (metadataDeleteError) throw metadataDeleteError;
      deletedMetadata.push(request);
    }
  },
}));

const originalEnv = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  scrollCalls = [];
  metadataPoints = [];
  failAttempts = new Set();
  stallCursor = false;
  attempt = 0;
  deletedCollections = [];
  deletedMetadata = [];
  collectionDeleteFailures = new Set();
  collectionsAlreadyGone = new Set();
  metadataDeleteError = null;
  collectionNames = ["codebase_realone", "socraticode_metadata"];
  mockRealpath.mockReset();
  mockRealpath.mockImplementation(async (value: string) => value);
  process.env = {
    ...originalEnv,
    QDRANT_MODE: "external",
    QDRANT_URL: "http://127.0.0.1:6333",
  };
  delete process.env.QDRANT_COLLECTION_PREFIX;
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.clearAllMocks();
});

/** A metadata point of the shape `saveProjectMetadata` writes. */
function metadataPoint(id: number, collectionName: string) {
  return {
    id,
    payload: {
      collectionName,
      projectPath: `/repos/p${id}`,
      // The field that makes the full-payload read expensive: one entry per
      // file in the project.
      fileHashes: Object.fromEntries(
        Array.from({ length: 3 }, (_, i) => [`src/file${i}.ts`, `hash-${id}-${i}`]),
      ),
    },
  };
}

describe("listCodebaseCollections metadata scroll", () => {
  it("returns entries beyond the first page", async () => {
    // 2500 points against a page size of 1000: everything past the first
    // thousand is only reachable by following the cursor.
    metadataPoints = Array.from({ length: 2500 }, (_, i) =>
      metadataPoint(i, i % 2 === 0 ? `codegraph_p${i}` : `context_p${i}`),
    );

    const { listCodebaseCollections } = await import("../../src/services/qdrant.js");
    const result = await listCodebaseCollections();

    expect(result).toContain("codegraph_p0");
    expect(result).toContain("context_p1499"); // second page
    expect(result).toContain("context_p2499"); // third page
    expect(scrollCalls).toHaveLength(3);
    // Every metadata entry, plus the one real collection from getCollections().
    expect(result).toHaveLength(2501);
  });

  it("skips a point whose collectionName is not a string, instead of throwing", async () => {
    // Optional chaining guards null and undefined but not a wrong type, so a
    // payload holding a number here reached `.startsWith` and threw — taking
    // out a read-only listing over one malformed point.
    metadataPoints = [
      { id: 0, payload: { collectionName: 42 } },
      { id: 1, payload: {} },
      metadataPoint(2, "codegraph_good"),
    ];

    const { listCodebaseCollections } = await import("../../src/services/qdrant.js");
    const result = await listCodebaseCollections();

    expect(result).toContain("codegraph_good");
    expect(result).toHaveLength(2); // the real collection, plus the good entry
  });

  it("asks only for the field it reads, not the whole payload", async () => {
    // The point of the projection: metadata payloads carry a hash map per
    // project, so a full read scales with repository size, not project count.
    metadataPoints = [metadataPoint(0, "codegraph_p0")];

    const { listCodebaseCollections } = await import("../../src/services/qdrant.js");
    await listCodebaseCollections();

    expect(scrollCalls).not.toHaveLength(0);
    for (const call of scrollCalls) {
      expect(call.with_payload).toEqual({ include: ["collectionName"] });
      expect(call.with_vector).toBe(false);
    }
  });
  it("retries a transient page failure instead of truncating the list", async () => {
    // Paging multiplies the requests that can fail, so one blip mid-scroll must
    // not silently shorten a list callers read as complete. Every other scroll
    // in qdrant.ts is wrapped in withRetry; this one is too.
    metadataPoints = Array.from({ length: 2500 }, (_, i) => metadataPoint(i, `codegraph_p${i}`));
    failAttempts = new Set([2]); // first attempt at the second page

    const { listCodebaseCollections } = await import("../../src/services/qdrant.js");
    const result = await listCodebaseCollections();

    expect(result).toHaveLength(2501);
    expect(result).toContain("codegraph_p2499");
    expect(scrollCalls).toHaveLength(4); // three pages, one retried
  }, 20_000);

  it("returns what it has when a page fails for good, without throwing", async () => {
    // Still non-fatal: the collections found before the metadata scroll stand.
    metadataPoints = Array.from({ length: 2500 }, (_, i) => metadataPoint(i, `codegraph_p${i}`));
    failAttempts = new Set([2, 3, 4]); // exhaust withRetry on the second page

    const { listCodebaseCollections } = await import("../../src/services/qdrant.js");
    const result = await listCodebaseCollections();

    expect(result).toContain("codebase_realone");
    expect(result).toContain("codegraph_p0"); // first page survived
    expect(result).not.toContain("codegraph_p2499");
  }, 20_000);

  it("stops when the cursor stops advancing", async () => {
    // An unbounded cursor loop cannot be caught — an infinite loop never throws
    // — and auto-resume is not awaited, so this would hang with nothing logged
    // and no project ever resumed.
    metadataPoints = Array.from({ length: 2500 }, (_, i) => metadataPoint(i, `codegraph_p${i}`));
    stallCursor = true;

    const { listCodebaseCollections } = await import("../../src/services/qdrant.js");
    const result = await listCodebaseCollections();

    expect(scrollCalls).toHaveLength(2); // first page, then the stall is caught
    expect(result).toContain("codegraph_p0");
  }, 20_000);
});

describe("project reclamation inventory", () => {
  it("reports absent and inaccessible paths without classifying either as stale", async () => {
    const gone = path.resolve("/gone/project");
    const linked = path.resolve("/linked/project");
    const canonical = path.resolve("/canonical/project");
    const blocked = path.resolve("/blocked/project");
    metadataPoints = [
      { id: 1, payload: { collectionName: "codebase_path-hash", projectPath: gone } },
      { id: 2, payload: { collectionName: "codebase_pinned", projectPath: linked } },
      { id: 3, payload: { collectionName: "codebase_other", projectPath: canonical } },
      { id: 4, payload: { collectionName: "codebase_remote", projectPath: blocked } },
      { id: 5, payload: { collectionName: 42, projectPath: "/typed/wrong" } },
      { id: 6, payload: { collectionName: "something_else_entirely", projectPath: "/foreign/project" } },
    ];
    mockRealpath.mockImplementation(async (value: string) => {
      if (value === gone) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      if (value === blocked) throw Object.assign(new Error("denied"), { code: "EACCES" });
      if (value === linked || value === canonical) return canonical;
      return value;
    });

    const { getProjectReclamationInventory } = await import("../../src/services/qdrant.js");
    const inventory = await getProjectReclamationInventory();
    const byIdentity = new Map(inventory.entries.map((entry) => [entry.identity, entry]));

    expect(byIdentity.get("path-hash")?.pathState).toBe("absent-on-this-host");
    expect(byIdentity.get("remote")?.pathState).toBe("unknown/inaccessible");
    expect(byIdentity.get("pinned")?.possibleSuperseded).toBe(true);
    expect(byIdentity.get("other")?.possibleSuperseded).toBe(true);
    expect(byIdentity.get("path-hash")?.metadataRecords).toEqual([
      expect.objectContaining({ pointId: 1, collectionName: "codebase_path-hash", projectPath: gone }),
    ]);
    // Each unattributable point is returned with what a person needs to find it, never inferred into an identity.
    expect(inventory.unrecognisedMetadata).toEqual([
      { pointId: 5, collectionName: null, projectPath: "/typed/wrong", reason: "collectionName is missing or not a string" },
      { pointId: 6, collectionName: "something_else_entirely", projectPath: "/foreign/project", reason: expect.stringContaining("not a known resource family") },
    ]);
  });

  it("marks an identity for manual inspection when its records disagree about the path", async () => {
    metadataPoints = [
      { id: 1, payload: { collectionName: "codebase_split", projectPath: "/one/project" } },
      { id: 2, payload: { collectionName: "codegraph_split", projectPath: "/two/project" } },
    ];

    const { getProjectReclamationInventory } = await import("../../src/services/qdrant.js");
    const entry = (await getProjectReclamationInventory()).entries.find((candidate) => candidate.identity === "split");

    expect(entry).toBeDefined();
    if (!entry) return;
    expect(entry.requiresManualInspection).toBe(true);
    expect(entry.projectPath).toBeNull();
    expect(entry.metadataRecords.map((record) => record.projectPath)).toEqual(["/one/project", "/two/project"]);
  });

  it("neither inventories nor deletes a lookalike outside the configured prefix", async () => {
    process.env.QDRANT_COLLECTION_PREFIX = "team_";
    collectionNames = [
      "team_codebase_alpha",
      "team_alpha_symgraph_meta",
      "team_context_alpha",
      "codebase_alpha",
      "alpha_symgraph_meta",
      "other_codebase_alpha",
      "team_socraticode_metadata",
    ];
    metadataPoints = [
      { id: 1, payload: { collectionName: "team_codebase_alpha", projectPath: "/team/alpha" } },
      { id: 2, payload: { collectionName: "codebase_alpha", projectPath: "/someone/else" } },
    ];

    const { getProjectReclamationInventory, removeProjectReclamationEntry } = await import("../../src/services/qdrant.js");
    const inventory = await getProjectReclamationInventory();

    expect(inventory.entries.map((entry) => entry.identity)).toEqual(["alpha"]);
    const [alpha] = inventory.entries;
    expect(alpha.resourceCollections).toEqual(["team_alpha_symgraph_meta", "team_codebase_alpha", "team_context_alpha"]);
    expect(alpha.metadataRecords.map((record) => record.collectionName)).toEqual(["team_codebase_alpha"]);
    expect(inventory.unrecognisedMetadata).toEqual([
      expect.objectContaining({ pointId: 2, collectionName: "codebase_alpha" }),
    ]);

    await removeProjectReclamationEntry(alpha);
    expect(deletedCollections.sort()).toEqual(["team_alpha_symgraph_meta", "team_codebase_alpha", "team_context_alpha"]);
    expect(deletedMetadata).toEqual([{ points: [1], wait: true }]);
  });

  it("keeps a pinned identity that begins with a family name in one piece when its symbol-graph triple is stored", async () => {
    collectionNames = [
      "codebase_context_docs",
      "context_context_docs",
      "context_docs_symgraph_meta",
      "context_docs_symgraph_file",
      "context_docs_symgraph_index",
      "socraticode_metadata",
    ];
    metadataPoints = [{ id: 1, payload: { collectionName: "codebase_context_docs", projectPath: "/docs" } }];

    const { getProjectReclamationInventory } = await import("../../src/services/qdrant.js");
    const inventory = await getProjectReclamationInventory();

    expect(inventory.entries.map((entry) => entry.identity)).toEqual(["context_docs"]);
    expect(inventory.entries[0].resourceCollections).toEqual([
      "codebase_context_docs",
      "context_context_docs",
      "context_docs_symgraph_file",
      "context_docs_symgraph_index",
      "context_docs_symgraph_meta",
    ]);
    expect(inventory.unattributedCollections).toEqual([]);
  });

  it.each(["_symgraph_meta", "_symgraph_file", "_symgraph_index"])(
    "attributes a family collection of an identity ending in %s by its metadata point",
    async (suffix) => {
      const identity = `context_docs${suffix}`;
      collectionNames = [`codebase_${identity}`, "socraticode_metadata"];
      metadataPoints = [{ id: 1, payload: { collectionName: `codebase_${identity}`, projectPath: "/odd" } }];

      const { getProjectReclamationInventory } = await import("../../src/services/qdrant.js");
      const inventory = await getProjectReclamationInventory();

      // The name also reads as the symbol graph of `codebase_context_docs`; the metadata point settles it.
      expect(inventory.entries.map((entry) => entry.identity)).toEqual([identity]);
      expect(inventory.entries[0].resourceCollections).toEqual([`codebase_${identity}`]);
      expect(inventory.entries[0].metadataRecords.map((record) => record.collectionName)).toEqual([`codebase_${identity}`]);
      expect(inventory.unattributedCollections).toEqual([]);
    },
  );

  it.each(["_symgraph_meta", "_symgraph_file", "_symgraph_index"])(
    "leaves a lone %s name that fits two identities for a person, and never deletes it",
    async (suffix) => {
      const name = `context_docs${suffix}`;
      collectionNames = [name, "socraticode_metadata"];
      metadataPoints = [];

      const { getProjectReclamationInventory } = await import("../../src/services/qdrant.js");
      const inventory = await getProjectReclamationInventory();

      expect(inventory.entries).toEqual([]);
      expect(inventory.unattributedCollections).toEqual([
        { name, reason: expect.stringContaining("context_docs (symgraph) or docs"), candidateIdentities: ["context_docs", `docs${suffix}`] },
      ]);
    },
  );

  it("holds back both candidates of a name that a metadata point and a symbol-graph triple both claim", async () => {
    collectionNames = [
      "context_docs_symgraph_meta",
      "context_docs_symgraph_file",
      "context_docs_symgraph_index",
      "socraticode_metadata",
    ];
    metadataPoints = [{ id: 1, payload: { collectionName: "context_docs_symgraph_meta", projectPath: "/both" } }];

    const { getProjectReclamationInventory } = await import("../../src/services/qdrant.js");
    const inventory = await getProjectReclamationInventory();

    expect(inventory.unattributedCollections).toEqual([
      expect.objectContaining({ name: "context_docs_symgraph_meta", candidateIdentities: ["context_docs", "docs_symgraph_meta"] }),
    ]);
    expect(inventory.entries.map((entry) => entry.identity)).toEqual(["context_docs", "docs_symgraph_meta"]);
    // Deleting either candidate would remove the evidence and hand the name to the other on the next read.
    for (const entry of inventory.entries) {
      expect(entry.requiresManualInspection).toBe(true);
      expect(entry.manualInspectionReasons).toEqual([expect.stringContaining("context_docs_symgraph_meta fits this identity and another")]);
    }
    expect(inventory.entries.find((entry) => entry.identity === "context_docs")?.resourceCollections).toEqual([
      "context_docs_symgraph_file",
      "context_docs_symgraph_index",
    ]);

    const again = await getProjectReclamationInventory();
    expect(again.unattributedCollections.map((item) => item.name)).toEqual(["context_docs_symgraph_meta"]);
    expect(again.entries.every((entry) => entry.requiresManualInspection)).toBe(true);
  });

  it("changes the confirmation token when a hold appears or lifts while records and resources stay the same", async () => {
    const { getProjectReclamationInventory } = await import("../../src/services/qdrant.js");
    metadataPoints = [{ id: 1, payload: { collectionName: "codebase_context_docs", projectPath: "/docs" } }];
    const tokenFor = async (names: string[]) => {
      collectionNames = names;
      const entry = (await getProjectReclamationInventory()).entries.find((candidate) => candidate.identity === "context_docs");
      if (!entry) throw new Error("context_docs missing from inventory");
      return { token: entry.confirmationToken, held: entry.requiresManualInspection, resources: entry.resourceCollections };
    };

    const free = await tokenFor(["codebase_context_docs", "socraticode_metadata"]);
    // A lone `context_docs_symgraph_file` fits two identities and holds context_docs back, without joining its resources.
    const held = await tokenFor(["codebase_context_docs", "context_docs_symgraph_file", "socraticode_metadata"]);
    const lifted = await tokenFor(["codebase_context_docs", "socraticode_metadata"]);

    expect(free.held).toBe(false);
    expect(held.held).toBe(true);
    expect(held.resources).toEqual(free.resources);
    expect(held.token).not.toBe(free.token);
    expect(lifted.held).toBe(false);
    expect(lifted.token).toBe(free.token);
  });

  it("stops at the first write after the barrier is lost, and attempts nothing more", async () => {
    const { removeProjectReclamationEntry } = await import("../../src/services/qdrant.js");
    let mayContinue = true;

    const outcomes = await removeProjectReclamationEntry(
      {
        identity: "old-index",
        projectPath: null,
        canonicalPath: null,
        pathState: "unknown/inaccessible",
        resourceCollections: ["codebase_old-index", "codegraph_old-index"],
        metadataRecords: [
          { pointId: "point-1", collectionName: "codebase_old-index", projectPath: null, indexingStatus: null, lastIndexedAt: null, lastBuiltAt: null, builtByVersion: null },
        ],
        inProgress: false,
        possibleSuperseded: false,
        requiresManualInspection: false,
        manualInspectionReasons: [],
        confirmationToken: "token",
      },
      () => {
        // Lost while the first deletion was in flight: consent holds for it and for nothing after.
        const answer = mayContinue;
        mayContinue = false;
        return answer;
      },
    );

    expect(outcomes).toEqual([
      { resource: "codebase_old-index", kind: "collection", outcome: "deleted" },
      expect.objectContaining({ resource: "codegraph_old-index", kind: "collection", outcome: "skipped" }),
      expect.objectContaining({ resource: "codebase_old-index [point point-1]", kind: "metadata", outcome: "skipped" }),
    ]);
    expect(deletedCollections).toEqual(["codebase_old-index"]);
    expect(deletedMetadata).toEqual([]);
  });

  it("changes the confirmation token when any record of the identity changes", async () => {
    const code = { id: 1, payload: { collectionName: "codebase_dual", projectPath: "/dual", indexingStatus: "completed", lastIndexedAt: "2026-09-01T00:00:00.000Z" } };
    const context = { id: 2, payload: { collectionName: "context_dual", projectPath: "/dual", lastIndexedAt: "2026-09-02T00:00:00.000Z" } };
    const { getProjectReclamationInventory } = await import("../../src/services/qdrant.js");
    const tokenFor = async (points: typeof metadataPoints) => {
      metadataPoints = points;
      const [entry] = (await getProjectReclamationInventory()).entries;
      return entry.confirmationToken;
    };

    const baseline = await tokenFor([code, context]);
    expect(await tokenFor([code, context])).toBe(baseline);
    // The last scrolled record is unchanged in both cases; only the other one moves.
    expect(await tokenFor([{ ...code, payload: { ...code.payload, indexingStatus: "in-progress" } }, context])).not.toBe(baseline);
    expect(await tokenFor([code, { ...context, payload: { ...context.payload, lastIndexedAt: "2026-09-03T00:00:00.000Z" } }])).not.toBe(baseline);
    expect(await tokenFor([code])).not.toBe(baseline);
  });

  it("flags an identity as in progress when any of its records says so", async () => {
    metadataPoints = [
      { id: 1, payload: { collectionName: "codebase_busy", projectPath: "/busy", indexingStatus: "completed" } },
      { id: 2, payload: { collectionName: "context_busy", projectPath: "/busy", indexingStatus: "in-progress" } },
    ];

    const { getProjectReclamationInventory } = await import("../../src/services/qdrant.js");
    const [entry] = (await getProjectReclamationInventory()).entries;

    expect(entry.inProgress).toBe(true);
  });

  it("keeps partial cleanup failures in the per-resource outcome", async () => {
    collectionDeleteFailures.add("context_old-index");
    metadataDeleteError = new Error("cannot delete metadata");
    const { removeProjectReclamationEntry } = await import("../../src/services/qdrant.js");

    const outcomes = await removeProjectReclamationEntry({
      identity: "old-index",
      projectPath: "/gone/project",
      canonicalPath: null,
      pathState: "absent-on-this-host",
      resourceCollections: ["codebase_old-index", "context_old-index"],
      metadataRecords: [
        { pointId: "point-1", collectionName: "codebase_old-index", projectPath: "/gone/project", indexingStatus: null, lastIndexedAt: null, lastBuiltAt: null, builtByVersion: null },
      ],
      inProgress: false,
      possibleSuperseded: false,
      requiresManualInspection: false,
      manualInspectionReasons: [],
      confirmationToken: "token",
    });

    expect(outcomes).toEqual([
      { resource: "codebase_old-index", kind: "collection", outcome: "deleted" },
      expect.objectContaining({ resource: "context_old-index", kind: "collection", outcome: "failed" }),
      expect.objectContaining({ resource: "codebase_old-index [point point-1]", kind: "metadata", outcome: "failed" }),
    ]);
    expect(deletedCollections).toEqual(["codebase_old-index"]);
    expect(deletedMetadata).toEqual([]);
  });

  it("counts a resource that is already gone as deleted, and waits for the metadata delete", async () => {
    collectionsAlreadyGone.add("codebase_old-index");
    metadataDeleteError = Object.assign(new Error("Not found: No point with id point-1"), { status: 404 });
    const { removeProjectReclamationEntry } = await import("../../src/services/qdrant.js");

    const outcomes = await removeProjectReclamationEntry({
      identity: "old-index",
      projectPath: null,
      canonicalPath: null,
      pathState: "unknown/inaccessible",
      resourceCollections: ["codebase_old-index", "codegraph_old-index"],
      metadataRecords: [
        { pointId: "point-1", collectionName: "codebase_old-index", projectPath: null, indexingStatus: null, lastIndexedAt: null, lastBuiltAt: null, builtByVersion: null },
      ],
      inProgress: false,
      possibleSuperseded: false,
      requiresManualInspection: false,
      manualInspectionReasons: [],
      confirmationToken: "token",
    });

    expect(outcomes).toEqual([
      { resource: "codebase_old-index", kind: "collection", outcome: "deleted" },
      { resource: "codegraph_old-index", kind: "collection", outcome: "deleted" },
      { resource: "codebase_old-index [point point-1]", kind: "metadata", outcome: "deleted" },
    ]);

    metadataDeleteError = null;
    await removeProjectReclamationEntry({
      identity: "old-index",
      projectPath: null,
      canonicalPath: null,
      pathState: "unknown/inaccessible",
      resourceCollections: [],
      metadataRecords: [
        { pointId: "point-1", collectionName: "codebase_old-index", projectPath: null, indexingStatus: null, lastIndexedAt: null, lastBuiltAt: null, builtByVersion: null },
      ],
      inProgress: false,
      possibleSuperseded: false,
      requiresManualInspection: false,
      manualInspectionReasons: [],
      confirmationToken: "token",
    });
    expect(deletedMetadata).toEqual([{ points: ["point-1"], wait: true }]);
  });
});
