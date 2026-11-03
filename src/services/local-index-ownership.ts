// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod/v3";
import { coreProjectId, sanitizeBranchName } from "../config.js";
import { QDRANT_HOST, QDRANT_MODE, QDRANT_URL } from "../constants.js";

const exec = promisify(execFile);
const directorySchema = z.object({
  path: z.string().refine(path.isAbsolute),
  device: z.string(),
  inode: z.string(),
  created: z.string(),
}).strict();
const ownershipSchema = z.object({
  version: z.literal(1),
  ownerId: z.string().uuid(),
  identity: z.string(),
  projectPath: z.string().refine(path.isAbsolute),
  project: directorySchema,
  repository: directorySchema,
  commonGitDir: directorySchema,
  checkoutGitDir: directorySchema,
  checkout: directorySchema,
  checkoutParent: directorySchema,
  branchRef: z.string().regex(/^refs\/heads\/.+/).nullable(),
  branchAware: z.boolean(),
  linkedWorktree: z.boolean(),
}).strict();

/** Original local ownership, not an identity inferred from a collection name. */
export type LocalIndexOwnership = z.infer<typeof ownershipSchema>;
type Directory = z.infer<typeof directorySchema>;

/** Automatic cleanup is off unless the operator explicitly declares local, non-shared use. */
export function automaticCleanupEnabled(): boolean {
  return process.env.SOCRATICODE_AUTO_CLEANUP === "local";
}

