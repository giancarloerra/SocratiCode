// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { gitRefreshTarget, readGitState } from "../../src/services/git-state.js";
import { acquireProjectLock, holdsIdentityLock, releaseAllLocks, releaseProjectLock } from "../../src/services/lock.js";
import { createGitFixture, git } from "../helpers/git.js";

const exec = promisify(execFile);
afterEach(async () => { await releaseAllLocks(); vi.unstubAllEnvs(); });

describe("Git refresh lock identity through real process boundaries", () => {
  it.each([false, true])("retains and releases the acquired identity across a checkout (explicit shared identity: %s)", async (shared) => {
    const fixture = createGitFixture();
    vi.stubEnv("SOCRATICODE_BRANCH_AWARE", "true");
    vi.stubEnv("SOCRATICODE_PROJECT_ID", shared ? `shared-${path.basename(fixture.root)}` : "");
    const target = gitRefreshTarget(fixture.root, await readGitState(fixture.root), true);
    try {
      expect(await acquireProjectLock(fixture.root, "index", undefined, { projectId: target.projectId, reentrant: false })).toBe(true);
      git(fixture.root, "checkout", "-b", "other");
      await expect(target.assertCurrent()).rejects.toThrow("checkout changed");
      expect(holdsIdentityLock(target.projectId, "index")).toBe(true);
      const script = `(async () => {
        const { acquireIdentityLock, releaseAllLocks } = await import(${JSON.stringify(new URL("../../src/services/lock.ts", import.meta.url).href)});
        const acquired = await acquireIdentityLock(${JSON.stringify(target.projectId)}, "index");
        process.stdout.write(String(acquired));
        await releaseAllLocks();
      })().catch(error => { console.error(error); process.exitCode = 1; });`;
      const probe = () => exec(process.execPath, [fileURLToPath(new URL("../../node_modules/tsx/dist/cli.mjs", import.meta.url)), "--input-type=module", "--eval", script], { timeout: 15_000 });
      expect((await probe()).stdout).toBe("false");
      await releaseProjectLock(fixture.root, "index", target.projectId);
      expect(holdsIdentityLock(target.projectId, "index")).toBe(false);
      expect((await probe()).stdout).toBe("true");
    } finally {
      await releaseAllLocks();
      fs.rmSync(path.join(os.tmpdir(), "socraticode-locks", `${target.projectId}-index`), { force: true });
      fixture.cleanup();
    }
  });
});
