// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadPathAliases, parsePathAliases } from "../../src/services/graph-aliases.js";

describe("parsePathAliases", () => {
  const projectPath = "/project";

  it("parses tsconfig paths with wildcard patterns", () => {
    const json = JSON.stringify({
      compilerOptions: {
        paths: {
          "$lib/*": ["src/lib/*"],
          "@/*": ["./src/*"],
        },
      },
    });

    const aliases = parsePathAliases(json, projectPath);

    expect(aliases.entries.get("$lib/")).toEqual([path.join("src", "lib")]);
    expect(aliases.entries.get("@/")).toEqual(["src"]);
  });

  it("respects baseUrl", () => {
    const json = JSON.stringify({
      compilerOptions: {
        baseUrl: "./app",
        paths: {
          "@/*": ["src/*"],
        },
      },
    });

    const aliases = parsePathAliases(json, projectPath);

    expect(aliases.entries.get("@/")).toEqual([path.join("app", "src")]);
  });

  it("handles exact (non-wildcard) patterns", () => {
    const json = JSON.stringify({
      compilerOptions: {
        paths: {
          "~": ["./src"],
        },
      },
    });

    const aliases = parsePathAliases(json, projectPath);

    expect(aliases.entries.get("~")).toEqual(["src"]);
  });

  it("handles multiple targets for a single alias", () => {
    const json = JSON.stringify({
      compilerOptions: {
        paths: {
          "@/*": ["src/*", "generated/*"],
        },
      },
    });

    const aliases = parsePathAliases(json, projectPath);

    expect(aliases.entries.get("@/")).toEqual(["src", "generated"]);
  });

  it("handles JSON with single-line comments", () => {
    const json = `{
      // This is a comment
      "compilerOptions": {
        "paths": {
          "$lib/*": ["src/lib/*"] // inline comment
        }
      }
    }`;

    const aliases = parsePathAliases(json, projectPath);

    expect(aliases.entries.get("$lib/")).toEqual([path.join("src", "lib")]);
  });

  it("handles JSON with multi-line comments", () => {
    const json = `{
      /* Multi-line
         comment */
      "compilerOptions": {
        "paths": {
          "@/*": ["src/*"]
        }
      }
    }`;

    const aliases = parsePathAliases(json, projectPath);

    expect(aliases.entries.get("@/")).toEqual(["src"]);
  });

  it("preserves // inside string values when stripping comments", () => {
    const json = `{
      // comment
      "compilerOptions": {
        "baseUrl": "./dist//subdir", // trailing comment
        "paths": {
          "@/*": ["src/*"]
        }
      }
    }`;

    const aliases = parsePathAliases(json, projectPath);

    expect(aliases.entries.get("@/")).toEqual([path.join("dist//subdir", "src")]);
  });

  it("returns empty entries for config without paths", () => {
    const json = JSON.stringify({
      compilerOptions: {
        strict: true,
      },
    });

    const aliases = parsePathAliases(json, projectPath);

    expect(aliases.entries.size).toBe(0);
  });

  it("returns empty entries for invalid JSON", () => {
    const aliases = parsePathAliases("not json at all", projectPath);

    expect(aliases.entries.size).toBe(0);
  });

  it("skips entries with empty targets array", () => {
    const json = JSON.stringify({
      compilerOptions: {
        paths: {
          "@/*": [],
          "$lib/*": ["src/lib/*"],
        },
      },
    });

    const aliases = parsePathAliases(json, projectPath);

    expect(aliases.entries.has("@/")).toBe(false);
    expect(aliases.entries.get("$lib/")).toEqual([path.join("src", "lib")]);
  });

  it("skips non-string targets gracefully", () => {
    const json = '{"compilerOptions":{"paths":{"@/*":[42, null, "./src/*"]}}}';

    const aliases = parsePathAliases(json, projectPath);

    expect(aliases.entries.get("@/")).toEqual(["src"]);
  });
});

