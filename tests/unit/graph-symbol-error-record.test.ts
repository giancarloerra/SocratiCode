// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited
//
// Issue #89: when symbol-graph persistence fails, the build must record WHY
// instead of reporting an unqualified success (which left codebase_impact
// answering "0 callers" with no explanation). The subtle half is that the
// incremental watcher path calls rebuildGraph with skipSymbolGraph, which does
// not touch the symbol graph at all and therefore must not erase a failure
// recorded by the last build that did.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Persisting the FILE graph must succeed; only the SYMBOL graph fails.
vi.mock("../../src/services/qdrant.js", () => ({
  saveGraphData: vi.fn(async () => undefined),
  loadGraphData: vi.fn(async () => null),
  getGraphMetadata: vi.fn(async () => null),
  deleteGraphData: vi.fn(async () => undefined),
  describeQdrantError: (err: unknown) => {
    const base = err instanceof Error ? err.message : String(err);
    const reason = (err as { data?: { status?: { error?: unknown } } })?.data?.status?.error;
    return typeof reason === "string" ? `${base}: ${reason}` : base;
  },
}));

const symbolPersistFails = { value: true };

vi.mock("../../src/services/symbol-graph-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/services/symbol-graph-store.js")>();
  return {
    ...actual,
    ensureSymbolGraphCollections: vi.fn(async () => undefined),
    saveSymbolGraphMeta: vi.fn(async () => undefined),
    saveShardsForFreshGeneration: vi.fn(async () => undefined),
    deleteSymbolGraphData: vi.fn(async () => undefined),
    saveFilePayloads: vi.fn(async () => {
      if (!symbolPersistFails.value) return undefined;
      // Shaped like the real @qdrant/js-client-rest 400: message is only the
      // HTTP status text, the reason lives in `data`.
      throw Object.assign(new Error("Bad Request"), {
        status: 400,
        data: { status: { error: "JSON payload (36001578 bytes) is larger than allowed (limit: 33554432 bytes)" } },
      });
    }),
  };
});

import {
  ensureDynamicLanguages,
  getLastGraphBuildCompleted,
  invalidateGraphCache,
  rebuildGraph,
} from "../../src/services/code-graph.js";

describe("symbol-graph failure is recorded and not silently cleared (#89)", () => {
  let root: string;

  beforeEach(() => {
    ensureDynamicLanguages();
    symbolPersistFails.value = true;
    root = fs.mkdtempSync(path.join(os.tmpdir(), "symerr-"));
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "a.ts"), "export function a() { return 1; }\n");
    fs.writeFileSync(path.join(root, "src", "b.ts"), "import { a } from './a.js';\nexport const b = a();\n");
    invalidateGraphCache(root);
  });

  afterEach(() => {
    invalidateGraphCache(root);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("Git refresh does not advance the graph input record when symbol persistence fails", async () => {
    const { projectIdFromPath } = await import("../../src/config.js");
    const { saveGraphData } = await import("../../src/services/qdrant.js");
    vi.mocked(saveGraphData).mockClear();
    const target = { projectId: projectIdFromPath(root), allowCreate: true, assertCurrent: async () => {} };
    await expect(rebuildGraph(root, { projectId: target.projectId, target })).rejects.toThrow("Bad Request");
    expect(saveGraphData).not.toHaveBeenCalled();
    expect(getLastGraphBuildCompleted(root)?.error).toContain("Bad Request");
  });

  it("records the server's real reason, not the bare HTTP status text", async () => {
    await rebuildGraph(root);
    const last = getLastGraphBuildCompleted(root);

    expect(last?.symbolGraphError).toBeDefined();
    // "Bad Request" alone is what used to be logged and is useless on its own.
    expect(last?.symbolGraphError).toContain("larger than allowed");
    expect(last?.symbolGraphError).toContain("33554432");
    // The file-import graph itself still succeeded and is reported as built.
    expect(last?.nodesCreated).toBeGreaterThan(0);
    expect(last?.error).toBeUndefined();
  });

  it("keeps the failure recorded across an incremental (skipSymbolGraph) rebuild", async () => {
    await rebuildGraph(root);
    expect(getLastGraphBuildCompleted(root)?.symbolGraphError).toBeDefined();

    // The watcher path: indexer.ts calls rebuildGraph(path, { skipSymbolGraph:
    // useIncremental }) on ordinary file edits. It never attempts the symbol
    // graph, so it must not report it healthy.
    invalidateGraphCache(root);
    await rebuildGraph(root, { skipSymbolGraph: true });

    const last = getLastGraphBuildCompleted(root);
    expect(last?.symbolGraphError).toBeDefined();
    expect(last?.symbolGraphError).toContain("larger than allowed");
  });

  it("keeps the failure recorded when a later build dies before the symbol phase", async () => {
    await rebuildGraph(root);
    expect(getLastGraphBuildCompleted(root)?.symbolGraphError).toBeDefined();

    // A total build failure (here: the file-graph save blows up, as a transient
    // Qdrant outage would) must not erase the symbol-graph failure, or the next
    // incremental build carries the blank forward and reports it healthy.
    const qdrant = await import("../../src/services/qdrant.js");
    const saveSpy = vi.spyOn(qdrant, "saveGraphData").mockRejectedValueOnce(new Error("connect ECONNREFUSED"));
    invalidateGraphCache(root);
    await expect(rebuildGraph(root)).rejects.toThrow("ECONNREFUSED");
    saveSpy.mockRestore();

    const last = getLastGraphBuildCompleted(root);
    expect(last?.error).toContain("ECONNREFUSED");
    expect(last?.symbolGraphError).toContain("larger than allowed");
  });

  it("clears the failure only when a real symbol-graph persist succeeds", async () => {
    await rebuildGraph(root);
    expect(getLastGraphBuildCompleted(root)?.symbolGraphError).toBeDefined();

    symbolPersistFails.value = false;
    invalidateGraphCache(root);
    await rebuildGraph(root);

    expect(getLastGraphBuildCompleted(root)?.symbolGraphError).toBeUndefined();
  });
});
