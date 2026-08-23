// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

/**
 * Per-language symbol & call-site extraction (mirrors `graph-imports.ts`).
 *
 * Populated in Phase B with ast-grep patterns for each language.
 */

import { Lang, parse } from "@ast-grep/napi";
import { getLanguageFromExtension } from "../constants.js";
import type { SymbolEdge, SymbolKind, SymbolNode } from "../types.js";
import { analyzeElixirTemplate, isElixirTemplateExtension } from "./elixir-templates.js";
import { logger } from "./logger.js";

/** Result of extracting symbols + raw call sites from a file. */
export interface ExtractedSymbols {
  symbols: SymbolNode[];
  /** Outgoing call sites — `calleeCandidates` and `confidence` are filled later by resolution. */
  rawCalls: Array<{
    callerId: string;
    calleeName: string;
    callSite: { file: string; line: number };
  }>;
}

/** Build a stable SymbolNode.id. */
function makeId(file: string, qualifiedName: string, line: number): string {
  return `${file}::${qualifiedName}#${line}`;
}

/**
 * Wrapper around `node.findAll({rule:{kind}})` that swallows ast-grep
 * "Invalid Kind" errors. Different language grammars expose different node
 * kinds, so a kind that is valid for Kotlin (`object_declaration`) may be
 * rejected by Java's grammar and abort the entire extraction. Logging is
 * intentionally omitted at debug-level to avoid log spam on every file.
 */
// biome-ignore lint/suspicious/noExplicitAny: ast-grep node type leaks through
function safeFindAll(node: any, kind: string): any[] {
  try {
    return node.findAll({ rule: { kind } });
  } catch {
    return [];
  }
}

/**
 * Single-node counterpart of {@link safeFindAll}. ast-grep REJECTS a kind the
 * grammar does not define — it throws rather than returning null — so a direct
 * `node.find({rule:{kind}})` written with a `?? find(otherKind)` fallback never
 * reaches its fallback on the grammars that need it. The concrete casualty:
 * `.js`/`.jsx`/`.mjs`/`.cjs` all parse with the JavaScript grammar, which has
 * no `type_identifier`, so one `class` in a plain-JS file aborted the whole
 * extraction and the file contributed a bare module symbol and zero calls.
 * Returning null keeps every existing fallback chain meaningful.
 */
// biome-ignore lint/suspicious/noExplicitAny: ast-grep node type leaks through
function safeFind(node: any, kind: string): any | null {
  if (!node) return null;
  try {
    return node.find({ rule: { kind } }) ?? null;
  } catch {
    return null;
  }
}

interface ScopeFrame {
  name: string;
  /** Line at which this scope begins (used to limit call-site attribution). */
  startLine: number;
  endLine: number;
  symbolId: string;
}

/**
 * Per-language dedupe set for symbol-extraction failures. Without this, a
 * missing PHP grammar would emit one warn per file (potentially hundreds).
 * We log the first failure per language at warn level (with the underlying
 * error attached) and silently skip subsequent failures.
 */
const symbolExtractionWarned = new Set<string>();

/**
 * Warn-once flag for Dart files the bundled grammar cannot fully parse. The
 * `@ast-grep/lang-dart` grammar predates Dart 3, so files using Dart 3 class
 * modifiers (sealed/base/interface/final/mixin class) or extension types
 * produce ERROR nodes and lose symbols. We surface this once per process at
 * warn level (per-file detail goes to debug) so the failure is not silent,
 * without spamming one warn per affected file on large Flutter projects.
 */
let dartParseErrorWarned = false;

/**
 * Reset the per-language dedupe set. Intended for tests that want to assert
 * deterministically on extraction warnings.
 */
export function resetSymbolExtractionWarnings(): void {
  symbolExtractionWarned.clear();
  dartParseErrorWarned = false;
}

/** Find the deepest scope frame covering a line. */
function findCallerId(scopes: ScopeFrame[], line: number, fallback: string): string {
  let best: ScopeFrame | null = null;
  for (const s of scopes) {
    if (line >= s.startLine && line <= s.endLine) {
      if (!best || s.startLine >= best.startLine) best = s;
    }
  }
  return best ? best.symbolId : fallback;
}

/**
 * Public entry point: extract symbols and raw call sites from a source file.
 * Returns empty arrays if the language is unsupported or parsing fails.
 */
export function extractSymbolsAndCalls(
  source: string,
  lang: Lang | string,
  ext: string,
  relativePath: string,
): ExtractedSymbols {
  const language = getLanguageFromExtension(ext);
  const langKey = String(lang);

  // Per-file synthetic "module" scope so unattributed calls have a caller.
  const moduleSymbol: SymbolNode = {
    id: makeId(relativePath, "<module>", 1),
    name: "<module>",
    qualifiedName: "<module>",
    kind: "module",
    file: relativePath,
    line: 1,
    endLine: source.split("\n").length,
    language,
  };

  try {
    if (isElixirTemplateExtension(ext)) {
      return extractFromElixirTemplate(source, ext, relativePath, moduleSymbol);
    }
    if (
      langKey === Lang.JavaScript ||
      langKey === Lang.TypeScript ||
      langKey === Lang.Tsx
    ) {
      return extractFromTsLike(source, lang as Lang, relativePath, language, moduleSymbol);
    }
    if (langKey === "python") {
      return extractFromPython(source, relativePath, language, moduleSymbol);
    }
    if (langKey === "go") {
      return extractFromGo(source, relativePath, language, moduleSymbol);
    }
    if (langKey === "rust") {
      return extractFromRust(source, relativePath, language, moduleSymbol);
    }
    if (langKey === "java" || langKey === "kotlin" || langKey === "scala") {
      return extractFromJvm(source, lang as string, relativePath, language, moduleSymbol);
    }
    if (langKey === "csharp") {
      return extractFromCSharp(source, relativePath, language, moduleSymbol);
    }
    if (langKey === "c" || langKey === "cpp") {
      return extractFromCFamily(source, lang as string, relativePath, language, moduleSymbol);
    }
    if (langKey === "ruby") {
      return extractFromRuby(source, relativePath, language, moduleSymbol);
    }
    if (langKey === "php") {
      return extractFromPhp(source, relativePath, language, moduleSymbol);
    }
    if (langKey === "swift") {
      return extractFromSwift(source, relativePath, language, moduleSymbol);
    }
    if (langKey === "bash") {
      return extractFromBash(source, relativePath, language, moduleSymbol);
    }
    if (langKey === "lua") {
      return extractFromLua(source, relativePath, language, moduleSymbol);
    }
    if (langKey === "dart") {
      return extractFromDart(source, relativePath, language, moduleSymbol);
    }
    if (langKey === "elixir") {
      return extractFromElixir(source, relativePath, language, moduleSymbol);
    }
    // Svelte, Vue and others fall through to the regex fallback.
    return extractFromRegex(source, relativePath, language, moduleSymbol);
  } catch (err) {
    if (!symbolExtractionWarned.has(langKey)) {
      symbolExtractionWarned.add(langKey);
      logger.warn(
        "Symbol extraction failed for language; subsequent failures will be suppressed for this language",
        {
          lang: langKey,
          file: relativePath,
          error: err instanceof Error ? err.message : String(err),
        },
      );
    }
    return { symbols: [moduleSymbol], rawCalls: [] };
  }
}

// ── Elixir ───────────────────────────────────────────────────────────────

