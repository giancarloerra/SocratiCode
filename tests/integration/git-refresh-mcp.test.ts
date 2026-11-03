// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited
// Run npm run build first: this exercises the shipped stdio entry point.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { collectionName, projectIdFromPath } from "../../src/config.js";
import { OLLAMA_HOST, QDRANT_API_KEY, QDRANT_HOST, QDRANT_PORT, QDRANT_URL } from "../../src/constants.js";
import { hashContent, indexProject, removeProjectIndex } from "../../src/services/indexer.js";
import { acquireIdentityLock, isProjectIdentityLocked, releaseIdentityLock } from "../../src/services/lock.js";
import { loadProjectHashes } from "../../src/services/qdrant.js";
import { isDockerAvailable } from "../helpers/fixtures.js";
import { createGitFixture, git } from "../helpers/git.js";
import { waitForOllama, waitForQdrant } from "../helpers/setup.js";

describe.skipIf(!isDockerAvailable())("Git refresh across two real MCP processes", () => {
  let fixture: ReturnType<typeof createGitFixture>;
  let identity: string;
  const clients: Client[] = [];
  const diagnostics: string[] = [];

  beforeAll(async () => {
    if (!await waitForQdrant()) throw new Error("Qdrant unavailable");
    if (!await waitForOllama()) throw new Error("Ollama unavailable");
    vi.stubEnv("SOCRATICODE_PROJECT_ID", "");
    vi.stubEnv("SOCRATICODE_BRANCH_AWARE", "false");
    fixture = createGitFixture();
    identity = projectIdFromPath(fixture.root);
    await indexProject(fixture.root);
    const entrypoint = fileURLToPath(new URL("../../dist/index.js", import.meta.url));
    if (!fs.existsSync(entrypoint)) throw new Error("Run npm run build before the MCP integration test");
    for (let i = 0; i < 2; i++) {
      const client = new Client({ name: "git-refresh-fixture", version: "1.0.0" });
      clients.push(client);
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [entrypoint],
        cwd: fixture.root,
        stderr: "pipe",
        env: {
          // The SDK's safe environment omits TMPDIR. All processes must use
          // the same existing OS-temp lock directory as their launcher.
          TMPDIR: os.tmpdir(), TMP: os.tmpdir(), TEMP: os.tmpdir(),
          SOCRATICODE_WATCHER: "git", SOCRATICODE_AUTO_RESUME: "off",
          SOCRATICODE_PROJECT_ID: identity,
          QDRANT_MODE: "external", QDRANT_URL: QDRANT_URL ?? `http://${QDRANT_HOST}:${QDRANT_PORT}`,
          ...(QDRANT_API_KEY ? { QDRANT_API_KEY } : {}),
          EMBEDDING_PROVIDER: "ollama", OLLAMA_MODE: "external", OLLAMA_HOST,
          ...(process.env.OLLAMA_URL ? { OLLAMA_URL: process.env.OLLAMA_URL } : {}),
        },
      });
      transport.stderr?.on("data", (chunk) => { diagnostics.push(String(chunk)); });
      await client.connect(transport);
    }
  }, 120_000);

  afterAll(async () => {
    await Promise.all(clients.map((client) => client.close()));
    if (identity) await releaseIdentityLock(identity, "index");
    if (fixture) {
      await removeProjectIndex(fixture.root);
      fixture.cleanup();
    }
    vi.unstubAllEnvs();
  }, 120_000);

  async function status(client: Client) {
    const result = await client.callTool({ name: "codebase_status", arguments: { projectPath: fixture.root } });
    expect(result.isError, diagnostics.slice(-3).join("\n")).not.toBe(true);
    return (result.content as Array<{ text?: string }>).map((part) => part.text ?? "").join("\n");
  }

  it("preserves tool schemas and keeps the connection usable after invalid input", async () => {
    for (const client of clients) {
      const { tools } = await client.listTools();
      const search = tools.find((tool) => tool.name === "codebase_search");
      expect(search?.inputSchema).toMatchObject({
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string" },
          limit: { type: "number", minimum: 1, maximum: 50 },
        },
      });
      const invalid = await client.callTool({ name: "codebase_search", arguments: { query: 3 } });
      expect(invalid.isError).toBe(true);
      expect(JSON.stringify(invalid.content)).toMatch(/Invalid arguments for tool codebase_search/);
      const about = await client.callTool({ name: "codebase_about", arguments: {} });
      expect(about.isError, diagnostics.slice(-3).join("\n")).not.toBe(true);
      expect(JSON.stringify(about.content)).toContain("SocratiCode");
    }
  });

  it("reports lock contention as pending, retries, converges on the same head, and releases locks on shutdown", async () => {
    for (const client of clients) expect(await status(client)).toContain("unverified");
    expect(await acquireIdentityLock(identity, "index", undefined, fixture.root, false)).toBe(true);
    const source = "export function sharedCheckoutChange() { return 'shared_commit_marker'; }\n";
    fs.writeFileSync(path.join(fixture.root, "shared.ts"), source);
    git(fixture.root, "add", ".");
    git(fixture.root, "commit", "-m", "Shared fixture update");
    await vi.waitFor(async () => {
      for (const client of clients) expect(await status(client)).toContain("FAILED, pending retry");
    }, { timeout: 15_000, interval: 500 });
    expect((await loadProjectHashes(collectionName(identity)))?.has("shared.ts")).toBe(false);
    await releaseIdentityLock(identity, "index");
    const head = git(fixture.root, "rev-parse", "HEAD").slice(0, 12);
    await vi.waitFor(async () => {
      for (const client of clients) {
        const result = await status(client);
        expect(result).toContain(`synchronized with refs/heads/main at ${head}`);
        expect(result).toContain("File watcher: disabled");
      }
    }, { timeout: 90_000, interval: 1_000 });
    expect((await loadProjectHashes(collectionName(identity)))?.get("shared.ts")).toBe(hashContent(source));
    for (const client of clients) {
      const symbols = await client.callTool({ name: "codebase_symbols", arguments: { projectPath: fixture.root, query: "sharedCheckoutChange" } });
      expect(JSON.stringify(symbols.content)).toContain("sharedCheckoutChange");
    }
    await Promise.all(clients.map((client) => client.close()));
    clients.length = 0;
    expect(await isProjectIdentityLocked(identity, "index")).toBe(false);
    expect(await isProjectIdentityLocked(identity, "graph")).toBe(false);
  }, 120_000);
});