/** The local declaration never enables deletion against an external or non-loopback store. */
export function assertLocalCleanupStore(): void {
  if (!automaticCleanupEnabled()) throw new Error("automatic cleanup is disabled");
  const host = QDRANT_URL ? new URL(QDRANT_URL).hostname : QDRANT_HOST;
  if (QDRANT_MODE !== "managed" || !["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
    throw new Error("automatic cleanup requires host-exclusive managed loopback Qdrant; shared/external stores remain explicit-prune only");
  }
  if (process.env.SOCRATICODE_PROJECT_ID?.trim()) throw new Error("an explicit project ID is pinned/shared");
}

/** Validate persisted ownership strictly; legacy and malformed records are never adopted. */
export function parseLocalIndexOwnership(value: unknown): LocalIndexOwnership | null {
  const result = ownershipSchema.safeParse(value);
  return result.success ? result.data : null;
}

async function ownerId(create: boolean): Promise<string> {
  const directory = path.join(os.homedir(), ".socraticode");
  const file = path.join(directory, "local-index-owner");
  if (create) {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      await fs.writeFile(file, `${randomUUID()}\n`, { flag: "wx", mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  const id = (await fs.readFile(file, "utf8")).trim();
  if (!z.string().uuid().safeParse(id).success) throw new Error("local ownership file is invalid; indexes are retained");
  return id;
}

async function directoryStamp(directory: string): Promise<Directory> {
  const canonical = await fs.realpath(directory);
  const stat = await fs.stat(canonical, { bigint: true });
  if (!stat.isDirectory()) throw new Error(`not a directory: ${directory}`);
  return { path: canonical, device: String(stat.dev), inode: String(stat.ino), created: String(stat.birthtimeNs) };
}

async function assertDirectory(original: Directory): Promise<void> {
  if (JSON.stringify(await directoryStamp(original.path)) !== JSON.stringify(original)) {
    throw new Error(`the recorded filesystem directory changed: ${original.path}`);
  }
}

async function assertAbsent(directory: string, refusal: string): Promise<void> {
  try {
    await fs.lstat(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error(refusal);
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  try {
    const { stdout } = await exec("git", args, { cwd, encoding: "utf8", timeout: 5_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
    return stdout;
  } catch (error) {
    const detail = error as Error & { stderr?: string; killed?: boolean };
    throw new Error(`Git retirement evidence unavailable: ${detail.killed ? "Git did not respond within 5 seconds" : detail.stderr?.trim() || detail.message}`);
  }
}

interface Worktree { path: string; branchRef: string | null }
async function worktrees(cwd: string): Promise<Worktree[]> {
  const records = (await git(cwd, "worktree", "list", "--porcelain", "-z")).split("\0\0").filter(Boolean);
  return records.map((record) => {
    const fields = record.split("\0");
    const worktree = fields.find((field) => field.startsWith("worktree "))?.slice(9);
    if (!worktree || !path.isAbsolute(worktree) || fields.includes("bare")) throw new Error("Git worktree inventory is ambiguous or bare");
    return { path: path.resolve(worktree), branchRef: fields.find((field) => field.startsWith("branch "))?.slice(7) ?? null };
  });
}

async function commonGitDirectory(cwd: string): Promise<string> {
  return fs.realpath(path.resolve(cwd, (await git(cwd, "rev-parse", "--git-common-dir")).trim()));
}

async function assertUnpinned(projectPath: string): Promise<void> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(projectPath, ".socraticode.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const config: unknown = JSON.parse(raw);
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("project configuration is ambiguous");
  const id = (config as Record<string, unknown>).projectId;
  if (id !== undefined && !(typeof id === "string" && !id.trim())) throw new Error("project configuration is pinned/shared or ambiguous");
}

function recordedIdentity(ownership: Pick<LocalIndexOwnership, "projectPath" | "branchAware" | "branchRef">): string {
  const branch = ownership.branchAware && ownership.branchRef ? sanitizeBranchName(ownership.branchRef.slice(11)) : "";
  return `${coreProjectId(ownership.projectPath)}${branch ? `__${branch}` : ""}`;
}

async function branchRefs(cwd: string): Promise<string[]> {
  return (await git(cwd, "for-each-ref", "--format=%(refname)", "refs/heads/")).trim().split("\n").filter(Boolean);
}

function assertNoBranchCollision(ownership: LocalIndexOwnership, refs: string[]): void {
  if (ownership.branchAware && refs.some((ref) => ref !== ownership.branchRef && recordedIdentity({ ...ownership, branchRef: ref }) === ownership.identity)) {
    throw new Error("different branch refs resolve to the recorded identity");
  }
}

/** Capture association only for a newly created, explicitly local identity. Failures mean report-only. */
export async function captureLocalIndexOwnership(projectPath: string, identity: string): Promise<LocalIndexOwnership> {
  assertLocalCleanupStore();
  const resolved = path.resolve(projectPath);
  await assertUnpinned(resolved);
  const checkout = await directoryStamp((await git(resolved, "rev-parse", "--show-toplevel")).trim());
  const commonGitDir = await directoryStamp(await commonGitDirectory(resolved));
  const registered = await worktrees(resolved);
  const primary = registered[0];
  const current = registered.find((entry) => entry.path === checkout.path);
  if (!primary || !current || await fs.realpath((await git(primary.path, "rev-parse", "--absolute-git-dir")).trim()) !== commonGitDir.path) {
    throw new Error("the original repository/worktree association cannot be verified");
  }
  await assertUnpinned(primary.path);
  const branchAware = process.env.SOCRATICODE_BRANCH_AWARE === "true";
  const linkedWorktree = current.path !== primary.path;
  if (!linkedWorktree && (!branchAware || !current.branchRef || !sanitizeBranchName(current.branchRef.slice(11)))) {
    throw new Error("the primary non-branch index is retained");
  }
  const ownership: LocalIndexOwnership = {
    version: 1, ownerId: await ownerId(true), identity, projectPath: resolved,
    project: await directoryStamp(resolved), repository: await directoryStamp(primary.path), commonGitDir,
    checkoutGitDir: await directoryStamp((await git(resolved, "rev-parse", "--absolute-git-dir")).trim()), checkout,
    checkoutParent: await directoryStamp(path.dirname(checkout.path)),
    branchRef: current.branchRef,
    branchAware, linkedWorktree,
  };
  if (recordedIdentity(ownership) !== identity) throw new Error("the Git branch no longer matches the index identity");
  if (ownership.project.device !== checkout.device || checkout.device !== ownership.checkoutParent.device) {
    throw new Error("a mount boundary prevents proving checkout removal safely");
  }
  if (ownership.linkedWorktree && (path.relative(commonGitDir.path, ownership.checkoutGitDir.path).startsWith("..") || ownership.checkoutGitDir.device !== commonGitDir.device)) {
    throw new Error("the worktree administration directory is outside the original Git filesystem");
  }
  assertNoBranchCollision(ownership, await branchRefs(primary.path));
  const ref = (await git(resolved, "rev-parse", "--symbolic-full-name", "HEAD")).trim();
  if ((ref === "HEAD" ? null : ref) !== ownership.branchRef || await commonGitDirectory(resolved) !== commonGitDir.path) {
    throw new Error("the Git checkout changed during ownership capture");
  }
  return ownership;
}

/** Prove actual Git retirement. Filesystem absence alone, merges and switches never suffice. */
export async function assertLocalIndexRetired(ownership: LocalIndexOwnership): Promise<void> {
  assertLocalCleanupStore();
  if (await ownerId(false) !== ownership.ownerId) throw new Error("the index belongs to another local installation");
  if (recordedIdentity(ownership) !== ownership.identity) throw new Error("the ownership record does not match its identity");
  if (ownership.linkedWorktree !== (ownership.checkout.path !== ownership.repository.path)) throw new Error("the recorded worktree association is inconsistent");
  await assertDirectory(ownership.repository);
  await assertDirectory(ownership.commonGitDir);
  await assertDirectory(ownership.checkoutParent);
  await assertUnpinned(ownership.repository.path);
  if (await commonGitDirectory(ownership.repository.path) !== ownership.commonGitDir.path) throw new Error("the original Git repository changed");
  const registered = await worktrees(ownership.repository.path);
  if (registered[0]?.path !== ownership.repository.path) throw new Error("the original primary Git checkout changed");
  const refs = await branchRefs(ownership.repository.path);
  assertNoBranchCollision(ownership, refs);
  const stillRegistered = registered.some((entry) => entry.path === ownership.checkout.path);
  if (ownership.linkedWorktree && !stillRegistered) {
    await assertAbsent(ownership.checkoutGitDir.path, "the original worktree Git directory still exists; the worktree may have moved");
    await assertDirectory(ownership.commonGitDir);
    await fs.readdir(ownership.commonGitDir.path);
    await assertAbsent(ownership.checkout.path, "the unregistered worktree directory still exists");
    await assertDirectory(ownership.checkoutParent);
    await fs.readdir(ownership.checkoutParent.path);
    return;
  }
  if (!stillRegistered) throw new Error("the original checkout is not registered; retirement is ambiguous");
  await assertDirectory(ownership.checkout);
  await assertDirectory(ownership.checkoutGitDir);
  await assertDirectory(ownership.project);
  await assertUnpinned(ownership.projectPath);
  if (await commonGitDirectory(ownership.projectPath) !== ownership.commonGitDir.path) throw new Error("the indexed directory belongs to another Git repository");
  if (!ownership.branchAware || !ownership.branchRef || refs.includes(ownership.branchRef)) throw new Error("the indexed branch/worktree is still registered");
  if (registered.some((entry) => entry.branchRef === ownership.branchRef)) throw new Error("a registered worktree still uses the indexed branch");
}