function extractFromElixir(
  source: string,
  file: string,
  language: string,
  moduleSym: SymbolNode,
): ExtractedSymbols {
  const root = parse("elixir" as unknown as Lang, source).root();
  const symbols: SymbolNode[] = [moduleSym];
  const scopes: ScopeFrame[] = [];
  // biome-ignore lint/suspicious/noExplicitAny: ast-grep node type leaks through
  const childrenOf = (node: any): any[] => {
    try {
      return node.children();
    } catch {
      return [];
    }
  };
  // biome-ignore lint/suspicious/noExplicitAny: ast-grep node type leaks through
  const targetOf = (node: any): any | null => {
    try {
      return node.field("target") ?? null;
    } catch {
      return null;
    }
  };
  // biome-ignore lint/suspicious/noExplicitAny: ast-grep node type leaks through
  const targetName = (node: any): string | null => {
    const target = targetOf(node);
    return target?.kind() === "identifier" ? target.text() : null;
  };
  // biome-ignore lint/suspicious/noExplicitAny: ast-grep node type leaks through
  const calleeName = (node: any): string | null => {
    const target = targetOf(node);
    if (target?.kind() === "identifier") return target.text();
    if (target?.kind() !== "dot") return null;
    const children = childrenOf(target);
    if (children[0]?.kind() !== "alias") return null;
    return [...children].reverse().find((child) => child.kind() === "identifier")?.text() ?? null;
  };
  // biome-ignore lint/suspicious/noExplicitAny: ast-grep node type leaks through
  const nodeKey = (node: any): string => {
    const range = node.range();
    return `${range.start.line}:${range.start.column}:${range.end.line}:${range.end.column}`;
  };
  const addSymbol = (
    name: string,
    qualifiedName: string,
    kind: SymbolKind,
    startLine: number,
    endLine: number,
  ): void => {
    const symbol: SymbolNode = {
      id: makeId(file, qualifiedName, startLine),
      name, qualifiedName, kind, file, line: startLine, endLine, language,
    };
    symbols.push(symbol);
    scopes.push({ name: qualifiedName, startLine, endLine, symbolId: symbol.id });
  };

  const calls = safeFindAll(root, "call");
  const modules: Array<{ name: string; startLine: number; endLine: number }> = [];
  for (const node of calls) {
    if (targetName(node) !== "defmodule") continue;
    const args = childrenOf(node).find((child) => child.kind() === "arguments");
    const rawName = args ? safeFindAll(args, "alias")[0]?.text() : null;
    if (!rawName) continue;
    const range = node.range();
    const startLine = range.start.line + 1;
    const endLine = range.end.line + 1;
    const owner = modules
      .filter((module) => startLine >= module.startLine && endLine <= module.endLine)
      .sort((a, b) => b.startLine - a.startLine)[0];
    const name = owner && !rawName.includes(".") ? `${owner.name}.${rawName}` : rawName;
    addSymbol(name, name, "module", startLine, endLine);
    modules.push({ name, startLine, endLine });
  }

  for (const node of calls) {
    const visibility = targetName(node);
    if (visibility !== "def" && visibility !== "defp") continue;
    const name = node.text().match(/^(?:def|defp)\s+([a-z_]\w*[!?]?)/)?.[1];
    if (!name) continue;
    const range = node.range();
    const startLine = range.start.line + 1;
    const endLine = range.end.line + 1;
    const owner = modules
      .filter((module) => startLine >= module.startLine && endLine <= module.endLine)
      .sort((a, b) => b.startLine - a.startLine)[0];
    addSymbol(name, owner ? `${owner.name}.${name}` : name, "function", startLine, endLine);
  }

  const definitionMacros = new Set([
    "def", "defp", "defmodule", "defstruct", "defguard", "defguardp", "defmacro", "defmacrop",
    "defdelegate", "defprotocol", "defimpl",
  ]);
  const definitionsWithHeads = new Set([
    "def", "defp", "defguard", "defguardp", "defmacro", "defmacrop", "defdelegate",
  ]);
  const definitionHeads = new Set<string>();
  for (const node of calls) {
    if (!definitionsWithHeads.has(targetName(node) ?? "")) continue;
    const args = childrenOf(node).find((child) => child.kind() === "arguments");
    const firstArgument = args ? childrenOf(args)[0] : null;
    const head = firstArgument?.kind() === "binary_operator" ? firstArgument.field("left") : firstArgument;
    if (head?.kind() === "call") definitionHeads.add(nodeKey(head));
  }

  const ignoredCalls = new Set([
    ...definitionMacros,
    "alias", "import", "require", "use",
    "if", "unless", "for", "with", "case", "cond", "receive", "try", "quote", "unquote",
  ]);
  const rawCalls: ExtractedSymbols["rawCalls"] = [];
  for (const node of calls) {
    const name = calleeName(node);
    if (
      !name ||
      ignoredCalls.has(name) ||
      definitionHeads.has(nodeKey(node)) ||
      node.parent()?.kind() === "unary_operator"
    ) continue;
    const line = node.range().start.line + 1;
    rawCalls.push({
      callerId: findCallerId(scopes, line, moduleSym.id),
      calleeName: name,
      callSite: { file, line },
    });
  }

  return { symbols, rawCalls };
}

function extractFromElixirTemplate(
  source: string,
  ext: string,
  file: string,
  moduleSym: SymbolNode,
): ExtractedSymbols {
  const analysis = analyzeElixirTemplate(source, ext);
  if (!analysis) {
    logger.debug("Invalid HEEx/EEx template AST; skipping symbols and calls", { file });
    return { symbols: [moduleSym], rawCalls: [] };
  }

  const rawCalls: ExtractedSymbols["rawCalls"] = analysis.elixirSource
    ? extractFromElixir(analysis.elixirSource, file, moduleSym.language, moduleSym).rawCalls
      .map((call) => ({ ...call, callerId: moduleSym.id }))
    : [];
  return { symbols: [moduleSym], rawCalls };
}

// ── Lua (namespace tables: function T.f(), local function f(), T.f = function()) ──

/**
 * Lua has no node-kind-specific extractor upstream and previously fell through
 * to the regex fallback, which records `Mod` for `function Mod.parse()`.
 * This walks the ast-grep Lua tree so namespace-table style (`Table.method`,
 * the common Lua module/OOP idiom) resolves to precise qualified symbols plus
 * their call sites.
 */
function extractFromLua(
  source: string,
  file: string,
  language: string,
  moduleSym: SymbolNode,
): ExtractedSymbols {
  const root = parse("lua" as unknown as Lang, source).root();
  const symbols: SymbolNode[] = [moduleSym];
  const scopes: ScopeFrame[] = [];
  const NAME = new Set(["dot_index_expression", "method_index_expression", "identifier"]);
  const KW = new Set([
    "if", "for", "while", "return", "function", "local", "then", "do", "end",
    "and", "or", "not", "elseif", "else", "in", "repeat", "until", "nil", "true", "false",
  ]);
  // biome-ignore lint/suspicious/noExplicitAny: ast-grep node type leaks through
  const kidsOf = (n: any): any[] => {
    try {
      return n.children();
    } catch {
      return [];
    }
  };
  const shortName = (qn: string): string => {
    const parts = qn.split(/[.:]/);
    return parts[parts.length - 1];
  };
  // biome-ignore lint/suspicious/noExplicitAny: ast-grep node type leaks through
  const addSym = (nameNode: any, rangeNode: any): void => {
    const qn = nameNode.text().replace(/\s+/g, "");
    if (!/^[A-Za-z_][\w]*([.:][A-Za-z_][\w]*)*$/.test(qn)) return;
    const range = rangeNode.range();
    const startLine = range.start.line + 1;
    const endLine = range.end.line + 1;
    const sym: SymbolNode = {
      id: makeId(file, qn, startLine),
      name: shortName(qn),
      qualifiedName: qn,
      kind: /[.:]/.test(qn) ? "method" : "function",
      file,
      line: startLine,
      endLine,
      language,
    };
    symbols.push(sym);
    scopes.push({ name: qn, startLine, endLine, symbolId: sym.id });
  };

  // `function T.f()`, `function T:m()`, `function f()`, `local function f()` —
  // the name is the DIRECT child before `parameters`, not a body expression.
  for (const fn of safeFindAll(root, "function_declaration")) {
    const kids = kidsOf(fn);
    // biome-ignore lint/suspicious/noExplicitAny: ast-grep node type leaks through
    const pIdx = kids.findIndex((c: any) => c.kind() === "parameters");
    const limit = pIdx < 0 ? kids.length : pIdx;
    // biome-ignore lint/suspicious/noExplicitAny: ast-grep node type leaks through
    let nameNode: any = null;
    for (let i = 0; i < limit; i++) {
      if (NAME.has(kids[i].kind())) {
        nameNode = kids[i];
        break;
      }
    }
    if (nameNode) addSym(nameNode, fn);
  }

  // `T.f = function() … end` / `local f = function() … end` — the RHS must be
  // DIRECTLY a function_definition (don't match nested anonymous functions).
  for (const assign of safeFindAll(root, "assignment_statement")) {
    const kids = kidsOf(assign);
    // biome-ignore lint/suspicious/noExplicitAny: ast-grep node type leaks through
    const rhs = kids.find((c: any) => c.kind() === "expression_list");
    if (!rhs) continue;
    const rhs0 = kidsOf(rhs)[0];
    if (rhs0?.kind() !== "function_definition") continue;
    // biome-ignore lint/suspicious/noExplicitAny: ast-grep node type leaks through
    const vl = kids.find((c: any) => c.kind() === "variable_list");
    const nameNode = vl ? kidsOf(vl)[0] : null;
    if (nameNode && NAME.has(nameNode.kind())) addSym(nameNode, assign);
  }

  // Calls — attribute each to its enclosing function scope (or <module>).
  const rawCalls: ExtractedSymbols["rawCalls"] = [];
  for (const call of safeFindAll(root, "function_call")) {
    const fnExpr = kidsOf(call)[0];
    if (!fnExpr) continue;
    const ids = safeFindAll(fnExpr, "identifier");
    const callee =
      ids.length > 0
        ? ids[ids.length - 1].text()
        : fnExpr.kind() === "identifier"
          ? fnExpr.text()
          : null;
    if (!callee || KW.has(callee)) continue;
    const line = call.range().start.line + 1;
    rawCalls.push({
      callerId: findCallerId(scopes, line, moduleSym.id),
      calleeName: callee,
      callSite: { file, line },
    });
  }

  return { symbols, rawCalls };
}

