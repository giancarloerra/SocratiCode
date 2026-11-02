// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited
import { Lang, parse, type SgNode } from "@ast-grep/napi";
import { gdscriptParserAvailable } from "./code-graph.js";
import { analyzeElixirTemplate, isElixirTemplateExtension } from "./elixir-templates.js";
import { tokenizeGdscript } from "./gdscript-syntax.js";
import { logger } from "./logger.js";

// ── Import extraction per language ───────────────────────────────────────

export interface ImportInfo {
  moduleSpecifier: string; // The raw import string
  isDynamic: boolean;
  /** CommonJS require uses a different conditional-export branch from import. */
  isRequire?: boolean;
  isCssImport?: boolean;   // True when extracted from a CSS/style context
  /**
   * Fallback specifier when the primary moduleSpecifier cannot be resolved.
   * Used by Godot .tscn/.tres ext_resource: when both uid:// and path are
   * present, uid is the primary specifier and path is the fallback, so the
   * resolver can try the path if UID resolution misses.
   */
  fallbackSpecifier?: string;
  /**
   * True when the specifier comes from a declaration that brings a file into
   * the module tree — a Rust `mod foo;` — rather than from a path that merely
   * names something. Rust needs the difference: a module has to be declared
   * before an unanchored path can reach it, and the declaration is the only
   * evidence of that in the file.
   */
  isModuleDeclaration?: boolean;
  /**
   * The name a module declaration puts in the declaring file's own scope.
   * Absent when the declaration is written inside an inline `mod` block,
   * where the name belongs to the block rather than to the file.
   *
   * It is not the specifier: `#[path = "custom.rs"] mod foo;` travels as the
   * path it declares, while the name it brings into scope is `foo`, and it is
   * `foo` an unanchored `use foo::Item;` in that file may reach.
   */
  declaredName?: string;
  /**
   * True when the path was written inside an inline `mod { … }` block and its
   * head is not a module that block declares. Such a head cannot reach a module
   * the *file* declares: rustc asks for an anchor first. Checked on cargo
   * 1.98.0 — `pub mod corelib;` at file level with `use corelib::marker;`
   * inside `pub mod block { … }` is E0432, "a similar path exists: use
   * crate::corelib::marker" (`super::` where the block sits deeper).
   *
   * It is the mirror of the case already handled the other way round, where a
   * declaration written inside a block does not count at file level.
   */
  fromInlineBlock?: boolean;
  /** Distinguishes Godot path semantics for extends, preload, and runtime load. */
  godotImportKind?: "extends" | "preload" | "load";
}

/**
 * Per-language dedupe set for import-extraction failures. Without this, a
 * missing PHP grammar would emit one warn per file (potentially hundreds).
 * We log the first failure per language at warn level (with the underlying
 * error attached) and silently skip subsequent failures.
 */
const importExtractionWarned = new Set<string>();

/**
 * Reset the per-language dedupe set. Intended for tests that want to assert
 * deterministically on extraction warnings.
 */
export function resetImportExtractionWarnings(): void {
  importExtractionWarned.clear();
}

// ── GDScript string literal decoding ─────────────────────────────────────

/**
 * Decode a GDScript string literal from its raw source text.
 *
 * GDScript supports:
 *   - Single-quoted: 'hello', '''triple single'''
 *   - Double-quoted: "hello", \"\"\"triple double\"\\"\"
 *   - Raw strings: r"no escapes", r'no escapes', r\"\"\"triple\"\"
 *
 * In raw strings, escape sequences are not processed — the content is
 * taken literally. In non-raw strings, \\n, \\t, \\\\, \\", \\', \\uXXXX
 * are decoded.
 *
 * Returns the decoded string value, or null if the text is not a valid
 * GDScript string literal.
 */
export function decodeGdscriptString(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;

  // Check for raw prefix
  const isRaw = text[0] === "r" || text[0] === "R";
  const body = isRaw ? text.slice(1) : text;

  if (!body) return null;

  // Triple-quoted strings
  if (body.startsWith('"""') && body.endsWith('"""') && body.length >= 6) {
    const inner = body.slice(3, -3);
    return isRaw ? inner : decodeGdscriptEscapes(inner);
  }
  if (body.startsWith("'''") && body.endsWith("'''") && body.length >= 6) {
    const inner = body.slice(3, -3);
    return isRaw ? inner : decodeGdscriptEscapes(inner);
  }

  // Single-quoted
  if (body.startsWith("'") && body.endsWith("'") && body.length >= 2) {
    const inner = body.slice(1, -1);
    return isRaw ? inner : decodeGdscriptEscapes(inner);
  }

  // Double-quoted
  if (body.startsWith('"') && body.endsWith('"') && body.length >= 2) {
    const inner = body.slice(1, -1);
    return isRaw ? inner : decodeGdscriptEscapes(inner);
  }

  return null;
}

/** Decode GDScript escape sequences in a non-raw string body. */
function decodeGdscriptEscapes(s: string): string {
  // Process escapes in a single pass to avoid order-dependent bugs
  // (e.g. \\t should produce \t (backslash-t), not a tab character).
  return s.replace(/\\(u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|.)/g, (_, seq: string) => {
    if (seq[0] === "u" && seq.length === 5) {
      return String.fromCharCode(parseInt(seq.slice(1), 16));
    }
    if (seq[0] === "U" && seq.length === 9) {
      const cp = parseInt(seq.slice(1), 16);
      if (cp > 0x10ffff) return seq; // invalid escape: keep the raw text
      return String.fromCodePoint(cp);
    }
    switch (seq) {
      case "n": return "\n";
      case "t": return "\t";
      case "r": return "\r";
      case "\\": return "\\";
      case '"': return '"';
      case "'": return "'";
      default: return seq; // unknown escape: just the character
    }
  });
}

// ── TSCN/.tres section header tokenizer ──────────────────────────────────

/**
 * Parse a TSCN/.tres section header line into its resource type and
 * key-value attributes.
 *
 * TSCN whitespace is insignificant outside strings. Headings are:
 *   [<resource_type> key1=value1 key2=value2 ...]
 *
 * This tokenizer handles:
 *   - Leading whitespace before [
 *   - Spaces around = in key=value pairs
 *   - Quoted values with escapes
 *   - Arbitrary attribute order
 *   - Comments (lines starting with ; outside a section)
 *
 * Returns { type, attrs } or null if the line is not a section header.
 */
export function parseTscnSectionHeader(
  line: string,
): { type: string; attrs: Map<string, string> } | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;

  const inner = trimmed.slice(1, -1);
  const attrs = new Map<string, string>();

  // Parse: resource_type key1=value1 key2=value2 ...
  // The resource type is the first token (may contain slashes for
  // sub-resources like ext_resource).
  let i = 0;
  // Read the resource type
  const typeStart = i;
  while (i < inner.length && inner[i] !== " " && inner[i] !== "\t") {
    i++;
  }
  const type = inner.slice(typeStart, i);
  if (!type) return null;

  // Parse key=value pairs
  while (i < inner.length) {
    // Skip whitespace
    while (i < inner.length && (inner[i] === " " || inner[i] === "\t")) i++;
    if (i >= inner.length) break;

    // Read key
    const keyStart = i;
    while (i < inner.length && inner[i] !== "=" && inner[i] !== " " && inner[i] !== "\t") {
      i++;
    }
    const key = inner.slice(keyStart, i);
    if (!key) break;

    // Skip whitespace before =
    while (i < inner.length && (inner[i] === " " || inner[i] === "\t")) i++;
    if (i >= inner.length || inner[i] !== "=") break;
    i++; // skip =

    // Skip whitespace after =
    while (i < inner.length && (inner[i] === " " || inner[i] === "\t")) i++;

    // Read value (quoted or unquoted)
    let value: string;
    if (i < inner.length && (inner[i] === '"' || inner[i] === "'")) {
      const quote = inner[i];
      i++; // skip opening quote
      const valStart = i;
      while (i < inner.length && inner[i] !== quote) {
        if (inner[i] === "\\" && i + 1 < inner.length) i++; // skip escaped char
        i++;
      }
      value = inner.slice(valStart, i);
      // Decode basic escapes
      value = value.replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\\\/g, "\\");
      if (i < inner.length) i++; // skip closing quote
    } else {
      const valStart = i;
      while (i < inner.length && inner[i] !== " " && inner[i] !== "\t") i++;
      value = inner.slice(valStart, i);
    }

    attrs.set(key, value);
  }

  return { type, attrs };
}

/** Extract CSS/SCSS/Stylus @import statements from raw style source text. */
function extractCssImports(source: string): ImportInfo[] {
  const imports: ImportInfo[] = [];
  // CSS/SCSS: @import "./foo.css"; @import url("./foo.css");
  for (const match of source.matchAll(/@import\s+(?:url\(\s*)?['"]([^'"]+)['"]\s*\)?/gm)) {
    const spec = match[1];
    if (spec.startsWith("http://") || spec.startsWith("https://")) continue;
    imports.push({ moduleSpecifier: spec, isDynamic: false, isCssImport: true });
  }
  // Stylus: @require "foo" (quoted form only; bare-identifier syntax not supported)
  for (const match of source.matchAll(/@require\s+['"]([^'"]+)['"]/gm)) {
    const spec = match[1];
    if (spec.startsWith("http://") || spec.startsWith("https://")) continue;
    imports.push({ moduleSpecifier: spec, isDynamic: false, isCssImport: true });
  }
  return imports;
}

/**
 * Split a PHP `use` statement body on the commas that separate its clauses,
 * leaving the ones inside a `{…}` group alone.
 *
 * `use App\{User, Post}, Other\Thing;` is one declaration holding two clauses,
 * and the group's internal commas separate members of the first clause rather
 * than clauses of the statement. A plain `split(",")` cannot tell the two
 * apart, and matching only the first clause is what dropped every name after
 * the first comma.
 */
