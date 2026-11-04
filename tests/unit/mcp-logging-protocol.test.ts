// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

/**
 * MCP logging at the protocol level (#178).
 *
 * The logger forwards every line as `notifications/message` once the server is
 * hosted, and stops writing to stderr. The SDK delivers those notifications
 * only when the server declares the `logging` capability, so without it every
 * log line was dropped. These tests start the real server over stdio and speak
 * JSON-RPC to it, the way an MCP host does.
 */

import { type ChildProcessWithoutNullStreams, execFile, spawn } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

interface RpcMessage {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: { level?: string; logger?: string; data?: unknown };
  result?: { capabilities?: Record<string, unknown> } & Record<string, unknown>;
  error?: { code: number; message: string };
}

/** Nothing listens here, so external Qdrant readiness fails without touching a real server. */
const UNREACHABLE = "http://127.0.0.1:9";
const execFileAsync = promisify(execFile);

let child: ChildProcessWithoutNullStreams | undefined;
let childClosed: Promise<void> | undefined;
let workDir = "";

beforeEach(async () => {
  workDir = await fsp.mkdtemp(path.join(os.tmpdir(), "socraticode-logging-protocol-"));
});

interface WindowsProcess {
  ProcessId: number;
  ParentProcessId: number;
  CreationDate: string;
}

/** Read identities so an exited process's reused PID is not a cleanup target. */
async function windowsProcesses(): Promise<WindowsProcess[]> {
  const { stdout } = await execFileAsync("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-Command",
    "$ErrorActionPreference = 'Stop'; Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CreationDate | Select-Object ProcessId,ParentProcessId,CreationDate | ConvertTo-Json -Compress",
  ], { timeout: 10_000 });
  return JSON.parse(stdout);
}

