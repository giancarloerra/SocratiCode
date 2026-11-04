// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────

// Track subscriptions created by @parcel/watcher mock
let mockSubscribeCallback: ((err: Error | null, events: Array<{ path: string; type: string }>) => void) | null = null;
const mockUnsubscribe = vi.fn(async () => {});

vi.mock("@parcel/watcher", () => ({
  default: {
    subscribe: vi.fn(async (_dir: string, cb: (err: Error | null, events: Array<{ path: string; type: string }>) => void, _opts?: unknown) => {
      mockSubscribeCallback = cb;
      return { unsubscribe: mockUnsubscribe };
    }),
  },
}));

vi.mock("../../src/services/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../src/services/ignore.js", async (importOriginal) => ({
  // The marker test is the real one: it is what the watcher relies on to see
  // an environment appear or vanish, and a stub would prove nothing about it.
  ...(await importOriginal<typeof import("../../src/services/ignore.js")>()),
  createIgnoreFilter: vi.fn(() => ({ ignores: () => false, isEnvironmentRoot: () => false })),
  shouldIgnore: vi.fn(() => false),
}));

const mockUpdateProjectIndex = vi.fn(async (_path: string, _progress?: unknown) => ({ added: 0, updated: 0, removed: 0, chunksCreated: 0, cancelled: false }));
const mockIsIndexingInProgress = vi.fn((_path: string) => false);
vi.mock("../../src/services/indexer.js", () => ({
  FILE_SCAN_BATCH: 50,
  updateProjectIndex: (...args: unknown[]) => mockUpdateProjectIndex(...(args as [string, unknown])),
  isIndexingInProgress: (...args: unknown[]) => mockIsIndexingInProgress(...(args as [string])),
}));

vi.mock("../../src/services/code-graph.js", () => ({
  invalidateGraphCache: vi.fn(),
}));

const mockProjectIdFromPath = vi.fn((_p: string) => "test-project-id");
const mockCollectionName = vi.fn((_id: string) => "codebase_test");
vi.mock("../../src/config.js", () => ({
  projectIdFromPath: (...args: unknown[]) => mockProjectIdFromPath(...(args as [string])),
  collectionName: (...args: unknown[]) => mockCollectionName(...(args as [string])),
}));

const mockGetCollectionInfo = vi.fn(async (_c: string): Promise<{ pointsCount: number } | null> => null);
const mockGetProjectMetadata = vi.fn(async (_c: string): Promise<Record<string, unknown> | null> => null);
const mockLoadProjectEffectiveProfile = vi.fn(async (_c: string) => null);
vi.mock("../../src/services/qdrant.js", () => ({
  getCollectionInfo: (...args: unknown[]) => mockGetCollectionInfo(...(args as [string])),
  getProjectMetadata: (...args: unknown[]) => mockGetProjectMetadata(...(args as [string])),
  loadProjectEffectiveProfile: (...args: unknown[]) =>
    mockLoadProjectEffectiveProfile(...(args as [string])),
}));

const mockAcquireProjectLock = vi.fn(async (_path: string, _type: string) => true);
const mockReleaseProjectLock = vi.fn(async (_path: string, _type: string) => {});
const mockIsProjectLocked = vi.fn(async (_path: string, _type: string) => false);
vi.mock("../../src/services/lock.js", () => ({
  holdsProjectLock: vi.fn(() => false),
  // The reclamation barrier every writer checks reads this; nothing is being reclaimed here.
  isProjectIdentityLocked: vi.fn(async () => false),
  acquireIdentityLock: vi.fn(async () => true),
  releaseIdentityLock: vi.fn(async () => {}),
  holdsIdentityLock: vi.fn(() => false),
  acquireProjectLock: (...args: unknown[]) => mockAcquireProjectLock(...(args as [string, string])),
  releaseProjectLock: (...args: unknown[]) => mockReleaseProjectLock(...(args as [string, string])),
  isProjectLocked: (...args: unknown[]) => mockIsProjectLocked(...(args as [string, string])),
}));

import { DETECT_HEAD_BYTES } from "../../src/constants.js";
import { createIgnoreFilter, shouldIgnore } from "../../src/services/ignore.js";
import { logger } from "../../src/services/logger.js";
// Import after mocks
import {
  clearExternalWatchCache,
  ensureWatcherStarted,
  getWatchedProjects,
  isIndexableFile,
  isWatchedByAnyProcess,
  isWatching,
  startWatching,
  startWatchingAutomatically,
  stopAllWatchers,
  stopWatching,
} from "../../src/services/watcher.js";

// ── Helpers ──────────────────────────────────────────────────────────────

const TEST_PROJECT = "/tmp/test-project";
const RESOLVED_PROJECT = path.resolve(TEST_PROJECT);

// ── Tests ────────────────────────────────────────────────────────────────

