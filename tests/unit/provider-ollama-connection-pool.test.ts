// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited
import { createServer, type Server } from "node:http";
import type { Socket } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetEmbeddingConfig } from "../../src/services/embedding-config.js";
import { OllamaEmbeddingProvider, resetOllamaClient, resetOllamaReadinessCache } from "../../src/services/provider-ollama.js";

/**
 * Issue 114: the Ollama client rode Node's default fetch pool, which has no
 * per-origin connection cap, so concurrent embeds stacked sockets to Ollama
 * without limit. The provider now supplies a bounded undici Agent through the
 * client's fetch override. These tests count connections on the FIXTURE
 * SERVER side ('connection' events), which is portable and needs no lsof.
 */
describe("ollama connection pool", () => {
  const originalEnv = { ...process.env };
  let server: Server;
  let port = 0;
  let opened = 0;
  let openSockets: Set<Socket>;
  let failNext = 0;
  let requiredAuthorization: string | undefined;
  let authorizations: (string | undefined)[];

  beforeEach(async () => {
    opened = 0;
    failNext = 0;
    requiredAuthorization = undefined;
    authorizations = [];
    openSockets = new Set();
    server = createServer((req, res) => {
      authorizations.push(req.headers.authorization);
      req.resume();
      req.on("end", () => {
        if (requiredAuthorization && req.headers.authorization !== requiredAuthorization) {
          res.writeHead(401, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "Unauthorized" }));
          return;
        }
        if (failNext > 0) {
          failNext--;
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "fixture failure" }));
          return;
        }
        const body = JSON.stringify(req.url === "/api/tags"
          ? { models: [{ name: "nomic-embed-text:latest" }] }
          : { embeddings: [[0.1, 0.2, 0.3]] });
        // A small delay keeps requests genuinely concurrent, so the peak
        // socket count measures the pool bound rather than scheduling luck.
        setTimeout(() => {
          res.writeHead(200, {
            "content-type": "application/json",
            "content-length": String(Buffer.byteLength(body)),
          });
          res.end(body);
        }, 30);
      });
    });
    // Defeat the server-side 5s idle reaper so client behavior, not the
    // fixture, decides when sockets close.
    server.keepAliveTimeout = 120_000;
    server.on("connection", (socket) => {
      opened++;
      openSockets.add(socket);
      socket.on("close", () => openSockets.delete(socket));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    port = typeof address === "object" && address ? address.port : 0;

    resetEmbeddingConfig();
    resetOllamaClient();
    resetOllamaReadinessCache();
    process.env.EMBEDDING_PROVIDER = "ollama";
    process.env.EMBEDDING_MODEL = "nomic-embed-text";
    process.env.OLLAMA_MODE = "external";
    process.env.OLLAMA_URL = `http://127.0.0.1:${port}`;
    delete process.env.OLLAMA_MAX_CONNECTIONS;
    delete process.env.OLLAMA_API_KEY;
  });

  afterEach(async () => {
    resetOllamaClient();
    resetOllamaReadinessCache();
    resetEmbeddingConfig();
    process.env = { ...originalEnv };
    for (const socket of openSockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("caps concurrent connections at the default bound", async () => {
    // 3 rounds of 20 concurrent embeds against a default cap of 4: without
    // the bounded agent the fixture accepts 20 sockets in the first round
    // (measured on the pre-fix provider), with it the total ever opened
    // stays at the cap and later rounds reuse the pooled connections.
    const provider = new OllamaEmbeddingProvider();
    for (let round = 0; round < 3; round++) {
      await Promise.all(
        Array.from({ length: 20 }, (_, i) => provider.embed([`text-${round}-${i}`])),
      );
    }
    expect(opened).toBeLessThanOrEqual(4);
  });

  it("honours OLLAMA_MAX_CONNECTIONS", async () => {
    process.env.OLLAMA_MAX_CONNECTIONS = "2";
    resetEmbeddingConfig();
    const provider = new OllamaEmbeddingProvider();
    await Promise.all(Array.from({ length: 12 }, (_, i) => provider.embed([`t-${i}`])));
    expect(opened).toBeLessThanOrEqual(2);
  });

  it("authenticates model readiness and embedding requests with the configured key", async () => {
    requiredAuthorization = "Bearer fixture-key-one";
    process.env.OLLAMA_API_KEY = "fixture-key-one";
    const provider = new OllamaEmbeddingProvider();

    await provider.ensureReady();
    await expect(provider.embed(["authenticated embedding"])).resolves.toEqual([[0.1, 0.2, 0.3]]);
    expect(authorizations.length).toBeGreaterThan(0);
    expect(authorizations.every((value) => value === requiredAuthorization)).toBe(true);
  });

  it("omits authorization when no key is configured", async () => {
    await new OllamaEmbeddingProvider().embed(["unauthenticated embedding"]);
    expect(authorizations).toEqual([undefined]);
  });

  it("uses a changed key without requiring a client reset", async () => {
    requiredAuthorization = "Bearer fixture-key-one";
    process.env.OLLAMA_API_KEY = "fixture-key-one";
    const provider = new OllamaEmbeddingProvider();
    await provider.embed(["first key"]);

    requiredAuthorization = "Bearer fixture-key-two";
    process.env.OLLAMA_API_KEY = "fixture-key-two";
    resetEmbeddingConfig();
    await expect(provider.embed(["second key"])).resolves.toEqual([[0.1, 0.2, 0.3]]);
    expect(authorizations).toEqual(["Bearer fixture-key-one", "Bearer fixture-key-two"]);
  });

  it("stops sending a key after it is removed from configuration", async () => {
    process.env.OLLAMA_API_KEY = "fixture-key-one";
    const provider = new OllamaEmbeddingProvider();
    await provider.embed(["with key"]);

    delete process.env.OLLAMA_API_KEY;
    resetEmbeddingConfig();
    await provider.embed(["without key"]);
    expect(authorizations).toEqual(["Bearer fixture-key-one", undefined]);
  });

  it("rejects an invalid key without including it in the error", async () => {
    requiredAuthorization = "Bearer fixture-key-one";
    const invalidKey = "fixture-invalid-key";
    process.env.OLLAMA_API_KEY = invalidKey;
    let failure: unknown;
    try {
      await new OllamaEmbeddingProvider().embed(["invalid key"]);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).toContain("Unauthorized");
    expect(String(failure)).not.toContain(invalidKey);
  });

  it("rechecks readiness after the configured key changes", async () => {
    requiredAuthorization = "Bearer fixture-key-one";
    process.env.OLLAMA_API_KEY = "fixture-key-one";
    const provider = new OllamaEmbeddingProvider();
    await provider.ensureReady();

    process.env.OLLAMA_API_KEY = "fixture-invalid-key";
    resetEmbeddingConfig();
    await expect(provider.ensureReady()).rejects.toThrow("Ollama is not reachable");
    expect(authorizations.at(-1)).toBe("Bearer fixture-invalid-key");
  });

  it("rejects on a failing response and stays bounded through failures", async () => {
    // The bound must hold on the failure path too: a connection consumed by
    // an error response has to return to the pool, not leak and be replaced.
    const provider = new OllamaEmbeddingProvider();
    failNext = 6;
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) => provider.embed([`f-${i}`])),
    );
    expect(results.some((r) => r.status === "rejected")).toBe(true);
    await Promise.all(Array.from({ length: 12 }, (_, i) => provider.embed([`ok-${i}`])));
    expect(opened).toBeLessThanOrEqual(4);
  });

  /** Poll until the open-socket count satisfies `predicate`, or fail loudly. */
  async function waitForSockets(predicate: (n: number) => boolean): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (!predicate(openSockets.size)) {
      if (Date.now() > deadline) {
        throw new Error(`open sockets stayed at ${openSockets.size} past the deadline`);
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  it("drains the pool on resetOllamaClient", async () => {
    // Idle keep-alive sockets belong to the dispatcher; closing it must
    // release them rather than leaving them to a timeout.
    const provider = new OllamaEmbeddingProvider();
    await Promise.all(Array.from({ length: 8 }, (_, i) => provider.embed([`d-${i}`])));
    expect(openSockets.size).toBeGreaterThan(0);
    resetOllamaClient();
    await waitForSockets((n) => n === 0);
  });

  it("rebuilds the pool when the cap changes", async () => {
    // A config change must not leave the old dispatcher's sockets behind:
    // the client rebuild closes the previous pool before the new one opens.
    const provider = new OllamaEmbeddingProvider();
    await Promise.all(Array.from({ length: 8 }, (_, i) => provider.embed([`a-${i}`])));
    const firstPool = opened;
    expect(firstPool).toBeLessThanOrEqual(4);
    process.env.OLLAMA_MAX_CONNECTIONS = "2";
    resetEmbeddingConfig();
    await Promise.all(Array.from({ length: 8 }, (_, i) => provider.embed([`b-${i}`])));
    await waitForSockets((n) => n <= 2);
  });
});