/** Close the server before deleting its files; fail explicitly if shutdown needs forced termination. */
async function stopServer(timeoutMs = 15_000, beforeForcedTermination?: () => Promise<void>): Promise<void> {
  const proc = child;
  const windowsPids = process.platform === "win32" && proc?.pid !== undefined ? [proc.pid] : [];
  const windowsSnapshot = windowsPids.length ? await windowsProcesses() : [];
  // Retain descendants before EOF can make their wrapper exit.
  for (const parent of windowsPids) {
    for (const entry of windowsSnapshot) {
      if (entry.ParentProcessId === parent && !windowsPids.includes(entry.ProcessId)) windowsPids.push(entry.ProcessId);
    }
  }
  let shutdownTimedOut = false;
  if (proc && proc.exitCode === null && proc.signalCode === null) {
    // EOF reaches the server through the tsx wrapper; wait for its streams
    // to close before removing a directory the server can still log into.
    proc.stdin.end();
  }
  if (proc && childClosed) {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      shutdownTimedOut = await Promise.race([
        childClosed.then(() => false),
        new Promise<true>((resolve) => { timeout = setTimeout(() => resolve(true), timeoutMs); }),
      ]);
      if (shutdownTimedOut && proc.pid !== undefined) {
        if (beforeForcedTermination) await beforeForcedTermination();
        if (process.platform === "win32") {
          const currentProcesses = await windowsProcesses();
          for (const pid of windowsPids.reverse()) {
            if (pid === proc.pid && (proc.exitCode !== null || proc.signalCode !== null)) continue;
            const original = windowsSnapshot.find((entry) => entry.ProcessId === pid);
            if (!original || !currentProcesses.some((entry) => entry.ProcessId === pid && entry.CreationDate === original.CreationDate)) continue;
            try {
              await execFileAsync("taskkill", ["/pid", String(pid), "/t", "/f"], { timeout: 10_000 });
            } catch (error) {
              try {
                process.kill(pid, 0);
              } catch (probeError) {
                if (probeError instanceof Error && "code" in probeError && probeError.code === "ESRCH") continue;
              }
              throw error;
            }
          }
        } else {
          try {
            process.kill(-proc.pid, "SIGKILL");
          } catch (error) {
            if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") throw error;
          }
        }
        clearTimeout(timeout);
        const streamsClosed = await Promise.race([
          childClosed.then(() => true),
          new Promise<false>((resolve) => { timeout = setTimeout(() => resolve(false), 10_000); }),
        ]);
        if (!streamsClosed) throw new Error("MCP logging server streams did not close within 10000 milliseconds after forced termination; temporary files were retained.");
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  child = undefined;
  childClosed = undefined;
  await fsp.rm(workDir, { recursive: true, force: true });
  if (shutdownTimedOut) throw new Error(`MCP logging server did not close within ${timeoutMs} milliseconds after stdin EOF; its process tree was terminated.`);
}

afterEach(() => stopServer());

/** Start the server from source over stdio, isolated from the caller's configuration. */
function startServer(logFile: string) {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!/^(QDRANT_|OLLAMA_|EMBEDDING_|SOCRATICODE_)/.test(key)) env[key] = value;
  }
  Object.assign(env, {
    QDRANT_MODE: "external",
    QDRANT_URL: UNREACHABLE,
    OLLAMA_MODE: "external",
    OLLAMA_URL: UNREACHABLE,
    SOCRATICODE_AUTO_RESUME: "off",
    SOCRATICODE_WATCHER: "off",
    SOCRATICODE_LOG_LEVEL: "info",
    SOCRATICODE_LOG_FILE: logFile,
  });

  const proc = spawn(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"), path.resolve("src/index.ts")], {
    cwd: path.resolve("."),
    env,
    stdio: ["pipe", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  child = proc;
  childClosed = new Promise<void>((resolve) => proc.once("close", () => resolve()));

  const received: RpcMessage[] = [];
  let stderr = "";
  let exited: Error | undefined;
  const waiters = new Map<number, { resolve: (msg: RpcMessage) => void; reject: (err: Error) => void }>();
  const exitCode = new Promise<number | null>((resolve) => proc.once("exit", (code) => resolve(code)));

  let buffer = "";
  proc.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let nl = buffer.indexOf("\n");
    while (nl !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      nl = buffer.indexOf("\n");
      if (!line) continue;
      const msg = JSON.parse(line) as RpcMessage;
      received.push(msg);
      if (typeof msg.id === "number") {
        waiters.get(msg.id)?.resolve(msg);
        waiters.delete(msg.id);
      }
    }
  });
  proc.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  // A server that fails to start fails the test at once, with its stderr,
  // instead of leaving every request waiting out the test timeout.
  proc.on("close", (code, signal) => {
    exited = new Error(`server exited (code ${code}, signal ${signal}); stderr:\n${stderr}`);
    for (const waiter of waiters.values()) waiter.reject(exited);
    waiters.clear();
  });
  proc.stdin.on("error", () => {
    // EPIPE after the server has gone; the close handler reports why.
  });

  let nextId = 1;
  const request = (method: string, params: unknown): Promise<RpcMessage> =>
    new Promise((resolve, reject) => {
      if (exited) return reject(exited);
      const id = nextId++;
      waiters.set(id, { resolve, reject });
      proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  const notify = (method: string): void => {
    proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
  };
  const logNotifications = (containing: string): RpcMessage[] =>
    received.filter((m) => m.method === "notifications/message" && String(m.params?.data).includes(containing));

  const initialize = async (): Promise<RpcMessage> => {
    const init = await request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "logging-protocol-test", version: "1.0.0" },
    });
    notify("notifications/initialized");
    return init;
  };

  return { proc, request, initialize, logNotifications, exitCode, stderr: () => stderr, exited: () => exited };
}

async function waitFor(check: () => boolean, timeoutMs: number, failed: () => Error | undefined): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    const failure = failed();
    if (failure) throw failure;
    if (Date.now() > deadline) throw new Error("timed out waiting for condition");
    await new Promise((done) => setTimeout(done, 25));
  }
}

const occurrences = (text: string, needle: string): number => text.split(needle).length - 1;