describe("watcher (unit)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SOCRATICODE_WATCHER;
    mockSubscribeCallback = null;
    mockAcquireProjectLock.mockResolvedValue(true);
    mockIsProjectLocked.mockResolvedValue(false);
    mockIsIndexingInProgress.mockReturnValue(false);
    mockGetCollectionInfo.mockResolvedValue(null);
    mockGetProjectMetadata.mockResolvedValue(null);
    mockLoadProjectEffectiveProfile.mockResolvedValue(null);
  });

  afterEach(async () => {
    // Clean up any active watchers between tests
    await stopAllWatchers();
    clearExternalWatchCache();
    delete process.env.SOCRATICODE_WATCHER;
  });

  // ── startWatching / stopWatching / isWatching / getWatchedProjects ───

  describe("startWatching", () => {
    it.each(["off", "git"])("refuses to start before acquiring a lock when watcher mode is %s", async (mode) => {
      process.env.SOCRATICODE_WATCHER = mode;
      const progress: string[] = [];

      const result = await startWatching(TEST_PROJECT, (msg) => progress.push(msg));

      expect(result).toBe(false);
      expect(progress).toContain(`File watcher disabled by SOCRATICODE_WATCHER=${mode}`);
      expect(mockAcquireProjectLock).not.toHaveBeenCalled();
      const watcher = await import("@parcel/watcher");
      expect(watcher.default.subscribe).not.toHaveBeenCalled();
    });

    it("still permits an explicit start in manual mode", async () => {
      process.env.SOCRATICODE_WATCHER = "manual";

      await expect(startWatching(TEST_PROJECT)).resolves.toBe(true);

      expect(isWatching(TEST_PROJECT)).toBe(true);
    });

    it("starts watching and reports via onProgress", async () => {
      const progress: string[] = [];
      const result = await startWatching(TEST_PROJECT, (msg) => progress.push(msg));

      expect(result).toBe(true);
      expect(isWatching(TEST_PROJECT)).toBe(true);
      expect(progress).toContain(`Started watching ${RESOLVED_PROJECT}`);
      expect(logger.info).toHaveBeenCalledWith("File watcher started", { projectPath: RESOLVED_PROJECT });
    });

    it("acquires a cross-process lock", async () => {
      await startWatching(TEST_PROJECT);
      expect(mockAcquireProjectLock).toHaveBeenCalledWith(RESOLVED_PROJECT, "watch", undefined, { reentrant: false });
    });

    it("skips if already watching (idempotent)", async () => {
      const progress: string[] = [];
      await startWatching(TEST_PROJECT);
      const result = await startWatching(TEST_PROJECT, (msg) => progress.push(msg));

      expect(result).toBe(true);
      expect(progress).toContain(`Already watching ${RESOLVED_PROJECT}`);
      // subscribe should only be called once
      const watcher = await import("@parcel/watcher");
      expect(watcher.default.subscribe).toHaveBeenCalledTimes(1);
    });

    it("skips if lock cannot be acquired (another process watching)", async () => {
      mockAcquireProjectLock.mockResolvedValue(false);
      const progress: string[] = [];
      const result = await startWatching(TEST_PROJECT, (msg) => progress.push(msg));

      expect(result).toBe(false);
      expect(isWatching(TEST_PROJECT)).toBe(false);
      expect(progress.some((m) => m.includes("Another process"))).toBe(true);
    });

    it("releases lock if @parcel/watcher.subscribe fails", async () => {
      const watcher = await import("@parcel/watcher");
      vi.mocked(watcher.default.subscribe).mockRejectedValueOnce(new Error("Permission denied"));

      const progress: string[] = [];
      const result = await startWatching(TEST_PROJECT, (msg) => progress.push(msg));

      expect(result).toBe(false);
      expect(isWatching(TEST_PROJECT)).toBe(false);
      expect(mockReleaseProjectLock).toHaveBeenCalledWith(RESOLVED_PROJECT, "watch");
      expect(progress.some((m) => m.includes("Failed to start watching"))).toBe(true);
    });

    it("subscribes without Qdrant and retries the effective profile on a later event", async () => {
      vi.useFakeTimers();
      mockGetCollectionInfo.mockRejectedValueOnce(new Error("Qdrant unavailable"));

      const result = await startWatching(TEST_PROJECT);

      expect(result).toBe(true);
      expect(isWatching(TEST_PROJECT)).toBe(true);
      expect(mockGetCollectionInfo).not.toHaveBeenCalled();

      await mockSubscribeCallback?.(null, [
        { path: path.join(RESOLVED_PROJECT, "file.ts"), type: "update" },
      ]);
      expect(logger.warn).toHaveBeenCalledWith(
        "Watch profile load failed; scheduling profile-aware update",
        expect.objectContaining({ error: "Qdrant unavailable" }),
      );
      await vi.advanceTimersByTimeAsync(2100);
      expect(mockUpdateProjectIndex).toHaveBeenCalledWith(RESOLVED_PROJECT, undefined);
      mockUpdateProjectIndex.mockClear();

      mockGetCollectionInfo.mockResolvedValue({ pointsCount: 1 });
      await mockSubscribeCallback?.(null, [
        { path: path.join(RESOLVED_PROJECT, "file.ts"), type: "update" },
      ]);
      await vi.advanceTimersByTimeAsync(2100);

      expect(mockGetCollectionInfo).toHaveBeenCalledTimes(2);
      expect(mockUpdateProjectIndex).toHaveBeenCalledWith(RESOLVED_PROJECT, undefined);
      vi.useRealTimers();
    });

    it("uses the stored profile extension map when filtering watcher events", async () => {
      vi.useFakeTimers();
      mockGetCollectionInfo.mockResolvedValue({ pointsCount: 1 });
      mockLoadProjectEffectiveProfile.mockResolvedValue({
        schemaVersion: 1,
        indexFormatVersion: 1,
        kind: "code",
        source: "fresh",
        queryPrefix: "query: ",
        documentPrefix: "document: ",
        documentIncludesPath: true,
        maxChunkChars: 2000,
        embedding: {
          provider: "openai",
          model: "test-model",
          dimensions: 3,
          contextLength: 512,
          litellmSendDimensions: false,
        },
        extensionLanguageMap: { ".profilefixture": ".ts" },
        maxFileBytes: 5_000_000,
        legacyUnverifiedFields: [],
      });
      await startWatching(TEST_PROJECT);

      await mockSubscribeCallback?.(null, [
        {
          path: path.join(RESOLVED_PROJECT, "file.profilefixture"),
          type: "update",
        },
      ]);
      await vi.advanceTimersByTimeAsync(2100);

      expect(mockUpdateProjectIndex).toHaveBeenCalledWith(RESOLVED_PROJECT, undefined);
      vi.useRealTimers();
    });

    it("ignores stale profile metadata after the collection was removed", async () => {
      vi.useFakeTimers();
      mockGetCollectionInfo.mockResolvedValue(null);
      mockLoadProjectEffectiveProfile.mockResolvedValue({
        schemaVersion: 1,
        indexFormatVersion: 0,
        kind: "code",
        source: "legacy-adopted",
        queryPrefix: "search_query: ",
        documentPrefix: "search_document: ",
        documentIncludesPath: true,
        maxChunkChars: 2000,
        embedding: {
          provider: "ollama",
          model: "nomic-embed-text",
          dimensions: 768,
          contextLength: 2048,
          litellmSendDimensions: false,
        },
        extensionLanguageMap: { ".staleprofile": ".ts" },
        maxFileBytes: 5_000_000,
        legacyUnverifiedFields: ["extensionLanguageMap"],
      });
      await startWatching(TEST_PROJECT);

      await mockSubscribeCallback?.(null, [
        {
          path: path.join(RESOLVED_PROJECT, "file.staleprofile"),
          type: "update",
        },
      ]);
      await vi.advanceTimersByTimeAsync(2100);

      expect(mockLoadProjectEffectiveProfile).not.toHaveBeenCalled();
      expect(mockUpdateProjectIndex).not.toHaveBeenCalled();
      vi.useRealTimers();
    });
  });

  describe("stopWatching", () => {
    it("stops an active watcher and releases lock", async () => {
      await startWatching(TEST_PROJECT);
      expect(isWatching(TEST_PROJECT)).toBe(true);

      await stopWatching(TEST_PROJECT);
      expect(isWatching(TEST_PROJECT)).toBe(false);
      expect(mockUnsubscribe).toHaveBeenCalled();
      expect(mockReleaseProjectLock).toHaveBeenCalledWith(RESOLVED_PROJECT, "watch");
    });

    it("does nothing for a non-watched project", async () => {
      await expect(stopWatching("/nonexistent")).resolves.not.toThrow();
      expect(mockUnsubscribe).not.toHaveBeenCalled();
    });

    it("does not start a queued update while native unsubscribe is pending", async () => {
      vi.useFakeTimers();
      let releaseUnsubscribe: () => void = () => {};
      const unsubscribePending = new Promise<void>((resolve) => {
        releaseUnsubscribe = resolve;
      });
      mockUnsubscribe.mockReturnValueOnce(unsubscribePending);

      try {
        await startWatching(TEST_PROJECT);
        mockSubscribeCallback?.(null, [
          { path: path.join(RESOLVED_PROJECT, "src/app.ts"), type: "update" },
        ]);
        await vi.advanceTimersByTimeAsync(0);

        const stopping = stopWatching(TEST_PROJECT);
        await vi.advanceTimersByTimeAsync(2100);
        expect(mockUpdateProjectIndex).not.toHaveBeenCalled();

        releaseUnsubscribe();
        await stopping;
      } finally {
        releaseUnsubscribe();
        vi.useRealTimers();
      }
    });
  });

  describe("stopAllWatchers", () => {
    it("stops all active watchers", async () => {
      await startWatching(TEST_PROJECT);
      expect(getWatchedProjects().length).toBe(1);

      await stopAllWatchers();
      expect(getWatchedProjects()).toHaveLength(0);
    });
  });

  describe("isWatching", () => {
    it("returns false when not watching", () => {
      expect(isWatching(TEST_PROJECT)).toBe(false);
    });

    it("returns true when watching", async () => {
      await startWatching(TEST_PROJECT);
      expect(isWatching(TEST_PROJECT)).toBe(true);
    });

    it("resolves relative paths", async () => {
      await startWatching(TEST_PROJECT);
      // Should match regardless of trailing slashes etc via path.resolve
      expect(isWatching(TEST_PROJECT)).toBe(true);
    });
  });

  describe("getWatchedProjects", () => {
    it("returns empty array when nothing is watched", () => {
      expect(getWatchedProjects()).toEqual([]);
    });

    it("returns resolved paths of watched projects", async () => {
      await startWatching(TEST_PROJECT);
      const projects = getWatchedProjects();
      expect(projects).toHaveLength(1);
      expect(projects[0]).toBe(RESOLVED_PROJECT);
    });
  });

  // ── isWatchedByAnyProcess (cross-process awareness) ────────────────

  describe("isWatchedByAnyProcess", () => {
    it("returns true when watching locally", async () => {
      await startWatching(TEST_PROJECT);
      expect(await isWatchedByAnyProcess(TEST_PROJECT)).toBe(true);
    });

    it("returns true when another process holds the watch lock", async () => {
      mockIsProjectLocked.mockResolvedValue(true);
      expect(await isWatchedByAnyProcess(TEST_PROJECT)).toBe(true);
      expect(mockIsProjectLocked).toHaveBeenCalledWith(RESOLVED_PROJECT, "watch");
    });

    it("returns false when not watched locally and no lock held", async () => {
      mockIsProjectLocked.mockResolvedValue(false);
      expect(await isWatchedByAnyProcess(TEST_PROJECT)).toBe(false);
    });

    it("skips lock check when watching locally (fast path)", async () => {
      await startWatching(TEST_PROJECT);
      mockIsProjectLocked.mockClear();
      expect(await isWatchedByAnyProcess(TEST_PROJECT)).toBe(true);
      expect(mockIsProjectLocked).not.toHaveBeenCalled();
    });
  });

  // ── Event filtering (via the callback) ─────────────────────────────────

  describe("event filtering", () => {
    it("triggers update for indexable file changes", async () => {
      vi.useFakeTimers();
      const progress = vi.fn();
      await startWatching(TEST_PROJECT, progress);

      // Simulate a file change event
      mockSubscribeCallback?.(null, [
        { path: path.join(RESOLVED_PROJECT, "src/app.ts"), type: "update" },
      ]);

      // Fast-forward past the debounce
      await vi.advanceTimersByTimeAsync(2100);

      expect(mockUpdateProjectIndex).toHaveBeenCalledWith(RESOLVED_PROJECT, progress);
      vi.useRealTimers();
    });

    it("ignores non-indexable files (e.g. .png, .lock)", async () => {
      vi.useFakeTimers();
      await startWatching(TEST_PROJECT);

      mockSubscribeCallback?.(null, [
        { path: path.join(RESOLVED_PROJECT, "image.png"), type: "create" },
        { path: path.join(RESOLVED_PROJECT, "package-lock.json"), type: "update" },
      ]);

      // .png is not in SUPPORTED_EXTENSIONS and not in SPECIAL_FILES
      // .json IS supported, so this actually triggers — but .png is filtered

      await vi.advanceTimersByTimeAsync(2100);

      // package-lock.json has .json extension which IS in SUPPORTED_EXTENSIONS,
      // so the update should still trigger for that event
      expect(mockUpdateProjectIndex).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });

    it("ignores files that match gitignore rules", async () => {
      vi.useFakeTimers();
      vi.mocked(shouldIgnore).mockReturnValue(true);

      await startWatching(TEST_PROJECT);

      mockSubscribeCallback?.(null, [
        { path: path.join(RESOLVED_PROJECT, "dist/bundle.js"), type: "create" },
      ]);

      await vi.advanceTimersByTimeAsync(2100);

      // All events were filtered by shouldIgnore, so no update
      expect(mockUpdateProjectIndex).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    // ── Environments appearing and vanishing under the watcher ──────────
    //
    // Review finding: the filter was built once, at start, and the tree
    // changes under a watcher. These run on a real directory, because the
    // gate lets an event through only where the filter and the disk disagree
    // — a stubbed path would prove nothing about that. `backend/env` rather
    // than a root `env/`, since the native watcher never reports the latter
    // (it is skipped at the top level, as `/env` is by the defaults).
    describe("environments", () => {
      let root: string;
      const filterOf = (excluded: (relative: string) => boolean, roots: string[] = []) => ({
        ignores: excluded,
        isEnvironmentRoot: (relative: string) => roots.includes(relative.split(path.sep).join("/").replace(/\/$/, "")),
      });
      const underEnv = (relative: string) =>
        relative === "backend/env" || relative.startsWith("backend/env/");
      const marker = () => path.join(root, "backend", "env", "pyvenv.cfg");

      beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "socraticode-watch-env-"));
        vi.mocked(shouldIgnore).mockImplementation((ig, relative) => ig.ignores(relative.split(path.sep).join("/")));
      });

      afterEach(async () => {
        await stopAllWatchers();
        vi.mocked(shouldIgnore).mockReturnValue(false);
        vi.mocked(createIgnoreFilter).mockReset().mockImplementation(() => filterOf(() => false));
        fs.rmSync(root, { recursive: true, force: true });
      });

      // Fake timers live inside this call alone: the debounce is created and
      // fired here, and nothing else in these tests needs a clock. Installed
      // in `beforeEach` and restored in `afterEach`, they left vitest's own
      // hook clock counting on the fake one, and on Node 18 every hook of the
      // block was reported as timed out after it had already returned (CI
      // finding); the rest of this file switches them inside the test body
      // for the same reason.
      const updatesAfter = async (events: Array<{ path: string; type: "create" | "update" | "delete" }>) => {
        vi.useFakeTimers();
        try {
          mockSubscribeCallback?.(null, events);
          await vi.advanceTimersByTimeAsync(2100);
        } finally {
          vi.useRealTimers();
        }
        return mockUpdateProjectIndex.mock.calls.length;
      };

      it("schedules a reconcile when a marker appears, though nothing about it is indexable", async () => {
        // A `pyvenv.cfg` is not a source file, so an event on it used to fail
        // the indexability check and schedule nothing, leaving the
        // environment's installed libraries in the index until some unrelated
        // change came along.
        vi.mocked(createIgnoreFilter).mockReturnValue(filterOf(() => false));
        await startWatching(root);

        fs.mkdirSync(path.dirname(marker()), { recursive: true });
        fs.writeFileSync(marker(), "home = /usr\n");
        expect(await updatesAfter([{ path: marker(), type: "create" }])).toBe(1);

        // Conda's marker is a directory, and its creation arrives as the
        // files inside it.
        const history = path.join(root, "tools", "env", "conda-meta", "history");
        fs.mkdirSync(path.dirname(history), { recursive: true });
        fs.writeFileSync(history, "");
        expect(await updatesAfter([{ path: history, type: "create" }])).toBe(2);
      });

      it("schedules a reconcile when a marker is deleted from a directory the filter excludes", async () => {
        // Once the environment exists its directory is excluded, so the
        // marker's deletion used to be dropped by the filter before anything
        // looked at it — and the source files written in its place stayed
        // hidden.
        vi.mocked(createIgnoreFilter).mockReturnValue(filterOf(underEnv, ["backend/env"]));
        await startWatching(root);

        expect(await updatesAfter([{ path: marker(), type: "delete" }])).toBe(1);
      });

      it("rebuilds its filter after each update, in both directions", async () => {
        const nothing = filterOf(() => false);
        const envExcluded = filterOf(underEnv, ["backend/env"]);
        vi.mocked(createIgnoreFilter)
          .mockReturnValueOnce(nothing)       // at start: no environment yet
          .mockReturnValueOnce(envExcluded)   // after the update that saw it appear
          .mockReturnValueOnce(nothing);      // after the update that saw it go
        await startWatching(root);
        expect(createIgnoreFilter).toHaveBeenCalledTimes(1);

        // The environment appears: its marker schedules the update, and the
        // filter rebuilt after it excludes the directory.
        fs.mkdirSync(path.dirname(marker()), { recursive: true });
        fs.writeFileSync(marker(), "home = /usr\n");
        expect(await updatesAfter([{ path: marker(), type: "create" }])).toBe(1);
        expect(createIgnoreFilter).toHaveBeenCalledTimes(2);

        // A library installed into it no longer schedules anything.
        const dep = path.join(root, "backend", "env", "lib", "dep.py");
        fs.mkdirSync(path.dirname(dep), { recursive: true });
        fs.writeFileSync(dep, "");
        expect(await updatesAfter([{ path: dep, type: "create" }])).toBe(1);

        // The environment goes: the marker's deletion is seen through the
        // exclusion, the update runs, and the filter rebuilt after it lets
        // the source files written in its place through again.
        fs.rmSync(marker());
        expect(await updatesAfter([{ path: marker(), type: "delete" }])).toBe(2);
        expect(createIgnoreFilter).toHaveBeenCalledTimes(3);

        const source = path.join(root, "backend", "env", "main.py");
        fs.writeFileSync(source, "");
        expect(await updatesAfter([{ path: source, type: "create" }])).toBe(3);
      });

      it("sees an environment moved away, which arrives as one event on its directory", async () => {
        // Review finding. `mv env env.old` is reported by FSEvents and inotify
        // as `delete env` and nothing on the marker inside it; the directory
        // is not a marker and the filter excludes it, so the event was
        // dropped and the filter stayed stale.
        vi.mocked(createIgnoreFilter).mockReturnValue(filterOf(underEnv, ["backend/env"]));
        await startWatching(root);

        expect(await updatesAfter([{ path: path.join(root, "backend", "env"), type: "delete" }])).toBe(1);
      });

      it("sees an environment moved into place, which arrives as one event on a directory it never heard of", async () => {
        // The other half of a rename: one `create` on the directory, and the
        // marker inside it produces nothing. The directory is asked for its
        // marker on disk.
        vi.mocked(createIgnoreFilter).mockReturnValue(filterOf(() => false));
        await startWatching(root);

        fs.mkdirSync(path.dirname(marker()), { recursive: true });
        fs.writeFileSync(marker(), "home = /usr\n");
        expect(await updatesAfter([{ path: path.join(root, "backend", "env"), type: "create" }])).toBe(1);

        // A plain directory moved into place is not one.
        const plain = path.join(root, "backend", "lib");
        fs.mkdirSync(plain, { recursive: true });
        expect(await updatesAfter([{ path: plain, type: "create" }])).toBe(1);
      });

      it("sees a dot-named environment moved into place", async () => {
        // Review finding. `backend/venv.3.12` moved in is one `create` on the
        // directory; a first cut read the dot as a file extension and skipped
        // the stat, so the event was dropped and the environment's files
        // stayed indexed until something unrelated changed. Every created
        // path is asked whether it is a directory first.
        vi.mocked(createIgnoreFilter).mockReturnValue(filterOf(() => false));
        await startWatching(root);

        const dotted = path.join(root, "backend", "venv.3.12");
        fs.mkdirSync(dotted, { recursive: true });
        fs.writeFileSync(path.join(dotted, "pyvenv.cfg"), "home = /usr\n");
        expect(await updatesAfter([{ path: dotted, type: "create" }])).toBe(1);

        // A created *file* with an extension still costs one stat and no more:
        // it is not a directory, and nothing else is asked of it here.
        const image = path.join(root, "backend", "logo.png");
        fs.writeFileSync(image, "");
        expect(await updatesAfter([{ path: image, type: "create" }])).toBe(1);
      });

      it("drops a marker event that changes nothing the filter answers", async () => {
        // Review finding. `conda install` rewrites `conda-meta/` on every run,
        // and `uv venv` rewrites `pyvenv.cfg`; in an environment the filter
        // already excludes, each of those used to reconcile the whole tree.
        // Present on disk and excluded by the filter is agreement, and
        // agreement schedules nothing.
        vi.mocked(createIgnoreFilter).mockReturnValue(filterOf(underEnv, ["backend/env"]));
        await startWatching(root);

        fs.mkdirSync(path.dirname(marker()), { recursive: true });
        fs.writeFileSync(marker(), "home = /usr\n");
        const history = path.join(root, "backend", "env", "conda-meta", "history");
        fs.mkdirSync(path.dirname(history), { recursive: true });
        fs.writeFileSync(history, "");
        const installed = path.join(root, "backend", "env", "conda-meta", "numpy.json");
        fs.writeFileSync(installed, "{}");

        expect(await updatesAfter([
          { path: marker(), type: "update" },
          { path: history, type: "update" },
          { path: installed, type: "create" },
        ])).toBe(0);

        // Removing one file or marker does not change the filter while another
        // valid environment marker remains at the same root.
        fs.rmSync(history);
        expect(await updatesAfter([{ path: history, type: "delete" }])).toBe(0);
        fs.rmSync(marker());
        expect(await updatesAfter([{ path: marker(), type: "delete" }])).toBe(0);
      });

      it("reconciles once more when an environment reverses while the update runs", async () => {
        // Review finding. While `updateProjectIndex` runs, the filter is the
        // one that update started from, so an environment reversing in that
        // window cannot be judged against it: here the marker is created and
        // deleted while the first update scans, and to the stale filter the
        // deletion reads as agreement — it excludes nothing, and the disk now
        // holds nothing. What the old code did with it depended on the marker:
        // dropped where it is not an indexable file, and where it is —
        // `pyvenv.cfg` is — passed on to the debounce, which fired *while the
        // first update was still running*. That second update takes the index
        // lock's "already indexing" path, returns zeros and reconciles
        // nothing, so the intermediate state stood until some later event.
        // Either way the reversal was lost. Now such an event is remembered
        // and one reconciliation follows the update it arrived under, with the
        // rebuilt filter to judge it by.
        const nothing = filterOf(() => false);
        const envExcluded = filterOf(underEnv, ["backend/env"]);
        vi.mocked(createIgnoreFilter)
          .mockReturnValueOnce(nothing)        // at start
          .mockReturnValueOnce(envExcluded)    // after the update that saw the marker
          .mockReturnValueOnce(nothing);       // after the follow-up, marker gone again
        await startWatching(root);

        // The update is held open, so the reversal below lands squarely inside
        // it rather than before or after.
        let releaseUpdate: () => void = () => {};
        const updateStarted = new Promise<void>((updateIsRunning) => {
          mockUpdateProjectIndex.mockImplementationOnce(async () => {
            updateIsRunning();
            await new Promise<void>((resolve) => {
              releaseUpdate = resolve;
            });
            return { added: 0, updated: 0, removed: 0, chunksCreated: 0, cancelled: false };
          });
        });

        fs.mkdirSync(path.dirname(marker()), { recursive: true });
        fs.writeFileSync(marker(), "home = /usr\n");

        vi.useFakeTimers();
        try {
          mockSubscribeCallback?.(null, [{ path: marker(), type: "create" }]);
          await vi.advanceTimersByTimeAsync(2100);
          await updateStarted;
          expect(mockUpdateProjectIndex).toHaveBeenCalledTimes(1);

          // The environment goes away again while that update is still
          // scanning. Judged against the filter it started from, this looks
          // like nothing happened.
          fs.rmSync(marker());
          mockSubscribeCallback?.(null, [{ path: marker(), type: "delete" }]);

          // An ordinary source event in the same window must join the pending
          // reconciliation rather than start a competing update and clear the
          // remembered environment reversal.
          const source = path.join(root, "backend", "app.ts");
          fs.writeFileSync(source, "export const value = 1;\n");
          mockSubscribeCallback?.(null, [{ path: source, type: "update" }]);

          await vi.advanceTimersByTimeAsync(2100);
          // No second update while the first still holds the lock: that one
          // would return zeros and reconcile nothing.
          expect(mockUpdateProjectIndex).toHaveBeenCalledTimes(1);

          releaseUpdate();
          await vi.advanceTimersByTimeAsync(2100);
          expect(mockUpdateProjectIndex).toHaveBeenCalledTimes(2);

          // Exactly one: nothing moved under the second update, so it starts
          // no third. This has to be asked on the same clock — a timer left
          // pending when the fake one is put away never fires, and an
          // unconditional follow-up would go unnoticed.
          await vi.advanceTimersByTimeAsync(10_000);
          expect(mockUpdateProjectIndex).toHaveBeenCalledTimes(2);
        } finally {
          vi.useRealTimers();
        }

        // The filter was rebuilt after each of the two updates.
        expect(createIgnoreFilter).toHaveBeenCalledTimes(3);
      });

      it("remembers an environment reversal that arrives with nothing else", async () => {
        // The twin of the test above, with the ordinary source event left out.
        // An environment event never reaches `scheduleUpdate` — the filter
        // answers it and returns null — so the remembering it does for itself
        // is the only thing that carries the reversal to the follow-up. With
        // the source event beside it, `scheduleUpdate` sets the same flag and
        // hides whether that path works at all: found by mutating it away and
        // watching the suite stay green.
        const nothing = filterOf(() => false);
        const envExcluded = filterOf(underEnv, ["backend/env"]);
        vi.mocked(createIgnoreFilter)
          .mockReturnValueOnce(nothing)
          .mockReturnValueOnce(envExcluded)
          .mockReturnValueOnce(nothing);
        await startWatching(root);

        let releaseUpdate: () => void = () => {};
        const updateStarted = new Promise<void>((updateIsRunning) => {
          mockUpdateProjectIndex.mockImplementationOnce(async () => {
            updateIsRunning();
            await new Promise<void>((resolve) => {
              releaseUpdate = resolve;
            });
            return { added: 0, updated: 0, removed: 0, chunksCreated: 0, cancelled: false };
          });
        });

        fs.mkdirSync(path.dirname(marker()), { recursive: true });
        fs.writeFileSync(marker(), "home = /usr\n");

        vi.useFakeTimers();
        try {
          mockSubscribeCallback?.(null, [{ path: marker(), type: "create" }]);
          await vi.advanceTimersByTimeAsync(2100);
          await updateStarted;
          expect(mockUpdateProjectIndex).toHaveBeenCalledTimes(1);

          fs.rmSync(marker());
          mockSubscribeCallback?.(null, [{ path: marker(), type: "delete" }]);
          await vi.advanceTimersByTimeAsync(2100);
          expect(mockUpdateProjectIndex).toHaveBeenCalledTimes(1);

          releaseUpdate();
          await vi.advanceTimersByTimeAsync(2100);
          expect(mockUpdateProjectIndex).toHaveBeenCalledTimes(2);
        } finally {
          vi.useRealTimers();
        }
      });

      it("drops a deferred reconciliation when the watcher stops", async () => {
        vi.mocked(createIgnoreFilter).mockReturnValue(filterOf(() => false));
        await startWatching(root);

        let releaseUpdate: () => void = () => {};
        const updateStarted = new Promise<void>((updateIsRunning) => {
          mockUpdateProjectIndex.mockImplementationOnce(async () => {
            updateIsRunning();
            await new Promise<void>((resolve) => {
              releaseUpdate = resolve;
            });
            return { added: 0, updated: 0, removed: 0, chunksCreated: 0, cancelled: false };
          });
        });

        fs.mkdirSync(path.dirname(marker()), { recursive: true });
        fs.writeFileSync(marker(), "home = /usr\n");

        vi.useFakeTimers();
        try {
          mockSubscribeCallback?.(null, [{ path: marker(), type: "create" }]);
          await vi.advanceTimersByTimeAsync(2100);
          await updateStarted;

          fs.rmSync(marker());
          mockSubscribeCallback?.(null, [{ path: marker(), type: "delete" }]);
          await stopWatching(root);

          releaseUpdate();
          await vi.advanceTimersByTimeAsync(10_000);
          expect(mockUpdateProjectIndex).toHaveBeenCalledTimes(1);
        } finally {
          vi.useRealTimers();
        }
      });
    });

    it("ignores files outside the project tree", async () => {
      vi.useFakeTimers();
      vi.mocked(shouldIgnore).mockReturnValue(false);

      await startWatching(TEST_PROJECT);

      mockSubscribeCallback?.(null, [
        { path: "/some/other/project/file.ts", type: "update" },
      ]);

      await vi.advanceTimersByTimeAsync(2100);

      expect(mockUpdateProjectIndex).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it("handles special files (Dockerfile, Makefile)", async () => {
      vi.useFakeTimers();
      vi.mocked(shouldIgnore).mockReturnValue(false);

      await startWatching(TEST_PROJECT);

      mockSubscribeCallback?.(null, [
        { path: path.join(RESOLVED_PROJECT, "Dockerfile"), type: "update" },
      ]);

      await vi.advanceTimersByTimeAsync(2100);

      expect(mockUpdateProjectIndex).toHaveBeenCalled();
      vi.useRealTimers();
    });

    it("triggers update for a detected extensionless file event (async filter)", async () => {
      // Exercises the async event pipeline end-to-end (not just isIndexableFile
      // in isolation): a real extensionless bash probe fired as a watch event
      // must flow through the async filter to scheduleUpdate. Uses real timers +
      // waitFor rather than fake timers, since the filter does a real head-read
      // and fake-timer/real-I/O mixing races.
      fs.mkdirSync(RESOLVED_PROJECT, { recursive: true });
      const probe = path.join(RESOLVED_PROJECT, "strato-check-evt");
      fs.writeFileSync(probe, "#!/bin/bash\nexit 0\n");
      try {
        await startWatching(TEST_PROJECT);
        mockSubscribeCallback?.(null, [{ path: probe, type: "update" }]);
        await vi.waitFor(() => expect(mockUpdateProjectIndex).toHaveBeenCalled(), {
          timeout: 5000,
          interval: 50,
        });
      } finally {
        fs.rmSync(probe, { force: true });
      }
    });

    it("schedules a reconcile for an extensionless update event even when it no longer detects as code", async () => {
      // A previously-indexed extensionless file edited into readable non-code
      // still needs updateProjectIndex so its stale chunks/symbols are purged,
      // even though isIndexableFile now returns false for it.
      fs.mkdirSync(RESOLVED_PROJECT, { recursive: true });
      const stale = path.join(RESOLVED_PROJECT, "was-a-probe");
      fs.writeFileSync(stale, "Release notes: nothing here is code.\n");
      try {
        await startWatching(TEST_PROJECT);
        mockSubscribeCallback?.(null, [{ path: stale, type: "update" }]);
        await vi.waitFor(() => expect(mockUpdateProjectIndex).toHaveBeenCalled(), {
          timeout: 5000,
          interval: 50,
        });
      } finally {
        fs.rmSync(stale, { force: true });
      }
    });

    it("logs and does not crash if event filtering throws (crash-guard)", async () => {
      vi.useFakeTimers();
      try {
        // Force the filter to reject; the async callback's promise is ignored by
        // @parcel/watcher, so an unguarded rejection would crash the process.
        vi.mocked(shouldIgnore).mockImplementationOnce(() => {
          throw new Error("boom");
        });
        await startWatching(TEST_PROJECT);

        mockSubscribeCallback?.(null, [{ path: path.join(RESOLVED_PROJECT, "src/app.ts"), type: "update" }]);
        await vi.advanceTimersByTimeAsync(2100);

        expect(logger.error).toHaveBeenCalledWith(
          "Watch event filtering failed",
          expect.objectContaining({ error: "boom" }),
        );
        expect(mockUpdateProjectIndex).not.toHaveBeenCalled();
      } finally {
        // Restore real timers even if an assertion above throws, so leaked fake
        // timers can't cascade into unrelated tests.
        vi.useRealTimers();
      }
    });
  });

  // ── Debounce behavior ──────────────────────────────────────────────────

  describe("debounce", () => {
    it("coalesces rapid changes into a single update", async () => {
      vi.useFakeTimers();
      vi.mocked(shouldIgnore).mockReturnValue(false);

      await startWatching(TEST_PROJECT);

      // Fire 5 rapid events
      for (let i = 0; i < 5; i++) {
        mockSubscribeCallback?.(null, [
          { path: path.join(RESOLVED_PROJECT, `file${i}.ts`), type: "update" },
        ]);
      }

      await vi.advanceTimersByTimeAsync(2100);

      // Only one update call despite 5 events
      expect(mockUpdateProjectIndex).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });

    it("does not trigger update before debounce period", async () => {
      vi.useFakeTimers();
      vi.mocked(shouldIgnore).mockReturnValue(false);

      await startWatching(TEST_PROJECT);

      mockSubscribeCallback?.(null, [
        { path: path.join(RESOLVED_PROJECT, "file.ts"), type: "update" },
      ]);

      // Only 1 second has passed — should not have triggered yet
      await vi.advanceTimersByTimeAsync(1000);
      expect(mockUpdateProjectIndex).not.toHaveBeenCalled();

      // Now pass the debounce threshold
      await vi.advanceTimersByTimeAsync(1100);
      expect(mockUpdateProjectIndex).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });
  });

  // ── Error handling ─────────────────────────────────────────────────────

  describe("error handling", () => {
    it("logs first 3 errors", async () => {
      await startWatching(TEST_PROJECT);

      for (let i = 0; i < 3; i++) {
        mockSubscribeCallback?.(new Error(`test error ${i}`), []);
      }

      expect(logger.error).toHaveBeenCalledTimes(3);
    });

    it("throttles error logging after 3rd error (logs every 100th)", async () => {
      await startWatching(TEST_PROJECT);

      // Fire 10 errors (below MAX_WATCHER_ERRORS threshold for this test — it will auto-stop at 10)
      // But we need to test throttling, so let's fire 4 to see the 4th is suppressed
      for (let i = 0; i < 4; i++) {
        mockSubscribeCallback?.(new Error(`error ${i}`), []);
      }

      // First 3 errors + the "too many errors" is NOT triggered yet (count=4 < 10)
      // logger.error is called for errors 1, 2, 3 but NOT 4
      const errorCalls = vi.mocked(logger.error).mock.calls.filter(
        (call) => call[0] === "File watcher error",
      );
      expect(errorCalls).toHaveLength(3);
    });

    it("auto-stops watcher after MAX_WATCHER_ERRORS consecutive errors", async () => {
      await startWatching(TEST_PROJECT);
      expect(isWatching(TEST_PROJECT)).toBe(true);

      // Fire 10 consecutive errors
      for (let i = 0; i < 10; i++) {
        mockSubscribeCallback?.(new Error(`error ${i}`), []);
      }

      // The auto-stop is asynchronous, so wait for it
      await vi.waitFor(() => {
        expect(isWatching(TEST_PROJECT)).toBe(false);
      });

      expect(logger.error).toHaveBeenCalledWith(
        "Too many watcher errors, stopping watcher",
        expect.objectContaining({ totalErrors: 10 }),
      );
    });

    it("resets error count on successful event delivery", async () => {
      vi.useFakeTimers();
      vi.mocked(shouldIgnore).mockReturnValue(false);
      await startWatching(TEST_PROJECT);

      // Fire 5 errors
      for (let i = 0; i < 5; i++) {
        mockSubscribeCallback?.(new Error(`error ${i}`), []);
      }

      // Then a successful event — error count should reset
      mockSubscribeCallback?.(null, [
        { path: path.join(RESOLVED_PROJECT, "file.ts"), type: "update" },
      ]);

      // Fire 5 more errors — should NOT auto-stop (count restarted from 0)
      for (let i = 0; i < 5; i++) {
        mockSubscribeCallback?.(new Error(`error ${i}`), []);
      }

      // Should still be watching (5 + 0 + 5, but count was reset in the middle)
      expect(isWatching(TEST_PROJECT)).toBe(true);
      vi.useRealTimers();
    });
  });

  // ── ensureWatcherStarted ───────────────────────────────────────────────

  describe("startWatchingAutomatically", () => {
    it("preserves automatic startup when the mode is unset", async () => {
      await expect(startWatchingAutomatically(TEST_PROJECT)).resolves.toBe(true);
      expect(isWatching(TEST_PROJECT)).toBe(true);
    });

    it.each(["manual", "off", "git"])("does no watcher work in %s mode", async (mode) => {
      process.env.SOCRATICODE_WATCHER = mode;

      await expect(startWatchingAutomatically(TEST_PROJECT)).resolves.toBe(false);

      expect(mockAcquireProjectLock).not.toHaveBeenCalled();
      const watcher = await import("@parcel/watcher");
      expect(watcher.default.subscribe).not.toHaveBeenCalled();
    });
  });

  describe("ensureWatcherStarted", () => {
    it.each(["manual", "off", "git"])("returns before storage access in %s mode", (mode) => {
      process.env.SOCRATICODE_WATCHER = mode;

      ensureWatcherStarted(TEST_PROJECT);

      expect(mockGetCollectionInfo).not.toHaveBeenCalled();
      expect(mockAcquireProjectLock).not.toHaveBeenCalled();
    });

    it("does nothing if already watching", async () => {
      await startWatching(TEST_PROJECT);
      mockGetCollectionInfo.mockClear();

      ensureWatcherStarted(TEST_PROJECT);

      // Should not even check collection info
      expect(mockGetCollectionInfo).not.toHaveBeenCalled();
    });

    it("does nothing if indexing is in progress", () => {
      mockIsIndexingInProgress.mockReturnValue(true);

      ensureWatcherStarted(TEST_PROJECT);

      expect(mockGetCollectionInfo).not.toHaveBeenCalled();
    });

    it("does nothing if no collection exists", async () => {
      mockGetCollectionInfo.mockResolvedValue(null);

      ensureWatcherStarted(TEST_PROJECT);

      // Wait for the async chain to complete
      await vi.waitFor(() => {
        expect(mockGetCollectionInfo).toHaveBeenCalled();
      });

      // Should not have started watching
      expect(isWatching(TEST_PROJECT)).toBe(false);
    });

    it("does nothing if collection is empty (0 points)", async () => {
      mockGetCollectionInfo.mockResolvedValue({ pointsCount: 0 });

      ensureWatcherStarted(TEST_PROJECT);

      await vi.waitFor(() => {
        expect(mockGetCollectionInfo).toHaveBeenCalled();
      });

      expect(isWatching(TEST_PROJECT)).toBe(false);
    });

    it("does not start if indexing status is not completed", async () => {
      mockGetCollectionInfo.mockResolvedValue({ pointsCount: 100 });
      mockGetProjectMetadata.mockResolvedValue({
        indexingStatus: "in-progress",
        filesIndexed: 10,
        filesTotal: 50,
      });

      ensureWatcherStarted(TEST_PROJECT);

      await vi.waitFor(() => {
        expect(mockGetProjectMetadata).toHaveBeenCalled();
      });

      // Give the async chain a moment to complete
      await new Promise((r) => setTimeout(r, 50));

      expect(isWatching(TEST_PROJECT)).toBe(false);
      expect(logger.info).toHaveBeenCalledWith(
        "Skipping watcher auto-start: index is incomplete (interrupted)",
        expect.objectContaining({ indexingStatus: "in-progress" }),
      );
    });

    it("starts watcher when collection exists and index is completed", async () => {
      mockGetCollectionInfo.mockResolvedValue({ pointsCount: 100 });
      mockGetProjectMetadata.mockResolvedValue({ indexingStatus: "completed" });

      ensureWatcherStarted(TEST_PROJECT);

      await vi.waitFor(() => {
        expect(isWatching(TEST_PROJECT)).toBe(true);
      });

      expect(logger.info).toHaveBeenCalledWith(
        "Auto-started file watcher on tool use",
        expect.objectContaining({ projectPath: RESOLVED_PROJECT }),
      );
    });

    it("starts watcher when metadata is null (legacy — no metadata point)", async () => {
      // Older indexed projects may not have a metadata point at all
      mockGetCollectionInfo.mockResolvedValue({ pointsCount: 100 });
      mockGetProjectMetadata.mockResolvedValue(null);

      ensureWatcherStarted(TEST_PROJECT);

      await vi.waitFor(() => {
        expect(isWatching(TEST_PROJECT)).toBe(true);
      });
    });

    it("handles errors gracefully (non-fatal)", async () => {
      mockGetCollectionInfo.mockRejectedValue(new Error("Qdrant unreachable"));

      ensureWatcherStarted(TEST_PROJECT);

      await vi.waitFor(() => {
        expect(logger.debug).toHaveBeenCalledWith(
          "Auto-start watcher check failed (non-fatal)",
          expect.objectContaining({ error: "Qdrant unreachable" }),
        );
      });

      expect(isWatching(TEST_PROJECT)).toBe(false);
    });

    it("caches external watch and skips retry within TTL", async () => {
      // Simulate another process holding the watch lock
      mockAcquireProjectLock.mockResolvedValue(false);
      mockGetCollectionInfo.mockResolvedValue({ pointsCount: 100 });
      mockGetProjectMetadata.mockResolvedValue({ indexingStatus: "completed" });

      ensureWatcherStarted(TEST_PROJECT);

      // Wait for the async chain to complete and cache the external watch
      await vi.waitFor(() => {
        expect(mockAcquireProjectLock).toHaveBeenCalled();
      });
      await new Promise((r) => setTimeout(r, 50));

      // Clear mocks to track subsequent calls
      mockGetCollectionInfo.mockClear();
      mockAcquireProjectLock.mockClear();

      // Call again — should be cached, no collection check or lock attempt
      ensureWatcherStarted(TEST_PROJECT);
      await new Promise((r) => setTimeout(r, 50));

      expect(mockGetCollectionInfo).not.toHaveBeenCalled();
    });

    it("does not log 'Auto-started' when another process holds the lock", async () => {
      mockAcquireProjectLock.mockResolvedValue(false);
      mockGetCollectionInfo.mockResolvedValue({ pointsCount: 100 });
      mockGetProjectMetadata.mockResolvedValue({ indexingStatus: "completed" });

      ensureWatcherStarted(TEST_PROJECT);

      await vi.waitFor(() => {
        expect(mockAcquireProjectLock).toHaveBeenCalled();
      });
      await new Promise((r) => setTimeout(r, 50));

      // Should log that another process is watching, NOT that we auto-started
      expect(logger.info).toHaveBeenCalledWith(
        "Another process is already watching this project, skipping",
        expect.anything(),
      );
      expect(logger.info).not.toHaveBeenCalledWith(
        "Auto-started file watcher on tool use",
        expect.anything(),
      );
    });

    it("re-checks conditions after async gap", async () => {
      mockGetCollectionInfo.mockResolvedValue({ pointsCount: 100 });
      mockGetProjectMetadata.mockResolvedValue({ indexingStatus: "completed" });

      // Start watching before ensureWatcherStarted's async chain completes
      await startWatching(TEST_PROJECT);

      const watcher = await import("@parcel/watcher");
      const subscribeCallCount = vi.mocked(watcher.default.subscribe).mock.calls.length;

      ensureWatcherStarted(TEST_PROJECT);

      // Wait for the async chain
      await new Promise((r) => setTimeout(r, 50));

      // subscribe should NOT have been called again (re-check detected already watching)
      expect(vi.mocked(watcher.default.subscribe).mock.calls.length).toBe(subscribeCallCount);
    });
  });

  // ── Graceful degradation ───────────────────────────────────────────────

  describe("graceful degradation on update failure", () => {
    it("logs error but keeps watcher running when update fails", async () => {
      vi.useFakeTimers();
      vi.mocked(shouldIgnore).mockReturnValue(false);
      mockUpdateProjectIndex.mockRejectedValueOnce(new Error("Something failed"));

      await startWatching(TEST_PROJECT);

      mockSubscribeCallback?.(null, [
        { path: path.join(RESOLVED_PROJECT, "file.ts"), type: "update" },
      ]);

      await vi.advanceTimersByTimeAsync(2100);

      expect(logger.error).toHaveBeenCalledWith(
        "Watch auto-update failed",
        expect.objectContaining({ error: "Something failed" }),
      );
      // Watcher should still be running
      expect(isWatching(TEST_PROJECT)).toBe(true);
      vi.useRealTimers();
    });
  });
});

