// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getLanguageFromExtension, SUPPORTED_EXTENSIONS } from "../../src/constants.js";
import { buildCodeGraph, ensureDynamicLanguages, getAstGrepLang } from "../../src/services/code-graph.js";
import { extractImports } from "../../src/services/graph-imports.js";
import { extractSymbolsAndCalls } from "../../src/services/graph-symbols.js";
import { chunkFileContent, isIndexableFile } from "../../src/services/indexer.js";

beforeAll(() => ensureDynamicLanguages());

describe("Elixir support", () => {
  let root: string | undefined;

  afterEach(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  it("indexes .ex and .exs files with the Elixir grammar", () => {
    for (const ext of [".ex", ".exs"]) {
      expect(SUPPORTED_EXTENSIONS.has(ext)).toBe(true);
      expect(isIndexableFile(`app${ext}`)).toBe(true);
      expect(getLanguageFromExtension(ext)).toBe("elixir");
      expect(getAstGrepLang(ext)).toBe("elixir");
    }
  });

  it("extracts Elixir module directives, including grouped aliases", () => {
    const imports = extractImports(`
      alias MyApp.{Repo, Mailer}
      import MyApp.Helpers
      require MyApp.Logger
      use MyApp.Worker
    `, "elixir", ".ex");
    expect(imports.map((item) => item.moduleSpecifier).sort()).toEqual([
      "MyApp.Helpers", "MyApp.Logger", "MyApp.Mailer", "MyApp.Repo", "MyApp.Worker",
    ]);
  });

  it("resolves directives to in-project defmodule files", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "socraticode-elixir-"));
    fs.mkdirSync(path.join(root, "lib"));
    fs.writeFileSync(path.join(root, "lib", "caller.ex"), "defmodule App.Caller do\n  alias App.Target\n  use App.Worker\nend\n");
    fs.writeFileSync(path.join(root, "lib", "target.EX"), "defmodule App.Target, do: :ok\n");
    fs.writeFileSync(path.join(root, "lib", "worker.EXS"), "defmodule(App.Worker, do: :ok)\n");

    const graph = await buildCodeGraph(root);
    expect(graph.nodes.find((node) => node.relativePath === "lib/worker.EXS")?.language).toBe("elixir");
    expect(graph.edges.filter((edge) => edge.source === "lib/caller.ex").map((edge) => edge.target).sort())
      .toEqual(["lib/target.EX", "lib/worker.EXS"]);
  });

  it("extracts module and function symbols, calls, and AST chunk boundaries", () => {
    const source = `defmodule App.Worker do
  def run(value) do
    helper(value)
    App.Target.save(value)
  end

  def ready, do: bootstrap()
  defp helper(value), do: value
  defp bootstrap, do: :ok
end
`;
    const result = extractSymbolsAndCalls(source, "elixir", ".ex", "lib/worker.ex");
    expect(result.symbols.map((symbol) => symbol.qualifiedName)).toEqual(expect.arrayContaining([
      "App.Worker", "App.Worker.run", "App.Worker.helper",
    ]));
    expect(result.rawCalls.map((call) => call.calleeName).sort()).toEqual(["bootstrap", "helper", "save"]);
    expect(result.rawCalls.find((call) => call.calleeName === "helper")?.callerId).toContain("App.Worker.run");
    expect(result.rawCalls.find((call) => call.calleeName === "bootstrap")?.callerId).toContain("App.Worker.ready");

    const module = (name: string) => `defmodule App.${name} do\n${Array.from({ length: 60 }, (_, i) => `  # ${i}`).join("\n")}\nend`;
    const content = `${module("One")}\n\n${module("Two")}\n`;
    const chunks = chunkFileContent("/test/app.ex", "app.ex", content);
    const twoLine = content.split("\n").indexOf("defmodule App.Two do") + 1;
    const twoChunk = chunks.find((chunk) => chunk.content.includes("defmodule App.Two do"));
    expect(twoChunk?.startLine).toBe(twoLine - 1);
  });
});
