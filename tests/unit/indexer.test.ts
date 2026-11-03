// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CHUNK_SIZE, EXTENSION_LANGUAGE_MAP, MAX_CHUNK_CHARS } from "../../src/constants.js";
import { ensureDynamicLanguages, getAstGrepLang } from "../../src/services/code-graph.js";
import { chunkFileContent, chunkId, getIndexableFiles, hashContent, isIndexableFile } from "../../src/services/indexer.js";

// Register dynamic language grammars once for AST-aware chunking tests
beforeAll(() => {
  ensureDynamicLanguages();
});

describe("indexer utilities", () => {
  // ── hashContent ──────────────────────────────────────────────

  describe("hashContent", () => {
    it("returns a 16-character hex string", () => {
      const hash = hashContent("hello world");
      expect(hash).toMatch(/^[0-9a-f]{16}$/);
    });

    it("is deterministic (same input → same hash)", () => {
      const a = hashContent("const x = 42;");
      const b = hashContent("const x = 42;");
      expect(a).toBe(b);
    });

    it("produces different hashes for different content", () => {
      const a = hashContent("function foo() {}");
      const b = hashContent("function bar() {}");
      expect(a).not.toBe(b);
    });

    it("handles empty string", () => {
      const hash = hashContent("");
      expect(hash).toMatch(/^[0-9a-f]{16}$/);
    });

    it("handles unicode content", () => {
      const hash = hashContent("const greeting = '日本語テスト';");
      expect(hash).toMatch(/^[0-9a-f]{16}$/);
    });
  });

  // ── chunkId ──────────────────────────────────────────────────

  describe("chunkId", () => {
    it("returns a valid UUID format (8-4-4-4-12)", () => {
      const id = chunkId("/path/to/file.ts", 1);
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it("is deterministic (same inputs → same ID)", () => {
      const a = chunkId("/path/file.ts", 10);
      const b = chunkId("/path/file.ts", 10);
      expect(a).toBe(b);
    });

    it("produces different IDs for different lines", () => {
      const a = chunkId("/path/file.ts", 1);
      const b = chunkId("/path/file.ts", 50);
      expect(a).not.toBe(b);
    });

    it("produces different IDs for different files", () => {
      const a = chunkId("/path/foo.ts", 1);
      const b = chunkId("/path/bar.ts", 1);
      expect(a).not.toBe(b);
    });

    it("produces the same ID for the same relative path regardless of absolute prefix", () => {
      // With relative paths as the canonical key, worktrees at different
      // absolute locations produce identical chunk IDs.
      const relPath = "src/index.ts";
      const a = chunkId(relPath, 1);
      const b = chunkId(relPath, 1);
      expect(a).toBe(b);
      // And it differs from an absolute-looking path
      const c = chunkId("/home/user/project/src/index.ts", 1);
      expect(a).not.toBe(c);
    });
  });

  // ── isIndexableFile ──────────────────────────────────────────

  describe("isIndexableFile", () => {
    it("accepts supported extensions", () => {
      expect(isIndexableFile("app.ts")).toBe(true);
      expect(isIndexableFile("main.py")).toBe(true);
      expect(isIndexableFile("index.js")).toBe(true);
      expect(isIndexableFile("styles.css")).toBe(true);
      expect(isIndexableFile("theme.styl")).toBe(true);
      expect(isIndexableFile("data.json")).toBe(true);
      expect(isIndexableFile("readme.md")).toBe(true);
      expect(isIndexableFile("player.gd")).toBe(true);
      expect(isIndexableFile("level.tscn")).toBe(true);
      expect(isIndexableFile("material.tres")).toBe(true);
    });

    it("accepts special filenames", () => {
      expect(isIndexableFile("Dockerfile")).toBe(true);
      expect(isIndexableFile("Makefile")).toBe(true);
      expect(isIndexableFile("Gemfile")).toBe(true);
      expect(isIndexableFile("Rakefile")).toBe(true);
      expect(isIndexableFile("Procfile")).toBe(true);
      expect(isIndexableFile(".env.example")).toBe(true);
      expect(isIndexableFile(".gitignore")).toBe(true);
      expect(isIndexableFile(".dockerignore")).toBe(true);
    });

    it("rejects unsupported extensions", () => {
      expect(isIndexableFile("image.png")).toBe(false);
      expect(isIndexableFile("video.mp4")).toBe(false);
      expect(isIndexableFile("archive.zip")).toBe(false);
      expect(isIndexableFile("binary.exe")).toBe(false);
    });

    it("accepts extra extensions when provided", () => {
      const extras = new Set([".tpl", ".blade"]);
      expect(isIndexableFile("template.tpl", extras)).toBe(true);
      expect(isIndexableFile("view.blade", extras)).toBe(true);
    });

    it("still rejects unknown extensions even with extras", () => {
      const extras = new Set([".tpl"]);
      expect(isIndexableFile("image.png", extras)).toBe(false);
    });

    it("accepts extensions registered via EXTENSION_LANGUAGE_MAP", () => {
      // isIndexableFile reads the global override map; mutate it directly (it is
      // the same Map the function consults) and restore the prior state after,
      // so the test stays hermetic even if `.inc` is ever pre-configured.
      const baseline = isIndexableFile("foo.class.inc");
      const hadPrevious = EXTENSION_LANGUAGE_MAP.has(".inc");
      const previous = EXTENSION_LANGUAGE_MAP.get(".inc");
      EXTENSION_LANGUAGE_MAP.set(".inc", ".php");
      try {
        expect(isIndexableFile("foo.class.inc")).toBe(true);
      } finally {
        if (hadPrevious) EXTENSION_LANGUAGE_MAP.set(".inc", previous as string);
        else EXTENSION_LANGUAGE_MAP.delete(".inc");
      }
      // Restored to the pre-test baseline.
      expect(isIndexableFile("foo.class.inc")).toBe(baseline);
    });

    it("accepts .cfg and .ini extensions", () => {
      expect(isIndexableFile("config.cfg")).toBe(true);
      expect(isIndexableFile("settings.ini")).toBe(true);
    });

    it("is case-insensitive for extensions", () => {
      // path.extname preserves case but .toLowerCase() is applied
      expect(isIndexableFile("App.TS")).toBe(true);
      expect(isIndexableFile("Main.PY")).toBe(true);
    });
  });

  // ── getAstGrepLang (EXTENSION_LANGUAGE_MAP override) ───────────

  describe("getAstGrepLang override", () => {
    it("resolves a mapped extension to the target language's grammar", () => {
      const override = new Map([[".inc", ".php"]]);
      expect(getAstGrepLang(".inc", override)).toBe("php");
      // Case-insensitive, matching getLanguageFromExtension.
      expect(getAstGrepLang(".INC", override)).toBe("php");
      // The vocabulary subtlety: a Lang-enum language resolves correctly too.
      const tsOverride = new Map([[".component", ".ts"]]);
      expect(String(getAstGrepLang(".component", tsOverride))).toBe("TypeScript");
    });

    it("returns null for an unmapped extension and leaves built-ins intact", () => {
      const override = new Map([[".inc", ".php"]]);
      expect(getAstGrepLang(".xyz", override)).toBeNull();
      expect(getAstGrepLang(".php", override)).toBe("php");
    });
  });

  // ── chunkFileContent ─────────────────────────────────────────

  describe("chunkFileContent", () => {
    it("returns a single chunk for small files", () => {
      const content = "const x = 1;\nconst y = 2;\nconst z = 3;";
      const chunks = chunkFileContent("/test/small.ts", "small.ts", content);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].startLine).toBe(1);
      expect(chunks[0].endLine).toBe(3);
      expect(chunks[0].content).toBe(content);
      expect(chunks[0].language).toBe("typescript");
      expect(chunks[0].relativePath).toBe("small.ts");
    });

    it("creates multiple chunks for large files (line-based fallback)", () => {
      // Generate a file larger than CHUNK_SIZE lines with a non-AST language
      const lines = Array.from(
        { length: CHUNK_SIZE + 50 },
        (_, i) => `line ${i + 1}: some text content`,
      );
      const content = lines.join("\n");
      const chunks = chunkFileContent("/test/large.txt", "large.txt", content);

      expect(chunks.length).toBeGreaterThan(1);
      // First chunk starts at line 1
      expect(chunks[0].startLine).toBe(1);
      // Last chunk ends at the last line
      expect(chunks[chunks.length - 1].endLine).toBe(lines.length);
    });

    it("uses AST-aware chunking for TypeScript files", () => {
      // Generate a TS file with multiple functions exceeding CHUNK_SIZE
      const functions = Array.from({ length: 15 }, (_, i) => {
        const body = Array.from({ length: 10 }, (_, j) => `  const v${j} = ${j};`).join("\n");
        return `export function func${i}(): void {\n${body}\n}`;
      });
      const content = `import { something } from "./other";\n\n${functions.join("\n\n")}`;

      const chunks = chunkFileContent("/test/funcs.ts", "funcs.ts", content);

      expect(chunks.length).toBeGreaterThan(1);
      // All chunks should be TypeScript
      for (const chunk of chunks) {
        expect(chunk.language).toBe("typescript");
        expect(chunk.type).toBe("code");
      }
    });

    // ── empty-chunk invariant ──────────────────────────────────
    //
    // Three code paths could emit a chunk whose content is "". Because such a
    // chunk embeds as a path-only document, BM25 length-normalisation floats it
    // to rank 1 — a blank top hit for an otherwise good query.

    it("emits no blank chunk for a newline-terminated file", () => {
      // `lines.slice(lastEnd)` on a trailing "\n" yields [""], which is a
      // non-empty ARRAY of empty CONTENT. Guarding on array length is therefore
      // always true and emits content:"" at line N+1.
      const functions = Array.from({ length: 40 }, (_, i) => {
        const body = Array.from({ length: 3 }, (_, j) => `  const v${j} = ${i * j};`).join("\n");
        return `export function fn${i}(): void {\n${body}\n}`;
      });
      const content = `${functions.join("\n\n")}\n`;

      const chunks = chunkFileContent("/test/epilogue.ts", "epilogue.ts", content);

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.filter((c) => c.content.trim().length === 0)).toHaveLength(0);
    });

    it("emits no blank chunk for a file whose first line is blank", () => {
      // Same tautology in the preamble branch: `lines.slice(0, startLine)` with
      // startLine > 0 is never an empty array, so a leading blank line emits
      // content:"" at 1-1.
      const functions = Array.from({ length: 40 }, (_, i) => {
        const body = Array.from({ length: 3 }, (_, j) => `  const v${j} = ${i * j};`).join("\n");
        return `export function fn${i}(): void {\n${body}\n}`;
      });
      const content = `\n${functions.join("\n\n")}\n`;

      const chunks = chunkFileContent("/test/preamble.ts", "preamble.ts", content);

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.filter((c) => c.content.trim().length === 0)).toHaveLength(0);
    });

    it("emits no chunks at all for zero-byte and whitespace-only files", () => {
      // These reach chunkByLines and would otherwise yield a single blank chunk.
      // Real corpora contain them: Python package markers such as __init__.py.
      expect(chunkFileContent("/test/__init__.py", "__init__.py", "")).toHaveLength(0);
      expect(chunkFileContent("/test/blank.py", "blank.py", "\n\n\n")).toHaveLength(0);
      expect(chunkFileContent("/test/ws.txt", "ws.txt", "   \n\t\n  ")).toHaveLength(0);
    });

    it("does not let the character cap re-create a blank chunk", () => {
      // applyCharCap must truncate BEFORE the blank filter. If it filters first, a
      // chunk whose only non-whitespace content sits past MAX_CHUNK_CHARS passes the
      // filter and is then truncated back into a blank chunk — so the invariant would
      // hold at the filter and be violated by the time the chunk is returned.
      // 99 lines x 23 spaces = 2376 chars of padding, real code only on line 100.
      const padding = Array.from({ length: 99 }, () => " ".repeat(23)).join("\n");
      const content = `${padding}\nrealCode();\n`;

      const chunks = chunkFileContent("/test/padded.txt", "padded.txt", content);

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.filter((c) => c.content.trim().length === 0)).toHaveLength(0);
    });

    it("splits an oversized chunk rather than dropping content", () => {
      // Guards the other direction: split-then-filter must not discard real content.
      // 5000 characters with no newline against the default 2000 cap: the pieces
      // end at the cap, and every character still reaches a chunk.
      const content = "x".repeat(5000);
      const chunks = chunkFileContent("/test/big.txt", "big.txt", content);

      expect(chunks.map((c) => c.content).join("")).toBe(content);
      expect(chunks.map((c) => c.content.length)).toEqual([2000, 2000, 1000]);
    });

    it("still chunks ordinary files normally", () => {
      // Guards against an over-broad filter silently emptying the index.
      const chunks = chunkFileContent("/test/ok.ts", "ok.ts", 'export const x = 1;\n');
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].content).toContain("export const x = 1;");
    });

    it("uses AST-aware chunking for Dart files (class and signature/body boundaries)", () => {
      // Two large Dart classes plus a top-level function, exceeding CHUNK_SIZE
      // lines. Dart splits a top-level function into sibling signature and
      // body nodes; if the two were not merged into one region, the function
      // body would be severed from its signature.
      const method = (name: string) => {
        const body = Array.from({ length: 12 }, (_, j) => `    final v${j} = ${j};`).join("\n");
        return `  void ${name}() {\n${body}\n  }`;
      };
      // Six 14-line methods per class (~86 lines each): two classes exceed the
      // 150-line merge cap, so the chunker must flush them as separate chunks
      // instead of grouping them (small adjacent declarations merge by design).
      const classOf = (name: string) =>
        `class ${name} {\n${Array.from({ length: 6 }, (_, i) => method(`m${i}`)).join("\n")}\n}`;
      const topFn = `Future<int> compute() async {\n${Array.from({ length: 12 }, (_, j) => `  final t${j} = ${j};`).join("\n")}\n  return 1;\n}`;
      const content = `import 'package:foo/bar.dart';\n\n${classOf("Alpha")}\n\n${classOf("Beta")}\n\n${topFn}\n`;

      const chunks = chunkFileContent("/test/app.dart", "app.dart", content);

      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.language).toBe("dart");
      }
      // AST-aware (not line-based): each class lives in a single chunk whose
      // content begins at the declaration. Beta spans lines ~90-175, so a
      // fixed 100-line window would split it mid-body.
      const lines = content.split("\n");
      const alphaLine = lines.findIndex((l) => l.startsWith("class Alpha")) + 1;
      expect(chunks.some((c) => c.startLine === alphaLine)).toBe(true);
      const betaLine = lines.findIndex((l) => l.startsWith("class Beta")) + 1;
      const betaClassLines = classOf("Beta").split("\n").length;
      const betaChunk = chunks.find((c) => c.startLine <= betaLine && c.endLine >= betaLine);
      expect(betaChunk).toBeDefined();
      expect(betaChunk?.content.trim().startsWith("class Beta")).toBe(true);
      expect(betaChunk?.endLine).toBeGreaterThanOrEqual(betaLine + betaClassLines - 1);
      // The top-level function's signature and body stay in the same chunk.
      const computeLine = lines.findIndex((l) => l.startsWith("Future<int> compute")) + 1;
      const computeChunk = chunks.find((c) => c.startLine <= computeLine && c.endLine >= computeLine);
      expect(computeChunk).toBeDefined();
      expect(computeChunk?.content).toContain("return 1;");
    });

    it("sets correct language for Python files", () => {
      const content = "def hello():\n    print('hello')";
      const chunks = chunkFileContent("/test/app.py", "app.py", content);

      expect(chunks[0].language).toBe("python");
    });

    it("sets correct language for JSON files", () => {
      const content = '{"key": "value"}';
      const chunks = chunkFileContent("/test/data.json", "data.json", content);

      expect(chunks[0].language).toBe("json");
    });

    it("generates valid UUID chunk IDs", () => {
      const content = "const x = 1;";
      const chunks = chunkFileContent("/test/file.ts", "file.ts", content);

      for (const chunk of chunks) {
        expect(chunk.id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );
      }
    });

    it("chunks have non-overlapping line ranges covering the whole file", () => {
      const lines = Array.from(
        { length: CHUNK_SIZE * 3 },
        (_, i) => `line ${i + 1}`,
      );
      const content = lines.join("\n");
      const chunks = chunkFileContent("/test/big.txt", "big.txt", content);

      // First chunk starts at line 1
      expect(chunks[0].startLine).toBe(1);
      // Last chunk ends at last line
      expect(chunks[chunks.length - 1].endLine).toBe(lines.length);
      // No gaps between chunks (accounting for overlap)
      for (let i = 1; i < chunks.length; i++) {
        expect(chunks[i].startLine).toBeLessThanOrEqual(chunks[i - 1].endLine + 1);
      }
    });

    it("uses character-based chunking for minified content", () => {
      // Create a single very long line that exceeds MAX_AVG_LINE_LENGTH average
      const longLine = "var a=1;" .repeat(500); // ~4000 chars, 1 line → avg >> 500
      const chunks = chunkFileContent("/test/bundle.min.js", "bundle.min.js", longLine);

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      // All chunks should be JavaScript
      for (const chunk of chunks) {
        expect(chunk.language).toBe("javascript");
      }
      // Total content should cover the entire input
      const totalContent = chunks.map((c) => c.content).join("");
      expect(totalContent).toBe(longLine);
    });

    it("character-based chunking splits at safe boundaries", () => {
      // Create minified content with semicolons as natural split points
      const segment = `var x${"x".repeat(100)}=1;`;
      // Repeat enough to exceed MAX_CHUNK_CHARS
      const content = segment.repeat(Math.ceil(MAX_CHUNK_CHARS / segment.length) * 3);
      const chunks = chunkFileContent("/test/app.min.js", "app.min.js", content);

      expect(chunks.length).toBeGreaterThan(1);
      // Each chunk should not exceed MAX_CHUNK_CHARS
      for (const chunk of chunks) {
        expect(chunk.content.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
      }
      // Content should be fully preserved (no data loss)
      const reassembled = chunks.map((c) => c.content).join("");
      expect(reassembled).toBe(content);
    });

    it("character-based chunks have unique IDs based on byte offset", () => {
      // Single long line → multiple chunks, all with startLine=1
      const content = "a".repeat(MAX_CHUNK_CHARS * 3);
      const chunks = chunkFileContent("/test/single-line.min.js", "single-line.min.js", content);

      expect(chunks.length).toBeGreaterThan(1);
      // All IDs should be unique (discriminated by byte offset, not line number)
      const ids = new Set(chunks.map((c) => c.id));
      expect(ids.size).toBe(chunks.length);
    });

    it("applies char cap to truncate oversized chunks", () => {
      // Create a file where a single AST region or line-based chunk would exceed MAX_CHUNK_CHARS.
      // Use a non-minified file (low avg line length) with a few very long lines so
      // it doesn't trigger character-based chunking but still produces an oversized chunk.
      const longLine = `// ${"x".repeat(MAX_CHUNK_CHARS + 500)}`;
      const normalLines = Array.from({ length: 5 }, (_, i) => `const v${i} = ${i};`);
      const content = [...normalLines, longLine, ...normalLines].join("\n");
      const chunks = chunkFileContent("/test/long-comment.txt", "long-comment.txt", content);

      // Every chunk must be within MAX_CHUNK_CHARS
      for (const chunk of chunks) {
        expect(chunk.content.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
      }
    });
  });

  // ── getIndexableFiles (INCLUDE_DOT_FILES) ─────────────────────────────

  describe("getIndexableFiles", () => {
    let tmpDir: string;

    beforeAll(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "socraticode-dotfiles-test-"));

      // Regular file
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "index.ts"), "export const x = 1;\n");

      // Dot-directory with an indexable file
      fs.mkdirSync(path.join(tmpDir, ".agent", "rules"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, ".agent", "rules", "config.ts"), "export const rule = true;\n");

      // Dot-file at root (e.g. .gitignore)
      fs.writeFileSync(path.join(tmpDir, ".gitignore"), "node_modules/\n");
    });

    afterAll(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("excludes dot-directory files by default", async () => {
      const files = await getIndexableFiles(tmpDir);
      const hasDotDir = files.some((f) => f.includes(".agent"));
      expect(hasDotDir).toBe(false);
    });

    it("includes dot-directory files when INCLUDE_DOT_FILES=true", async () => {
      vi.stubEnv("INCLUDE_DOT_FILES", "true");
      try {
        const files = await getIndexableFiles(tmpDir);
        const dotFiles = files.filter((f) => f.includes(".agent"));
        expect(dotFiles.length).toBeGreaterThan(0);
        expect(dotFiles.some((f) => f.includes("config.ts"))).toBe(true);
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("treats INCLUDE_DOT_FILES case-insensitively", async () => {
      vi.stubEnv("INCLUDE_DOT_FILES", "True");
      try {
        const files = await getIndexableFiles(tmpDir);
        const hasDotDir = files.some((f) => f.includes(".agent"));
        expect(hasDotDir).toBe(true);
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("excludes dot-directory files for non-true values", async () => {
      vi.stubEnv("INCLUDE_DOT_FILES", "yes");
      try {
        const files = await getIndexableFiles(tmpDir);
        const hasDotDir = files.some((f) => f.includes(".agent"));
        expect(hasDotDir).toBe(false);
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });

  describe("getIndexableFiles — extensionless detection", () => {
    let root: string;

    beforeAll(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), "socraticode-idx-extless-"));
      fs.mkdirSync(path.join(root, "bin"), { recursive: true });
      fs.writeFileSync(
        path.join(root, "bin", "strato-check-x"),
        "#!/bin/bash\ncurl -sf localhost || exit 1\n",
      );
      fs.writeFileSync(path.join(root, "wscript"), "def build(bld):\n    bld.program(source='a.c')\n");
      fs.writeFileSync(path.join(root, "LICENSE"), "MIT License\n\nCopyright (c) 2026\n");
      fs.writeFileSync(path.join(root, "app.ts"), "export const x = 1;\n");
      fs.writeFileSync(path.join(root, "blob"), Buffer.from([0x00, 0x01, 0x02, 0x03]));
      fs.writeFileSync(path.join(root, ".profile"), 'set -eu\nif [ -d "$HOME/bin" ]; then\n  export PATH="$HOME/bin"\nfi\n');
    });

    afterAll(() => {
      fs.rmSync(root, { recursive: true, force: true });
    });

    it("indexes detected extensionless scripts, skips non-code and binary", async () => {
      const files = await getIndexableFiles(root);
      expect(files).toContain(path.join("bin", "strato-check-x"));
      expect(files).toContain("wscript");
      expect(files).toContain("app.ts");
      expect(files).not.toContain("LICENSE");
      expect(files).not.toContain("blob");
    });

    it("restores old behavior when INDEX_EXTENSIONLESS=false", async () => {
      vi.stubEnv("INDEX_EXTENSIONLESS", "false");
      try {
        const files = await getIndexableFiles(root);
        expect(files).toContain("app.ts");
        expect(files).not.toContain("bin/strato-check-x");
        expect(files).not.toContain("wscript");
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("indexes an extensionless code dotfile only when INCLUDE_DOT_FILES=true", async () => {
      // Default: dotfiles are not globbed at all, so the graph must exclude them too.
      expect(await getIndexableFiles(root)).not.toContain(".profile");
      vi.stubEnv("INCLUDE_DOT_FILES", "true");
      try {
        expect(await getIndexableFiles(root)).toContain(".profile");
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });

  describe("chunkFileContent — extensionless language", () => {
    it("labels a detected shell probe as shell and preserves the path", () => {
      const chunks = chunkFileContent("/proj/bin/strato-check-x", "bin/strato-check-x", "#!/bin/bash\necho ok\n");
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].language).toBe("shell");
      expect(chunks[0].relativePath).toBe("bin/strato-check-x");
    });

    it("labels a no-shebang Python wscript as python", () => {
      const chunks = chunkFileContent("/proj/wscript", "wscript", "def build(bld):\n    pass\n");
      expect(chunks[0].language).toBe("python");
    });

    it("produces no chunks when an extensionless file no longer detects as code", () => {
      // If content changed since discovery admitted the file (TOCTOU) so it no
      // longer detects as code, the chunker must emit nothing rather than index
      // it as plaintext — matching getIndexableFiles' eligibility contract.
      const chunks = chunkFileContent("/proj/was-a-probe", "was-a-probe", "just some prose, not code at all\n");
      expect(chunks).toEqual([]);
    });

    it("leaves a SPECIAL_FILE (Makefile) as plaintext despite a shell-recipe body", () => {
      // Load-bearing: this Makefile body sniffs to shell (tab-indented `set -e`,
      // `if…then`), so removing chunkFileContent's SPECIAL_FILES guard would
      // relabel it "shell". The guard must keep it "plaintext".
      const chunks = chunkFileContent(
        "/proj/Makefile",
        "Makefile",
        "build:\n\tset -euo pipefail\n\tif [ -f foo ]; then echo yes; fi\n",
      );
      expect(chunks[0].language).toBe("plaintext");
    });

    it("respects the kill-switch (plaintext when INDEX_EXTENSIONLESS=false)", () => {
      vi.stubEnv("INDEX_EXTENSIONLESS", "false");
      try {
        const chunks = chunkFileContent("/proj/bin/probe", "bin/probe", "#!/bin/bash\necho ok\n");
        expect(chunks[0].language).toBe("plaintext");
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("detects on the head window only, not the whole file (>8 KiB)", async () => {
      // Shell signals in the first 8 KiB, Python signals pushed well past it.
      // chunk-time detection must inspect only the head (matching discovery), so
      // this is "shell"; using the full content would flip it to "python".
      const head = "set -eu\nif [ -f x ]; then\n  echo y\nfi\n";
      const filler = "# comment line padding\n".repeat(400); // ~9 KiB, no code signals
      const pyTail = "def render():\n    return 1\n\nclass C:\n    pass\n\nimport os\n";
      const chunks = chunkFileContent("/proj/genscript", "genscript", head + filler + pyTail);
      expect(chunks[0].language).toBe("shell");
    });
  });
});