// ── Dart (type-first signatures, sibling signature/body pairs, selector calls) ──

/**
 * Dart previously fell through to the regex fallback, which cannot match
 * type-first signatures (`void foo()`, `Future<int> baz() async`), so
 * classes, methods, and call sites were invisible to the symbol graph.
 * This walks the ast-grep Dart tree instead. Grammar quirks handled here:
 * class/mixin/enum/extension nodes span their bodies, but a function is a
 * `function_signature` followed by a SIBLING `function_body`, so scope
 * ranges are stitched from each pair; plain constructors live inside a
 * generic `declaration` wrapper; and there is no call_expression kind, so
 * calls are recovered from `argument_part` nodes (callee = the preceding
 * identifier or selector chain, or the `cascade_selector` for `..` calls).
 */
function extractFromDart(
  source: string,
  file: string,
  language: string,
  moduleSym: SymbolNode,
): ExtractedSymbols {
  const root = parse("dart" as unknown as Lang, source).root();
  const symbols: SymbolNode[] = [moduleSym];
  const scopes: ScopeFrame[] = [];

  // Surface (not silently swallow) files the grammar cannot fully parse.
  // ERROR nodes for Dart almost always mean Dart 3 syntax the bundled grammar
  // predates; the affected declarations lose their symbols. Per-file detail at
  // debug, a single warn per process so big Flutter repos are not spammed.
  const parseErrors = safeFindAll(root, "ERROR").length;
  if (parseErrors > 0) {
    logger.debug("Dart file has parse errors; some symbols skipped (likely Dart 3 syntax unsupported by the grammar)", {
      file,
      parseErrors,
    });
    if (!dartParseErrorWarned) {
      dartParseErrorWarned = true;
      logger.warn(
        "Some Dart files use syntax the bundled grammar (@ast-grep/lang-dart) cannot parse — likely Dart 3 class modifiers (sealed/base/interface/final/mixin class) or extension types. Symbols in those regions are skipped until the upstream grammar is updated.",
      );
    }
  }

  // biome-ignore lint/suspicious/noExplicitAny: ast-grep node type leaks through
  const kidsOf = (n: any): any[] => {
    try {
      return n.children();
    } catch {
      return [];
    }
  };
  // biome-ignore lint/suspicious/noExplicitAny: ast-grep node type leaks through
  const childOfKind = (n: any, kind: string): any | null =>
    // biome-ignore lint/suspicious/noExplicitAny: ast-grep node type leaks through
    kidsOf(n).find((c: any) => c.kind() === kind) ?? null;
  // Direct identifier children only — the name slot. Type annotations are
  // `type_identifier`/`void_type` and parameter names are nested deeper, so
  // they never appear here.
  // biome-ignore lint/suspicious/noExplicitAny: ast-grep node type leaks through
  const idChildren = (n: any): any[] =>
    // biome-ignore lint/suspicious/noExplicitAny: ast-grep node type leaks through
    kidsOf(n).filter((c: any) => c.kind() === "identifier");

  // Operators are not named by an identifier: the name is the token after the
  // `operator` keyword (e.g. `+`, `==`, `[]`). Build "operator<tok>" so the
  // symbol is `Owner.operator+` etc. Returns null when the shape is unexpected.
  // biome-ignore lint/suspicious/noExplicitAny: ast-grep node type leaks through
  const operatorName = (sig: any): string | null => {
    const kids = kidsOf(sig);
    // biome-ignore lint/suspicious/noExplicitAny: ast-grep node type leaks through
    const opIdx = kids.findIndex((c: any) => c.kind() === "operator");
    if (opIdx < 0 || opIdx + 1 >= kids.length) return null;
    const tok = kids[opIdx + 1].text().replace(/\s+/g, "");
    return tok ? `operator${tok}` : null;
  };

  const addSym = (
    name: string,
    qualifiedName: string,
    kind: SymbolKind,
    startLine: number,
    endLine: number,
  ): void => {
    const sym: SymbolNode = {
      id: makeId(file, qualifiedName, startLine),
      name,
      qualifiedName,
      kind,
      file,
      line: startLine,
      endLine,
      language,
    };
    symbols.push(sym);
    scopes.push({ name: qualifiedName, startLine, endLine, symbolId: sym.id });
  };

  // biome-ignore lint/suspicious/noExplicitAny: ast-grep node type leaks through
  const lineOf = (n: any): number => n.range().start.line + 1;
  // biome-ignore lint/suspicious/noExplicitAny: ast-grep node type leaks through
  const endLineOf = (n: any): number => n.range().end.line + 1;

  /**
   * Emit the member symbols of a class-like body. Members come in ordered
   * sibling pairs: a `method_signature` (wrapping function / getter / setter /
   * operator / factory signatures) or a `declaration` (a plain constructor, an
   * abstract bodyless member, or a field), optionally followed by its
   * `function_body`. Bodyless abstract members and operators live under
   * `declaration`; fields are skipped.
   */
  // biome-ignore lint/suspicious/noExplicitAny: ast-grep node type leaks through
  const walkMembers = (bodyNode: any, owner: string): void => {
    const members = kidsOf(bodyNode);
    for (let i = 0; i < members.length; i++) {
      const member = members[i];
      const memberKind = member.kind();
      const next = members[i + 1];
      const scopeEnd = next && next.kind() === "function_body" ? endLineOf(next) : endLineOf(member);

      if (memberKind === "method_signature") {
        const inner = kidsOf(member)[0];
        if (!inner) continue;
        const innerKind = inner.kind();
        if (innerKind === "factory_constructor_signature") {
          const ids = idChildren(inner);
          if (ids.length === 0) continue;
          // biome-ignore lint/suspicious/noExplicitAny: ast-grep node type leaks through
          const qn = ids.map((c: any) => c.text()).join(".");
          addSym(ids[ids.length - 1].text(), qn, "constructor", lineOf(member), scopeEnd);
        } else if (innerKind === "operator_signature") {
          // `T operator +(T o) { ... }` — operators are not named by an identifier.
          const name = operatorName(inner);
          if (!name) continue;
          addSym(name, `${owner}.${name}`, "method", lineOf(member), scopeEnd);
        } else if (
          innerKind === "function_signature" ||
          innerKind === "getter_signature" ||
          innerKind === "setter_signature"
        ) {
          const ids = idChildren(inner);
          if (ids.length === 0) continue;
          const name = ids[ids.length - 1].text();
          addSym(name, `${owner}.${name}`, "method", lineOf(member), scopeEnd);
        }
      } else if (memberKind === "declaration") {
        // A `declaration` member is one of:
        //   - a plain/named constructor:     `constructor_signature`
        //   - an abstract (bodyless) member:  `function_signature` /
        //     `getter_signature` / `setter_signature` / `operator_signature`
        //     (e.g. `void foo();`, `int get x;`, `set y(int v);`, `T operator +(T o);`)
        //   - a field (type + initializer, no signature child): skipped
        const ctor = childOfKind(member, "constructor_signature");
        if (ctor) {
          const ids = idChildren(ctor);
          if (ids.length === 0) continue;
          // biome-ignore lint/suspicious/noExplicitAny: ast-grep node type leaks through
          const qn = ids.map((c: any) => c.text()).join(".");
          addSym(ids[ids.length - 1].text(), qn, "constructor", lineOf(member), scopeEnd);
          continue;
        }
        const sig =
          childOfKind(member, "function_signature") ??
          childOfKind(member, "getter_signature") ??
          childOfKind(member, "setter_signature") ??
          childOfKind(member, "operator_signature");
        if (!sig) continue; // field or unrecognized shape — skip, as before
        const name =
          sig.kind() === "operator_signature"
            ? operatorName(sig)
            : (idChildren(sig).at(-1)?.text() ?? null);
        if (!name) continue;
        addSym(name, `${owner}.${name}`, "method", lineOf(member), scopeEnd);
      }
    }
  };

  // ── Top-level declarations (ordered walk so signature/body pairs line up) ──
  // Dart 3 class modifiers (`sealed` / `base` / `interface` / `final` /
  // `mixin class`) and `extension type` are NOT handled: the vendored grammar
  // (@ast-grep/lang-dart 0.0.7, latest published) predates them and parses
  // them to ERROR nodes (no `sealed_class_declaration` /
  // `extension_type_declaration` kinds exist). The affected declaration is
  // dropped, and depending on parser recovery it can also drop following
  // sibling classes; the rest of the file still extracts. The ERROR count is
  // surfaced via the warn above. Revisit when the upstream grammar updates.
  const topLevel = kidsOf(root);
  for (let i = 0; i < topLevel.length; i++) {
    const node = topLevel[i];
    const nodeKind = node.kind();

    if (nodeKind === "class_definition" || nodeKind === "mixin_declaration" || nodeKind === "extension_declaration") {
      const nameNode = childOfKind(node, "identifier");
      if (!nameNode) continue;
      const name = nameNode.text();
      const kind: SymbolKind = nodeKind === "mixin_declaration" ? "trait" : "class";
      addSym(name, name, kind, lineOf(node), endLineOf(node));
      const body = childOfKind(node, "class_body") ?? childOfKind(node, "extension_body");
      if (body) walkMembers(body, name);
    } else if (nodeKind === "enum_declaration") {
      const nameNode = childOfKind(node, "identifier");
      if (nameNode) addSym(nameNode.text(), nameNode.text(), "enum", lineOf(node), endLineOf(node));
    } else if (nodeKind === "type_alias") {
      const nameNode = childOfKind(node, "type_identifier");
      if (nameNode) addSym(nameNode.text(), nameNode.text(), "interface", lineOf(node), endLineOf(node));
    } else if (nodeKind === "function_signature" || nodeKind === "getter_signature" || nodeKind === "setter_signature") {
      const ids = idChildren(node);
      if (ids.length === 0) continue;
      const name = ids[ids.length - 1].text();
      const next = topLevel[i + 1];
      const scopeEnd = next && next.kind() === "function_body" ? endLineOf(next) : endLineOf(node);
      addSym(name, name, "function", lineOf(node), scopeEnd);
    }
  }

  // ── Calls — every invocation wraps an `argument_part` node ──────────────
  const rawCalls: ExtractedSymbols["rawCalls"] = [];
  for (const ap of safeFindAll(root, "argument_part")) {
    const holder = ap.parent();
    if (!holder) continue;
    const holderKind = holder.kind();
    let callee: string | null = null;

    if (holderKind === "cascade_section") {
      // `obj..method(args)` — the callee lives in the cascade_selector.
      const cs = childOfKind(holder, "cascade_selector");
      const id = cs ? childOfKind(cs, "identifier") : null;
      callee = id ? id.text() : null;
    } else if (holderKind === "selector") {
      // `name(args)` / `expr.name(args)` — the callee is the previous
      // sibling: a bare identifier, or a selector whose trailing identifier
      // is the method name (`f.bar(…)`, `mat.runApp(…)`, `Foo.create(…)`).
      const parent = holder.parent();
      if (!parent) continue;
      const siblings = kidsOf(parent);
      const hr = holder.range();
      const idx = siblings.findIndex(
        // biome-ignore lint/suspicious/noExplicitAny: ast-grep node type leaks through
        (c: any) => {
          if (c.kind() !== "selector") return false;
          const r = c.range();
          return (
            r.start.line === hr.start.line &&
            r.start.column === hr.start.column &&
            r.end.line === hr.end.line &&
            r.end.column === hr.end.column
          );
        },
      );
      if (idx <= 0) continue;
      const prev = siblings[idx - 1];
      if (prev.kind() === "identifier") {
        callee = prev.text();
      } else if (prev.kind() === "selector") {
        const ids = safeFindAll(prev, "identifier");
        callee = ids.length > 0 ? ids[ids.length - 1].text() : null;
      }
    }

    if (!callee) continue;
    const line = ap.range().start.line + 1;
    rawCalls.push({
      callerId: findCallerId(scopes, line, moduleSym.id),
      calleeName: callee,
      callSite: { file, line },
    });
  }

  return { symbols, rawCalls };
}

