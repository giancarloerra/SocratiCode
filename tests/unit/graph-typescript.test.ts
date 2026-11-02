// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EXTRA_EXTENSIONS } from "../../src/constants.js";
import { buildCodeGraph, currentGraphCapabilities } from "../../src/services/code-graph.js";
import { decideGraphRebuild, type GraphInputRecord } from "../../src/services/graph-inputs.js";

describe("TS/JS monorepo graph resolution", () => {
  let root: string;
  const write = (file: string, content: string | object) => {
    const absolute = path.join(root, file);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, typeof content === "string" ? content : JSON.stringify(content));
  };
  const project = (files: Record<string, string | object>) => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "socraticode-ts-workspace-"));
    for (const [file, content] of Object.entries(files)) write(file, content);
  };
  const dependencies = (graph: Awaited<ReturnType<typeof buildCodeGraph>>, file: string) =>
    graph.edges.filter((edge) => edge.source === file).map((edge) => edge.target).sort();
  const decide = async (record: GraphInputRecord) => decideGraphRebuild(root, record, {
    hasAdditions: false, changed: new Map(), removed: new Set(), unreadable: new Set(), knownHash: () => undefined,
  }, EXTRA_EXTENSIONS, await currentGraphCapabilities());

  afterEach(() => {
    vi.restoreAllMocks();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it("resolves the same alias in two apps without leaking the root mapping", async () => {
    project({
      "tsconfig.json": { compilerOptions: { paths: { "@/*": ["root/*"] } } },
      "root/util.ts": "export const value = 0;",
      "root/main.ts": 'import { value } from "@/util";',
      "apps/crm/tsconfig.json": { compilerOptions: { paths: { "@/*": ["src/*"] } } },
      "apps/site/jsconfig.json": { compilerOptions: { paths: { "@/*": ["src/*"] } } },
      "apps/crm/src/main.ts": 'import { value } from "@/util"; import "./relative.js";',
      "apps/crm/src/util.ts": "export const value = 1;",
      "apps/crm/src/relative.ts": "export {};",
      "apps/site/src/main.js": 'import { value } from "@/util";',
      "apps/site/src/util.js": "export const value = 2;",
    });
    const graph = await buildCodeGraph(root);
    expect(dependencies(graph, "root/main.ts")).toEqual(["root/util.ts"]);
    expect(dependencies(graph, "apps/crm/src/main.ts")).toEqual(["apps/crm/src/relative.ts", "apps/crm/src/util.ts"]);
    expect(dependencies(graph, "apps/site/src/main.js")).toEqual(["apps/site/src/util.js"]);
  });

  it("inherits origin-relative paths and baseUrl through package and array extends", async () => {
    project({
      "node_modules/@workspace/config/package.json": { name: "@workspace/config", tsconfig: "base.json" },
      "node_modules/@workspace/config/base.json": { compilerOptions: { baseUrl: "../../../shared", paths: { "@/*": ["*"] }, moduleResolution: "bundler" } },
      "configs/strict.json": { compilerOptions: { strict: true } },
      "apps/crm/tsconfig.json": '{ // JSONC\n"extends": ["@workspace/config", "../../configs/strict.json"],\n"compilerOptions": { "module": "esnext", },\n}',
      "apps/crm/main.ts": 'import { value } from "@/util";',
      "shared/util.ts": "export const value = 1;",
    });
    const graph = await buildCodeGraph(root);
    expect(dependencies(graph, "apps/crm/main.ts")).toEqual(["shared/util.ts"]);
    expect(Object.keys(graph.graphInputs.files)).toEqual(expect.arrayContaining([
      "apps/crm/tsconfig.json", "node_modules/@workspace/config/base.json", "node_modules/@workspace/config/package.json", "configs/strict.json",
    ]));
  });

  it("keeps inherited paths relative to their declaring config without baseUrl", async () => {
    project({
      "configs/base.json": { compilerOptions: { paths: { "@/*": ["../shared/*"] } } },
      "apps/crm/tsconfig.json": { extends: "../../configs/base" },
      "apps/crm/main.ts": 'import { value } from "@/util";',
      "shared/util.ts": "export const value = 1;",
    });
    expect(dependencies(await buildCodeGraph(root), "apps/crm/main.ts")).toEqual(["shared/util.ts"]);
  });

  it("resolves declared root, subpath and wildcard exports without installed workspace links", async () => {
    project({
      "package.json": { workspaces: ["packages/*", "apps/*"] },
      "apps/crm/main.ts": 'import "@workspace/db"; import "@workspace/db/schemas"; import "@workspace/db/features/foo"; import "@workspace/db/private"; import "@workspace/db/unlisted"; import "unrelated"; import "missing-package";',
      "packages/db/package.json": { name: "@workspace/db", main: "./src/index.ts", exports: {
        ".": "./src/index.ts", "./schemas": "./src/schemas/index.ts", "./features/*": "./src/features/*.ts", "./private": null,
      } },
      "packages/db/src/index.ts": "export {};",
      "packages/db/src/schemas/index.ts": "export {};",
      "packages/db/src/features/foo.ts": "export {};",
      "packages/db/private.ts": "export {};",
      "packages/db/unlisted.ts": "export {};",
      "examples/unrelated/package.json": { name: "unrelated", main: "index.ts" },
      "examples/unrelated/index.ts": "export {};",
    });
    expect(dependencies(await buildCodeGraph(root), "apps/crm/main.ts")).toEqual([
      "packages/db/src/features/foo.ts", "packages/db/src/index.ts", "packages/db/src/schemas/index.ts",
    ]);
    expect(fs.existsSync(path.join(root, "node_modules"))).toBe(false);
  });

  it("honors conditional declaration order, custom conditions and import versus require", async () => {
    project({
      "package.json": { workspaces: { packages: ["packages/*"] } },
      "tsconfig.json": { compilerOptions: { moduleResolution: "bundler", module: "preserve", customConditions: ["development"] } },
      "main.ts": 'import "dual"; const cjs = require("dual"); import("dual"); import "ordered"; import "custom"; import "typed";',
      "packages/dual/package.json": { name: "dual", exports: { import: "./esm.ts", require: "./cjs.ts", default: "./fallback.ts" } },
      "packages/dual/esm.ts": "export {};", "packages/dual/cjs.ts": "export {};", "packages/dual/fallback.ts": "export {};",
      "packages/ordered/package.json": { name: "ordered", exports: { default: "./first.ts", types: "./second.ts" } },
      "packages/ordered/first.ts": "export {};", "packages/ordered/second.ts": "export {};",
      "packages/custom/package.json": { name: "custom", exports: { development: "./dev.ts", default: "./prod.ts" } },
      "packages/custom/dev.ts": "export {};", "packages/custom/prod.ts": "export {};",
      "packages/typed/package.json": { name: "typed", exports: { types: "./types.ts", import: "./runtime.ts" } },
      "packages/typed/types.ts": "export {};", "packages/typed/runtime.ts": "export {};",
    });
    expect(dependencies(await buildCodeGraph(root), "main.ts")).toEqual([
      "packages/custom/dev.ts", "packages/dual/cjs.ts", "packages/dual/esm.ts", "packages/dual/esm.ts", "packages/ordered/first.ts", "packages/typed/types.ts",
    ]);
  });

  it("uses package type for NodeNext static imports and keeps dynamic imports in import mode", async () => {
    project({
      "package.json": { workspaces: ["packages/*"] },
      "tsconfig.json": { compilerOptions: { module: "nodenext", moduleResolution: "nodenext" } },
      "main.ts": 'import "dual"; import("dual");',
      "esm/package.json": { type: "module" },
      "esm/main.ts": 'import "dual";',
      "packages/dual/package.json": { name: "dual", exports: { import: "./esm.ts", require: "./cjs.ts" } },
      "packages/dual/esm.ts": "export {};", "packages/dual/cjs.ts": "export {};",
    });
    const graph = await buildCodeGraph(root);
    expect(dependencies(graph, "main.ts")).toEqual(["packages/dual/cjs.ts", "packages/dual/esm.ts"]);
    expect(dependencies(graph, "esm/main.ts")).toEqual(["packages/dual/esm.ts"]);
  });

  it("supports pnpm YAML include/exclude patterns and excludes ignored packages", async () => {
    project({
      "pnpm-workspace.yaml": 'packages: ["packages/**", "!**/excluded"]\n',
      ".gitignore": "packages/ignored/\n",
      "main.ts": 'import "allowed"; import "excluded"; import "ignored";',
      "packages/allowed/package.json": { name: "allowed", main: "index.ts" },
      "packages/allowed/index.ts": "export {};",
      "packages/excluded/package.json": { name: "excluded", main: "index.ts" },
      "packages/excluded/index.ts": "export {};",
      "packages/ignored/package.json": { name: "ignored", main: "index.ts" },
      "packages/ignored/index.ts": "export {};",
    });
    expect(dependencies(await buildCodeGraph(root), "main.ts")).toEqual(["packages/allowed/index.ts"]);
  });

  it("resolves compiler-supported legacy types, main, index and file subpaths", async () => {
    project({
      "package.json": { workspaces: ["packages/*"] },
      "main.ts": 'import "typed"; import "legacy"; import "legacy/sub"; import "indexed";',
      "packages/typed/package.json": { name: "typed", types: "types.ts", main: "runtime.js" },
      "packages/typed/types.ts": "export {};", "packages/typed/runtime.js": "export {};",
      "packages/legacy/package.json": { name: "legacy", main: "lib/main.js" },
      "packages/legacy/lib/main.ts": "export {};", "packages/legacy/sub.ts": "export {};",
      "packages/indexed/package.json": { name: "indexed" }, "packages/indexed/index.ts": "export {};",
    });
    expect(dependencies(await buildCodeGraph(root), "main.ts")).toEqual([
      "packages/indexed/index.ts", "packages/legacy/lib/main.ts", "packages/legacy/sub.ts", "packages/typed/types.ts",
    ]);
  });

  it("preserves component, stylesheet and jsconfig root aliases", async () => {
    project({
      "tsconfig.json": { compilerOptions: { strict: true } },
      "jsconfig.json": { compilerOptions: { paths: { "$lib/*": ["src/*"] } } },
      "App.svelte": '<script>import Component from "$lib/Component.svelte"; import "./relative.ts";</script>',
      "App.vue": '<script setup>import Component from "$lib/Component.vue";</script>',
      "main.ts": 'import "$lib/styles.css";',
      "src/styles.css": ".test { color: red; }",
      "src/Component.svelte": "<p>test</p>", "src/Component.vue": "<template><p>test</p></template>",
      "relative.ts": "export {};",
    });
    const graph = await buildCodeGraph(root);
    expect(dependencies(graph, "App.svelte")).toEqual(["relative.ts", "src/Component.svelte"]);
    expect(dependencies(graph, "App.vue")).toEqual(["src/Component.vue"]);
    expect(dependencies(graph, "main.ts")).toEqual(["src/styles.css"]);
  });

  it("invalidates nested config and workspace manifest edits, then skips an unchanged update", async () => {
    project({
      "package.json": { workspaces: ["packages/*"] },
      "apps/crm/tsconfig.json": { compilerOptions: { paths: { "@/*": ["one/*"] } } },
      "apps/crm/main.ts": 'import "@/util"; import "db";',
      "apps/crm/one/util.ts": "export {};", "apps/crm/two/util.ts": "export {};",
      "packages/db/package.json": { name: "db", exports: "./one.ts" },
      "packages/db/one.ts": "export {};", "packages/db/two.ts": "export {};",
    });
    let graph = await buildCodeGraph(root);
    expect((await decide(graph.graphInputs)).rebuild).toBe(false);
    write("apps/crm/tsconfig.json", { compilerOptions: { paths: { "@/*": ["two/*"] } } });
    expect((await decide(graph.graphInputs)).rebuild).toBe(true);
    graph = await buildCodeGraph(root);
    expect(dependencies(graph, "apps/crm/main.ts")).toEqual(["apps/crm/two/util.ts", "packages/db/one.ts"]);
    write("packages/db/package.json", { name: "db", exports: "./two.ts" });
    expect((await decide(graph.graphInputs)).rebuild).toBe(true);
    graph = await buildCodeGraph(root);
    expect(dependencies(graph, "apps/crm/main.ts")).toEqual(["apps/crm/two/util.ts", "packages/db/two.ts"]);
    expect((await decide(graph.graphInputs)).rebuild).toBe(false);
    fs.rmSync(path.join(root, "apps/crm/tsconfig.json"));
    expect((await decide(graph.graphInputs)).rebuild).toBe(true);
    graph = await buildCodeGraph(root);
    expect(dependencies(graph, "apps/crm/main.ts")).toEqual(["packages/db/two.ts"]);
    write("apps/crm/tsconfig.json", { compilerOptions: { paths: { "@/*": ["one/*"] } } });
    expect((await decide(graph.graphInputs)).rebuild).toBe(true);
  });

  it.each([
    "node_modules/@ws/db", "node_modules/db", "apps/crm/node_modules/@ws/db", "apps/crm/node_modules/db",
  ])("preserves installed workspace links at %s", async (location) => {
    const name = location.split("node_modules/")[1];
    project({
      "package.json": { workspaces: ["apps/*", "packages/*"] },
      "tsconfig.json": { compilerOptions: { moduleResolution: "bundler", module: "preserve" } },
      "apps/crm/package.json": { name: "crm", dependencies: { [name]: "workspace:*" } },
      "apps/crm/main.ts": `import "${name}";`,
      "packages/db/package.json": { name, exports: "./src/index.ts" },
      "packages/db/src/index.ts": "export {};",
    });
    const expected = ["packages/db/src/index.ts"];
    expect(dependencies(await buildCodeGraph(root), "apps/crm/main.ts")).toEqual(expected);
    const link = path.join(root, location);
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(path.join(root, "packages/db"), link, "junction");
    expect(dependencies(await buildCodeGraph(root), "apps/crm/main.ts")).toEqual(expected);
  });

  it.each([
    "node_modules/@ws/db", "node_modules/db", "apps/crm/node_modules/@ws/db", "apps/crm/node_modules/db",
  ])("keeps an independently installed package external at %s", async (location) => {
    const name = location.split("node_modules/")[1];
    project({
      "package.json": { workspaces: ["apps/*", "packages/*"] },
      "tsconfig.json": { compilerOptions: { moduleResolution: "bundler", module: "preserve" } },
      "apps/crm/package.json": { name: "crm", dependencies: { [name]: "npm:external-db@2.0.0" } },
      "apps/crm/main.ts": `import "${name}";`,
      "packages/db/package.json": { name, exports: "./index.ts" },
      "packages/db/index.ts": "export {};",
      [`${location}/package.json`]: { name: "external-db", exports: "./index.ts" },
      [`${location}/index.ts`]: "export {};",
      "node_modules/.installed/db/package.json": { name: "external-db", exports: "./index.ts" },
      "node_modules/.installed/db/index.ts": "export {};",
    });
    expect(dependencies(await buildCodeGraph(root), "apps/crm/main.ts")).toEqual([]);
    const link = path.join(root, location);
    fs.rmSync(link, { recursive: true });
    fs.symlinkSync(path.join(root, "node_modules/.installed/db"), link, "junction");
    expect(dependencies(await buildCodeGraph(root), "apps/crm/main.ts")).toEqual([]);
  });

  it.each(["@ws/db", "db"])("invalidates installed binding changes with identical manifests for %s", async (name) => {
    const manifest = { name, exports: "./index.ts" };
    project({
      "package.json": { workspaces: ["apps/*", "packages/*"] },
      "tsconfig.json": { compilerOptions: { moduleResolution: "bundler", module: "preserve" } },
      "apps/crm/main.ts": `import "${name}";`,
      "packages/db/package.json": manifest, "packages/db/index.ts": "export {};",
    });
    let graph = await buildCodeGraph(root);
    expect(dependencies(graph, "apps/crm/main.ts")).toEqual(["packages/db/index.ts"]);
    expect((await decide(graph.graphInputs)).rebuild).toBe(false);
    write("node_modules/.installed/db/package.json", manifest);
    write("node_modules/.installed/db/index.ts", "export {};");
    const link = path.join(root, "apps/crm/node_modules", name);
    fs.mkdirSync(path.dirname(link), { recursive: true });
    for (const member of [false, true, false]) {
      fs.symlinkSync(path.join(root, member ? "packages/db" : "node_modules/.installed/db"), link, "junction");
      expect((await decide(graph.graphInputs)).rebuild).toBe(true);
      graph = await buildCodeGraph(root);
      expect(dependencies(graph, "apps/crm/main.ts")).toEqual(member ? ["packages/db/index.ts"] : []);
      expect((await decide(graph.graphInputs)).rebuild).toBe(false);
      fs.unlinkSync(link);
    }
    expect((await decide(graph.graphInputs)).rebuild).toBe(true);
    expect(dependencies(await buildCodeGraph(root), "apps/crm/main.ts")).toEqual(["packages/db/index.ts"]);
  });

  it("preserves the underlying error when an installed binding cannot be inspected", async () => {
    project({
      "package.json": { workspaces: ["packages/*"] }, "main.ts": 'import "db";',
      "packages/db/package.json": { name: "db", main: "index.ts" }, "packages/db/index.ts": "export {};",
    });
    const link = path.join(root, "node_modules/db");
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(path.join(root, "packages/db"), link, "junction");
    const failure = Object.assign(new Error("EACCES: installed binding cannot be inspected"), { code: "EACCES", path: link });
    const original = fs.realpathSync;
    vi.spyOn(fs, "realpathSync").mockImplementation((...args) => {
      if (path.resolve(String(args[0])) === link) throw failure;
      return Reflect.apply(original, fs, args);
    });
    await expect(buildCodeGraph(root)).rejects.toThrow(/EACCES: installed binding cannot be inspected/);
  });

  it("preserves implicit Classic resolution for an explicit ESNext module setting", async () => {
    project({
      "package.json": { workspaces: ["packages/*"] },
      "tsconfig.json": { compilerOptions: { module: "esnext" } },
      "main.ts": 'import "db";',
      "packages/db/package.json": { name: "db", exports: "./src/index.ts" },
      "packages/db/src/index.ts": "export {};",
    });
    expect(dependencies(await buildCodeGraph(root), "main.ts")).toEqual([]);
    write("tsconfig.json", { compilerOptions: { module: "esnext", moduleResolution: "bundler" } });
    expect(dependencies(await buildCodeGraph(root), "main.ts")).toEqual(["packages/db/src/index.ts"]);
  });

  it.each(["./missing-base.json", "@missing/config"])("preserves local aliases when the extends base %s is absent", async (base) => {
    project({
      "tsconfig.json": { extends: base, compilerOptions: { paths: { "@/*": ["src/*"] } } },
      "main.ts": 'import "@/util";', "src/util.ts": "export {};", "alternate/src/util.ts": "export {};",
    });
    const graph = await buildCodeGraph(root);
    expect(dependencies(graph, "main.ts")).toEqual(["src/util.ts"]);
    expect((await decide(graph.graphInputs)).rebuild).toBe(false);
    if (base.startsWith(".")) {
      write("missing-base.json", { compilerOptions: { baseUrl: "./alternate" } });
    } else {
      write("node_modules/@missing/config/package.json", { name: "@missing/config", tsconfig: "tsconfig.json" });
      write("node_modules/@missing/config/tsconfig.json", { compilerOptions: { baseUrl: "../../../alternate" } });
    }
    expect((await decide(graph.graphInputs)).rebuild).toBe(true);
    const updated = await buildCodeGraph(root);
    expect(dependencies(updated, "main.ts")).toEqual(["alternate/src/util.ts"]);
    expect((await decide(updated.graphInputs)).rebuild).toBe(false);
  });

  it("reports the original cause when an existing config base cannot be read", async () => {
    project({
      "tsconfig.json": { extends: "./base.jsonc", compilerOptions: { paths: { "@/*": ["src/*"] } } },
      "base.jsonc": {}, "main.ts": 'import "@/util";', "src/util.ts": "export {};",
    });
    expect(dependencies(await buildCodeGraph(root), "main.ts")).toEqual(["src/util.ts"]);
    const base = path.join(root, "base.jsonc");
    const failure = Object.assign(new Error("EACCES: config base cannot be read"), { code: "EACCES", path: base });
    const original = fs.readFileSync;
    vi.spyOn(fs, "readFileSync").mockImplementation((...args) => {
      if (path.resolve(String(args[0])) === base) throw failure;
      return Reflect.apply(original, fs, args);
    });
    await expect(buildCodeGraph(root)).rejects.toThrow(/EACCES: config base cannot be read/);
  });

  it("reports invalid/circular configuration and recovers after correction", async () => {
    project({ "tsconfig.json": { extends: "./base.json" }, "base.json": { extends: "./tsconfig.json" }, "main.ts": 'import "missing";' });
    await expect(buildCodeGraph(root)).rejects.toThrow(/circularity/i);
    write("tsconfig.json", "{ invalid");
    await expect(buildCodeGraph(root)).rejects.toThrow(/TypeScript configuration/);
    write("tsconfig.json", { compilerOptions: { moduleResolution: "invalid-mode" } });
    await expect(buildCodeGraph(root)).rejects.toThrow(/moduleResolution/);
    write("tsconfig.json", {});
    expect(dependencies(await buildCodeGraph(root), "main.ts")).toEqual([]);
  });

  it("does not bypass the most specific paths entry after its target is missing", async () => {
    project({
      "tsconfig.json": { compilerOptions: { paths: { "@/*": ["fallback/*"], "@/specific/*": ["missing/*"] } } },
      "main.ts": 'import "@/specific/util";',
      "fallback/specific/util.ts": "export {};",
    });
    expect(dependencies(await buildCodeGraph(root), "main.ts")).toEqual([]);
  });

  it("uses require conditions for TypeScript import assignments", async () => {
    project({
      "package.json": { workspaces: ["packages/*"] },
      "tsconfig.json": { compilerOptions: { moduleResolution: "bundler", module: "preserve" } },
      "main.ts": 'import db = require("dual");',
      "packages/dual/package.json": { name: "dual", exports: { import: "./esm.ts", require: "./cjs.ts" } },
      "packages/dual/esm.ts": "export {};", "packages/dual/cjs.ts": "export {};",
    });
    expect(dependencies(await buildCodeGraph(root), "main.ts")).toEqual(["packages/dual/cjs.ts"]);
  });

  it("preserves usable aliases with TypeScript 6 compiler-only options", async () => {
    project({
      // https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html#the---stabletypeordering-flag
      "tsconfig.json": { compilerOptions: { stableTypeOrdering: true, target: "es2025", lib: ["es2025"], paths: { "@/*": ["src/*"] } } },
      "main.ts": 'import "@/util";', "src/util.ts": "export {};",
    });
    expect(dependencies(await buildCodeGraph(root), "main.ts")).toEqual(["src/util.ts"]);
  });

  it("identifies malformed package manifests without suppressing the parse failure", async () => {
    project({
      "package.json": { workspaces: ["packages/*"] },
      "main.ts": 'import "broken";',
      "packages/broken/package.json": "{ invalid",
      "packages/broken/index.ts": "export {};",
    });
    await expect(buildCodeGraph(root)).rejects.toThrow(/Invalid package manifest.*packages[/\\]broken[/\\]package\.json/);
  });
});
