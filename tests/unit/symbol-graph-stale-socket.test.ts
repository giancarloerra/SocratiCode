// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited
import { Worker } from "node:worker_threads";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SymbolGraphFilePayload } from "../../src/types.js";

/**
 * A synchronous step that outlasts the server's keep-alive leaves the client
 * holding a connection the server has closed, and the next request fails with
 * `fetch failed` caused by `other side closed [UND_ERR_SOCKET]`. The fixture
 * server runs on its own thread so it can close the connection while this
 * thread is blocked.
 */
describe("symbol-graph store: requests on a connection closed during a slow step", () => {
  const IDLE_MS = 50;
  const UPSERT = { method: "PUT", path: "^/collections/[^/]+/points$" };

  const originalQdrantUrl = process.env.QDRANT_URL;
  let server: Worker;
  let nextId = 0;
  let store: typeof import("../../src/services/symbol-graph-store.js");
  let qdrant: typeof import("../../src/services/qdrant.js");

  function ask<T>(msg: Record<string, unknown>): Promise<T> {
    const id = ++nextId;
    return new Promise((resolve) => {
      const onMessage = (reply: { id?: number }) => {
        if (reply.id !== id) return;
        server.off("message", onMessage);
        resolve(reply as T);
      };
      server.on("message", onMessage);
      server.postMessage({ ...msg, id });
    });
  }

  /**
   * Block the thread past the server's idle timeout. Call it right after a
   * Qdrant response: an event-loop turn in between lets undici's idle-socket
   * check read the close before the next request is written.
   */
  function slowSynchronousStep(): void {
    const end = Date.now() + IDLE_MS * 4;
    while (Date.now() < end) {
      // busy-wait: the event loop must not run
    }
  }

  beforeAll(async () => {
    server = new Worker(new URL("../helpers/idle-closing-qdrant-server.mjs", import.meta.url), {
      workerData: { idleMs: IDLE_MS },
    });
    const { port } = await new Promise<{ port: number }>((resolve) => server.once("message", resolve));
    process.env.QDRANT_URL = `http://127.0.0.1:${port}`;
    store = await import("../../src/services/symbol-graph-store.js");
    qdrant = await import("../../src/services/qdrant.js");
  });

  afterAll(async () => {
    await server.terminate();
    if (originalQdrantUrl === undefined) delete process.env.QDRANT_URL;
    else process.env.QDRANT_URL = originalQdrantUrl;
  });

  beforeEach(async () => {
    await ask({ type: "reset" });
    store.resetSymbolGraphCollectionCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const payload = (version: string): SymbolGraphFilePayload => ({
    file: "src/a.ts",
    language: "typescript",
    contentHash: version,
    symbols: [],
    outgoingCalls: [],
  });

  function transportError(code: string): TypeError {
    return new TypeError("fetch failed", { cause: Object.assign(new Error(code), { code }) });
  }

  it.each(["EPIPE", "ECONNRESET"])("replays the same upsert once after %s and persists the payload", async (code) => {
    const upsert = vi.spyOn(qdrant.getClient(), "upsert").mockRejectedValueOnce(transportError(code));
    const expected = payload("v1");
    await store.saveFilePayloads("p", [expected], "g1");
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert.mock.calls[1]).toEqual(upsert.mock.calls[0]);
    expect(await store.loadFilePayload("p", expected.file, "g1")).toEqual(expected);
  });

  it.each(["EPIPE", "ECONNRESET"])("propagates the second %s failure unchanged", async (code) => {
    const second = transportError(code);
    const upsert = vi.spyOn(qdrant.getClient(), "upsert")
      .mockRejectedValueOnce(transportError(code))
      .mockRejectedValueOnce(second);
    await expect(store.saveFilePayloads("p", [payload("v1")], "g1")).rejects.toBe(second);
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it("propagates a refused connection on the first attempt", async () => {
    const refused = transportError("ECONNREFUSED");
    const upsert = vi.spyOn(qdrant.getClient(), "upsert").mockRejectedValueOnce(refused);
    await expect(store.saveFilePayloads("p", [payload("v1")], "g1")).rejects.toBe(refused);
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it("retries an upsert sent after the slow step, and stores the payload", async () => {
    await store.saveFilePayloads("p", [payload("v1")], "g1");
    slowSynchronousStep();
    await store.saveFilePayloads("p", [payload("v2")], "g1");
    expect(await store.loadFilePayload("p", "src/a.ts", "g1"), "payload written after the slow step").toEqual(payload("v2"));
  });

  it("retries a collection check sent after the slow step", async () => {
    await store.saveFilePayloads("p", [payload("v1")], "g1");
    store.resetSymbolGraphCollectionCache();
    slowSynchronousStep();
    await store.saveFilePayloads("p", [payload("v2")], "g1");
    expect(await store.loadFilePayload("p", "src/a.ts", "g1"), "payload written after the slow step").toEqual(payload("v2"));
  });

  it("retries a shard load sent after the slow step", async () => {
    const reverseEdges = { "src/a.ts#alpha": ["src/b.ts#beta"] };
    await store.saveReverseShard("p", 9, reverseEdges, "g1");
    slowSynchronousStep();
    expect(await store.loadReverseShard("p", 9, "g1"), "shard read after the slow step").toEqual(reverseEdges);
  });

  it("fails when the retry also hits a closed connection, and names the socket error", async () => {
    await ask({ type: "reset", close: { ...UPSERT, count: 2 } });
    const err = await store.saveFilePayloads("p", [payload("v1")], "g1").then(
      () => null,
      (e: unknown) => e,
    );
    expect(err, "second consecutive close must reject").not.toBeNull();
    expect(qdrant.describeQdrantError(err)).toBe("fetch failed: other side closed [UND_ERR_SOCKET]");
  });

  it("does not retry a request the server answered with an error", async () => {
    await ask({ type: "reset", reject: UPSERT });
    await expect(store.saveFilePayloads("p", [payload("v1")], "g1")).rejects.toThrow();
    const { requests } = await ask<{ requests: string[] }>({ type: "requests" });
    expect(requests.filter((r) => r.startsWith("PUT ") && r.endsWith("/points")), "upsert sent exactly once").toHaveLength(1);
  });
});