// ── JS / TS / TSX ────────────────────────────────────────────────────────

function extractFromTsLike(
  source: string,
  lang: Lang,
  file: string,
  language: string,
  moduleSym: SymbolNode,
): ExtractedSymbols {
  const root = parse(lang, source).root();
  const symbols: SymbolNode[] = [moduleSym];
  const scopes: ScopeFrame[] = [];

  // Class declarations
  for (const node of safeFindAll(root, "class_declaration")) {
    // The name FIELD, not a subtree search: safeFind's recursive DFS reaches a
    // decorator's identifier before the class's own name, so `@sealed class X`
    // would extract as a class named `sealed` and collide with the real
    // decorator function at resolution time. The field is grammar-precise on
    // JS (identifier) and TS/TSX (type_identifier) alike; the searches remain
    // only as a belt for grammars without the field.
    const nameNode = node.field("name")
      ?? safeFind(node, "type_identifier")
      ?? safeFind(node, "identifier");
    if (!nameNode) continue;
    const name = nameNode.text();
    const range = node.range();
    const startLine = range.start.line + 1;
    const endLine = range.end.line + 1;
    const sym: SymbolNode = {
      id: makeId(file, name, startLine),
      name, qualifiedName: name, kind: "class", file, line: startLine, endLine, language,
    };
    symbols.push(sym);
    scopes.push({ name, startLine, endLine, symbolId: sym.id });

    // Methods inside the class — DIRECT children of the class body only. A
    // recursive scan fabricates phantom methods: an object-literal shorthand
    // handler inside a field initializer or a call argument, or a nested
    // class's methods, would all be stamped onto THIS class and persisted into
    // the name index, corrupting name-based resolution and impact seeds.
    const body = node.field("body");
    // biome-ignore lint/suspicious/noExplicitAny: ast-grep node type leaks through
    let members: any[] = [];
    try {
      // biome-ignore lint/suspicious/noExplicitAny: ast-grep node type leaks through
      members = body ? body.children().filter((c: any) => c.kind() === "method_definition") : [];
    } catch {
      members = [];
    }
    for (const m of members) {
      // Name from the field, accepting only a literal property name: a
      // computed name like `[Symbol.iterator]` has no static identity, and
      // searching inside it used to persist a method that does not exist.
      const mNameNode = m.field("name");
      const mName = mNameNode?.kind() === "property_identifier" ? mNameNode.text() : null;
      if (!mName) continue;
      const mr = m.range();
      const mStart = mr.start.line + 1;
      const mEnd = mr.end.line + 1;
      const qname = `${name}.${mName}`;
      const msym: SymbolNode = {
        id: makeId(file, qname, mStart),
        name: mName, qualifiedName: qname,
        kind: mName === "constructor" ? "constructor" : "method",
        file, line: mStart, endLine: mEnd, language,
      };
      symbols.push(msym);
      scopes.push({ name: qname, startLine: mStart, endLine: mEnd, symbolId: msym.id });
    }
  }

  // Top-level function declarations
  for (const node of safeFindAll(root, "function_declaration")) {
    const nameNode = safeFind(node, "identifier");
    if (!nameNode) continue;
    const name = nameNode.text();
    const r = node.range();
    const startLine = r.start.line + 1;
    const endLine = r.end.line + 1;
    const sym: SymbolNode = {
      id: makeId(file, name, startLine),
      name, qualifiedName: name, kind: "function", file, line: startLine, endLine, language,
    };
    symbols.push(sym);
    scopes.push({ name, startLine, endLine, symbolId: sym.id });
  }

  // Generator function declarations
  for (const node of safeFindAll(root, "generator_function_declaration")) {
    const nameNode = safeFind(node, "identifier");
    if (!nameNode) continue;
    const name = nameNode.text();
    const r = node.range();
    const startLine = r.start.line + 1;
    const endLine = r.end.line + 1;
    const sym: SymbolNode = {
      id: makeId(file, name, startLine),
      name, qualifiedName: name, kind: "function", file, line: startLine, endLine, language,
    };
    symbols.push(sym);
    scopes.push({ name, startLine, endLine, symbolId: sym.id });
  }

  // Named arrow functions: `const foo = (...) => {...}` or `const foo = function(...) {...}`
  for (const node of safeFindAll(root, "lexical_declaration")) {
    for (const decl of safeFindAll(node, "variable_declarator")) {
      const idNode = safeFind(decl, "identifier");
      if (!idNode) continue;
      const name = idNode.text();
      const arrow = safeFind(decl, "arrow_function");
      const fnExpr = safeFind(decl, "function_expression");
      const fn = arrow ?? fnExpr;
      if (!fn) continue;
      const r = fn.range();
      const startLine = r.start.line + 1;
      const endLine = r.end.line + 1;
      const sym: SymbolNode = {
        id: makeId(file, name, startLine),
        name, qualifiedName: name, kind: "function", file, line: startLine, endLine, language,
      };
      symbols.push(sym);
      scopes.push({ name, startLine, endLine, symbolId: sym.id });
    }
  }

  // Call sites
  const rawCalls: ExtractedSymbols["rawCalls"] = [];
  for (const node of safeFindAll(root, "call_expression")) {
    const calleeName = extractCalleeNameJs(node.text());
    if (!calleeName) continue;
    const r = node.range();
    const callLine = r.start.line + 1;
    const callerId = findCallerId(scopes, callLine, moduleSym.id);
    rawCalls.push({
      callerId, calleeName,
      callSite: { file, line: callLine },
    });
  }
  return { symbols, rawCalls };
}

