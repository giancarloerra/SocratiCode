// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SOCRATICODE_VERSION } from "../../src/constants.js";
import { ensureQdrantReady } from "../../src/services/docker.js";
import {
  GRAPH_INPUTS_VERSION,
  type GraphInputRecord,
  parseGraphInputRecord,
} from "../../src/services/graph-inputs.js";
import {
  requestedIndexProfile,
} from "../../src/services/index-profile.js";
import { ensureOllamaReady } from "../../src/services/ollama.js";
import {
  deleteCollection,
  deleteFileChunks,
  deleteGraphData,
  deleteProjectMetadata,
  ensureCollection,
  getCollectionInfo,
  getProjectMetadata,
  listCodebaseCollections,
  loadGraphInputs,
  loadProjectHashes,
  saveGraphData,
  saveProjectMetadata,
  searchChunks,
  upsertChunks,
} from "../../src/services/qdrant.js";
import type { FileChunk } from "../../src/types.js";
import { isDockerAvailable } from "../helpers/fixtures.js";
import {
  deleteTestCollection,
  waitForOllama,
  waitForQdrant,
} from "../helpers/setup.js";

const dockerAvailable = isDockerAvailable();
const TEST_COLLECTION = "codebase_test_qdrant_integration";

describe.skipIf(!dockerAvailable)("qdrant service", () => {
  beforeAll(async () => {
    await ensureQdrantReady();
    await ensureOllamaReady();
    await waitForQdrant();
    await waitForOllama();

    // Clean up from any previous test run
    await deleteTestCollection(TEST_COLLECTION);
  });

  afterAll(async () => {
    await deleteTestCollection(TEST_COLLECTION);
  });

  describe("collection management", () => {
    it("creates a collection with correct dimensions", async () => {
      await ensureCollection(TEST_COLLECTION);
      const info = await getCollectionInfo(TEST_COLLECTION);

      expect(info).toBeDefined();
      expect(info?.status).toBe("green");
      expect(info?.denseVectorSize).toBe(
        requestedIndexProfile("code").embedding.dimensions,
      );
    });

    it("is idempotent — creating an existing collection does not error", async () => {
      await expect(ensureCollection(TEST_COLLECTION)).resolves.not.toThrow();
    });

    it("lists collections including the test collection", async () => {
      const collections = await listCodebaseCollections();
      expect(collections).toContain(TEST_COLLECTION);
    });

    it("returns collection info", async () => {
      const info = await getCollectionInfo(TEST_COLLECTION);
      expect(info).toBeDefined();
      expect(info?.pointsCount).toBe(0); // no data yet
    });

    it("returns null info for non-existent collection", async () => {
      const info = await getCollectionInfo("nonexistent_collection_xyz");
      expect(info).toBeNull();
    });
  });

  describe("chunk upsert and search with real embeddings", () => {
    const chunks: FileChunk[] = [
      {
        id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        filePath: "/project/src/auth.ts",
        relativePath: "src/auth.ts",
        content:
          "export function authenticateUser(token: string): boolean {\n  // Validate JWT token and check permissions\n  const parts = token.split('.');\n  return parts.length === 3;\n}",
        startLine: 1,
        endLine: 5,
        language: "typescript",
        type: "code",
      },
      {
        id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        filePath: "/project/src/math.ts",
        relativePath: "src/math.ts",
        content:
          "export function fibonacci(n: number): number {\n  if (n <= 0) return 0;\n  if (n === 1) return 1;\n  let prev = 0, curr = 1;\n  for (let i = 2; i <= n; i++) {\n    [prev, curr] = [curr, prev + curr];\n  }\n  return curr;\n}",
        startLine: 1,
        endLine: 9,
        language: "typescript",
        type: "code",
      },
      {
        id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
        filePath: "/project/lib/data.py",
        relativePath: "lib/data.py",
        content:
          'def load_json_file(filepath: str) -> dict:\n    """Load and parse a JSON file from disk."""\n    with open(filepath, "r") as f:\n        return json.load(f)',
        startLine: 1,
        endLine: 4,
        language: "python",
        type: "code",
      },
    ];

    const _embeddings: number[][] = [];

    it("upserts chunks with real embeddings (generated internally)", async () => {
      await upsertChunks(
        TEST_COLLECTION,
        chunks,
        "test-content-hash",
        requestedIndexProfile("code"),
      );

      // Verify points were created
      const info = await getCollectionInfo(TEST_COLLECTION);
      expect(info).toBeDefined();
      expect(info?.pointsCount).toBe(3);
    });

    it("searches for authentication-related code", async () => {
      const results = await searchChunks(
        TEST_COLLECTION,
        "user authentication with JWT tokens",
        5,
      );

      expect(results.length).toBeGreaterThan(0);
      // The auth.ts chunk should rank highest for auth-related queries
      expect(results[0].relativePath).toBe("src/auth.ts");
      expect(results[0].score).toBeGreaterThan(0);
      expect(results[0].content).toContain("authenticateUser");
    });

    it("searches for mathematical algorithms", async () => {
      const results = await searchChunks(
        TEST_COLLECTION,
        "fibonacci sequence calculation algorithm",
        5,
      );

      expect(results.length).toBeGreaterThan(0);
      // The math.ts chunk should rank highest for math queries
      expect(results[0].relativePath).toBe("src/math.ts");
      expect(results[0].content).toContain("fibonacci");
    });

    it("searches for data loading utilities", async () => {
      const results = await searchChunks(
        TEST_COLLECTION,
        "load and parse JSON data from file",
        5,
      );

      expect(results.length).toBeGreaterThan(0);
      // The data.py chunk should rank highest
      expect(results[0].relativePath).toBe("lib/data.py");
    });

    it("supports limit parameter", async () => {
      const results = await searchChunks(TEST_COLLECTION, "code", 2);
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it("supports file filter", async () => {
      const results = await searchChunks(
        TEST_COLLECTION,
        "function",
        10,
        "auth",
      );

      // Only auth.ts should match the file filter
      for (const r of results) {
        expect(r.relativePath).toContain("auth");
      }
    });

    it("supports language filter", async () => {
      const results = await searchChunks(
        TEST_COLLECTION,
        "function",
        10,
        undefined,
        "python",
      );

      for (const r of results) {
        expect(r.language).toBe("python");
      }
    });

    it("returns empty results for unrelated queries in filtered search", async () => {
      const results = await searchChunks(
        TEST_COLLECTION,
        "authentication",
        10,
        undefined,
        "python",
      );

      // Should return python results (only data.py), even though
      // the query is more related to auth.ts
      for (const r of results) {
        expect(r.language).toBe("python");
      }
    });
  });

  describe("delete file chunks", () => {
    it("deletes chunks for a specific file", async () => {
      await deleteFileChunks(TEST_COLLECTION, "lib/data.py");

      const info = await getCollectionInfo(TEST_COLLECTION);
      expect(info?.pointsCount).toBe(2); // 2 remaining
    });
  });

  describe("metadata collection", () => {
    const metadataCollection = TEST_COLLECTION; // reuse the test collection for metadata
    const projectPath = "/test/project/path";

    it("saves project metadata", async () => {
      const fileHashes = new Map<string, string>([
        ["src/auth.ts", "hash-auth"],
        ["src/math.ts", "hash-math"],
      ]);

      await saveProjectMetadata(
        metadataCollection,
        projectPath,
        42,
        2,
        fileHashes,
        "completed",
        requestedIndexProfile("code"),
      );

      const metadata = await getProjectMetadata(metadataCollection);
      expect(metadata).toBeDefined();
      expect(metadata?.projectPath).toBe(projectPath);
      expect(metadata?.filesTotal).toBe(42);
      expect(metadata?.filesIndexed).toBe(2);
      expect(metadata?.effectiveProfile).toEqual(requestedIndexProfile("code"));
    });

    it("loads project hashes", async () => {
      const hashes = await loadProjectHashes(metadataCollection);
      // Initially might be empty or contain entries based on implementation
      expect(hashes).toBeDefined();
      expect(typeof hashes).toBe("object");
    });

    it("can delete project metadata", async () => {
      await deleteProjectMetadata(metadataCollection);
      // After deletion, metadata should be gone
      const metadata = await getProjectMetadata(metadataCollection);
      expect(metadata).toBeNull();
    });
  });

  describe("graph input record", () => {
    // The record shares a point with the serialized graph and is read back
    // through a payload projection, which is Qdrant behaviour rather than
    // ours — so the round-trip is pinned against a real one. (That the read is
    // projected is not observable from here; it is a cost, not a contract.)
    const graphCollection = "codebase_test_graph_inputs";
    const record: GraphInputRecord = {
      version: GRAPH_INPUTS_VERSION,
      builtByVersion: SOCRATICODE_VERSION,
      capabilities: "aabbccddeeff0011",
      files: { "src/auth.ts": "0123456789abcdef", "go.mod": "fedcba9876543210" },
      heads: { NOTES: "aabbccddeeff0011" },
      presence: { "src/huge.ts": 1_234_567 },
      unreadable: ["vendor/locked.json"],
      unreadableDirectories: ["vendor/private"],
      directories: {
        ".": { all: "1122334455667788", kept: "2233445566778899" },
        src: { all: "8877665544332211", kept: "7766554433221100" },
      },
      settings: "00112233445566ff",
    };

    afterAll(async () => {
      await deleteGraphData(graphCollection);
    });

    it("round-trips the record stored beside the graph", async () => {
      await saveGraphData(graphCollection, "/test/project/path", { nodes: [], edges: [] }, record);

      const stored = await loadGraphInputs(graphCollection);

      // Projected out of a payload that also holds the whole graph, and read
      // back through the string form it is persisted as.
      expect(stored.status).toBe("stored");
      const value = stored.status === "stored" ? stored.value : null;
      expect(typeof value).toBe("string");
      expect(parseGraphInputRecord(value)).toEqual(record);
    });

    it("reports an absent point apart from a record it could not parse", async () => {
      // The distinction the rebuild gate turns on: no graph at all is the one
      // case an update that indexed nothing must not act on, while a graph
      // with no usable record has to rebuild once and populate.
      await expect(loadGraphInputs("codebase_test_graph_inputs_absent")).resolves.toEqual({
        status: "absent",
      });
    });

  });

  describe("collection deletion", () => {
    it("deletes the test collection", async () => {
      await deleteCollection(TEST_COLLECTION);

      const info = await getCollectionInfo(TEST_COLLECTION);
      expect(info).toBeNull();
    });

    it("does not error when deleting non-existent collection", async () => {
      await expect(
        deleteCollection("nonexistent_collection_xyz_test"),
      ).resolves.not.toThrow();
    });
  });
});