function splitPhpUseClauses(body: string): string[] {
  const clauses: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of body) {
    if (ch === "{") depth++;
    else if (ch === "}") depth = Math.max(0, depth - 1);
    else if (ch === "," && depth === 0) {
      clauses.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  clauses.push(current);
  return clauses.map((clause) => clause.trim()).filter(Boolean);
}

/**
 * Every namespace path a PHP `use` declaration names.
 *
 * Handles the single (`use A\B;`), aliased (`use A\B as C;`), grouped
 * (`use A\{B, C};`) and comma-list (`use A\B, A\C;`) forms, with the
 * statement-level `function`/`const` modifiers stripped. A leading `\` on a
 * fully-qualified name is left on the specifier — the resolver strips it, so
 * `node.imports` keeps reporting what the source actually says.
 */
function phpUseSpecifiers(text: string): string[] {
  const specs: string[] = [];
  const body = text.replace(/^use\s+(?:function\s+|const\s+)?/, "").replace(/;\s*$/, "");

  for (const clause of splitPhpUseClauses(body)) {
    // Grouped: A\B\{C, D as E, function f, const K}
    const group = clause.match(/^([\w\\]+)\\\{([^}]*)\}$/);
    if (group) {
      for (const member of group[2].split(",")) {
        // A group may carry `function`/`const` per member as well as at the
        // statement level — `use App\{function first, const MAX, User};` is one
        // declaration importing a function, a constant and a class. Left on,
        // the modifier became part of the name (`App\function first`), which
        // names nothing and loses the real one.
        const name = member
          .trim()
          .replace(/^(?:function|const)\s+/, "")
          .split(/\s+as\s+/)[0]
          .trim();
        if (name) specs.push(`${group[1]}\\${name}`);
      }
      continue;
    }
    // Single: A\B, \A\B, A\B as C
    const single = clause.match(/^([\w\\]+)/);
    if (single) specs.push(single[1].trim());
  }

  return specs;
}

/**
 * The path a PHP `require`/`include` names, or null when it names nothing
 * statically knowable.
 *
 * Two shapes are literal. A quoted path (`require './x.php'`) is taken as
 * written. `__DIR__ . '/x.php'` and its `dirname(__FILE__)` spelling are
 * compile-time constants naming the including file's own directory, so they
 * are equivalent to a source-relative path and are emitted as one — which is
 * what the resolver's relative branch already knows how to handle. This is
 * the dominant include idiom in WordPress and in any plugin-style tree that
 * predates Composer, and the previous regex could not match it: it required a
 * quote immediately after `require`/`(`, so the `__DIR__ .` prefix killed the
 * match and the statement produced no specifier at all.
 *
 * Anything else stays null rather than being guessed. `require ABSPATH .
 * '/x.php'` and `require $base . '/x.php'` depend on a value this pass cannot
 * know, and inventing a path from the literal tail alone would draw an edge to
 * a file the code may never include.
 *
 * Both patterns are anchored, because the text handed to them is one
 * include/require expression node rather than a whole statement — see
 * PHP_REQUIRE_KINDS.
 */
const PHP_REQUIRE_DIR_JOINED =
  /^(?:require|include)(?:_once)?\s*\(?\s*(?:__DIR__|dirname\s*\(\s*__FILE__\s*\))\s*\.\s*['"]([^'"]+)['"]/;
const PHP_REQUIRE_QUOTED =
  /^(?:require|include)(?:_once)?\s*[(]?\s*['"]([^'"]+)['"]/;

/**
 * The AST node kinds PHP's four include constructs produce.
 *
 * Matching these rather than scanning statement text is what keeps the pattern
 * off everything that merely reads like an include. The parser has already
 * decided what is code: a comment saying "does NOT include 'event'", a string
 * holding a Blade directive (`"@include('partials/card')"`), and a method
 * named after the construct (`$loader->require('x.php')`) produce no node here,
 * while `@include('x.php')` — the error-suppressed form, which is real — still
 * does. Scanning `expression_statement` text matched the first three and was
 * the source of every junk specifier this extractor produced.
 *
 * It also removes the need to enumerate the statements an include can sit in.
 * `return require __DIR__ . '/config.php';` is a return_statement and
 * `$c = include 'c.php';` an expression_statement; as expressions they are the
 * same node kind, so both are found without either being named.
 */
const PHP_REQUIRE_KINDS = [
  "require_expression",
  "require_once_expression",
  "include_expression",
  "include_once_expression",
];

function phpRequireSpecifier(text: string): string | null {
  const dirRelative = text.match(PHP_REQUIRE_DIR_JOINED);
  if (dirRelative) {
    // `__DIR__` is the directory itself, so the literal's leading separator is
    // a joiner rather than an absolute-path anchor. `./` makes the result
    // explicitly source-relative for the resolver; `__DIR__ . '/../lib/x.php'`
    // becomes `./../lib/x.php`, which normalizes to the parent directory.
    const rest = dirRelative[1].replace(/^\/+/, "");
    return rest ? `./${rest}` : null;
  }

  const quoted = text.match(PHP_REQUIRE_QUOTED);
  return quoted ? quoted[1] : null;
}

/**
 * Syntax-aware GDScript import fallback for hosts where the optional native
 * parser cannot load. The lightweight lexer excludes comments and string
 * bodies before recognizing direct preload/load arguments and extends forms.
 */
export function extractGdscriptImportsRegex(source: string): ImportInfo[] {
  const imports: ImportInfo[] = [];
  const tokens = tokenizeGdscript(source);

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.kind !== "identifier" || tokens[index - 1]?.text === ".") continue;

    if (token.text === "preload" || token.text === "load") {
      if (tokens[index + 1]?.text !== "(" || tokens[index + 2]?.kind !== "string") continue;
      const decoded = decodeGdscriptString(tokens[index + 2].text);
      if (!decoded) continue;
      imports.push({
        moduleSpecifier: decoded,
        isDynamic: token.text === "load",
        godotImportKind: token.text,
      });
      continue;
    }

    if (token.text !== "extends") continue;
    const target = tokens[index + 1];
    if (target?.kind === "string") {
      const decoded = decodeGdscriptString(target.text);
      if (decoded) {
        imports.push({ moduleSpecifier: decoded, isDynamic: false, godotImportKind: "extends" });
      }
      continue;
    }
    if (target?.kind === "identifier") {
      imports.push({
        moduleSpecifier: `class:${target.text}`,
        isDynamic: false,
        godotImportKind: "extends",
      });
    }
  }

  return imports;
}

/**
 * Tokenizer-based import extraction for Godot resource files (.tscn/.tres).
 *
 * These are text-based INI-like files with no tree-sitter grammar.
 * Dependencies are declared via `[ext_resource path="..."]` lines.
 *
 * The path can be:
 *   - A `res://` path (absolute within the Godot project)
 *   - A relative path (relative to the .tscn/.tres file's directory)
 *   - A `uid://` path (resolved via .uid sidecar files)
 *
 * TSCN whitespace is insignificant outside strings, so the tokenizer handles
 * leading whitespace, spaces around =, arbitrary attribute order, and quoted
 * values with escapes. See the TSCN documentation:
 * https://docs.godotengine.org/en/stable/engine_details/file_formats/tscn.html
 *
 * Scene-to-scene composition is represented by PackedScene entries in
 * ext_resource, not a separate [instance] section. The `instance` keyword
 * is an attribute of a [node] declaration, not a section heading.
 *
 * Both `uid` and `path` attributes are extracted. When both are present,
 * Godot prefers the UID and falls back to the text path only when the UID
 * cannot be resolved. The resolver handles this priority.
 */
export function extractGodotResourceImports(source: string): ImportInfo[] {
  const imports: ImportInfo[] = [];
  for (const line of source.split("\n")) {
    const section = parseTscnSectionHeader(line);
    if (!section) continue;
    if (section.type !== "ext_resource") continue;

    // Extract uid:// path if present (Godot prefers UID over text path)
    const uid = section.attrs.get("uid");
    const path = section.attrs.get("path");

    if (uid?.startsWith("uid://")) {
      // UID is primary; path is the fallback when UID resolution misses.
      // Emit a single import to avoid duplicate edges.
      imports.push({
        moduleSpecifier: uid,
        isDynamic: false,
        ...(path ? { fallbackSpecifier: path } : {}),
      });
    } else if (path) {
      // No UID — use the text path directly
      imports.push({ moduleSpecifier: path, isDynamic: false });
    }
  }
  return imports;
}