/** Pull the callee's bare name from the start of a call expression's text. */
function extractCalleeNameJs(text: string): string | null {
  // `foo(...)` → "foo"  ;  `obj.foo(...)` → "foo"  ;  `obj.bar.foo(...)` → "foo"
  const m = text.match(/^([\w$.]+)\s*\(/);
  if (!m) return null;
  const chain = m[1];
  const parts = chain.split(".");
  const last = parts[parts.length - 1];
  return /^[A-Za-z_$][\w$]*$/.test(last) ? last : null;
}

/**
 * Callee name for a PHP call expression.
 *
 * PHP separates a callee from its receiver with `::` (static) or `->`
 * (instance), neither of which appears in the JS chain pattern `[\w$.]+`.
 * Running PHP calls through `extractCalleeNameJs` therefore returned null for
 * every method and static call — the match stopped dead at the `:` of
 * `Cls::method(` or the `-` of `$obj->method(` — so only bare
 * `function_call_expression` nodes survived, which in practice means stdlib
 * calls. Every cross-file PHP call edge was dropped, leaving `codebase_impact`
 * and `codebase_symbol` reporting no callers for code with many.
 *
 * The callee is the identifier before *this* call's own argument list, which is
 * the last top-level parenthesis group in the node's text. Taking the first `(`
 * instead names the wrong method on a fluent chain: ast-grep reports one node
 * per link, and each node's text starts at the head of the chain, so
 * `Model::where('x')->orderBy('y')->get()` would yield `where` three times
 * rather than `where`, `orderBy`, `get`.
 *
 * Quoted sections are skipped so a parenthesis inside a string literal —
 * `where('a)b')` — cannot unbalance the scan.
 *
 *   foo(…)                                 → "foo"
 *   Cls::make(…)                           → "make"
 *   $this->svc->blacklist(…)               → "blacklist"
 *   Acme\Support\Cls::of(…)                → "of"
 *   Model::where(…)->orderBy(…)->get()     → "get"   (outermost node)
 */
function extractCalleeNamePhp(text: string): string | null {
  let depth = 0;
  let quote: string | null = null;
  let lastTopLevelOpen = -1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (quote !== null) {
      if (ch === "\\") i++; // escaped char — consume the pair
      else if (ch === quote) quote = null;
      continue;
    }

    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === "(") {
      if (depth === 0) lastTopLevelOpen = i;
      depth++;
    } else if (ch === ")") {
      depth--;
    }
  }

  if (lastTopLevelOpen <= 0) return null;
  const receiver = text.slice(0, lastTopLevelOpen).trimEnd();
  const m = receiver.match(/([A-Za-z_]\w*)$/);
  return m ? m[1] : null;
}

// ── Python ───────────────────────────────────────────────────────────────

function extractFromPython(
  source: string,
  file: string,
  language: string,
  moduleSym: SymbolNode,
): ExtractedSymbols {
  const root = parse("python" as unknown as Lang, source).root();
  const symbols: SymbolNode[] = [moduleSym];
  const scopes: ScopeFrame[] = [];

  // Classes
  for (const cls of safeFindAll(root, "class_definition")) {
    const nameNode = safeFind(cls, "identifier");
    if (!nameNode) continue;
    const className = nameNode.text();
    const r = cls.range();
    const startLine = r.start.line + 1;
    const endLine = r.end.line + 1;
    const csym: SymbolNode = {
      id: makeId(file, className, startLine),
      name: className, qualifiedName: className, kind: "class", file, line: startLine, endLine, language,
    };
    symbols.push(csym);
    scopes.push({ name: className, startLine, endLine, symbolId: csym.id });

    // Methods
    for (const fn of safeFindAll(cls, "function_definition")) {
      const fnName = safeFind(fn, "identifier")?.text();
      if (!fnName) continue;
      const fr = fn.range();
      const fStart = fr.start.line + 1;
      const fEnd = fr.end.line + 1;
      const qname = `${className}.${fnName}`;
      const fsym: SymbolNode = {
        id: makeId(file, qname, fStart),
        name: fnName, qualifiedName: qname,
        kind: fnName === "__init__" ? "constructor" : "method",
        file, line: fStart, endLine: fEnd, language,
      };
      symbols.push(fsym);
      scopes.push({ name: qname, startLine: fStart, endLine: fEnd, symbolId: fsym.id });
    }
  }

  // Top-level functions (those not nested inside classes)
  for (const fn of safeFindAll(root, "function_definition")) {
    const fnName = safeFind(fn, "identifier")?.text();
    if (!fnName) continue;
    const r = fn.range();
    const startLine = r.start.line + 1;
    // Skip if already captured as a method (start line matches an existing scope's nested method)
    if (symbols.some((s) => s.file === file && s.line === startLine && s.name === fnName)) continue;
    const endLine = r.end.line + 1;
    const sym: SymbolNode = {
      id: makeId(file, fnName, startLine),
      name: fnName, qualifiedName: fnName, kind: "function", file, line: startLine, endLine, language,
    };
    symbols.push(sym);
    scopes.push({ name: fnName, startLine, endLine, symbolId: sym.id });
  }

  // Calls
  const rawCalls: ExtractedSymbols["rawCalls"] = [];
  for (const node of safeFindAll(root, "call")) {
    const calleeName = extractCalleeNameJs(node.text());
    if (!calleeName) continue;
    const r = node.range();
    const callLine = r.start.line + 1;
    rawCalls.push({
      callerId: findCallerId(scopes, callLine, moduleSym.id),
      calleeName,
      callSite: { file, line: callLine },
    });
  }
  return { symbols, rawCalls };
}

