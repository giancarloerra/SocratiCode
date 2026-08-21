// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited
import { Lang, parse } from "@ast-grep/napi";
import { analyzeElixirTemplate, isElixirTemplateExtension } from "./elixir-templates.js";
import { logger } from "./logger.js";

// ── Import extraction per language ───────────────────────────────────────

export interface ImportInfo {
  moduleSpecifier: string; // The raw import string
  isDynamic: boolean;
  isCssImport?: boolean;   // True when extracted from a CSS/style context
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

/** Extract JS/TS imports from an ast-grep root node. Shared by JS/TS and Svelte/Vue handlers. */
function extractJsTsImportsFromNode(sgNode: ReturnType<ReturnType<typeof parse>["root"]>): ImportInfo[] {
  const imports: ImportInfo[] = [];

  // import ... from "..."
  for (const node of sgNode.findAll({ rule: { kind: "import_statement" } })) {
    const sourceNode = node.find({ rule: { kind: "string" } });
    if (sourceNode) {
      const spec = sourceNode.text().replace(/['"]/g, "");
      imports.push({ moduleSpecifier: spec, isDynamic: false });
    }
  }
  // require("...")
  for (const node of sgNode.findAll({ rule: { kind: "call_expression" } })) {
    const text = node.text();
    const match = text.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/);
    if (match) {
      imports.push({ moduleSpecifier: match[1], isDynamic: false });
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

/**
 * Extract import statements from source code using ast-grep.
 * Returns raw module specifiers for each language's import syntax.
 */
export function extractImports(source: string, lang: Lang | string, ext: string): ImportInfo[] {
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
    const sgNode = parse(lang, source).root();

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

      case "rust": {
        // use std::collections::HashMap;
        for (const node of sgNode.findAll({ rule: { kind: "use_declaration" } })) {
          const text = node.text();
          const match = text.match(/^use\s+(.+);?\s*$/);
          if (match) {
            imports.push({ moduleSpecifier: match[1].trim().replace(/;$/, ""), isDynamic: false });
          }
        }
        // mod foo;
        for (const node of sgNode.findAll({ rule: { kind: "mod_item" } })) {
          const text = node.text();
          if (text.includes("{")) continue; // inline mod definition, not an import
          const match = text.match(/^mod\s+(\w+)\s*;/);
          if (match) {
            imports.push({ moduleSpecifier: match[1], isDynamic: false });
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
        for (const node of sgNode.findAll({ rule: { kind: "namespace_use_declaration" } })) {
          const text = node.text();

          // Grouped use: use App\Models\{User, Post};
          const groupMatch = text.match(/^use\s+(?:function\s+|const\s+)?([\w\\]+)\\\{([^}]+)\}/);
          if (groupMatch) {
            const prefix = groupMatch[1];
            const members = groupMatch[2].split(",");
            for (const member of members) {
              const name = member.trim().split(/\s+as\s+/)[0].trim();
              if (name) {
                imports.push({ moduleSpecifier: `${prefix}\\${name}`, isDynamic: false });
              }
            }
            continue;
          }

          // Single use: use App\Models\User; or use App\Models\User as Alias;
          const singleMatch = text.match(/^use\s+(?:function\s+|const\s+)?([\w\\]+)/);
          if (singleMatch) {
            imports.push({ moduleSpecifier: singleMatch[1].trim(), isDynamic: false });
          }
        }
        // require/require_once/include/include_once
        for (const node of sgNode.findAll({ rule: { kind: "expression_statement" } })) {
          const text = node.text();
          const match = text.match(/(?:require|include)(?:_once)?\s*[(]?\s*['"]([^'"]+)['"]/);
          if (match) {
            imports.push({ moduleSpecifier: match[1], isDynamic: false });
          }
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
        // Unsupported language for import extraction
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