/** Extract JS/TS imports from an ast-grep root node. Shared by JS/TS and Svelte/Vue handlers. */
function extractJsTsImportsFromNode(sgNode: ReturnType<ReturnType<typeof parse>["root"]>): ImportInfo[] {
  const imports: ImportInfo[] = [];

  // import ... from "..."
  for (const node of sgNode.findAll({ rule: { kind: "import_statement" } })) {
    const sourceNode = node.find({ rule: { kind: "string" } });
    if (sourceNode) {
      const spec = sourceNode.text().replace(/['"]/g, "");
      const isRequire = node.children().some((child) => child.kind() === "import_require_clause");
      imports.push({ moduleSpecifier: spec, isDynamic: false, ...(isRequire ? { isRequire: true } : {}) });
    }
  }
  // require("...")
  for (const node of sgNode.findAll({ rule: { kind: "call_expression" } })) {
    const text = node.text();
    const match = text.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/);
    if (match) {
      imports.push({ moduleSpecifier: match[1], isDynamic: false, isRequire: true });
    }
  }
  // dynamic import("...")
  for (const node of sgNode.findAll({ rule: { kind: "call_expression" } })) {
    const text = node.text();
    const match = text.match(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/);
    if (match) {
      imports.push({ moduleSpecifier: match[1], isDynamic: true });
    }
  }
  // export ... from "..."
  for (const node of sgNode.findAll({ rule: { kind: "export_statement" } })) {
    const sourceNode = node.find({ rule: { kind: "string" } });
    if (sourceNode) {
      const spec = sourceNode.text().replace(/['"]/g, "");
      imports.push({ moduleSpecifier: spec, isDynamic: false });
    }
  }

  return imports;
}

/** Split a `use` group body on its top-level commas, ignoring nested groups. */
function splitRustUseList(inner: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(inner.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

/**
 * The module a raw identifier names. `mod r#async;` declares the module
 * `async`, whose file rustc looks for as `async.rs` — the `r#` is how the
 * source escapes a keyword, not part of the name. Without stripping it, the
 * path `crate::r#async::poll` resolves to nothing and falls back to the crate
 * root, which draws an edge at the wrong file.
 */
function stripRawIdent(segment: string): string {
  return segment.startsWith("r#") ? segment.slice(2) : segment;
}

/**
 * One leaf of a `use` tree as a module path: the alias is dropped, and so are
 * trailing `self` and `*`, which name the module the path already reached
 * rather than something under it.
 */
function rustUseLeafPath(leaf: string): string {
  const trimmed = leaf.trim();
  // A leading `::` says the head names a crate, never a module in scope. The
  // marker is kept because the resolver now prefers a local module, and
  // dropping it turned `use ::config::Item;` into an edge at a local
  // `config.rs` that the source explicitly said not to look at.
  const global = trimmed.startsWith("::");
  const segments = trimmed
    .replace(/\s+as\s+(?:r#)?\w+\s*$/, "")
    .split("::")
    .map((segment) => stripRawIdent(segment.trim()))
    .filter(Boolean);
  while (segments.length > 0 && ["self", "*"].includes(segments[segments.length - 1])) {
    segments.pop();
  }
  if (segments.length === 0) return "";
  return global ? `::${segments.join("::")}` : segments.join("::");
}

/** A group leaf with its alias removed, which is what says whether it is `self`. */
function rustLeafHead(part: string): string {
  return part.replace(/\s+as\s+(?:r#)?\w+\s*$/, "").trim();
}

/**
 * Strip comments from a `use` declaration before its text is parsed as a path.
 *
 * A `use` tree may be spread over several lines with comments between the
 * leaves, and the text of the AST node carries them. Left in, they become path
 * segments: `crate::{ // note\n models::User }` yields the specifier
 * `crate::// note\n    models::User`, which names no module and falls back to
 * the crate root. A `use` holds no string literals, so removing comment spans
 * from the raw text is safe.
 */
function stripRustComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

/**
 * The chain of inline `mod` blocks enclosing a node, outermost first.
 *
 * `mod tests { … }` opens a module without opening a file, so a path written
 * inside it is relative to a position one level below the file. The chain is
 * what lets that position be reconstructed; it is empty for the overwhelming
 * majority of declarations, which sit at the top of a file.
 */
function rustInlineModules(node: SgNodeLike): InlinePosition {
  const chain: string[] = [];
  let innermost: SgNodeLike | null = null;
  let current = node.parent();
  while (current) {
    if (current.kind() === "mod_item") {
      innermost ??= current;
      // An inline `mod` may carry a `#[path]` of its own, and then it is that
      // path — not the module's name — that names the directory its children
      // live in. Where several are named, only one directory can be walked
      // from: the nearest is taken, the reading a single `#[path]` already got.
      const declared = rustPathAttributes(current).paths[0] ?? null;
      const name = current.field("name")?.text();
      if (declared) chain.unshift(declared.replace(/\/+$/, ""));
      else if (name) chain.unshift(stripRawIdent(name));
    }
    current = current.parent();
  }

  // What the innermost block declares by hand: a path whose head names one of
  // these is a path into the block, not out to another crate.
  //
  // Direct children only. `findAll` walks the whole subtree, so a module
  // declared two blocks down counted as this block's own: with
  // `mod nested { pub mod corelib { … } }` inside `outer`, a `use
  // corelib::marker;` written in `outer` was rebased into the block and drew an
  // edge to a file rustc never reaches — `error[E0432]: unresolved import
  // corelib` on rustc 1.98.0, edition 2021. A name declared in a nested block
  // is in that block's scope, not in this one's, which is the same rule that
  // keeps a block's declaration out of the file's scope.
  const declares = new Set<string>();
  let importsEverything = false;
  const body = innermost?.field("body");
  if (body) {
    for (const child of body.children()) {
      if (child.kind() === "mod_item") {
        const name = child.field("name")?.text();
        if (name) declares.add(stripRawIdent(name));
        continue;
      }
      // A glob rooted inside the crate puts names in the block that nothing
      // here can enumerate: `use super::*;` brings in every module the file
      // declares, and then a bare head inside the block does reach one —
      // verified on rustc 1.98.0, edition 2021, where the same line is E0432
      // with the glob removed. Where one appears, the block's scope is not
      // knowable from the block alone, so nothing is asserted about it.
      //
      // The whole path has to be read, not just the trailing `*`. A glob over a
      // dependency (`use std::collections::*;`) brings in nothing of this
      // crate, and one over a submodule (`use crate::prelude::*;`) brings in
      // only what that module re-exports — neither puts the file's own modules
      // in the block, and treating them as if they did switched the guard off
      // for any block that happened to contain one. Only the anchor itself
      // does: `use super::*;` at the first level is the file's own scope, in
      // whichever of its spellings it is written.
      if (child.kind() === "use_declaration") {
        const text = stripRustComments(child.text()).replace(/\s+/g, "");
        const tree = text.replace(/^(?:pub(?:\([^)]*\))?)?use/, "").replace(/;$/, "");
        if (namesAnchorGlob(tree, chain.length)) importsEverything = true;
      }
    }
  }
  return { chain, declares, importsEverything };
}

/**
 * True when a `use` tree names the glob that reaches out of `depth` inline
 * blocks and into the file's own scope: `super::*` from one level down,
 * `super::super::*` from two, and so on. Any spelling, flat or braced.
 *
 * The anchor is what puts the file's own modules into a block's scope, so
 * finding it is what switches the scope guard off. Reading only the flat
 * spelling missed the braced ones: `use {super::*};` is a group with no prefix
 * carrying the anchor inside, `use super::{*};` is the same import written the
 * other way round, and both compile where the bare head that follows is E0432
 * without them — checked on cargo 1.98.0, edition 2021, with
 * `use corelib::sub::Marker;` inside `pub mod block { … }`. The cost of missing
 * one is a real edge left undrawn.
 *
 * **The count matters, and the other anchors are not anchors here.** `self::*`
 * is the block's own scope, `crate::*` is the crate root, and `super::*` from
 * two levels down only reaches the block in between. None of them puts the
 * file's declarations in scope: `use crate::{*};` beside `use sibling::Marker;`
 * inside `mod inner` in a non-root file is E0432 on cargo 1.98.0, "a similar
 * path exists: super::sibling::Marker", and reading it as an anchor drew that
 * rejected import as an edge.
 *
 * A group is walked rather than matched: the anchor may sit at any depth
 * (`use {super::{*}};`), and rebuilding each leaf against its prefix is what
 * the recursion does.
 */
function namesAnchorGlob(tree: string, depth: number): boolean {
  const trimmed = tree.trim();
  if (!trimmed) return false;

  const open = trimmed.indexOf("{");
  if (open === -1) {
    const flat = trimmed.replace(/\s+/g, "");
    if (!flat.endsWith("::*")) return false;
    const segments = flat.slice(0, -3).split("::");
    return segments.length === depth && segments.every((segment) => segment === "super");
  }

  const close = trimmed.lastIndexOf("}");
  if (close < open) return false;

  // A leading `::` marks a crate outside this one, whose glob brings in nothing
  // the file declares. Only a prefix that is itself an anchor can lead to one.
  const prefix = trimmed.slice(0, open).replace(/::\s*$/, "").trim();
  if (prefix.startsWith("::")) return false;
  for (const part of splitRustUseList(trimmed.slice(open + 1, close))) {
    if (namesAnchorGlob(prefix ? `${prefix}::${part.trim()}` : part, depth)) return true;
  }
  return false;
}

/** Where a declaration sits inside inline `mod` blocks, and what they declare. */
interface InlinePosition {
  chain: string[];
  declares: Set<string>;
  /**
   * True when the innermost block carries a glob `use`, which puts names in its
   * scope that cannot be enumerated from the block. A bare head inside such a
   * block may legitimately reach a module the file declares, so nothing is
   * asserted about its scope.
   */
  importsEverything?: boolean;
}

/** The subset of the ast-grep node API this module reads. */
interface SgNodeLike {
  kind(): string;
  text(): string;
  parent(): SgNodeLike | null;
  prev(): SgNodeLike | null;
  field(name: string): SgNodeLike | null;
  findAll(matcher: { rule: { kind: string } }): SgNodeLike[];
  children(): SgNodeLike[];
  range(): { start: { index: number }; end: { index: number } };
}

/**
 * Rewrite a path written inside inline modules so it means the same thing when
 * read from the file's own position.
 *
 * `self` and `super` count module levels, and an inline `mod` is a level that
 * the file system does not show. `use super::open_store;` inside
 * `mod tests { … }` in `store/open.rs` names that very file — but counted from
 * the file it reads as the parent module, and an edge is drawn at
 * `store.rs`, which the source never imports. That edge also closes a cycle
 * with the `mod open;` declaration pointing the other way, and `#[cfg(test)]
 * mod tests` sits in a large share of all Rust files.
 *
 * Returns null when the path names the file itself, which is not an edge.
 * Paths anchored at `crate` are unaffected, and a bare head is left alone:
 * inside `mod tests`, `use some_crate::Thing;` is how a test reaches another
 * crate of the project, and rebasing it would lose that edge.
 */
function rustPathFromInline(path: string, inline: InlinePosition): string | null {
  const levels = inline.chain;
  if (levels.length === 0) return path;
  const segments = path.split("::").filter(Boolean);
  if (segments.length === 0) return null;
  if (segments[0] === "crate" || path.startsWith("::")) return path;

  let climbed = 0;
  let rest = segments;
  if (rest[0] === "self") {
    rest = rest.slice(1);
  } else {
    while (rest.length > 0 && rest[0] === "super") {
      climbed++;
      rest = rest.slice(1);
    }
    // A bare head is rebased only when the block itself declares a module by
    // that name — `mod tests { mod fixtures; use fixtures::build; }` is a path
    // into the block. Otherwise it is left alone, because the commoner shape
    // by far is `mod tests { use some_crate::Thing; }`, and rebasing that
    // would lose the edge to the other crate.
    if (climbed === 0) return inline.declares.has(segments[0]) ? `self::${levels.join("::")}::${path}` : path;
  }

  // Each `super` first consumes an inline level; only what is left of the
  // climb reaches the file system.
  const remainingClimb = Math.max(0, climbed - levels.length);
  const prefix = levels.slice(0, Math.max(0, levels.length - climbed));
  if (remainingClimb > 0) {
    return [...Array(remainingClimb).fill("super"), ...rest].join("::");
  }
  const rebased = [...prefix, ...rest];
  return rebased.length === 0 ? null : ["self", ...rebased].join("::");
}

/**
 * The values of the `path = "…"` arguments an attribute writes at its own
 * level, ignoring anything that only *looks* like one from inside a string.
 *
 * Scanning the raw text was enough until a doc string named a path:
 * `#[cfg_attr(docsrs, doc = r#"override with path = "custom.rs""#)] mod plain;`
 * compiles by convention against `src/plain.rs` on cargo 1.98.0, and reading
 * the doc's words as a relocation lost that edge without a trace. Strings are
 * skipped whole — plain, escaped and raw with any number of hashes — and only
 * what is left is read.
 */
function pathValuesOutsideStrings(text: string): string[] {
  const values: string[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];

    // A raw string opens with `r`, any number of `#`, and a quote; it ends at
    // the quote followed by the same number of hashes, and nothing inside it
    // escapes.
    if (ch === "r") {
      const raw = /^r(#*)"/.exec(text.slice(i));
      if (raw) {
        const closer = `"${raw[1]}`;
        const end = text.indexOf(closer, i + raw[0].length);
        i = end === -1 ? text.length : end + closer.length;
        continue;
      }
    }

    if (ch === '"') {
      // Read the string, and keep it when it is the value of a `path` written
      // outside any other string — which is what the walk has established by
      // arriving here.
      let j = i + 1;
      let value = "";
      while (j < text.length && text[j] !== '"') {
        if (text[j] === "\\") {
          value += text[j + 1] ?? "";
          j += 2;
          continue;
        }
        value += text[j];
        j += 1;
      }
      if (/\bpath\s*=\s*$/.test(text.slice(0, i))) values.push(value);
      i = j + 1;
      continue;
    }

    i += 1;
  }
  return values;
}

/**
 * Every file the `#[path = "…"]` attributes above a `mod` point at, relative to
 * the directory the declaring file sits in — never to the directory that file's
 * submodules live in. Both `src/a/b.rs` and `src/a/mod.rs` resolve
 * `#[path = "moved.rs"]` to `src/a/moved.rs`.
 *
 * Attributes are siblings preceding the `mod` in the tree, and several may
 * stack (`#[cfg(test)]` above `#[path = …]`), so the walk goes back through
 * all of them. Nearest first, which is the order a single declaration is read
 * in when only one path is named.
 *
 * **A `#[cfg_attr(…, path = "…")]` names one too**, and reading only the bare
 * form did real damage in both directions at once. It is the Rust Reference's
 * own example and the standard platform-abstraction idiom — 12 occurrences in 8
 * crates of a 141-crate registry sample, among them `libc`, `rustix`, `serde`
 * and `tempfile`. On `errno` the module `sys` is relocated to `unix.rs` or
 * `windows.rs` and `src/sys.rs` is never read; unread, the graph drew an edge
 * to a file rustc ignores and missed the one holding the whole crate body.
 * Reproduced on cargo 1.98.0 with a `compile_error!` in `src/sys.rs`: the
 * package builds, and the dep-info lists `src/unix.rs` and no `src/sys.rs`.
 *
 * Every named path is returned, and each draws its own edge. That is the
 * reading the rest of the model already takes: the graph is independent of
 * which features and target are selected, so a module that is `unix.rs` here
 * and `windows.rs` there depends on both as far as the tree is concerned.
 *
 * `conditional` says whether every path found came from a `cfg_attr`. When it
 * did, **the convention is still one of the answers**: with the condition
 * false the attribute is not applied at all and the module is the file its name
 * implies. `#[cfg_attr(any(), path = "ghost.rs")] mod platform;` compiles
 * against `src/platform.rs` on cargo 1.98.0, and reading only the named path
 * lost that edge while drawing one into a file rustc never opens.
 */
function rustPathAttributes(node: SgNodeLike): { paths: string[]; conditional: boolean } {
  const paths: string[] = [];
  let conditional = true;
  let previous = node.prev();
  // Comments count as siblings too, and one written between the attribute and
  // the `mod` it belongs to would otherwise end the walk before the attribute
  // is seen — a comment above a relocated module is exactly where someone
  // explains why it was relocated.
  while (previous && (previous.kind() === "attribute_item" || previous.kind().includes("comment"))) {
    const text = previous.text();
    const bare = text.match(/^#\[\s*path\s*=\s*"([^"]+)"\s*\]$/);
    if (bare) {
      paths.push(bare[1]);
      // A bare `#[path]` always applies, so the convention never comes back.
      conditional = false;
    } else if (/^#\[\s*cfg_attr\s*\(/.test(text)) {
      // The condition is not read: what it selects depends on the target and
      // the features, neither of which this graph fixes. Only `path` is picked
      // out of the attributes the `cfg_attr` would apply — a `#[cfg_attr(unix,
      // doc = "…")]` names none and contributes nothing.
      paths.push(...pathValuesOutsideStrings(text));
    }
    previous = previous.prev();
  }
  return { paths, conditional: paths.length > 0 && conditional };
}

/**
 * Flatten one `use` tree into the module paths it names, one per leaf:
 *
 *   crate::config::Config     → ["crate::config::Config"]
 *   crate::{a::Thing, b}      → ["crate::a::Thing", "crate::b"]
 *   crate::a::{self, b as c}  → ["crate::a", "crate::a::b"]
 *   crate::a::*               → ["crate::a"]
 *
 * A braced group is not a module path and never resolved to one; recording the
 * leaves instead is what lets `use crate::{parser, printer}` draw an edge to
 * each of the two files rather than to their parent module — or, in a flat
 * crate with no parent module file, to nothing at all.
 */
export function expandRustUseTree(tree: string): string[] {
  const trimmed = tree.trim();
  if (!trimmed) return [];

  const open = trimmed.indexOf("{");
  if (open === -1) {
    const leaf = rustUseLeafPath(trimmed);
    return leaf ? [leaf] : [];
  }
  const close = trimmed.lastIndexOf("}");
  if (close < open) return [];

  // A group written `::{a::b, c::d}` carries the external marker in its prefix
  // and nowhere else: stripping the trailing `::` leaves the empty string, and
  // an empty prefix is indistinguishable from a group with no prefix at all
  // (`use {a, b};`). Read that way, `use ::{log::info};` reached the local
  // module `log` again — the very capture the leading `::` exists to prevent,
  // and the same bug the single-path spelling had. `::corelib::{marker}` was
  // never affected, because there the marker survives inside a non-empty
  // prefix. Checked on rustc 1.98.0: in edition 2018 the braced global form
  // resolves to the dependency and `use log::info;` beside `pub mod log;`
  // is E0432, so the two spellings must not resolve to the same file.
  const rawPrefix = trimmed.slice(0, open).trim();
  const global = rawPrefix === "::";
  const prefix = rawPrefix.replace(/::\s*$/, "").trim();
  const paths: string[] = [];
  for (const part of splitRustUseList(trimmed.slice(open + 1, close))) {
    for (const expanded of expandRustUseTree(part)) {
      paths.push(prefix ? `${prefix}::${expanded}` : global ? `::${expanded}` : expanded);
    }
    // `self` and `*` expand to nothing, so the group's own prefix is what the
    // leaf named: `use crate::a::{self, b}` imports `crate::a` as well as
    // `crate::a::b`. The alias has to come off first — `{self as cfg}` is the
    // same leaf, and comparing the raw text dropped the whole import.
    const head = rustLeafHead(part);
    if ((head === "self" || head === "*") && prefix) paths.push(prefix);
  }
  return paths;
}

/**
 * The Rust source with the head and the braces of every `name! { … }` erased,
 * so what the invocation wraps is read as the items it is.
 *
 * tree-sitter keeps a macro's body as an unparsed token tree, so nothing inside
 * one is a node and `findAll` walks straight past it. Expansion happens before
 * name resolution, though, and a `mod x;` written in there is a declaration like
 * any other: **256 of tokio's 535 `mod` declarations (48%) were invisible**, and
 * 566 of 3,286 across a 141-crate registry sample, plus 348 `use` in tokio
 * alone. 59 of the 287 files rustc reads for tokio's lib had no incoming edge,
 * every one of them declared inside a macro body.
 *
 *     cfg_io_util! {          // tokio/src/io/util/mod.rs
 *         mod async_buf_read_ext;
 *         …36 declarations the graph did not see
 *     }
 *
 * The rewrite keeps every other character where it was, so what the body sits
 * inside is unchanged: a macro invoked inside `mod inner { … }` leaves its
 * declarations inside that block, and the inline-block machinery reads them
 * from there without knowing a macro was ever involved. **A macro body is not a
 * module level** — it opens no scope of its own — and blanking the braces
 * rather than the whole invocation is what says so.
 *
 * Only `{}` is unwrapped. A `()` or `[]` invocation carries an expression, not
 * items, and unwrapping it would feed the parser a fragment that is not one.
 *
 * **The limit that stays**: what a macro does with the tokens it is handed is
 * unknowable from the source. One that expands them declares the modules it
 * names; one that discards them declares nothing, and both are written the same
 * way. Reading the body is the answer that is right for the shapes that occur —
 * `cfg_if!` and the `cfg_*!` family, which is what the 295 invocations carrying
 * a `mod` in a 245-crate sample are made of — and wrong for a macro that throws
 * its argument away. Restricting to item positions closes the case that
 * actually occurs, `quote!`; a discarding macro in item position is left as a
 * known cost.
 *
 * And only where an item may stand. A macro body holds items when the
 * invocation itself is an item — that is the whole of the rule, and reading it
 * off the tree keeps the graph from having to know any library by name. Without
 * it, a proc-macro crate writing
 *
 *     quote! {
 *         mod generated;
 *     }
 *     .into()
 *
 * had `src/generated.rs` drawn as its dependency, though that module belongs to
 * whoever invokes the macro and rustc never reads the file here: verified on
 * cargo 1.98.0 with a `compile_error!` in it, where the crate builds clean and
 * the dep-info lists `src/lib.rs` alone.
 *
 * **And only while recovery stays inside the macro.** What the head and braces
 * hide is not always item syntax: `cfg_if!` writes its arms as
 *
 *     cfg_if! {
 *         if #[cfg(unix)] { mod arm_a; } else { mod arm_b; }
 *     }
 *
 * and an `if` carrying an attribute is not Rust anywhere. Blanking it hands the
 * parser a fragment it has to recover from, and recovery does not stop at the
 * macro: inside `mod inner { … }` it closes the block after the first arm and
 * re-parents everything after it to file level. On a cargo-verified crate that
 * builds clean the graph drew `src/lib.rs -> src/arm_b.rs` twice and
 * `src/lib.rs -> src/after.rs` — three edges into files carrying
 * `compile_error!`, one of them a module that belongs to the block, while
 * `mod after;` lost the edge it should have had.
 *
 * So the rewritten source is parsed before it is used, and it is kept only when
 * every ERROR node sits inside a macro this pass unwrapped, or is one the pass
 * before already accepted. Where one does not, the pass is redone with the
 * bodies that parse as items on their own — the rest stay the token trees they
 * were. `recoveryStaysInside` carries why the test is drawn there and not
 * around the ERROR itself, and why what an earlier pass hands on is its ERRORs
 * rather than its regions.
 *
 * The admission rule still decides what a body means: an `if #[cfg(…)]` is not
 * something the language guarantees, it is what one library spells its
 * condition with, and nothing here reads it as arms. What the graph keeps is
 * only what the parser puts where it was written.
 *
 * Returns null when there was nothing to unwrap, which is the common case, and
 * otherwise the rewritten source together with the tree the check already had
 * to build from it — the caller reads its imports off that tree rather than
 * parsing the same text a second time.
 */
function rustSourceWithMacroBodiesInlined(
  source: string,
  root: SgNodeLike,
  forgiven: Span[],
): UnwrappedSource | null {
  const regions: MacroRegion[] = [];
  for (const node of root.findAll({ rule: { kind: "macro_invocation" } })) {
    if (!standsWhereAnItemMay(node)) continue;
    const text = node.text();
    const open = text.indexOf("{");
    if (open === -1) continue;
    // The last brace has to close the invocation itself. Where it does not, the
    // delimiter is `(` or `[` and the `{` found above is inside the arguments.
    if (!text.trimEnd().endsWith("}")) continue;
    const close = text.lastIndexOf("}");
    if (close <= open) continue;

    const start = node.range().start.index;
    regions.push({
      start,
      open: start + open,
      close: start + close,
      insideBlock: node.parent()?.kind() === "declaration_list",
    });
  }
  if (regions.length === 0) return null;

  // An ERROR the source has before anything is blanked, outside every macro
  // about to be unwrapped and not one an earlier pass already accepted, will
  // reject every attempt below — the check is answered on the tree in hand,
  // before three parses that cannot pass.
  if (!recoveryStaysInside(root, regions, forgiven)) return null;

  // Recovery reached past a macro's own text, so the tree around it can no
  // longer be trusted — but the macro that let it out is one of the few written
  // inside a block, where an early `}` has a `mod` or an `impl` to close. The
  // ones at file level are dropped only if that is not enough.
  //
  // Dropping every unparsable body at the first sign of trouble costs whole
  // files: one `cfg_if!` written in an `impl` took with it every declaration the
  // `cfg_if!`s at file level carried. Across the 153 crates of a registry cache
  // that hold the shape, that was 78 distinct dependencies lost against HEAD;
  // narrowing the retry this way brings it to 56 and leaves ahash and dashmap
  // as they were. What stays lost is the file blanking breaks outright —
  // libc's `freebsd/mod.rs` parses as one ERROR from line 1 once its fifteen
  // `cfg_if!`s are blanked — and no reading of that tree would be worth
  // trusting.
  //
  // Each body is parsed on its own at most once, and only once the first
  // attempt has been refused: the common outcome is that it is not, and a
  // tokio file with a dozen `cfg_*!` bodies would otherwise pay a dozen
  // parses for nothing.
  const parsedAlone = new Map<MacroRegion, boolean>();
  const dirty = (r: MacroRegion): boolean => {
    let answer = parsedAlone.get(r);
    if (answer === undefined) {
      answer = !rustBodyIsItemsOnItsOwn(source.slice(r.open + 1, r.close));
      parsedAlone.set(r, answer);
    }
    return answer;
  };
  const narrower: (() => MacroRegion[])[] = [
    () => regions.filter((r) => !(r.insideBlock && dirty(r))),
    () => regions.filter((r) => !dirty(r)),
  ];

  let attempt = regions;
  for (;;) {
    const rewritten = rustSourceWithRegionsBlanked(source, attempt);
    let tree: SgNodeLike;
    try {
      tree = parse("rust" as unknown as Lang, rewritten).root() as unknown as SgNodeLike;
    } catch {
      return null;
    }
    const errors = recoveryStaysInside(tree, attempt, forgiven);
    if (errors) return { source: rewritten, root: tree, errors };

    // Retry with fewer bodies, but only when the next rule actually drops one.
    let next: MacroRegion[] | undefined;
    while (next === undefined && narrower.length > 0) {
      const candidate = narrower.shift()?.();
      if (candidate !== undefined && candidate.length < attempt.length) next = candidate;
    }
    if (next === undefined || next.length === 0) return null;
    attempt = next;
  }
}

/** A half-open range of character indexes in a source. */
interface Span {
  start: number;
  end: number;
}

interface UnwrappedSource {
  /** The rewritten Rust source. */
  source: string;
  /** Its tree, already built by the check that accepted it. */
  root: SgNodeLike;
  /**
   * Every ERROR node that tree holds — each inside a macro unwrapped in this
   * pass or an earlier one, or the check would not have accepted it. The next
   * pass forgives exactly these, and nothing else.
   */
  errors: Span[];
}

interface MacroRegion {
  /**
   * Whether the invocation is written inside a `mod`, `impl` or `trait` body —
   * the only place an early `}` produced by recovery has something to close,
   * and so the only place the damage can leave the macro.
   */
  insideBlock: boolean;
  /** Index of the first character of the invocation. */
  start: number;
  /** Index of the `{` that opens the body. */
  open: number;
  /** Index of the `}` that closes it. */
  close: number;
}

/** The source with the head and the braces of each region replaced by spaces. */
function rustSourceWithRegionsBlanked(source: string, regions: MacroRegion[]): string {
  const chars = source.split("");
  const blank = (at: number): void => {
    // Newlines stay: a line comment must keep ending where it ended, or what
    // follows it on the next line is swallowed.
    if (chars[at] !== "\n" && chars[at] !== "\r") chars[at] = " ";
  };
  for (const region of regions) {
    for (let i = region.start; i <= region.open; i++) blank(i);
    blank(region.close);
  }
  return chars.join("");
}

/**
 * Whether the rewritten source leaves the parser recovering only *inside* the
 * macros that were unwrapped.
 *
 * This is the test that decides whether the pass is usable, and it is the one
 * that matches the defect: what went wrong was never the ERROR node itself, it
 * was recovery reaching past the macro and re-parenting other people's items.
 * An `if #[cfg(…)]` written at file level leaves an ERROR on the attribute and
 * nothing else moves, so the declarations in the arms are read where they were
 * written — which is where rustc reads them too. The same arms inside
 * `mod inner { … }` close the block early, and everything after them lands at
 * file level: `src/lib.rs -> src/arm_b.rs` for a file carrying
 * `compile_error!`, plus a module of the block drawn as the file's own, both
 * verified against a clean `cargo build`.
 *
 * The distinction is worth drawing. Across a 1,256-crate registry cache, 449
 * macro bodies that carry declarations do not parse as items on their own — and
 * 431 of them stand at file level, where the pass is right. Refusing all of them
 * to close the 18 would pay for the fix with the case that works: `js-sys`,
 * `backtrace`, `ahash` and `aes` each lose real module edges.
 *
 * An ERROR earns its exemption one of two ways, and nothing else does. Either it
 * sits inside a macro *this* pass unwrapped, or it is — start and end — one the
 * earlier pass already accepted, which still stands in this pass's input since
 * blanking turns characters into spaces and removes none. The second pass reads
 * what the first rewrote, so a file-level `cfg_if!` kept there has its ERROR on
 * the attribute in this pass's text, and that one is forgiven.
 *
 * Two shortcuts look equivalent and both reopen the defect. Tolerating the
 * ERROR nodes a source already had: a file carrying an unresolved merge marker
 * inside `mod inner { … }` has an ERROR at the same index the recovery produces,
 * so the damaged pass was accepted and `mod after;` was drawn at file level
 * again — measured on the live version before this was tightened. Tolerating
 * anything inside a macro an earlier pass unwrapped: a clean body such as
 * `outer! { mod k { cfg_if! { … } mod z; } }` is accepted whole on the first
 * pass, and on the second the `cfg_if!` closes `mod k` early — the orphan `}`
 * that should reject the pass lies inside `outer!`'s region, and `mod z;` was
 * drawn at file level exactly as in the case this guard was written for. Found
 * by review, and the reason the exemption is a list of ERRORs, not of regions.
 *
 * A source that does not parse cleanly for reasons of its own therefore gets no
 * unwrapping at all, which is the conservative side to fall on: 1,771 of 34,655
 * `.rs` files in a registry cache are in that state, and not one of them carries
 * a declaration inside a macro body.
 *
 * Returns the ERROR nodes of an accepted tree, which is what the next pass is
 * handed, and null where one lies outside. The tree is the one the caller
 * already built and goes on to read its imports off, so the check adds no
 * parse of its own. What it still costs, measured on tokio with nine runs a
 * side alternating between the two: 2,013 ms before this change, 2,123 ms
 * after, against 1,304 ms on `main` — 5% of the graph build, on top of the 54%
 * the rest of the Rust work already costs.
 */
function recoveryStaysInside(
  root: SgNodeLike,
  regions: MacroRegion[],
  forgiven: Span[],
): Span[] | null {
  const errors: Span[] = [];
  for (const error of root.findAll({ rule: { kind: "ERROR" } })) {
    const start = error.range().start.index;
    const end = error.range().end.index;
    const inside = regions.some((r) => start >= r.start && end <= r.close + 1);
    const inherited = forgiven.some((f) => f.start === start && f.end === end);
    if (!inside && !inherited) return null;
    errors.push({ start, end });
  }
  return errors;
}

/**
 * Whether what a macro wraps parses as Rust items with nothing around it.
 *
 * The guard on blanking: a body that only makes sense to the macro reading it
 * leaves the parser recovering, and recovery rewrites the tree well past the
 * macro's own text. Asking the body alone keeps the answer the same wherever
 * the invocation stands.
 *
 * A tree-sitter ERROR node is the whole of the test. Recovery still produces
 * nodes under it, which is why the wrong edges were drawn in the first place —
 * they looked like ordinary declarations sitting at file level.
 */
function rustBodyIsItemsOnItsOwn(body: string): boolean {
  if (body.trim() === "") return false;
  try {
    const root = parse("rust" as unknown as Lang, body).root();
    return root.findAll({ rule: { kind: "ERROR" } }).length === 0;
  } catch {
    // A body the grammar cannot be run on is one we have no evidence about.
    return false;
  }
}

/**
 * Whether a node sits where a Rust *item* is written: the file itself, or the
 * body of a `mod`, `impl` or `trait`.
 *
 * A macro invocation anywhere else is an expression, and what it wraps is a
 * value being built rather than items being declared. That is what keeps a
 * proc-macro's `quote!` from being read as this crate's own declarations: the
 * module it names belongs to whoever invokes the macro, and rustc never opens
 * the file here — verified on cargo 1.98.0 with a `compile_error!` in it, where
 * the crate builds clean and its dep-info lists `src/lib.rs` alone.
 *
 * **A block is not on the list**, though an item may legally be written in one.
 * The tail expression of a block — a `quote! { … }` returned without a
 * semicolon, the idiom of every `fn … -> TokenStream` — has `block` for its
 * parent too, and nothing in the tree tells the two apart. Measured across
 * ripgrep, tokio and clap, admitting blocks adds not one edge, so the whole of
 * what it buys is that false one.
 *
 * An `impl` body does count, even though no `mod` may be written in one:
 * tokio's `cfg_unstable! { fn … { use crate::runtime::UnhandledPanic; } }` is
 * written there, and the `use` inside the function it wraps is a real
 * dependency.
 */
function standsWhereAnItemMay(node: SgNodeLike): boolean {
  const kind = node.parent()?.kind();
  return kind === "source_file" || kind === "declaration_list";
}

/**
 * A key that tells two extracted imports apart, for the merge below.
 *
 * `fromInlineBlock` is left out on purpose: it is not part of what an import
 * *is* but of how far the pass that read it could see. `mod tests { cfg_test! {
 * use super::*; } use outer::Thing; }` reads `outer::Thing` as a bare head in a
 * block on the first pass, because the glob that brings the file's own
 * declarations into scope is still hidden in the token tree; the second pass
 * sees the glob and reads the same line as a path the block may answer. Keyed
 * on the flag, both readings were kept, and the first one — resolved with no
 * declarations in scope — could reach a workspace crate named `outer` that
 * rustc would refuse with E0432. Found by review.
 */
function importKey(imp: ImportInfo): string {
  return [
    imp.moduleSpecifier,
    imp.isDynamic,
    imp.isCssImport ?? "",
    imp.isModuleDeclaration ?? "",
    imp.declaredName ?? "",
  ].join("\0");
}

/**
 * `already` with the second pass's reading folded in, counting repeats.
 *
 * The second pass over a macro-unwrapped source re-reads the whole file, so
 * everything the first pass found comes back with it. Each import the second
 * pass re-reads replaces the first pass's copy of it — the later reading saw
 * more of the file, and its scope flag is the right one — and what only the
 * macro bodies held is appended. An import the second pass did not come back
 * with stays: an `include! { "x.rs" }` written with braces is blanked like any
 * body, and only the first pass reads the file it names. Repeats survive on
 * both sides, since consumers count them.
 */
function withMacroPassMerged(already: ImportInfo[], found: ImportInfo[]): ImportInfo[] {
  const merged = already.slice();
  const unclaimed = new Map<string, number[]>();
  already.forEach((imp, at) => {
    const key = importKey(imp);
    const slots = unclaimed.get(key);
    if (slots) slots.push(at);
    else unclaimed.set(key, [at]);
  });
  for (const imp of found) {
    const at = unclaimed.get(importKey(imp))?.shift();
    if (at === undefined) merged.push(imp);
    else merged[at] = imp;
  }
  return merged;
}

/**
 * How many times a Rust source is re-read after unwrapping macro bodies.
 *
 * One pass covers what is written in a file; a second catches a macro that only
 * became visible when the one around it was unwrapped — provided it stands
 * where an item may. A macro written inside a `cfg_if!` arm does not: after
 * blanking, the arm is the block of a recovered `if`, and `standsWhereAnItemMay`
 * turns a block down for the reason it gives. So `cfg_if! { if #[cfg(unix)] {
 * cfg_io_util! { mod deep; } } }` reads nothing under `cfg_io_util!`, and a
 * nested `cfg_if!` in an arm — a shape libc writes — reads only its own text.
 * That is the limit of reading a body in place; reading each body on its own
 * with the invocation's scope would lift it.
 *
 * The bound is what keeps a pathological file from being re-parsed without end
 * — it is not a limit anything real has been seen to reach.
 */
const RUST_MACRO_UNWRAP_PASSES = 2;

/**
 * Extract import statements from source code using ast-grep.
 * Returns raw module specifiers for each language's import syntax.
 *
 * `unwrapped` is internal, and only the Rust macro pass passes it: the tree it
 * had to build to accept the source it rewrote, so the same text is not parsed
 * twice, and the regions it blanked, which the next pass needs to tell its own
 * damage from the last pass's leftovers. Nothing else should pass it — it
 * describes one particular `source` and would be read as if it described this
 * one.
 */
export function extractImports(
  source: string,
  lang: Lang | string,
  ext: string,
  unwrapPassesLeft: number = RUST_MACRO_UNWRAP_PASSES,
  unwrapped?: UnwrappedSource,
): ImportInfo[] {
  const imports: ImportInfo[] = [];
  const langKey = String(lang);

  if (isElixirTemplateExtension(ext)) {
    const analysis = analyzeElixirTemplate(source, ext);
    if (!analysis) return imports;
    for (const moduleSpecifier of analysis.moduleReferences) {
      imports.push({ moduleSpecifier, isDynamic: false });
    }
    if (analysis.elixirSource) {
      for (const item of extractImports(analysis.elixirSource, "elixir", ".ex")) {
        if (!imports.some((existing) => existing.moduleSpecifier === item.moduleSpecifier)) imports.push(item);
      }
    }
    return imports;
  }

  // ── Regex-only extraction for languages without AST grammars ──────────
  if (langKey === "dart") {
    // import 'package:foo/bar.dart'; / import 'relative.dart'; / export '...'
    for (const match of source.matchAll(/^(?:import|export)\s+['"]([^'"]+)['"]/gm)) {
      imports.push({ moduleSpecifier: match[1], isDynamic: false });
    }
    // part 'src/model.dart';
    for (const match of source.matchAll(/^part\s+['"]([^'"]+)['"]/gm)) {
      imports.push({ moduleSpecifier: match[1], isDynamic: false });
    }
    return imports;
  }

  if (langKey === "lua") {
    // require("foo.bar") / require 'foo'
    for (const match of source.matchAll(/require\s*[(]?\s*['"]([^'"]+)['"]\s*[)]?/gm)) {
      imports.push({ moduleSpecifier: match[1], isDynamic: false });
    }
    // dofile("path.lua") / loadfile("path.lua")
    for (const match of source.matchAll(/(?:dofile|loadfile)\s*\(\s*['"]([^'"]+)['"]\s*\)/gm)) {
      imports.push({ moduleSpecifier: match[1], isDynamic: false });
    }
    return imports;
  }

  // ── Godot resources (.tscn/.tres): regex-only, no AST grammar ─────────
  // Text-based INI-like files; dependencies are [ext_resource] declarations
  // with res:// or relative paths.
  if (langKey === "godot-resource") {
    return extractGodotResourceImports(source);
  }

  // ── GDScript: AST extraction with a syntax-aware fallback ──────────────
  // tree-sitter-gdscript is an optional dependency resolved via node-gyp-build.
  // When the native binary is available, AST extraction avoids false matches
  // in comments and string literals. When unavailable, use the lightweight lexer.
  if (langKey === "gdscript") {
    if (!gdscriptParserAvailable) {
      return extractGdscriptImportsRegex(source);
    }
    // AST-based extraction
    try {
      const sgNode = parse(lang, source).root();

      // extends "res://path.gd" or extends "relative/path.gd" — string form
      for (const node of sgNode.findAll({ rule: { kind: "extends_statement" } })) {
        // Find the direct string child (not an arbitrary descendant).
        // The extends_statement node has a string child when it's a
        // string-path extends, or a type child when it's a class-name extends.
        const children = node.children();
        const stringNode = children.find((c) => c.kind() === "string");
        if (stringNode) {
          const decoded = decodeGdscriptString(stringNode.text());
          if (decoded) {
            imports.push({ moduleSpecifier: decoded, isDynamic: false, godotImportKind: "extends" });
          }
        } else {
          // extends ClassName — class-name reference
          const typeNode = children.find((c) => c.kind() === "type");
          if (typeNode) {
            const rawType = typeNode.text().trim();
            const segments = rawType.split(".");
            const className = segments.length > 1
              ? (segments[0] ?? rawType).trim()
              : rawType;
            imports.push({ moduleSpecifier: `class:${className}`, isDynamic: false, godotImportKind: "extends" });
          }
        }
      }

      // preload("...") / load("...") — call nodes
      // Inspect the direct call argument, not an arbitrary descendant string.
      // load(resolve_path("res://fake.gd")) must NOT extract "res://fake.gd"
      // because the string is nested inside another call, not a direct
      // argument to load/preload.
      for (const node of sgNode.findAll({ rule: { kind: "call" } })) {
        const children = node.children();
        const identNode = children.find((c) => c.kind() === "identifier");
        if (!identNode) continue;
        const funcName = identNode.text();
        if (funcName !== "preload" && funcName !== "load") continue;

        // Find the direct argument: the first child after the function
        // identifier and "(" that is a string node.
        const args = children.find((c) => c.kind() === "arguments");
        if (!args) continue;
        const argChildren = args.children();
        // The first string in the arguments is the direct argument.
        // If the first argument is not a string (e.g. a call expression),
        // this is a dynamic expression — skip it, do not extract a path.
        const firstArgument = argChildren.find((child) => !["(", ")", ","].includes(String(child.kind())));
        const directString = firstArgument?.kind() === "string" ? firstArgument : undefined;
        if (directString) {
          const decoded = decodeGdscriptString(directString.text());
          if (decoded) {
            imports.push({
              moduleSpecifier: decoded,
              isDynamic: funcName === "load",
              godotImportKind: funcName,
            });
          }
        }
        // If no direct string argument, this is a dynamic expression like
        // load(resolve_path(...)) — no import edge is created.
      }

      return imports;
    } catch (err) {
      logger.warn("GDScript AST parse failed, falling back to regex", { error: String(err) });
      return extractGdscriptImportsRegex(source);
    }
  }

  // ── Svelte/Vue: parse as HTML, extract <script> blocks, re-parse as TS ──
  if (langKey === "svelte" || langKey === "vue") {
    try {
      const htmlRoot = parse(Lang.Html, source).root();
      const scriptElements = htmlRoot.findAll({ rule: { kind: "script_element" } });

      for (const scriptEl of scriptElements) {
        const rawText = scriptEl.find({ rule: { kind: "raw_text" } });
        if (!rawText) continue;

        const scriptContent = rawText.text();
        if (!scriptContent.trim()) continue;

        // Default to TypeScript (superset of JS, safe for both)
        const scriptRoot = parse(Lang.TypeScript, scriptContent).root();
        imports.push(...extractJsTsImportsFromNode(scriptRoot));
      }

      // Also extract CSS @import from <style> blocks
      const styleElements = htmlRoot.findAll({ rule: { kind: "style_element" } });
      for (const styleEl of styleElements) {
        const rawText = styleEl.find({ rule: { kind: "raw_text" } });
        if (rawText) imports.push(...extractCssImports(rawText.text()));
      }
    } catch (err) {
      logger.warn("Failed to parse Svelte/Vue file for imports", { error: String(err) });
    }
    return imports;
  }

  // ── AST-based extraction for languages with grammar support ───────────
  try {
    const sgNode = (unwrapped?.root as SgNode | undefined) ?? parse(lang, source).root();

    switch (langKey) {
      case "python": {
        // import foo / import foo.bar
        for (const node of sgNode.findAll({ rule: { kind: "import_statement" } })) {
          const text = node.text();
          const match = text.match(/^import\s+(.+)/);
          if (match) {
            for (const mod of match[1].split(",")) {
              const cleaned = mod.trim().split(/\s+as\s+/)[0].trim();
              if (cleaned) imports.push({ moduleSpecifier: cleaned, isDynamic: false });
            }
          }
        }
        // from foo import bar
        for (const node of sgNode.findAll({ rule: { kind: "import_from_statement" } })) {
          const text = node.text();
          const match = text.match(/^from\s+(\S+)\s+import/);
          if (match) {
            imports.push({ moduleSpecifier: match[1], isDynamic: false });
          }
        }
        break;
      }

      case "Css": {
        imports.push(...extractCssImports(source));
        break;
      }

      case "JavaScript":
      case "TypeScript":
      case "Tsx": {
        imports.push(...extractJsTsImportsFromNode(sgNode));
        break;
      }

      case "java": {
        // import com.example.Foo;
        for (const node of sgNode.findAll({ rule: { kind: "import_declaration" } })) {
          const text = node.text();
          const match = text.match(/^import\s+(?:static\s+)?([^;]+)/);
          if (match) {
            imports.push({ moduleSpecifier: match[1].trim(), isDynamic: false });
          }
        }
        break;
      }

      case "kotlin": {
        for (const node of sgNode.findAll({ rule: { kind: "import_header" } })) {
          const text = node.text();
          const match = text.match(/^import\s+(.+)/);
          if (match) {
            imports.push({ moduleSpecifier: match[1].trim(), isDynamic: false });
          }
        }
        break;
      }

      case "go": {
        // import "fmt" or import ("fmt"; "os")
        for (const node of sgNode.findAll({ rule: { kind: "import_spec" } })) {
          const pathNode = node.find({ rule: { kind: "interpreted_string_literal" } });
          if (pathNode) {
            const spec = pathNode.text().replace(/"/g, "");
            imports.push({ moduleSpecifier: spec, isDynamic: false });
          }
        }
        break;
      }

      // ── What counts as a Rust declaration, and what does not ─────────────
      //
      // Rust can put a module declaration where a reader does not look, and
      // each way it does is a candidate for this block. **One test decides
      // every one of them, so this never becomes a list of libraries we happen
      // to know:**
      //
      //     Does the language guarantee it, or does it require knowing a
      //     library?
      //
      // In, because the language guarantees them:
      //   - a `mod`/`use` written in a macro body — expansion happens before
      //     name resolution, so what is written there is a declaration. This is
      //     a fact about the language, not about any particular macro.
      //   - `#[path]`, and `#[cfg_attr(…, path = …)]`, which the Reference
      //     documents as the same relocation.
      //   - `include!("x.rs")` with a literal path, also in the Reference.
      //
      // Out, and not for lack of effort:
      //   - `automod::dir!("tests/x")` and anything like it. Reading it means
      //     teaching this file one third-party macro *and its expansion rules*
      //     — where the path counts from, whether the read recurses, which
      //     names are excluded. It is 92 files on clap and 163 across a
      //     245-crate sample, and **the size of the number is not what decides**:
      //     the moment it can, the criterion stops being "what the source says".
      //     `tests/unit/graph-discovery.test.ts` holds a test that pins this
      //     refusal, so moving the boundary cannot happen quietly.
      //   - `include!(concat!(env!("OUT_DIR"), …))` — that file does not exist
      //     until `build.rs` has run, so no reading of the source can find it.
      //
      // A case that passes the test is worth adding however few files it
      // reaches; one that fails it is refused however many. Whoever adds the
      // next one: answer the question above first, in the commit message.
      case "rust": {
        // use std::collections::HashMap;  /  pub use crate::config::Config;
        //
        // A `use_declaration` node carries its visibility modifier, so the
        // optional `pub` / `pub(crate)` / `pub(in path)` prefix has to be
        // consumed here: without it every re-export in the tree was dropped
        // before reaching the resolver, and re-exports are how a Rust crate
        // publishes its own modules.
        for (const node of sgNode.findAll({ rule: { kind: "use_declaration" } })) {
          const text = stripRustComments(node.text());
          const match = text.match(/^(?:pub\s*(?:\([^)]*\)\s*)?)?use\s+([\s\S]+?)\s*;?\s*$/);
          if (!match) continue;
          const inline = rustInlineModules(node as unknown as SgNodeLike);
          for (const spec of expandRustUseTree(match[1])) {
            const fromInline = rustPathFromInline(spec, inline);
            if (!fromInline) continue;
            // A bare head inside a block, left alone by the rebase above, is
            // either another crate or nothing — never a module the file
            // declares. Marking it here is what keeps the resolver from
            // answering it with the file's own declarations.
            const head = fromInline.replace(/^::/, "").split("::")[0];
            const bareInsideBlock =
              inline.chain.length > 0 &&
              !inline.importsEverything &&
              !fromInline.startsWith("::") &&
              !fromInline.startsWith("self::") &&
              !fromInline.startsWith("super::") &&
              !fromInline.startsWith("crate::") &&
              !inline.declares.has(head);
            imports.push({
              moduleSpecifier: fromInline,
              isDynamic: false,
              ...(bareInsideBlock ? { fromInlineBlock: true } : {}),
            });
          }
        }
        // mod foo;  /  pub mod foo;  /  pub(crate) mod foo;  /  mod r#async;
        for (const node of sgNode.findAll({ rule: { kind: "mod_item" } })) {
          // A body makes it a module definition, not a declaration pointing at
          // another file. Reading the field rather than looking for a brace in
          // the text keeps an attribute that happens to carry one out of it.
          if (node.field("body")) continue;
          const match = node
            .text()
            .match(/^(?:pub\s*(?:\([^)]*\)\s*)?)?mod\s+((?:r#)?\w+)\s*;/);
          if (!match) continue;
          const typed = node as unknown as SgNodeLike;
          const inline = rustInlineModules(typed);
          // `#[path = "…"]` moves the file away from every convention, and only
          // the attribute says where. It travels as a path with its extension,
          // which no module path ever has, and the resolver reads it as one.
          //
          // The two forms count from different places, which rustc settles and
          // no reading of the path can: a declared module resolves it against
          // the directory the declaring file sits in, while one inside an
          // inline block resolves it against that file's own module directory
          // plus a directory per inline level. The `self/` head marks the
          // second form for the resolver.
          const { paths: declaredPaths, conditional } = rustPathAttributes(typed);
          const name = stripRawIdent(match[1]);
          // The name a declaration brings into scope, which is the module's
          // name and never its file's: `#[path = "custom.rs"] mod foo;` puts
          // `foo` in scope, and `use foo::Item;` beside it compiles — checked
          // on cargo 1.70.0 and 1.98.0. It is carried separately because the
          // specifier cannot hold it: there it is a path, or an anchored
          // `self::…` chain. Declared inside an inline block, the name belongs
          // to that block and not to the file, so nothing is reported.
          const declaredName = inline.chain.length === 0 ? name : undefined;
          if (declaredPaths.length > 0) {
            // The name the declaration brings into scope is carried by exactly
            // one of the specifiers, because the map it feeds holds one file
            // per name. An unconditional `#[path]` takes it — that file is the
            // module, full stop. Where every path is conditional the convention
            // takes it instead: the map also answers this file's own
            // declaration, and pointing it at a conditional path made
            // `mod platform;` resolve to `ghost.rs` and lose `platform.rs`.
            const nameGoesToConvention = conditional;
            for (const [index, declaredPath] of declaredPaths.entries()) {
              const spec =
                inline.chain.length === 0
                  ? declaredPath
                  : `self/${inline.chain.join("/")}/${declaredPath}`;
              imports.push({
                moduleSpecifier: spec,
                isDynamic: false,
                isModuleDeclaration: true,
                declaredName: index === 0 && !nameGoesToConvention ? declaredName : undefined,
              });
            }
            // Every path came from a `cfg_attr`, so the condition may be false
            // and leave the module where its name puts it. That file is one of
            // the answers too, and it falls through to the convention below.
            if (!conditional) continue;
          }
          // Declared inside `mod outer { … }`, the file sits under `outer/`,
          // not beside the declaring file.
          const spec =
            inline.chain.length === 0 ? name : ["self", ...inline.chain, name].join("::");
          imports.push({
            moduleSpecifier: spec,
            isDynamic: false,
            isModuleDeclaration: true,
            // Claimed above by an unconditional `#[path]`, which is the module
            // whatever its name says; a conditional one leaves it here.
            declaredName: declaredPaths.length > 0 && !conditional ? undefined : declaredName,
          });
        }
        // extern crate serde;  /  #[macro_use] extern crate log as logging;
        //
        // The 2015 way of naming a dependency, still written today above a
        // `#[macro_use]`. The crate it names cannot collide with a local
        // module of the same name — rustc rejects that — so the bare name is
        // safe to resolve the way a `mod` declaration is.
        for (const node of sgNode.findAll({ rule: { kind: "extern_crate_declaration" } })) {
          const name = node.field("name")?.text();
          if (name && name !== "self") {
            imports.push({ moduleSpecifier: stripRawIdent(name), isDynamic: false });
          }
        }

        // `include!("gen.rs")` pastes a file's text where it stands. It brings
        // no name into scope, so it declares no module and carries no
        // `declaredName` — but the file is a source rustc opens, and cargo
        // lists it in the dep-info like any other. The Reference resolves the
        // path against the directory of the file that writes it, which is
        // already what a `.rs` specifier means to the resolver, inline module
        // or not: unlike a `#[path]`, an `include!` inside `mod inner { … }`
        // still counts from the file.
        //
        // A literal path only. `include!(concat!(env!("OUT_DIR"), "/x.rs"))`
        // names a file that does not exist until `build.rs` has run, which no
        // reading of the source can find — 94 of them across a 1,256-crate
        // registry cache, against 122 literal ones standing in code.
        //
        // Reading the AST rather than the text is also what keeps the
        // illustrative ones out: an `include!` written inside a doc comment is
        // part of that comment's node and never a `macro_invocation`, and there
        // are 9 of those in the same cache.
        for (const node of sgNode.findAll({ rule: { kind: "macro_invocation" } })) {
          const invocation = node.text();
          // Brackets are interchangeable on an invocation, and cargo accepts
          // all three spellings.
          const literal = invocation.match(/^\s*include\s*!\s*[([{]\s*"([^"]+\.rs)"\s*[)\]}]/);
          if (!literal) continue;
          imports.push({ moduleSpecifier: literal[1], isDynamic: false });
        }

        // What a macro invocation wraps is read last, on a source with its head
        // and braces blanked out, and folded into what the pass above found. See
        // `rustSourceWithMacroBodiesInlined` for why a body has to be read at
        // all, and why it is not a module level.
        if (unwrapPassesLeft > 0) {
          const inlined = rustSourceWithMacroBodiesInlined(
            source,
            sgNode as unknown as SgNodeLike,
            unwrapped?.errors ?? [],
          );
          if (inlined !== null) {
            const withBodies = extractImports(
              inlined.source,
              lang,
              ext,
              unwrapPassesLeft - 1,
              inlined,
            );
            imports.splice(0, imports.length, ...withMacroPassMerged(imports, withBodies));
          }
        }
        break;
      }

      case "csharp": {
        // using System.Collections;
        for (const node of sgNode.findAll({ rule: { kind: "using_directive" } })) {
          const text = node.text();
          // Skip using aliases: using Foo = Bar.Baz;
          if (text.match(/^using\s+\w+\s*=/)) continue;
          const match = text.match(/^using\s+(?:static\s+)?([^;=]+)/);
          if (match) {
            imports.push({ moduleSpecifier: match[1].trim(), isDynamic: false });
          }
        }
        break;
      }

      case "ruby": {
        // require "json" / require_relative "./helper"
        for (const node of sgNode.findAll({ rule: { kind: "call" } })) {
          const text = node.text();
          const reqMatch = text.match(/^require(?:_relative)?\s*[(]?\s*['"]([^'"]+)['"]/);
          if (reqMatch) {
            imports.push({
              moduleSpecifier: reqMatch[1],
              isDynamic: false,
            });
          }
        }
        break;
      }

      case "swift": {
        // import Foundation
        for (const node of sgNode.findAll({ rule: { kind: "import_declaration" } })) {
          const text = node.text();
          const match = text.match(/^import\s+(.+)/);
          if (match) {
            imports.push({ moduleSpecifier: match[1].trim(), isDynamic: false });
          }
        }
        break;
      }

      case "scala": {
        for (const node of sgNode.findAll({ rule: { kind: "import_declaration" } })) {
          const text = node.text();
          const match = text.match(/^import\s+(.+)/);
          if (match) {
            imports.push({ moduleSpecifier: match[1].trim(), isDynamic: false });
          }
        }
        break;
      }

      case "c":
      case "cpp": {
        // #include "myfile.h" or #include <stdio.h>
        for (const node of sgNode.findAll({ rule: { kind: "preproc_include" } })) {
          const text = node.text();
          // Only track local includes (quoted), not system includes (angle brackets)
          const localMatch = text.match(/#include\s+"([^"]+)"/);
          if (localMatch) {
            imports.push({ moduleSpecifier: localMatch[1], isDynamic: false });
          }
        }
        break;
      }
      case "php": {
        // use App\Models\User;
        // use App\Models\User as UserModel;
        // use function App\Helpers\format;
        // use const App\Config\MAX;
        // use App\Models\{User, Post, Comment};
        // use App\Models\User, App\Models\Post;
        for (const node of sgNode.findAll({ rule: { kind: "namespace_use_declaration" } })) {
          for (const spec of phpUseSpecifiers(node.text())) {
            imports.push({ moduleSpecifier: spec, isDynamic: false });
          }
        }
        // require/require_once/include/include_once, quoted or __DIR__-joined,
        // taken from the include expressions themselves. Collected across the
        // four kinds and re-sorted by position, so the specifiers stay in
        // document order rather than being grouped by construct.
        const requireNodes = PHP_REQUIRE_KINDS
          .flatMap((kind) => sgNode.findAll({ rule: { kind } }))
          .sort((a, b) => a.range().start.index - b.range().start.index);
        for (const node of requireNodes) {
          const spec = phpRequireSpecifier(node.text());
          if (spec) imports.push({ moduleSpecifier: spec, isDynamic: false });
        }
        break;
      }
      case "elixir": {
        // alias/import/require/use MyApp.Module [,...]
        const addImport = (moduleSpecifier: string): void => {
          if (!imports.some((item) => item.moduleSpecifier === moduleSpecifier)) {
            imports.push({ moduleSpecifier, isDynamic: false });
          }
        };
        for (const node of sgNode.findAll({ rule: { kind: "call" } })) {
          const target = node.field("target");
          const directive = target?.kind() === "identifier" ? target.text() : null;
          if (!directive || !["alias", "import", "require", "use"].includes(directive)) continue;
          const args = (node.children().find((child) => child.kind() === "arguments")?.text() ?? "")
            .replace(/^\(\s*/, "");
          const match = args.match(/^([A-Z]\w*(?:\.[A-Z]\w*)*)(?:\.\{([^}]+)\})?/);
          if (!match) continue;
          if (match[2]) {
            for (const member of match[2].split(",")) {
              const name = member.trim();
              if (/^[A-Z]\w*(?:\.[A-Z]\w*)*$/.test(name)) {
                addImport(`${match[1]}.${name}`);
              }
            }
          } else {
            addImport(match[1]);
          }
        }
        break;
      }

      case "bash": {
        // source ./script.sh or . ./script.sh
        for (const node of sgNode.findAll({ rule: { kind: "command" } })) {
          const text = node.text();
          const match = text.match(/^(?:source|\.)\s+(.+)/);
          if (match) {
            imports.push({ moduleSpecifier: match[1].trim(), isDynamic: false });
          }
        }
        break;
      }

      default:
        // Unsupported language for import extraction.
        // GDScript is handled earlier (before the AST switch) because it
        // has a separate parser-independent fallback path.
        break;
    }
  } catch (err) {
    const langKey = String(lang);
    if (!importExtractionWarned.has(langKey)) {
      importExtractionWarned.add(langKey);
      logger.warn(
        "Failed to parse file for imports; subsequent failures will be suppressed for this language",
        {
          lang: langKey,
          error: err instanceof Error ? err.message : String(err),
        },
      );
    }
  }

  return imports;
}