describe("MCP logging over stdio", () => {
  it.each(["exit", "close", "exit before EOF"] as const)("cleans up and retains the timeout error when %s precedes forced termination", async (event) => {
    // Windows otherwise ends the child with its parent's job instead of retaining the pipes.
    const descendantScript = "setInterval(() => {}, 1000); process.stdout.write(String(process.pid) + '\\n');";
    const descendant = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendantScript)}], { detached: process.platform === 'win32', stdio: ['ignore', 'inherit', 'inherit'] }).unref(); `;
    const script = `${event !== "close" ? descendant : "process.stdout.write('ready\\n');"}process.stdin.resume(); setInterval(() => {}, 1000);`;
    const proc = spawn(process.execPath, ["-e", script], {
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    child = proc;
    const exited = new Promise<void>((resolve) => proc.once("exit", () => resolve()));
    const closed = new Promise<void>((resolve) => proc.once("close", () => resolve()));
    childClosed = closed;
    proc.stderr.resume();
    const descendantPid = await new Promise<number>((resolve) => {
      createInterface({ input: proc.stdout }).once("line", (line) => resolve(Number(line)));
    });

    let terminationStarted = false;
    if (event === "exit before EOF") {
      proc.kill();
      await exited;
    }
    try {
      await expect(stopServer(100, async () => {
        terminationStarted = true;
        proc.kill();
        await (event !== "close" ? exited : closed);
      })).rejects.toThrow("process tree was terminated");
      expect(terminationStarted).toBe(true);
      expect(child).toBeUndefined();
      expect(childClosed).toBeUndefined();
      await expect(fsp.stat(workDir)).rejects.toMatchObject({ code: "ENOENT" });
    } catch (error) {
      // A failed cleanup assertion must not leave the persistent fixture behind.
      if (Number.isInteger(descendantPid) && descendantPid > 0) {
        try {
          process.kill(descendantPid, "SIGKILL");
        } catch (cleanupError) {
          if (!(cleanupError instanceof Error) || !("code" in cleanupError) || cleanupError.code !== "ESRCH") {
            throw new AggregateError([error, cleanupError], "Cleanup assertion and fixture termination both failed");
          }
        }
      }
      throw error;
    }
  });

  it("fails and removes the whole process tree when EOF shutdown stalls", async () => {
    const descendant = "process.stdin.resume(); process.stdout.write('ready'); setInterval(() => {}, 1000);";
    const wrapper = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: ['pipe', 'inherit', 'inherit'] }); process.stdin.resume(); setInterval(() => {}, 1000);`;
    const proc = spawn(process.execPath, ["-e", wrapper], {
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    child = proc;
    childClosed = new Promise<void>((resolve) => proc.once("close", () => resolve()));
    proc.stderr.resume();
    await new Promise<void>((resolve) => proc.stdout.once("data", () => resolve()));

    await expect(stopServer(100)).rejects.toThrow("process tree was terminated");
    await expect(fsp.stat(workDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("advertises logging, accepts logging/setLevel, and delivers one notification per log line", async () => {
    const logFile = path.join(workDir, "server.log");
    const server = startServer(logFile);

    const init = await server.initialize();
    expect(init.error).toBeUndefined();
    expect(init.result?.capabilities?.logging).toEqual({});

    const setLevel = await server.request("logging/setLevel", { level: "info" });
    expect(setLevel.error).toBeUndefined();
    expect(setLevel.result).toEqual({});

    // A post-initialization log with a known text: codebase_index reports it is
    // checking the external Qdrant before that check fails. The call itself is
    // left to fail on its own; only the log line matters here.
    const marker = `Checking external Qdrant at ${UNREACHABLE}...`;
    server
      .request("tools/call", { name: "codebase_index", arguments: { projectPath: workDir } })
      .catch(() => {});

    await waitFor(() => server.logNotifications(marker).length > 0, 60_000, server.exited);
    // Give a duplicate, if there were one, time to arrive.
    await new Promise((done) => setTimeout(done, 300));

    const matches = server.logNotifications(marker);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.params).toMatchObject({ level: "info", logger: "socraticode" });
    // Forwarding does not also write the line to stderr, and the log file still gets it.
    expect(server.stderr()).not.toContain(marker);
    expect(occurrences(await fsp.readFile(logFile, "utf8"), marker)).toBe(1);
  });

  it("still shuts down gracefully when the host has already closed its end of stdout", async () => {
    // Shutdown logs, and that log now goes to stdout. With the host gone the
    // write fails with EPIPE, which must not end the process mid-shutdown.
    const logFile = path.join(workDir, "server.log");
    const server = startServer(logFile);
    const init = await server.initialize();
    expect(init.error).toBeUndefined();

    server.proc.stdout.destroy();
    server.proc.stdin.end();

    expect(await server.exitCode).toBe(0);
    const log = await fsp.readFile(logFile, "utf8");
    expect(log).toContain("Graceful shutdown complete");
    expect(log).not.toContain("Uncaught exception");
  });
});