describe("watcher isIndexableFile — extensionless", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "socraticode-watch-extless-"));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("recognizes built-in Godot files with an empty legacy extension map", async () => {
    const legacyExtensionMap = new Map<string, string>();
    await expect(isIndexableFile(path.join(dir, "player.gd"), legacyExtensionMap)).resolves.toBe(true);
    await expect(isIndexableFile(path.join(dir, "level.tscn"), legacyExtensionMap)).resolves.toBe(true);
    await expect(isIndexableFile(path.join(dir, "material.tres"), legacyExtensionMap)).resolves.toBe(true);
  });

  it("treats a detected extensionless script as indexable", async () => {
    const p = path.join(dir, "strato-check-x");
    fs.writeFileSync(p, "#!/bin/bash\nexit 0\n");
    expect(await isIndexableFile(p)).toBe(true);
  });

  it("ignores a readable non-code extensionless file", async () => {
    const p = path.join(dir, "LICENSE");
    fs.writeFileSync(p, "MIT License\n\nCopyright (c) 2026\n");
    expect(await isIndexableFile(p)).toBe(false);
  });

  it("scores lossily-decoded content on the same window discovery uses", async () => {
    // Latin-1 bytes each re-encode to three, so markers sitting past
    // DETECT_HEAD_BYTES / 3 characters are outside the shared window. Scoring the
    // raw head instead would call this code and schedule an update for a file
    // discovery will not admit — this check's answer decides whether an edit is
    // scheduled at all, so it has to agree with discovery.
    const p = path.join(dir, "deploy-latin1");
    fs.writeFileSync(
      p,
      Buffer.concat([
        Buffer.from("# "),
        Buffer.alloc(Math.ceil(DETECT_HEAD_BYTES / 3) + 100, 0xe9),
        Buffer.from("\nif [ -d /tmp ]; then\n  export PATH=/bin\nfi\n"),
      ]),
    );
    expect(await isIndexableFile(p)).toBe(false);
  });

  it("schedules (returns true) for a vanished extensionless file, to reconcile a delete", async () => {
    expect(await isIndexableFile(path.join(dir, "was-deleted"))).toBe(true);
  });

  it("ignores an extensionless directory (never head-reads it)", async () => {
    const d = path.join(dir, "somedir");
    fs.mkdirSync(d);
    expect(await isIndexableFile(d)).toBe(false);
  });

  it.skipIf(process.platform === "win32")("ignores an extensionless FIFO without blocking on the open", async () => {
    // A FIFO reaches this guard like a directory does, but opening it for read
    // blocks until a writer appears — so the guard must lstat and drop it rather
    // than head-read it inside the long-lived watch callback (a directory throws
    // EISDIR; a FIFO would hang and starve the I/O threadpool).
    const fifo = path.join(dir, "evt-pipe");
    execFileSync("mkfifo", [fifo]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        isIndexableFile(fifo),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("blocked on FIFO open")), 2000);
        }),
      ]);
      expect(result).toBe(false);
    } finally {
      clearTimeout(timer);
      // Release any read-open a buggy guard left blocked so the leaked threadpool
      // op does not stall worker teardown.
      try {
        fs.closeSync(fs.openSync(fifo, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK));
      } catch {
        /* no blocked reader (guard worked) → ENXIO; ignore */
      }
    }
  });

  it("keeps supported extensions indexable without a read", async () => {
    expect(await isIndexableFile(path.join(dir, "a.ts"))).toBe(true);
  });

  it("respects the kill-switch for extensionless files", async () => {
    const p = path.join(dir, "probe");
    fs.writeFileSync(p, "#!/bin/bash\n");
    vi.stubEnv("INDEX_EXTENSIONLESS", "false");
    expect(await isIndexableFile(p)).toBe(false);
  });
});