// ── Go ───────────────────────────────────────────────────────────────────

function extractFromGo(
  source: string,
  file: string,
  language: string,
  moduleSym: SymbolNode,
): ExtractedSymbols {
  const root = parse("go" as unknown as Lang, source).root();
  const symbols: SymbolNode[] = [moduleSym];
  const scopes: ScopeFrame[] = [];

  for (const fn of safeFindAll(root, "function_declaration")) {
    const nameNode = safeFind(fn, "identifier");
    if (!nameNode) continue;
    const name = nameNode.text();
    const r = fn.range();
    const startLine = r.start.line + 1;
    const endLine = r.end.line + 1;
    const sym: SymbolNode = {
      id: makeId(file, name, startLine),
      name, qualifiedName: name, kind: "function", file, line: startLine, endLine, language,
    };
    symbols.push(sym);
    scopes.push({ name, startLine, endLine, symbolId: sym.id });
  }
  for (const fn of safeFindAll(root, "method_declaration")) {
    const nameNode = safeFind(fn, "field_identifier");
    if (!nameNode) continue;
    const name = nameNode.text();
    const r = fn.range();
    const startLine = r.start.line + 1;
    const endLine = r.end.line + 1;
    const sym: SymbolNode = {
      id: makeId(file, name, startLine),
      name, qualifiedName: name, kind: "method", file, line: startLine, endLine, language,
    };
    symbols.push(sym);
    scopes.push({ name, startLine, endLine, symbolId: sym.id });
  }

  const rawCalls: ExtractedSymbols["rawCalls"] = [];
  for (const node of safeFindAll(root, "call_expression")) {
    const calleeName = extractCalleeNameJs(node.text());
    if (!calleeName) continue;
    const r = node.range();
    const callLine = r.start.line + 1;
    rawCalls.push({
      callerId: findCallerId(scopes, callLine, moduleSym.id),
      calleeName, callSite: { file, line: callLine },
    });
  }
  return { symbols, rawCalls };
}

// ── Rust ─────────────────────────────────────────────────────────────────

function extractFromRust(
  source: string,
  file: string,
  language: string,
  moduleSym: SymbolNode,
): ExtractedSymbols {
  const root = parse("rust" as unknown as Lang, source).root();
  const symbols: SymbolNode[] = [moduleSym];
  const scopes: ScopeFrame[] = [];

  for (const fn of safeFindAll(root, "function_item")) {
    const nameNode = safeFind(fn, "identifier");
    if (!nameNode) continue;
    const name = nameNode.text();
    const r = fn.range();
    const startLine = r.start.line + 1;
    const endLine = r.end.line + 1;
    const sym: SymbolNode = {
      id: makeId(file, name, startLine),
      name, qualifiedName: name, kind: "function", file, line: startLine, endLine, language,
    };
    symbols.push(sym);
    scopes.push({ name, startLine, endLine, symbolId: sym.id });
  }

  const rawCalls: ExtractedSymbols["rawCalls"] = [];
  for (const node of safeFindAll(root, "call_expression")) {
    const calleeName = extractCalleeNameJs(node.text());
    if (!calleeName) continue;
    const r = node.range();
    const callLine = r.start.line + 1;
    rawCalls.push({
      callerId: findCallerId(scopes, callLine, moduleSym.id),
      calleeName, callSite: { file, line: callLine },
    });
  }
  for (const node of safeFindAll(root, "macro_invocation")) {
    const nameNode = safeFind(node, "identifier");
    if (!nameNode) continue;
    const r = node.range();
    const callLine = r.start.line + 1;
    rawCalls.push({
      callerId: findCallerId(scopes, callLine, moduleSym.id),
      calleeName: nameNode.text(), callSite: { file, line: callLine },
    });
  }
  return { symbols, rawCalls };
}

// ── JVM (Java / Kotlin / Scala) ──────────────────────────────────────────

function extractFromJvm(
  source: string,
  langKey: string,
  file: string,
  language: string,
  moduleSym: SymbolNode,
): ExtractedSymbols {
  const root = parse(langKey as unknown as Lang, source).root();
  const symbols: SymbolNode[] = [moduleSym];
  const scopes: ScopeFrame[] = [];

  const classKinds = langKey === "scala"
    ? ["class_definition", "object_definition", "trait_definition"]
    : ["class_declaration", "interface_declaration", "enum_declaration", "object_declaration"];
  for (const k of classKinds) {
    for (const cls of safeFindAll(root, k)) {
      const name = extractJvmTypeName(cls.text(), langKey);
      if (!name) continue;
      const r = cls.range();
      const startLine = r.start.line + 1;
      const endLine = r.end.line + 1;
      const kind: SymbolKind = k.includes("interface") ? "interface"
        : k.includes("trait") ? "trait"
        : k.includes("enum") ? "enum" : "class";
      const sym: SymbolNode = {
        id: makeId(file, name, startLine),
        name, qualifiedName: name, kind, file, line: startLine, endLine, language,
      };
      symbols.push(sym);
      scopes.push({ name, startLine, endLine, symbolId: sym.id });
    }
  }

  const methodKinds = langKey === "scala"
    ? ["function_definition"]
    : langKey === "kotlin"
      ? ["function_declaration"]
      : ["method_declaration", "constructor_declaration"];
  for (const k of methodKinds) {
    for (const m of safeFindAll(root, k)) {
      const name = extractJvmCallableName(m.text());
      if (!name) continue;
      const r = m.range();
      const startLine = r.start.line + 1;
      const endLine = r.end.line + 1;
      const sym: SymbolNode = {
        id: makeId(file, name, startLine),
        name, qualifiedName: name,
        kind: k.includes("constructor") ? "constructor" : "method",
        file, line: startLine, endLine, language,
      };
      symbols.push(sym);
      scopes.push({ name, startLine, endLine, symbolId: sym.id });
    }
  }

  const callKinds = langKey === "java"
    ? ["method_invocation"]
    : ["call_expression"];
  const rawCalls: ExtractedSymbols["rawCalls"] = [];
  for (const k of callKinds) {
    for (const node of safeFindAll(root, k)) {
      const calleeName = extractCalleeNameJs(node.text());
      if (!calleeName) continue;
      const r = node.range();
      const callLine = r.start.line + 1;
      rawCalls.push({
        callerId: findCallerId(scopes, callLine, moduleSym.id),
        calleeName, callSite: { file, line: callLine },
      });
    }
  }
  return { symbols, rawCalls };
}

function stripJvmAnnotations(text: string): string {
  return text
    .split("\n")
    .map((line) =>
      line.replace(/^\s*(?:@(?:[\w$]+:)?[\w$.]+(?:\([^)]*\))?\s*)+/, "")
    )
    .join("\n");
}

function extractJvmTypeName(text: string, langKey: string): string | null {
  const withoutAnnotations = stripJvmAnnotations(text);
  const header = withoutAnnotations.split("{", 1)[0] ?? withoutAnnotations;
  const pattern = langKey === "scala"
    ? /\b(?:class|object|trait)\s+([A-Za-z_$][\w$]*)\b/
    : /\b(?:class|interface|enum|object)\s+([A-Za-z_$][\w$]*)\b/;
  return header.match(pattern)?.[1] ?? null;
}

function extractJvmCallableName(text: string): string | null {
  const withoutAnnotations = stripJvmAnnotations(text);
  const signature = withoutAnnotations
    .split("{", 1)[0]
    .split("=", 1)[0]
    .trim();
  const scalaDefMatches = Array.from(signature.matchAll(/\bdef\s+([A-Za-z_$][\w$]*)\b/g));
  if (scalaDefMatches.length > 0) {
    return scalaDefMatches[scalaDefMatches.length - 1][1];
  }
  const matches = Array.from(signature.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g));
  return matches.length > 0 ? matches[matches.length - 1][1] : null;
}

