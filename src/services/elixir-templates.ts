// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

import { fileURLToPath } from "node:url";
import { type Lang, parse, type SgNode } from "@ast-grep/napi";
import type { Node as SyntaxNode, Parser as WebParser } from "web-tree-sitter";
import { ELIXIR_TEMPLATE_EXTENSIONS } from "../constants.js";
import { logger } from "./logger.js";

export interface ElixirTemplateAnalysis {
  /** Template markup masked with whitespace, leaving only real embedded Elixir. */
  elixirSource: string | null;
  moduleReferences: string[];
  regions: Array<{ startLine: number; endLine: number }>;
}

const parsers = new Map<"heex" | "eex", WebParser>();
let initialization: Promise<boolean> | null = null;

export function isElixirTemplateExtension(ext: string): boolean {
  return ELIXIR_TEMPLATE_EXTENSIONS.has(ext.toLowerCase());
}

/** Load the official HEEx/EEx grammars once. Failure keeps the safe line/leaf fallback. */
export function ensureElixirTemplateParsers(): Promise<boolean> {
  if (initialization) return initialization;
  initialization = (async () => {
    try {
      const [{ Language, Parser }, { default: heexWasm }, { default: eexWasm }] = await Promise.all([
        import("web-tree-sitter"),
        import("@lumis-sh/wasm-heex"),
        import("@lumis-sh/wasm-eex"),
      ]);
      await Parser.init();
      for (const [name, wasm] of [["heex", heexWasm], ["eex", eexWasm]] as const) {
        const parser = new Parser();
        parser.setLanguage(await Language.load(fileURLToPath(wasm)));
        parsers.set(name, parser);
      }
      return true;
    } catch (err) {
      logger.warn("HEEx/EEx grammar loading failed; templates will use safe line/leaf fallback", {
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  })();
  return initialization;
}

function parserFor(ext: string): WebParser | null {
  return parsers.get(ext.toLowerCase() === ".heex" ? "heex" : "eex") ?? null;
}

/** ast-grep exposes Tree-sitter MISSING tokens as zero-width, empty leaf nodes. */
function hasMissingNode(node: SgNode): boolean {
  return node.isLeaf() ? node.text() === "" : node.children().some(hasMissingNode);
}

function maskEmbeddedElixir(source: string, nodes: SyntaxNode[]): string | null {
  if (nodes.length === 0) return "";
  const masked: string[] = Array.from({ length: source.length }, (_, i) =>
    source[i] === "\n" || source[i] === "\r" ? source[i] : " "
  );
  const ranges = nodes
    .map((node) => ({ start: node.startIndex, end: node.endIndex }))
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start)
    .filter((range, index, all) => index === 0 || range.start >= all[index - 1].end);

  let previousEnd = -1;
  for (const range of ranges) {
    if (previousEnd >= 0 && !source.slice(previousEnd, range.start).includes("\n")) {
      for (let i = range.start - 1; i >= previousEnd; i--) {
        if (masked[i] === " ") {
          masked[i] = ";"; // separate independent same-line expressions
          break;
        }
      }
    }
    for (let i = range.start; i < range.end; i++) masked[i] = source[i];
    previousEnd = range.end;
  }

  const elixirSource = masked.join("");
  try {
    const root = parse("elixir" as unknown as Lang, elixirSource).root();
    if (root.findAll({ rule: { kind: "ERROR" } }).length > 0 || hasMissingNode(root)) return null;
  } catch {
    return null;
  }
  return elixirSource;
}

/** Parse one template. Invalid template ASTs return null rather than guessed data. */
export function analyzeElixirTemplate(source: string, ext: string): ElixirTemplateAnalysis | null {
  const parser = parserFor(ext);
  if (!parser) return null;
  const tree = parser.parse(source);
  if (!tree) return null;

  try {
    const root = tree.rootNode;
    if (root.hasError) return null;
    const heex = ext.toLowerCase() === ".heex";
    const expressionNodes = root.descendantsOfType(
      heex
        ? ["expression_value", "partial_expression_value", "ending_expression_value"]
        : ["expression", "partial_expression"],
    ).filter((node) => {
      let parent = node.parent;
      while (parent && parent.type !== "directive") parent = parent.parent;
      return !parent?.text.startsWith("<%%");
    });
    const componentNodes = heex
      ? root.descendantsOfType(["start_component", "self_closing_component"])
      : [];
    const moduleReferences = [...new Set(componentNodes.flatMap((node) => {
      const name = node.namedChildren.find((child) => child.type === "component_name");
      const module = name?.namedChildren.find((child) => child.type === "module")?.text;
      return module ? [module] : [];
    }))];
    const regions = root.namedChildren
      .filter((node) => node.type !== "text" && node.type !== "comment")
      .map((node) => ({
        startLine: node.startPosition.row,
        endLine: node.endPosition.row + 1,
      }));

    return {
      elixirSource: maskEmbeddedElixir(source, expressionNodes),
      moduleReferences,
      regions,
    };
  } finally {
    tree.delete();
  }
}
