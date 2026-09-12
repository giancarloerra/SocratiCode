// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphChangeSummary } from "../../src/services/graph-inputs.js";
import type { GraphInputsLoad } from "../../src/services/qdrant.js";

/**
 * What `shouldRebuildGraph` makes of the three outcomes a metadata read can
 * have. They are easy to collapse into one "no record, rebuild" and must not
 * be: only one of them means there is no graph, and the compatibility rule for
 * the other two is that they rebuild once *however quiet the update was*.
 */
const load = vi.hoisted(() => ({ result: { status: "absent" } as GraphInputsLoad }));

vi.mock("../../src/services/qdrant.js", () => ({
  loadGraphInputs: vi.fn(async () => load.result),
  saveGraphData: vi.fn(async () => undefined),
  loadGraphData: vi.fn(async () => null),
  getGraphMetadata: vi.fn(async () => null),
  deleteGraphData: vi.fn(async () => undefined),
  describeQdrantError: (err: unknown) => String(err),
}));

const quiet = (): GraphChangeSummary => ({
  hasAdditions: false,
  changed: new Map(),
  removed: new Set(),
  unreadable: new Set(),
  knownHash: () => undefined,
});

describe("what a metadata read can say about the graph", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports no graph when the metadata point is absent", async () => {
    // Nothing persisted. Rebuilding here would be *building* a graph, which an
    // update that indexed nothing has no business deciding to do — so the
    // caller is told, and `graphExists` is the thing that tells it.
    const { shouldRebuildGraph } = await import("../../src/services/code-graph.js");
    load.result = { status: "absent" };

    await expect(shouldRebuildGraph("/tmp/no-such-project", quiet())).resolves.toEqual({
      rebuild: true,
      reason: "no code graph has been built yet",
      graphExists: false,
    });
  });

  it("rebuilds a graph whose record is missing, and does not call that an absent graph", async () => {
    // The legacy case: a graph built before records existed. It must rebuild
    // once and populate, on any update, so `graphExists` has to be true.
    const { shouldRebuildGraph } = await import("../../src/services/code-graph.js");
    load.result = { status: "stored", value: undefined };

    await expect(shouldRebuildGraph("/tmp/legacy-project", quiet())).resolves.toMatchObject({
      rebuild: true,
      reason: "no usable record of what the graph was built from",
      graphExists: true,
    });
  });

  it("rebuilds a graph whose record is malformed or of an unknown version", async () => {
    const { shouldRebuildGraph } = await import("../../src/services/code-graph.js");

    load.result = { status: "stored", value: "{not json" };
    await expect(shouldRebuildGraph("/tmp/malformed", quiet())).resolves.toMatchObject({
      rebuild: true,
      graphExists: true,
    });

    load.result = { status: "stored", value: { version: 999 } };
    await expect(shouldRebuildGraph("/tmp/future", quiet())).resolves.toMatchObject({
      rebuild: true,
      graphExists: true,
    });
  });

  it("rebuilds when the read failed, rather than reading that as no record", async () => {
    // A failed read knows nothing, least of all that there is no graph. It is
    // the most conservative of the three outcomes and must not be the quietest:
    // the reason names the failure so it is not mistaken for the legacy path.
    const { shouldRebuildGraph } = await import("../../src/services/code-graph.js");
    load.result = { status: "failed", error: "connection refused" };

    const decision = await shouldRebuildGraph("/tmp/unreachable", quiet());

    expect(decision).toMatchObject({ rebuild: true, graphExists: true });
    expect(decision.reason).toContain("could not be read");
    expect(decision.reason).toContain("connection refused");
  });
});
