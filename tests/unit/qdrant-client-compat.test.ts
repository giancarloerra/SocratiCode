// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createQdrantFetchBridge,
  nativeFetchSupportsUndiciDispatcher,
  qdrantFetchMode,
  readInstalledQdrantClientVersion,
} from "../../src/services/qdrant-client-compat.js";

/**
 * Node 26 must pair Qdrant client 1.18's dispatcher with fetch from the same
 * undici line, while every unaffected runtime and request keeps the native
 * transport. The packaged-runtime CI job proves this decision against a real
 * Qdrant from a clean consumer installation.
 */
describe("qdrant-client-compat", () => {
  describe("readInstalledQdrantClientVersion", () => {
    it("reads the version of the actually installed client", () => {
      // The package's exports map exposes only ".", so the reader resolves
      // the entry and walks up; the result must equal what node_modules
      // really contains, not a guess.
      const expected = JSON.parse(
        fs.readFileSync(
          path.join(process.cwd(), "node_modules/@qdrant/js-client-rest/package.json"),
          "utf8",
        ),
      ).version;

      expect(readInstalledQdrantClientVersion()).toBe(expected);
    });
  });

  describe("qdrantFetchMode", () => {
    it("keeps native fetch below Node 26, whatever the client", () => {
      for (const version of ["1.18.0", "1.19.0", null]) {
        for (const major of [18, 20, 22, 24, 25]) {
          expect(qdrantFetchMode(major, version), `${major}/${version}`).toBe("native");
        }
      }
    });

    it("pairs fetch on Node 26+ with a pre-1.19 client", () => {
      expect(qdrantFetchMode(26, "1.18.0")).toBe("paired-undici");
      expect(qdrantFetchMode(26, "1.17.0")).toBe("paired-undici");
      expect(qdrantFetchMode(27, "1.18.5")).toBe("paired-undici");
    });

    it("keeps native fetch on Node 26+ with 1.19 or newer", () => {
      expect(qdrantFetchMode(26, "1.19.0")).toBe("native");
      expect(qdrantFetchMode(26, "1.20.3")).toBe("native");
      expect(qdrantFetchMode(27, "2.0.0")).toBe("native");
    });

    it("fails closed when the Node 26+ client version is unknown or unparseable", () => {
      expect(qdrantFetchMode(26, null)).toBe("unknown");
      expect(qdrantFetchMode(26, "not-a-version")).toBe("unknown");
      // A half-valid string must not be half-read as its leading 1.19,
      // whether the garbage starts at the patch or trails after it.
      expect(qdrantFetchMode(26, "1.19.not-a-version")).toBe("unknown");
      expect(qdrantFetchMode(26, "1.19.0garbage")).toBe("unknown");
    });

    it("reads prerelease and build-metadata versions normally", () => {
      // The strict shape must not reject the tagged versions the registry
      // legitimately serves.
      expect(qdrantFetchMode(26, "1.19.0-rc.1")).toBe("native");
      expect(qdrantFetchMode(26, "1.18.2+build.5")).toBe("paired-undici");
      expect(qdrantFetchMode(26, "1.18.0-1a")).toBe("paired-undici");
    });

    it("fails closed for malformed prerelease and build metadata", () => {
      for (const version of [
        "1.19.0-",
        "1.19.0+",
        "1.19.0-01",
        "1.19.0-alpha..1",
        "1.19.0+meta.",
      ]) {
        expect(qdrantFetchMode(26, version), version).toBe("unknown");
      }
    });

    it("keeps native fetch for a non-finite Node major", () => {
      expect(qdrantFetchMode(Number.NaN, "1.18.0")).toBe("native");
    });
  });

  describe("nativeFetchSupportsUndiciDispatcher", () => {
    it("reports a handler without onError as unsupported", () => {
      // Mirrors the real failure: Node's built-in fetch hands undici 6's
      // dispatcher a handler that has no onError, so undici's own recovery
      // path throws `invalid onError method`.
      const nativeFetch = vi.fn(async (_input: unknown, init: unknown) => {
        const { dispatcher } = init as { dispatcher: { dispatch: (o: unknown, h: unknown) => boolean } };
        dispatcher.dispatch({}, {});
        return new Response("ok");
      }) as unknown as typeof globalThis.fetch;

      expect(nativeFetchSupportsUndiciDispatcher(nativeFetch)).toBe(false);
    });

    it("reports a handler exposing onError as supported", () => {
      const nativeFetch = vi.fn(async (_input: unknown, init: unknown) => {
        const { dispatcher } = init as { dispatcher: { dispatch: (o: unknown, h: unknown) => boolean } };
        dispatcher.dispatch({}, { onError: () => undefined });
        return new Response("ok");
      }) as unknown as typeof globalThis.fetch;

      expect(nativeFetchSupportsUndiciDispatcher(nativeFetch)).toBe(true);
    });

    it("treats a fetch that throws synchronously as unsupported", () => {
      const nativeFetch = (() => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof globalThis.fetch;

      expect(nativeFetchSupportsUndiciDispatcher(nativeFetch)).toBe(false);
    });

    it("treats a fetch that never reaches the dispatcher as unsupported", () => {
      // No handler shape was ever observed, so the pair cannot be trusted.
      const nativeFetch = vi.fn(async () => new Response("ok")) as unknown as typeof globalThis.fetch;

      expect(nativeFetchSupportsUndiciDispatcher(nativeFetch)).toBe(false);
    });
  });

  describe("createQdrantFetchBridge", () => {
    const response = new Response(JSON.stringify({ result: true }));
    const dispatcher = {};

    it("uses paired fetch only for a Qdrant request carrying a dispatcher", async () => {
      const nativeFetch = vi.fn(async () => response);
      const pairedFetch = vi.fn(async () => response);
      const bridge = createQdrantFetchBridge(
        nativeFetch,
        pairedFetch,
        new Set(["http://qdrant.test:6333"]),
      );
      const init = { dispatcher } as RequestInit;

      await bridge("http://qdrant.test:6333/collections", init);

      expect(pairedFetch).toHaveBeenCalledWith("http://qdrant.test:6333/collections", init);
      expect(nativeFetch).not.toHaveBeenCalled();
    });

    it("keeps native fetch for unrelated origins and dispatcher-free requests", async () => {
      const nativeFetch = vi.fn(async () => response);
      const pairedFetch = vi.fn(async () => response);
      const bridge = createQdrantFetchBridge(
        nativeFetch,
        pairedFetch,
        new Set(["http://qdrant.test:6333"]),
      );
      const init = { dispatcher } as RequestInit;

      await bridge("https://example.com/collections", init);
      await bridge("http://qdrant.test:6333/healthz");

      expect(nativeFetch).toHaveBeenCalledTimes(2);
      expect(pairedFetch).not.toHaveBeenCalled();
    });

    it("propagates the paired transport error without falling back", async () => {
      const failure = new Error("transport failed");
      const nativeFetch = vi.fn(async () => response);
      const pairedFetch = vi.fn(async () => {
        throw failure;
      });
      const bridge = createQdrantFetchBridge(
        nativeFetch,
        pairedFetch,
        new Set(["http://qdrant.test:6333"]),
      );

      await expect(
        bridge("http://qdrant.test:6333/collections", { dispatcher } as RequestInit),
      ).rejects.toBe(failure);
      expect(nativeFetch).not.toHaveBeenCalled();
    });
  });
});