// ── C# ──────────────────────────────────────────────────────────────────

function extractFromCSharp(
  source: string,
  file: string,
  language: string,
  moduleSym: SymbolNode,
): ExtractedSymbols {
  const root = parse("csharp" as unknown as Lang, source).root();
  const symbols: SymbolNode[] = [moduleSym];
  const scopes: ScopeFrame[] = [];

  for (const k of ["class_declaration", "interface_declaration", "record_declaration", "struct_declaration"]) {
    for (const cls of safeFindAll(root, k)) {
      const nameNode = safeFind(cls, "identifier");
      if (!nameNode) continue;
      const name = nameNode.text();
      const r = cls.range();
      const startLine = r.start.line + 1;
      const endLine = r.end.line + 1;
      const sym: SymbolNode = {
        id: makeId(file, name, startLine),
        name, qualifiedName: name,
        kind: k.includes("interface") ? "interface"
          : k.includes("struct") ? "struct" : "class",
        file, line: startLine, endLine, language,
      };
      symbols.push(sym);
      scopes.push({ name, startLine, endLine, symbolId: sym.id });
    }
  }
  for (const k of ["method_declaration", "constructor_declaration"]) {
    for (const m of safeFindAll(root, k)) {
      const nameNode = safeFind(m, "identifier");
      if (!nameNode) continue;
      const name = nameNode.text();
      const r = m.range();
      const startLine = r.start.line + 1;
      const endLine = r.end.line + 1;
      const sym: SymbolNode = {
        id: makeId(file, name, startLine),
        name, qualifiedName: name,
        kind: k.includes("constructor") ? "constructor" : "method",
        file, line: startLine, endLine, language,
      };
      symbols.push(sym);
      scopes.push({ name, startLine, endLine, symbolId: sym.id });
    }
  }

  const rawCalls: ExtractedSymbols["rawCalls"] = [];
  for (const node of safeFindAll(root, "invocation_expression")) {
    const calleeName = extractCalleeNameJs(node.text());
    if (!calleeName) continue;
    const r = node.range();
    const callLine = r.start.line + 1;
    rawCalls.push({
      callerId: findCallerId(scopes, callLine, moduleSym.id),
      calleeName, callSite: { file, line: callLine },
    });
  }
  return { symbols, rawCalls };
}

// ── C / C++ ──────────────────────────────────────────────────────────────

function extractFromCFamily(
  source: string,
  langKey: string,
  file: string,
  language: string,
  moduleSym: SymbolNode,
): ExtractedSymbols {
  const root = parse(langKey as unknown as Lang, source).root();
  const symbols: SymbolNode[] = [moduleSym];
  const scopes: ScopeFrame[] = [];

  if (langKey === "cpp") {
    for (const k of ["class_specifier", "struct_specifier"]) {
      for (const cls of safeFindAll(root, k)) {
        const nameNode = safeFind(cls, "type_identifier");
        if (!nameNode) continue;
        const name = nameNode.text();
        const r = cls.range();
        const startLine = r.start.line + 1;
        const endLine = r.end.line + 1;
        const sym: SymbolNode = {
          id: makeId(file, name, startLine),
          name, qualifiedName: name,
          kind: k.includes("struct") ? "struct" : "class",
          file, line: startLine, endLine, language,
        };
        symbols.push(sym);
        scopes.push({ name, startLine, endLine, symbolId: sym.id });
      }
    }
  }

  for (const fn of safeFindAll(root, "function_definition")) {
    const declarator = safeFind(fn, "function_declarator");
    const nameNode = safeFind(declarator, "identifier")
      ?? safeFind(declarator, "qualified_identifier");
    if (!nameNode) continue;
    const fullName = nameNode.text();
    const name = fullName.split("::").pop() ?? fullName;
    const r = fn.range();
    const startLine = r.start.line + 1;
    const endLine = r.end.line + 1;
    const sym: SymbolNode = {
      id: makeId(file, fullName, startLine),
      name, qualifiedName: fullName,
      kind: fullName.includes("::") ? "method" : "function",
      file, line: startLine, endLine, language,
    };
    symbols.push(sym);
    scopes.push({ name: fullName, startLine, endLine, symbolId: sym.id });
  }

  const rawCalls: ExtractedSymbols["rawCalls"] = [];
  for (const node of safeFindAll(root, "call_expression")) {
    const calleeName = extractCalleeNameJs(node.text());
    if (!calleeName) continue;
    const r = node.range();
    const callLine = r.start.line + 1;
    rawCalls.push({
      callerId: findCallerId(scopes, callLine, moduleSym.id),
      calleeName, callSite: { file, line: callLine },
    });
  }
  return { symbols, rawCalls };
}

// ── Ruby ────────────────────────────────────────────────────────────────

function extractFromRuby(
  source: string,
  file: string,
  language: string,
  moduleSym: SymbolNode,
): ExtractedSymbols {
  const root = parse("ruby" as unknown as Lang, source).root();
  const symbols: SymbolNode[] = [moduleSym];
  const scopes: ScopeFrame[] = [];

  for (const k of ["class", "module"]) {
    for (const cls of safeFindAll(root, k)) {
      const nameNode = safeFind(cls, "constant")
        ?? safeFind(cls, "identifier");
      if (!nameNode) continue;
      const name = nameNode.text();
      const r = cls.range();
      const startLine = r.start.line + 1;
      const endLine = r.end.line + 1;
      const sym: SymbolNode = {
        id: makeId(file, name, startLine),
        name, qualifiedName: name,
        kind: k === "module" ? "module" : "class",
        file, line: startLine, endLine, language,
      };
      symbols.push(sym);
      scopes.push({ name, startLine, endLine, symbolId: sym.id });
    }
  }
  for (const m of safeFindAll(root, "method")) {
    const nameNode = safeFind(m, "identifier");
    if (!nameNode) continue;
    const name = nameNode.text();
    const r = m.range();
    const startLine = r.start.line + 1;
    const endLine = r.end.line + 1;
    const sym: SymbolNode = {
      id: makeId(file, name, startLine),
      name, qualifiedName: name, kind: "method",
      file, line: startLine, endLine, language,
    };
    symbols.push(sym);
    scopes.push({ name, startLine, endLine, symbolId: sym.id });
  }

  const rawCalls: ExtractedSymbols["rawCalls"] = [];
  for (const node of safeFindAll(root, "call")) {
    // Ask the grammar, not the text. tree-sitter-ruby's `call` node carries the
    // callee in its `method` field for every call shape — parenthesised or not,
    // command style (`has_many :posts`), safe navigation (`a&.b`), block calls,
    // and each link of a fluent chain as its own node. The previous
    // extractCalleeNameJs(text) parse required a `(` before the name, so every
    // parenthesis-less call — the dominant Ruby idiom — was silently dropped
    // and Ruby files contributed almost no call edges. (A bare receiverless,
    // argumentless `helper` parses as a plain identifier, indistinguishable
    // from a variable read, so it is not a `call` node and stays out.)
    const methodNode = node.field("method");
    const calleeName = methodNode ? methodNode.text() : extractCalleeNameJs(node.text());
    if (!calleeName) continue;
    const r = node.range();
    const callLine = r.start.line + 1;
    rawCalls.push({
      callerId: findCallerId(scopes, callLine, moduleSym.id),
      calleeName, callSite: { file, line: callLine },
    });
  }
  return { symbols, rawCalls };
}

// ── PHP ─────────────────────────────────────────────────────────────────

