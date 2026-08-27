// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildCodeGraph, ensureDynamicLanguages } from "../../src/services/code-graph.js";
import { ensureElixirTemplateParsers } from "../../src/services/elixir-templates.js";
import { extractImports } from "../../src/services/graph-imports.js";
import { resolveCallSites } from "../../src/services/graph-symbol-resolution.js";
import { extractSymbolsAndCalls } from "../../src/services/graph-symbols.js";
import { chunkFileContent } from "../../src/services/indexer.js";

beforeAll(async () => {
  ensureDynamicLanguages();
  expect(await ensureElixirTemplateParsers()).toBe(true);
});

describe("Elixir templates", () => {
  let root: string | undefined;

  afterEach(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  it("extracts only real HEEx expressions and remote component dependencies", () => {
    const source = `<p>Call support() if this fails.</p>
<button onclick="save()">Save</button>
<%# cleanup() %>
<.button disabled={busy?()}>{@label}</.button>
<MyApp.Components.card item={load_item(@id)} />`;
    const calls = extractSymbolsAndCalls(source, "elixir-template", ".heex", "view.heex")
      .rawCalls.map((call) => call.calleeName);

    expect(calls.sort()).toEqual(["busy?", "load_item"]);
    expect(extractImports(source, "elixir-template", ".heex").map((item) => item.moduleSpecifier))
      .toEqual(["MyApp.Components"]);
  });

  it("combines EEx blocks, ignores markup/comments, and supports LEEx when valid", () => {
    const eex = `<p>support()</p>
<%# cleanup() %>
<%= if show?(@user) do %>
  <%= render_user(@user) %>
<% end %>`;
    const eexCalls = extractSymbolsAndCalls(eex, "elixir-template", ".eex", "view.eex")
      .rawCalls.map((call) => call.calleeName).sort();
    expect(eexCalls).toEqual(["render_user", "show?"]);

    const leex = `<%= live_patch "Open", to: Routes.item_path(@socket, :show, @item) %>`;
    const leexCalls = extractSymbolsAndCalls(leex, "elixir-template", ".leex", "view.leex")
      .rawCalls.map((call) => call.calleeName).sort();
    expect(leexCalls).toEqual(["item_path", "live_patch"]);

    const escaped = `<%%= fake() %><%= real() %>`;
    expect(extractSymbolsAndCalls(escaped, "elixir-template", ".eex", "escaped.eex")
      .rawCalls.map((call) => call.calleeName)).toEqual(["real"]);

    expect(extractSymbolsAndCalls("<%= render(", "elixir-template", ".eex", "bad.eex").rawCalls)
      .toEqual([]);
    expect(extractSymbolsAndCalls("<div>{load(@id}</div>", "elixir-template", ".heex", "missing.heex").rawCalls)
      .toEqual([]);
    expect(extractSymbolsAndCalls("<p>😀</p>{load(@id)}", "elixir-template", ".heex", "unicode.heex")
      .rawCalls.map((call) => call.calleeName)).toEqual(["load"]);
  });

  it("uses template AST boundaries for chunking", () => {
    const tag = (name: string) => `<section id="${name}">\n${Array.from({ length: 80 }, (_, i) => `  <p>${i}</p>`).join("\n")}\n</section>`;
    const source = `${tag("one")}\n${tag("two")}`;
    const chunks = chunkFileContent("/tmp/view.heex", "view.heex", source);

    expect(chunks).toHaveLength(2);
    expect(chunks[0].content).toContain('id="one"');
    expect(chunks[1].content).toContain('id="two"');
  });

  it("resolves a remote HEEx component dependency and embedded call", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "socraticode-heex-"));
    fs.mkdirSync(path.join(root, "lib"));
    fs.writeFileSync(path.join(root, "lib/components.ex"), `defmodule MyApp.Components do
  def load(id), do: id
end\n`);
    fs.writeFileSync(path.join(root, "lib/view.heex"), `<MyApp.Components.card item={MyApp.Components.load(@id)} />\n`);

    const graph = await buildCodeGraph(root);
    expect(graph.edges.some((edge) =>
      edge.source === "lib/view.heex" && edge.target === "lib/components.ex"
    )).toBe(true);
    resolveCallSites(graph, graph.symbolsByFile, graph.outgoingCallsByFile);
    const load = graph.outgoingCallsByFile.get("lib/view.heex")?.find((edge) => edge.calleeName === "load");
    expect(load?.confidence).toBe("unique");
    expect(load?.calleeCandidates[0]).toContain("lib/components.ex::MyApp.Components.load");
  });
});