describe("loadPathAliases", () => {
  let tmpDir: string | null = null;

  afterEach(() => {
    if (tmpDir) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
      tmpDir = null;
    }
  });

  it("returns empty aliases for non-existent project", async () => {
    const aliases = await loadPathAliases("/non/existent/path");

    expect(aliases.entries.size).toBe(0);
  });

  it("reads aliases from tsconfig.json", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "socraticode-aliases-"));
    fs.writeFileSync(path.join(tmpDir, "tsconfig.json"), JSON.stringify({
      compilerOptions: {
        paths: { "$lib/*": ["src/lib/*"] },
      },
    }));

    const aliases = await loadPathAliases(tmpDir);

    expect(aliases.entries.get("$lib/")).toEqual([path.join("src", "lib")]);
  });

  it("falls back to jsconfig.json when tsconfig.json is absent", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "socraticode-aliases-"));
    fs.writeFileSync(path.join(tmpDir, "jsconfig.json"), JSON.stringify({
      compilerOptions: {
        paths: { "@/*": ["./src/*"] },
      },
    }));

    const aliases = await loadPathAliases(tmpDir);

    expect(aliases.entries.get("@/")).toEqual(["src"]);
  });

  it("falls through to jsconfig.json when tsconfig.json has no paths", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "socraticode-aliases-"));
    fs.writeFileSync(path.join(tmpDir, "tsconfig.json"), JSON.stringify({
      compilerOptions: { strict: true },
    }));
    fs.writeFileSync(path.join(tmpDir, "jsconfig.json"), JSON.stringify({
      compilerOptions: {
        paths: { "@/*": ["./src/*"] },
      },
    }));

    const aliases = await loadPathAliases(tmpDir);

    expect(aliases.entries.get("@/")).toEqual(["src"]);
  });

  it("prefers tsconfig.json over jsconfig.json", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "socraticode-aliases-"));
    fs.writeFileSync(path.join(tmpDir, "tsconfig.json"), JSON.stringify({
      compilerOptions: {
        paths: { "$lib/*": ["src/lib/*"] },
      },
    }));
    fs.writeFileSync(path.join(tmpDir, "jsconfig.json"), JSON.stringify({
      compilerOptions: {
        paths: { "@/*": ["./src/*"] },
      },
    }));

    const aliases = await loadPathAliases(tmpDir);

    // Should use tsconfig.json paths, not jsconfig.json
    expect(aliases.entries.has("$lib/")).toBe(true);
    expect(aliases.entries.has("@/")).toBe(false);
  });

  it("follows extends chain to find paths in parent config", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "socraticode-aliases-"));
    fs.writeFileSync(path.join(tmpDir, "tsconfig.json"), JSON.stringify({
      extends: "./tsconfig.base.json",
      compilerOptions: { strict: true },
    }));
    fs.writeFileSync(path.join(tmpDir, "tsconfig.base.json"), JSON.stringify({
      compilerOptions: {
        paths: { "$lib/*": ["src/lib/*"] },
      },
    }));

    const aliases = await loadPathAliases(tmpDir);

    expect(aliases.entries.get("$lib/")).toEqual([path.join("src", "lib")]);
  });

  it("follows multi-level extends chain", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "socraticode-aliases-"));
    fs.writeFileSync(path.join(tmpDir, "tsconfig.json"), JSON.stringify({
      extends: "./tsconfig.app.json",
    }));
    fs.writeFileSync(path.join(tmpDir, "tsconfig.app.json"), JSON.stringify({
      extends: "./tsconfig.base.json",
      compilerOptions: { strict: true },
    }));
    fs.writeFileSync(path.join(tmpDir, "tsconfig.base.json"), JSON.stringify({
      compilerOptions: {
        paths: { "@/*": ["src/*"] },
      },
    }));

    const aliases = await loadPathAliases(tmpDir);

    expect(aliases.entries.get("@/")).toEqual(["src"]);
  });

  it("handles extends without .json extension", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "socraticode-aliases-"));
    fs.writeFileSync(path.join(tmpDir, "tsconfig.json"), JSON.stringify({
      extends: "./base",
    }));
    fs.writeFileSync(path.join(tmpDir, "base.json"), JSON.stringify({
      compilerOptions: {
        paths: { "$lib/*": ["src/lib/*"] },
      },
    }));

    const aliases = await loadPathAliases(tmpDir);

    expect(aliases.entries.get("$lib/")).toEqual([path.join("src", "lib")]);
  });

  it("handles circular extends gracefully", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "socraticode-aliases-"));
    fs.writeFileSync(path.join(tmpDir, "tsconfig.json"), JSON.stringify({
      extends: "./tsconfig.base.json",
    }));
    fs.writeFileSync(path.join(tmpDir, "tsconfig.base.json"), JSON.stringify({
      extends: "./tsconfig.json",
    }));

    const aliases = await loadPathAliases(tmpDir);

    // Should not infinite loop, returns empty
    expect(aliases.entries.size).toBe(0);
  });

  it("stops when extended file does not exist", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "socraticode-aliases-"));
    fs.writeFileSync(path.join(tmpDir, "tsconfig.json"), JSON.stringify({
      extends: "./nonexistent.json",
    }));

    const aliases = await loadPathAliases(tmpDir);

    expect(aliases.entries.size).toBe(0);
  });
});