function extractFromPhp(
  source: string,
  file: string,
  language: string,
  moduleSym: SymbolNode,
): ExtractedSymbols {
  const root = parse("php" as unknown as Lang, source).root();
  const symbols: SymbolNode[] = [moduleSym];
  const scopes: ScopeFrame[] = [];

  for (const k of ["class_declaration", "interface_declaration", "trait_declaration"]) {
    for (const cls of safeFindAll(root, k)) {
      const nameNode = safeFind(cls, "name");
      if (!nameNode) continue;
      const name = nameNode.text();
      const r = cls.range();
      const startLine = r.start.line + 1;
      const endLine = r.end.line + 1;
      const sym: SymbolNode = {
        id: makeId(file, name, startLine),
        name, qualifiedName: name,
        kind: k.includes("interface") ? "interface" : k.includes("trait") ? "trait" : "class",
        file, line: startLine, endLine, language,
      };
      symbols.push(sym);
      scopes.push({ name, startLine, endLine, symbolId: sym.id });
    }
  }
  for (const k of ["function_definition", "method_declaration"]) {
    for (const m of safeFindAll(root, k)) {
      const nameNode = safeFind(m, "name");
      if (!nameNode) continue;
      const name = nameNode.text();
      const r = m.range();
      const startLine = r.start.line + 1;
      const endLine = r.end.line + 1;
      const sym: SymbolNode = {
        id: makeId(file, name, startLine),
        name, qualifiedName: name,
        kind: k === "function_definition" ? "function" : "method",
        file, line: startLine, endLine, language,
      };
      symbols.push(sym);
      scopes.push({ name, startLine, endLine, symbolId: sym.id });
    }
  }

  const rawCalls: ExtractedSymbols["rawCalls"] = [];
  for (const k of ["function_call_expression", "member_call_expression", "scoped_call_expression"]) {
    for (const node of safeFindAll(root, k)) {
      const calleeName = extractCalleeNamePhp(node.text());
      if (!calleeName) continue;
      const r = node.range();
      const callLine = r.start.line + 1;
      rawCalls.push({
        callerId: findCallerId(scopes, callLine, moduleSym.id),
        calleeName, callSite: { file, line: callLine },
      });
    }
  }
  return { symbols, rawCalls };
}

// ── Swift ───────────────────────────────────────────────────────────────

function extractFromSwift(
  source: string,
  file: string,
  language: string,
  moduleSym: SymbolNode,
): ExtractedSymbols {
  const root = parse("swift" as unknown as Lang, source).root();
  const symbols: SymbolNode[] = [moduleSym];
  const scopes: ScopeFrame[] = [];

  for (const k of ["class_declaration", "struct_declaration", "protocol_declaration", "enum_declaration"]) {
    for (const cls of safeFindAll(root, k)) {
      const nameNode = safeFind(cls, "type_identifier")
        ?? safeFind(cls, "identifier");
      if (!nameNode) continue;
      const name = nameNode.text();
      const r = cls.range();
      const startLine = r.start.line + 1;
      const endLine = r.end.line + 1;
      const sym: SymbolNode = {
        id: makeId(file, name, startLine),
        name, qualifiedName: name,
        kind: k.includes("struct") ? "struct"
          : k.includes("protocol") ? "interface"
          : k.includes("enum") ? "enum" : "class",
        file, line: startLine, endLine, language,
      };
      symbols.push(sym);
      scopes.push({ name, startLine, endLine, symbolId: sym.id });
    }
  }
  for (const fn of safeFindAll(root, "function_declaration")) {
    const nameNode = safeFind(fn, "simple_identifier")
      ?? safeFind(fn, "identifier");
    if (!nameNode) continue;
    const name = nameNode.text();
    const r = fn.range();
    const startLine = r.start.line + 1;
    const endLine = r.end.line + 1;
    const sym: SymbolNode = {
      id: makeId(file, name, startLine),
      name, qualifiedName: name, kind: "function",
      file, line: startLine, endLine, language,
    };
    symbols.push(sym);
    scopes.push({ name, startLine, endLine, symbolId: sym.id });
  }

  const rawCalls: ExtractedSymbols["rawCalls"] = [];
  for (const node of safeFindAll(root, "call_expression")) {
    const calleeName = extractCalleeNameJs(node.text());
    if (!calleeName) continue;
    const r = node.range();
    const callLine = r.start.line + 1;
    rawCalls.push({
      callerId: findCallerId(scopes, callLine, moduleSym.id),
      calleeName, callSite: { file, line: callLine },
    });
  }
  return { symbols, rawCalls };
}

// ── Bash ────────────────────────────────────────────────────────────────

function extractFromBash(
  source: string,
  file: string,
  language: string,
  moduleSym: SymbolNode,
): ExtractedSymbols {
  const root = parse("bash" as unknown as Lang, source).root();
  const symbols: SymbolNode[] = [moduleSym];
  const scopes: ScopeFrame[] = [];

  for (const fn of safeFindAll(root, "function_definition")) {
    const nameNode = safeFind(fn, "word");
    if (!nameNode) continue;
    const name = nameNode.text();
    const r = fn.range();
    const startLine = r.start.line + 1;
    const endLine = r.end.line + 1;
    const sym: SymbolNode = {
      id: makeId(file, name, startLine),
      name, qualifiedName: name, kind: "function",
      file, line: startLine, endLine, language,
    };
    symbols.push(sym);
    scopes.push({ name, startLine, endLine, symbolId: sym.id });
  }

  const rawCalls: ExtractedSymbols["rawCalls"] = [];
  for (const node of safeFindAll(root, "command")) {
    const nameNode = safeFind(node, "command_name");
    if (!nameNode) continue;
    const name = nameNode.text();
    if (!/^[A-Za-z_][\w]*$/.test(name)) continue;
    const r = node.range();
    const callLine = r.start.line + 1;
    rawCalls.push({
      callerId: findCallerId(scopes, callLine, moduleSym.id),
      calleeName: name, callSite: { file, line: callLine },
    });
  }
  return { symbols, rawCalls };
}

// ── Regex fallback (Dart, Lua, Svelte/Vue, anything unsupported) ────────

function extractFromRegex(
  source: string,
  file: string,
  language: string,
  moduleSym: SymbolNode,
): ExtractedSymbols {
  const symbols: SymbolNode[] = [moduleSym];
  const scopes: ScopeFrame[] = [];
  const lines = source.split("\n");

  // Generic `function NAME` / `def NAME` / `fn NAME` / `func NAME` patterns
  const fnRegex = /^\s*(?:export\s+|public\s+|private\s+|static\s+|async\s+)*(?:function|def|fn|func|sub|local\s+function)\s+([A-Za-z_][\w]*)/;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(fnRegex);
    if (!m) continue;
    const name = m[1];
    const startLine = i + 1;
    // Heuristic end line: next line with same or less indentation
    const indent = lines[i].match(/^\s*/)?.[0].length ?? 0;
    let endLine = startLine;
    for (let j = i + 1; j < lines.length; j++) {
      const text = lines[j];
      if (text.trim() === "") continue;
      const ind = text.match(/^\s*/)?.[0].length ?? 0;
      if (ind <= indent) break;
      endLine = j + 1;
    }
    const sym: SymbolNode = {
      id: makeId(file, name, startLine),
      name, qualifiedName: name, kind: "function",
      file, line: startLine, endLine, language,
    };
    symbols.push(sym);
    scopes.push({ name, startLine, endLine, symbolId: sym.id });
  }

  const rawCalls: ExtractedSymbols["rawCalls"] = [];
  const callRegex = /([A-Za-z_][\w]*)\s*\(/g;
  for (let i = 0; i < lines.length; i++) {
    let m: RegExpExecArray | null = null;
    callRegex.lastIndex = 0;
    m = callRegex.exec(lines[i]);
    while (m !== null) {
      const name = m[1];
      // Skip language keywords/control flow
      if (!["if", "for", "while", "switch", "return", "function", "def", "fn", "func", "class", "new"].includes(name)) {
        const callLine = i + 1;
        rawCalls.push({
          callerId: findCallerId(scopes, callLine, moduleSym.id),
        calleeName: name, callSite: { file, line: callLine },
      });
      }
      m = callRegex.exec(lines[i]);
    }
  }
  return { symbols, rawCalls };
}

/** Convert raw call sites to unresolved SymbolEdge objects (resolution in Phase C). */
export function rawCallsToUnresolvedEdges(
  rawCalls: ExtractedSymbols["rawCalls"],
): SymbolEdge[] {
  return rawCalls.map((c) => ({
    callerId: c.callerId,
    calleeName: c.calleeName,
    calleeCandidates: [],
    confidence: "unresolved" as const,
    callSite: c.callSite,
  }));
}
