// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited
import { type Dirent, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parse as parseToml, type TomlTable, type TomlValue } from "smol-toml";
import { toForwardSlash } from "../constants.js";
import { extractClassNameFromGdscript } from "./gdscript-syntax.js";
import type { PathAliases } from "./graph-aliases.js";
import type { GraphInputRecorder } from "./graph-inputs.js";
import { extractSymbolsAndCalls } from "./graph-symbols.js";
import { createIgnoreFilter, shouldIgnore } from "./ignore.js";

// ── Module resolution ────────────────────────────────────────────────────

/**
 * Build a suffix lookup map for JVM (Java/Kotlin/Scala) files in multi-module projects.
 *
 * For a Maven/Gradle multi-module layout such as:
 *   module-a/sub-module/src/main/java/com/example/Foo.java
 * the map entry is:
 *   key:   "com/example/Foo.java"  (forward-slash-normalized)
 *   value: "module-a/sub-module/src/main/java/com/example/Foo.java"
 *
 * This enables O(1) resolution of fully-qualified class names that cannot be
 * found via the standard prefix-based scan (e.g. src/main/java/…).
 *
 * Call this once per graph build and pass the result to resolveImport.
 *
 * When two modules provide the same class path, the first one iterated wins, so
 * `fileSet`'s order decides between them — pass a lexicographically ordered set
 * (as `buildCodeGraph` does) for a stable pick. Either file resolves the import;
 * ordering only settles which, so an unordered caller gets a valid map with an
 * arbitrary winner.
 */
export function buildJvmSuffixMap(fileSet: Set<string>): Map<string, string> {
  const map = new Map<string, string>();
  const jvmExts = new Set([".java", ".kt", ".kts", ".scala"]);

  for (const f of fileSet) {
    if (!jvmExts.has(path.extname(f))) continue;

    // Split on either separator so the logic works on Windows and POSIX.
    const parts = f.split(/[\\/]/);

    // Find the first occurrence of src/main/<lang> boundary.
    const jvmLangs = new Set(["java", "kotlin", "scala"]);
    const idx = parts.findIndex(
      (p, i) =>
        p === "src" &&
        parts[i + 1] === "main" &&
        jvmLangs.has(parts[i + 2]),
    );

    if (idx !== -1) {
      // classPath = everything after src/main/<lang>, e.g. com/example/Foo.java
      const classPath = parts.slice(idx + 3).join("/");
      // Only register the first match to avoid ambiguity for duplicate class names.
      if (!map.has(classPath)) {
        map.set(classPath, f);
      }
    }
  }

  return map;
}

/**
 * Build a namespace lookup map for C# files.
 *
 * Scans every `.cs` file in the project for `namespace X.Y.Z` declarations
 * (both block-scoped `namespace X { ... }` and file-scoped `namespace X;`
 * introduced in C# 10) and builds:
 *
 *   key:   "App.Services"
 *   value: ["src/Services/OrderService.cs", "src/Services/UserService.cs"]
 *
 * Used to resolve `using App.Services;` to the candidate files that
 * contribute to that namespace. Without this, every C# `using` resolved
 * to `null` and C# projects produced an empty file-import graph.
 *
 * Files are processed in lexicographic order so the resulting candidate
 * lists are deterministic across machines and runs. This matters because
 * multi-file namespaces resolve to `candidates[0]` in `resolveImport`,
 * and a stable "first" file is required for reproducible graphs.
 *
 * Cost: O(n) reads at graph-build time (negligible vs. AST parsing). Files
 * with no `namespace` declaration are silently skipped. Read failures are
 * swallowed since this is best-effort.
 */
export function buildCsNamespaceMap(
  fileSet: Set<string>,
  projectPath: string,
  recorder?: GraphInputRecorder,
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  // Match both `namespace Foo.Bar { ... }` and the file-scoped C# 10+
  // syntax `namespace Foo.Bar;`. The `^\s*` lets us catch nested
  // declarations (`namespace Outer { namespace Inner { ... } }`) which
  // are indented inside the outer block. The dotted-identifier capture
  // requires each segment to start with a letter or underscore (matching
  // C# identifier rules) so junk like `namespace 1Foo` is rejected. The
  // `(?=[;{])` lookahead ensures we only match real declarations and
  // not stray occurrences of the word `namespace`.
  const namespaceRegex =
    /^\s*namespace\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*(?=[;{])/gm;

  // Sort .cs paths lexically so `candidates[0]` is deterministic without relying
  // on how the caller ordered `fileSet` — this map owns its own ordering.
  const csFiles = [...fileSet]
    .filter((f) => path.extname(f).toLowerCase() === ".cs")
    .sort();

  for (const f of csFiles) {
    let source: string;
    const absPath = path.join(projectPath, f);
    try {
      source = readFileSync(absPath, "utf-8");
    } catch {
      continue;
    }
    recorder?.read(absPath, source);
    for (const match of source.matchAll(namespaceRegex)) {
      const ns = match[1];
      const existing = map.get(ns);
      if (existing) {
        if (!existing.includes(f)) existing.push(f);
      } else {
        map.set(ns, [f]);
      }
    }
  }

  return map;
}

/**
 * Discover every `composer.json` under `projectPath`, project-relative and
 * forward-slash-normalized.
 *
 * `composer.json` is not a graphable file, so it is never in the set returned
 * by `getGraphableFiles` — this walk is independent of that set, exactly like
 * {@link findGoModFiles}. The same ignore filter (`createIgnoreFilter` /
 * `shouldIgnore`) `getGraphableFiles` uses is applied, with the same
 * trailing-slash convention for directories, so a manifest under
 * `node_modules/`, `.git/` or any gitignored or `.socraticodeignore`d path is
 * skipped — matching what the graphable walk would do.
 *
 * `vendor/` is additionally skipped unconditionally. DEFAULT_IGNORE_PATTERNS
 * already lists it, but a `.socraticodeignore` negation (`!vendor/`) can
 * re-include it, and a Composer path repository symlinks `vendor/<pkg>` back
 * to the in-repo source, so a manifest read through it would register a
 * second directory for a prefix the in-repo manifest already declared —
 * pointing at a path whose files were indexed under their real location.
 */
function findComposerManifests(projectPath: string): string[] {
  const ig = createIgnoreFilter(projectPath);
  const results: string[] = [];
  const walk = (dir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relPath = toForwardSlash(path.relative(projectPath, path.join(dir, entry.name)));
      if (shouldIgnore(ig, entry.isDirectory() ? `${relPath}/` : relPath)) continue;
      if (entry.isDirectory()) {
        if (entry.name === "vendor") continue;
        walk(path.join(dir, entry.name));
      } else if (entry.name === "composer.json") {
        // Mirrors findGoModFiles: readdirSync Dirents do not follow symlinks,
        // so a symlinked manifest reports isFile()===false and would be missed.
        let isFile = entry.isFile();
        if (!isFile && entry.isSymbolicLink()) {
          try {
            isFile = statSync(path.join(dir, entry.name)).isFile();
          } catch {
            continue;
          }
        }
        if (isFile) results.push(relPath);
      }
    }
  };
  walk(projectPath);
  // Sorted so the directory list for a prefix declared by several manifests is
  // deterministic across machines — resolveImport tries them in order.
  return results.sort();
}

/**
 * Build a PSR-4 prefix map for PHP projects from every in-repo `composer.json`.
 *
 * PHP namespaces carry no path information — `App\Models\User` only maps to
 * `app/Models/User.php` because `composer.json` says so. The convention-based
 * fallback in `resolveImport` guesses that mapping from the directory layout,
 * which works for a single-package project whose namespace root happens to
 * match a real directory name, and silently drops every import that does not:
 *
 *   - `Database\Seeders\Foo`  → the directory is `database/seeders`, lowercase,
 *                               so the case-sensitive guess misses it
 *   - `Acme\Auth\Models\Role` → lives in `packages/auth/src/Models/Role.php`,
 *                               a path no namespace-shaped guess can reach
 *
 * The second case is the norm in Composer monorepos (path repositories), where
 * every domain package declares its own PSR-4 root. Those imports resolved to
 * nothing, so package-to-package edges were absent from the graph entirely and
 * impact analysis reported "no callers" for code with many callers.
 *
 * Reads the root manifest plus each nested one (`autoload` and `autoload-dev`),
 * mapping every prefix to directories relative to the manifest that declared
 * it.
 *
 * Call this once per graph build and pass the result to resolveImport.
 */
export function buildPhpPsr4Map(projectPath: string, recorder?: GraphInputRecorder): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const root = path.resolve(projectPath);

  for (const relManifest of findComposerManifests(root)) {
    const manifest = path.join(root, relManifest);
    let parsed: unknown;
    try {
      const source = readFileSync(manifest, "utf8");
      recorder?.read(manifest, source);
      parsed = JSON.parse(source);
    } catch {
      // A manifest the walk found and this could not read is still an input:
      // it is not a graph node, so nothing else would notice it recovering.
      // `read` above wins where it ran, so this only lands on a failed read.
      recorder?.unreadable(manifest);
      continue; // malformed manifest — the other manifests still count
    }
    if (typeof parsed !== "object" || parsed === null) continue;

    const manifestDir = path.dirname(manifest);
    const doc = parsed as Record<string, unknown>;
    const blocks = [doc.autoload, doc["autoload-dev"]];

    for (const block of blocks) {
      if (typeof block !== "object" || block === null) continue;
      const psr4 = (block as Record<string, unknown>)["psr-4"];
      if (typeof psr4 !== "object" || psr4 === null) continue;

      for (const [prefix, target] of Object.entries(psr4 as Record<string, unknown>)) {
        // PSR-4 allows a string or an array of directories per prefix.
        const targets = Array.isArray(target) ? target : [target];
        for (const rawTarget of targets) {
          if (typeof rawTarget !== "string") continue;
          const abs = path.resolve(manifestDir, rawTarget);
          const rel = toForwardSlash(path.relative(root, abs)).replace(/\/+$/, "");
          // A manifest outside the indexed tree (path.relative escapes upward)
          // cannot contribute resolvable files.
          if (rel.startsWith("..")) continue;
          const list = map.get(prefix) ?? [];
          if (!list.includes(rel)) list.push(rel);
          map.set(prefix, list);
        }
      }
    }
  }

  return map;
}

/**
 * The shape of a PHP namespace path: identifier segments joined by
 * backslashes, and nothing else.
 *
 * PHP `use` statements and `require`/`include` paths arrive in one specifier
 * space, and only their shape tells them apart. A namespace path cannot hold a
 * `/`, a `.` or a separator of any other kind, so anything that does is a file
 * path. Segments admit the high-byte range because PHP identifiers do.
 */
const PHP_NAMESPACE_SHAPE =
  /^[A-Za-z_\x80-\uFFFF][\w\x80-\uFFFF]*(?:\\[A-Za-z_\x80-\uFFFF][\w\x80-\uFFFF]*)*$/;

/**
 * One regex hit in a PHP source file: the name it captured and the offset it
 * was found at. Used for both passes below — the `namespace` declarations and
 * the `class`/`interface`/`trait`/`enum` ones — because attributing the second
 * to the first is purely a matter of comparing their offsets.
 */
interface PhpSourceMatch {
  index: number;
  name: string;
}

/**
 * Build a fully-qualified-class-name lookup map for PHP files, derived from
 * the declarations themselves rather than from any manifest.
 *
 * PSR-4 stays the authority wherever it exists, and this map is consulted only
 * after it misses. It exists for the code PSR-4 cannot describe: a package that
 * ships no autoload map at all and registers its namespaces at run time —
 *
 *   $loader->addNamespace('Acme', PLUGIN_DIR . '/src/acme');
 *
 * — which is how WordPress plugins overwhelmingly do it, and which a
 * composer.json reader cannot see. Such a package declares `"autoload": {}` or
 * no manifest at all, so every `use` it makes and every `use` of it resolved to
 * nothing, leaving whole trees orphaned in the graph while their symbols
 * extracted perfectly (issue #120). Interpreting `spl_autoload_register` is not
 * needed to fix that: the file that declares `Acme\Schema\Role` is a fact the
 * source states outright.
 *
 *   key:   "Acme\\Schema\\Role"
 *   value: ["src/acme/schema/RoleSchema.php"]
 *
 * Scans every PHP file unconditionally rather than only those under roots no
 * PSR-4 prefix covers, following `buildCsNamespaceMap`. One map means one
 * resolution regime everywhere, and it keeps working where a composer.json
 * exists but is incomplete — a partial map is the common case, not an edge one.
 *
 * The key is the exact FQCN, declared namespace and declared name together,
 * with no tail matching, so a collision means two files literally declaring the
 * same class — in practice a vendored duplicate. Files are read in
 * lexicographic order and `resolveImport` takes `candidates[0]`, so the pick is
 * deterministic across machines; an edge to either copy is a true "depends on
 * this FQCN" edge, which is why this guesses rather than refusing, matching the
 * C# resolver.
 *
 * Reads `fileSet`, which is already ignore-filtered, so a `vendor/` tree the
 * project excluded contributes nothing and one it deliberately re-included is a
 * legitimate target — no unconditional skip is needed here, unlike the
 * manifest walk in `findComposerManifests`.
 *
 * Declarations are matched by regex at line start, as in `buildCsNamespaceMap`,
 * which costs one read per file instead of a parse. Positional association
 * carries the braced multi-namespace form (`namespace A { … } namespace B { … }`)
 * as well as the file-scoped one. A `class` line inside a heredoc would be
 * matched as a declaration; a false FQCN nobody imports resolves nothing.
 */
export function buildPhpFqcnMap(
  fileSet: Set<string>,
  projectPath: string,
  recorder?: GraphInputRecorder,
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  // `namespace Foo\Bar;` (file-scoped) and `namespace Foo\Bar {` (braced).
  const namespaceRegex =
    /^[ \t]*namespace\s+([A-Za-z_\x80-\uFFFF][\w\x80-\uFFFF]*(?:\\[A-Za-z_\x80-\uFFFF][\w\x80-\uFFFF]*)*)\s*[;{]/gm;
  // Enums are autoloadable and `use`-imported exactly as classes are, so they
  // belong in a map whose job is answering "which file declares this name".
  //
  // A declaration starts its line, or follows an opening brace on one — the
  // braced namespace form puts the two together as `namespace A { class B`.
  // Requiring one or the other is what rejects the near-misses: ` * class Foo`
  // in a doc block, `// class Foo`, `"class Foo"` in a string, and the
  // anonymous `new class {}`, none of which declare a name to import.
  const declarationRegex =
    /(?:^|\{)[ \t]*(?:(?:final|abstract|readonly)\s+)*(?:class|interface|trait|enum)\s+([A-Za-z_\x80-\uFFFF][\w\x80-\uFFFF]*)/gm;

  const phpFiles = [...fileSet]
    .filter((f) => path.extname(f).toLowerCase() === ".php")
    .sort();

  for (const file of phpFiles) {
    let source: string;
    const absPath = path.join(projectPath, file);
    try {
      source = readFileSync(absPath, "utf8");
    } catch {
      continue;
    }
    recorder?.read(absPath, source);

    // Namespaces in declaration order, so each type can be attributed to the
    // one in effect where it appears.
    const namespaces: PhpSourceMatch[] = [];
    for (const match of source.matchAll(namespaceRegex)) {
      namespaces.push({ index: match.index ?? 0, name: match[1] });
    }

    for (const match of source.matchAll(declarationRegex)) {
      const at = match.index ?? 0;
      let namespace = "";
      for (const ns of namespaces) {
        if (ns.index < at) namespace = ns.name;
        else break;
      }
      const fqcn = namespace ? `${namespace}\\${match[1]}` : match[1];
      const files = map.get(fqcn);
      if (files) {
        if (!files.includes(file)) files.push(file);
      } else {
        map.set(fqcn, [file]);
      }
    }
  }

  return map;
}

/**
 * Information needed to resolve Go imports to local files for ONE module.
 *
 * A project may contain several Go modules (a monorepo with nested
 * `go.mod` files), so {@link buildGoModuleInfo} returns one of these per
 * `go.mod` it discovers. `modulePath` is the value of the `module`
 * directive in `go.mod` (e.g. `github.com/user/repo`); imports starting
 * with this prefix are local to that module. `moduleDir` is the
 * project-relative directory that contains `go.mod` ("." when it sits at
 * the indexed root). `packageMap` maps a Go package's directory *relative
 * to the module directory* (with "." for the module's own root package)
 * to the lex-smallest non-test `.go` file in that directory (stored
 * project-relative), used as a representative target for file-level edges.
 *
 * {@link buildGoModuleInfo} returns an empty array when no `go.mod` is
 * found or none parse. Callers must treat an empty result as "no Go
 * resolution available" and return null for all Go imports.
 */
export interface GoModuleInfo {
  modulePath: string;
  moduleDir: string;
  packageMap: Map<string, string>;
}

/** Map each in-project Elixir `defmodule` name to its files, deterministically. */
export function buildElixirModuleMap(
  fileSet: Set<string>,
  projectPath: string,
  recorder?: GraphInputRecorder,
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const file of [...fileSet].filter((f) => [".ex", ".exs"].includes(path.extname(f).toLowerCase())).sort()) {
    let source: string;
    const absPath = path.join(projectPath, file);
    try {
      source = readFileSync(absPath, "utf8");
    } catch {
      continue;
    }
    recorder?.read(absPath, source);
    const symbols = extractSymbolsAndCalls(source, "elixir", path.extname(file), file).symbols;
    for (const symbol of symbols) {
      if (symbol.kind !== "module" || symbol.name === "<module>") continue;
      const files = map.get(symbol.qualifiedName);
      if (files) {
        if (!files.includes(file)) files.push(file);
      } else {
        map.set(symbol.qualifiedName, [file]);
      }
    }
  }
  return map;
}

/**
 * Build Go module-resolution info for a project, one entry per `go.mod`.
 *
 * Discovers EVERY `go.mod` under the project root (so a monorepo with
 * nested modules is supported, not just a single root-level `go.mod`),
 * parses each module path with a regex, and constructs a per-module
 * directory-to-representative-file map across the `.go` files owned by
 * that module. `_test.go` files are excluded — Go does not allow them to
 * be imported from non-test code in other packages. Files are sorted
 * lexicographically before each map is built so the representative
 * chosen for a multi-file package is deterministic across machines/runs.
 *
 * `go.mod` is discovered by walking the tree independently of `fileSet`:
 * `go.mod` has no AST grammar and is not an extra extension, so it is
 * NEVER admitted by `getGraphableFiles` and therefore never present in
 * `fileSet`. An earlier attempt scanned `fileSet` for `go.mod` entries,
 * which matched nothing in a real build and silently broke Go resolution
 * for every project (issue #82, including the root-level #45 case). The
 * walk reuses the same ignore filter `getGraphableFiles` uses, so a
 * `go.mod` inside `node_modules/`, `.git/`, or a gitignored path is
 * skipped.
 *
 * Each `.go` file is attributed to its DEEPEST owning module (the module
 * whose `moduleDir` is the longest directory prefix of the file). The
 * tie-break is directory DEPTH, not string length: the root module
 * (`"."`, depth 0) must never win over a single-segment nested module
 * whose directory name happens to be short (e.g. `z`, which is string
 * length 1 just like `"."`).
 *
 * `packageMap` keys are MODULE-relative (the package directory with the
 * module directory stripped), because a Go import strips the module path
 * down to a module-relative directory. The map VALUES stay
 * project-relative (they are the `fileSet` entries), so resolution needs
 * no further translation even for a nested module.
 *
 * Cost: one tree walk (ignore-filtered) + one `readFileSync` per module
 * plus an O(n) walk over `.go` files at graph-build time. Lookups during
 * resolution are O(1).
 *
 * Limitations (deferred to follow-up issues if reported):
 *   - Parenthesized `module ( ... )` form (rare; not used by any
 *     mainstream Go project).
 *   - `vendor/` directory shadowing of external imports.
 *   - `replace` directives in `go.mod`.
 *   - `go.work` multi-module workspaces.
 */
export function buildGoModuleInfo(
  fileSet: Set<string>,
  projectPath: string,
  recorder?: GraphInputRecorder,
): GoModuleInfo[] {
  const goModPaths = findGoModFiles(projectPath);
  if (goModPaths.length === 0) return [];

  interface RawModule {
    moduleDir: string; // project-relative, forward-slash; "." at the root
    modulePath: string; // declared `module` path
    depth: number; // directory depth, for deepest-owner attribution
  }
  const rawModules: RawModule[] = [];
  for (const goModRel of goModPaths) {
    let goModSource: string;
    const goModAbs = path.join(projectPath, goModRel);
    try {
      goModSource = readFileSync(goModAbs, "utf-8");
    } catch {
      recorder?.unreadable(goModAbs);
      continue;
    }
    recorder?.read(goModAbs, goModSource);

    // Match `module <path>` at the start of a line, allowing leading
    // horizontal whitespace and capturing the path token greedily up to
    // the next whitespace. Module paths are non-whitespace tokens (e.g.
    // `github.com/user/repo`, `go.uber.org/zap`).
    const match = goModSource.match(/^[ \t]*module[ \t]+(\S+)/m);
    if (!match) continue;
    const moduleDir = path.dirname(goModRel).replace(/\\/g, "/"); // "." for a root-level go.mod
    const depth = moduleDir === "." ? 0 : moduleDir.split("/").length;
    rawModules.push({ moduleDir, modulePath: match[1], depth });
  }
  if (rawModules.length === 0) return [];

  // Precompute each .go file's owning module once. A file is owned by the
  // DEEPEST module whose directory is a prefix of the file's directory
  // (depth, not string length — see the function docstring).
  const goFiles = [...fileSet]
    .filter((f) => f.endsWith(".go") && !f.endsWith("_test.go"))
    .sort();
  const ownerByFile = new Map<string, RawModule | null>();
  for (const f of goFiles) {
    const fileDir = path.dirname(f).replace(/\\/g, "/");
    let best: RawModule | null = null;
    for (const mod of rawModules) {
      // The root module (".") is a prefix of every path; a nested module
      // owns a file only when the file's directory is itself or below it.
      const owned =
        mod.moduleDir === "." ||
        fileDir === mod.moduleDir ||
        fileDir.startsWith(`${mod.moduleDir}/`);
      if (!owned) continue;
      if (best === null || mod.depth > best.depth) best = mod;
    }
    ownerByFile.set(f, best);
  }

  const modules: GoModuleInfo[] = [];
  for (const mod of rawModules) {
    const packageMap = new Map<string, string>();
    for (const f of goFiles) {
      if (ownerByFile.get(f) !== mod) continue;
      const absDir = path.dirname(f).replace(/\\/g, "/");
      // Strip the module directory to get the MODULE-relative package
      // directory (the form a Go import resolves to). Go import paths
      // always use forward slashes and fileSet entries are forward-slash-
      // normalized (see toForwardSlash in constants.ts).
      const dir =
        mod.moduleDir === "."
          ? absDir
          : absDir === mod.moduleDir
            ? "."
            : absDir.slice(mod.moduleDir.length + 1); // absDir starts with `${mod.moduleDir}/`
      if (!packageMap.has(dir)) {
        packageMap.set(dir, f); // value stays project-relative (a fileSet entry)
      }
    }
    modules.push({ modulePath: mod.modulePath, moduleDir: mod.moduleDir, packageMap });
  }
  return modules;
}

/**
 * Discover every `go.mod` under `projectPath`, project-relative and
 * forward-slash-normalized.
 *
 * `go.mod` is not a graphable file (no AST grammar, not an extra
 * extension), so it is never in the set returned by `getGraphableFiles`.
 * This walk is therefore independent of that set and is how
 * {@link buildGoModuleInfo} finds modules without relying on `go.mod`
 * being graphable (issue #82). The same ignore filter
 * (`createIgnoreFilter` / `shouldIgnore`) `getGraphableFiles` uses is
 * applied, with the same trailing-slash convention for directories, so a
 * `go.mod` under `node_modules/`, `.git/`, or a gitignored path is
 * skipped — exactly matching what the graphable walk would do.
 */
function findGoModFiles(projectPath: string): string[] {
  const ig = createIgnoreFilter(projectPath);
  const results: string[] = [];
  const walk = (dir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relPath = toForwardSlash(path.relative(projectPath, path.join(dir, entry.name)));
      if (shouldIgnore(ig, entry.isDirectory() ? `${relPath}/` : relPath)) continue;
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name));
      } else if (entry.name === "go.mod") {
        // readdirSync Dirents do not follow symlinks: a symlinked go.mod
        // reports isFile()===false, so without this it would be neither
        // recorded nor followed and a root-level symlinked go.mod would
        // regress (the old single readFileSync followed the link). statSync
        // resolves the link so a symlinked go.mod is discovered like a real
        // one; broken links and non-file targets are skipped.
        let isFile = entry.isFile();
        if (!isFile && entry.isSymbolicLink()) {
          try {
            isFile = statSync(path.join(dir, entry.name)).isFile();
          } catch {
            continue;
          }
        }
        if (isFile) results.push(relPath);
      }
    }
  };
  walk(projectPath);
  return results.sort();
}

/**
 * Discover every `pubspec.yaml` under `projectPath`, project-relative and
 * forward-slash-normalized.
 *
 * `pubspec.yaml` is not a graphable file (no AST grammar, not an extra
 * extension), so it is never in the set returned by `getGraphableFiles` —
 * this walk is independent of that set, exactly like {@link findGoModFiles}
 * (the fileSet-scan trap from issue #82 applies here identically). The same
 * ignore filter (`createIgnoreFilter` / `shouldIgnore`) `getGraphableFiles`
 * uses is applied, with the same trailing-slash convention for directories,
 * so a manifest under `node_modules/`, `.git/`, or a gitignored path is
 * skipped.
 *
 * `.dart_tool/` is additionally skipped unconditionally. DEFAULT_IGNORE_PATTERNS
 * already lists it, but a `.socraticodeignore` negation (`!.dart_tool/`) can
 * re-include it, and Flutter code generation writes a `flutter_gen/pubspec.yaml`
 * inside it whose `name:` would register a package root pointing at generated
 * files.
 */
function findPubspecFiles(projectPath: string): string[] {
  const ig = createIgnoreFilter(projectPath);
  const results: string[] = [];
  const walk = (dir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relPath = toForwardSlash(path.relative(projectPath, path.join(dir, entry.name)));
      if (shouldIgnore(ig, entry.isDirectory() ? `${relPath}/` : relPath)) continue;
      if (entry.isDirectory()) {
        if (entry.name === ".dart_tool") continue;
        walk(path.join(dir, entry.name));
      } else if (entry.name === "pubspec.yaml") {
        // Mirrors findGoModFiles: readdirSync Dirents do not follow symlinks,
        // so a symlinked manifest reports isFile()===false and would be missed.
        let isFile = entry.isFile();
        if (!isFile && entry.isSymbolicLink()) {
          try {
            isFile = statSync(path.join(dir, entry.name)).isFile();
          } catch {
            continue;
          }
        }
        if (isFile) results.push(relPath);
      }
    }
  };
  walk(projectPath);
  // Sorted so duplicate package names across manifests resolve to the same
  // root on every machine — buildDartPackageMap is first-wins in this order.
  return results.sort();
}

/**
 * Map every in-repo Dart package name to its package root directory
 * (project-relative, forward-slash; `"."` for a root-level `pubspec.yaml`).
 *
 * Dart/Flutter code imports intra-project files by package URI almost
 * exclusively — `import 'package:my_app/src/service.dart';` is the layout
 * convention pub itself generates — and a package URI carries no path
 * information: `package:<name>/<rest>` maps to `<package_root>/lib/<rest>`
 * only because `<name>`'s pubspec lives at `<package_root>`. Without this
 * map every such import resolved to null (issue #106), so Flutter projects
 * lost nearly all file-graph edges and impact analysis reported "no callers"
 * for files with many consumers. Nested manifests are read too, which is what
 * resolves cross-package `package:<sibling>/...` imports in pub-workspace and
 * melos monorepos.
 *
 * The `name:` field is matched only at column 0: pubspec is YAML, so a
 * nested `name:` key legitimately appears indented inside dependency blocks
 * (`dependencies: { foo: { hosted: { name: ... } } }`), and an unanchored
 * match could map a dependency's name to the wrong root. Pub package names
 * are lowercase identifiers (`[a-z0-9_]`); the optional quote accepts the
 * YAML-quoted spelling of the same name. A manifest without a matching
 * `name:` contributes nothing; the first manifest (in sorted path order) to
 * declare a name wins, mirroring `buildJvmSuffixMap`'s first-wins
 * determinism.
 *
 * Call this once per graph build and pass the result to resolveImport.
 */
export function buildDartPackageMap(projectPath: string, recorder?: GraphInputRecorder): Map<string, string> {
  const map = new Map<string, string>();
  const root = path.resolve(projectPath);
  for (const relManifest of findPubspecFiles(root)) {
    let source: string;
    const manifestAbs = path.join(root, relManifest);
    try {
      source = readFileSync(manifestAbs, "utf8");
    } catch {
      recorder?.unreadable(manifestAbs);
      continue; // unreadable manifest — the other manifests still count
    }
    recorder?.read(manifestAbs, source);
    // A UTF-8 BOM sits before the first line's `name:` and would defeat the
    // column-0 anchor below — `dart pub get` accepts a BOM'd manifest, so
    // without this the package silently loses every package: edge again.
    if (source.charCodeAt(0) === 0xfeff) source = source.slice(1);
    const match = source.match(/^name:[ \t]*['"]?([a-z0-9_]+)/m);
    if (!match) continue;
    const packageDir = toForwardSlash(path.dirname(relManifest)); // "." at the root
    if (!map.has(match[1])) map.set(match[1], packageDir);
  }
  return map;
}

/**
 * Discover every `pyproject.toml` under `projectPath`, project-relative and
 * forward-slash-normalized.
 *
 * `pyproject.toml` is not a graphable file (no AST grammar, not an extra
 * extension), so it is never in the set returned by `getGraphableFiles` —
 * this walk is independent of that set, exactly like {@link findGoModFiles}
 * (the fileSet-scan trap from issue #82 applies here identically). The same
 * ignore filter (`createIgnoreFilter` / `shouldIgnore`) `getGraphableFiles`
 * uses is applied, with the same trailing-slash convention for directories,
 * so a manifest under `node_modules/`, `.git/`, or a gitignored path is
 * skipped.
 *
 * `site-packages/` and `dist-packages/` are additionally skipped
 * unconditionally. Every installed third-party distribution ships its own
 * `pyproject.toml` in one of them, and each would register an import root
 * over vendored code that shadows the project's own modules.
 * DEFAULT_IGNORE_PATTERNS covers the common virtualenv directory names
 * (`.venv`, `venv`, `env`), but an environment named anything else
 * (`.venv312`, `myenv`) or a `.socraticodeignore` negation re-including one
 * lands the walk straight in `lib/pythonX.Y/site-packages`. `dist-packages`
 * is the same directory under Debian and Ubuntu's system Python.
 */
function findPyProjectManifests(projectPath: string): string[] {
  const ig = createIgnoreFilter(projectPath);
  const results: string[] = [];
  const walk = (dir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relPath = toForwardSlash(path.relative(projectPath, path.join(dir, entry.name)));
      if (shouldIgnore(ig, entry.isDirectory() ? `${relPath}/` : relPath)) continue;
      if (entry.isDirectory()) {
        if (entry.name === "site-packages" || entry.name === "dist-packages") continue;
        walk(path.join(dir, entry.name));
      } else if (entry.name === "pyproject.toml") {
        // Mirrors findGoModFiles: readdirSync Dirents do not follow symlinks,
        // so a symlinked manifest reports isFile()===false and would be missed.
        // uv workspaces symlink member manifests in some layouts.
        let isFile = entry.isFile();
        if (!isFile && entry.isSymbolicLink()) {
          try {
            isFile = statSync(path.join(dir, entry.name)).isFile();
          } catch {
            continue;
          }
        }
        if (isFile) results.push(relPath);
      }
    }
  };
  walk(projectPath);
  return results.sort();
}

/**
 * One `pyproject.toml` found in the tree: where it sits, the import roots it
 * implies, and the sibling packages it declares importable.
 */
export interface PythonManifest {
  /** Project-relative directory holding the manifest; `"."` at the root. */
  dir: string;
  /** Import roots it implies: its own directory and its `src/`. */
  roots: string[];
  /**
   * Project-relative directories of the workspace members it declares,
   * resolved against the manifests actually discovered. Empty for a manifest
   * with no `[tool.uv.workspace]` section.
   */
  members: string[];
}

/**
 * Discover every `pyproject.toml` in the tree and record, for each, the import
 * roots it implies and the workspace members it declares.
 *
 * A packaged Python project puts its importable modules under the manifest's
 * directory in one of two layouts: `src/` (what `uv init --lib`, hatchling
 * and setuptools all generate) or flat, directly beside the manifest. Neither
 * is derivable from the import itself. `from usa_wa_adapter_sos.house import
 * build` names no directory that appears in
 * `packages/usa-wa-adapter-sos/src/usa_wa_adapter_sos/house/build.py`: the
 * distribution directory is dashed, the module is underscored, and `src/`
 * sits between them. The resolver's existing project-root `src/`+`lib/` probe
 * only reaches a single-package repo, so in a workspace every cross-package
 * import — and every package's own absolute self-import — resolved to null
 * (issue #107). A 362-file uv workspace built 3 edges.
 *
 * Both roots are recorded per manifest without probing the filesystem for
 * which layout is in use: a root that does not exist holds no files, so it
 * matches nothing, and the check would cost a `stat` per manifest to remove
 * lookups that already miss.
 *
 * Roots are recorded rather than module names enumerated under them. Names
 * would have to come from the directories actually present — a distribution
 * name and its import name are not reliably related (Pillow imports as `PIL`),
 * so `[project] name` cannot supply them — and enumerating directories alone
 * would miss single-module distributions, where `src/mymodule.py` is the whole
 * importable surface and no directory bears the module's name. Trying each
 * root in turn covers both, and covers PEP 420 namespace packages (no
 * `__init__.py`) for free, since it never asks what a directory contains.
 *
 * The only part of a manifest that is read is its `[tool.uv.workspace]`
 * member list, which {@link pythonRootsForFile} needs to tell a sibling
 * package apart from an unrelated project that merely carries a manifest.
 *
 * Sorted by directory so that when two manifests contribute a root holding the
 * same top-level module name, the same one wins on every machine.
 *
 * Call this once per graph build and pass each file's scoped roots (see
 * {@link pythonRootsForFile}) to resolveImport.
 */
export function buildPythonManifests(projectPath: string, recorder?: GraphInputRecorder): PythonManifest[] {
  const root = path.resolve(projectPath);
  const relManifests = findPyProjectManifests(root);
  const dirs = relManifests.map((m) => toForwardSlash(path.dirname(m))); // "." at the root

  return relManifests.map((relManifest, i) => {
    const dir = dirs[i];
    let source = "";
    const manifestAbs = path.join(root, relManifest);
    try {
      source = readFileSync(manifestAbs, "utf8");
      recorder?.read(manifestAbs, source);
    } catch {
      recorder?.unreadable(manifestAbs);
      // Unreadable manifest still contributes its roots; it just declares no
      // members, so it scopes to its own subtree.
    }
    return {
      dir,
      roots: [dir, dir === "." ? "src" : `${dir}/src`],
      members: declaredWorkspaceMembers(source, dir, dirs),
    };
  });
}

/**
 * A parsed TOML table as this reader consumes it. {@link TomlTable} has no
 * undefined member, but reading a key a manifest does not carry yields one, and
 * that is precisely what the checks around every lookup are checking for — so
 * the type has to be able to say it.
 */
type ReadTable = Record<string, TomlValue | undefined>;

/**
 * The `[tool.uv.workspace]` table of one manifest, or null when the document
 * declares none — including when it cannot be parsed at all.
 *
 * Reading this by pattern-matching was a losing position. The cases that kept
 * surfacing were not edges but the lexer: a `# """` comment masking a valid
 * table, and `members = ["a" "b"]` inventing a member out of a document uv
 * rejects outright. Tracking comment and string state is the first thing a TOML
 * parser does and the last thing a scanner can bolt on, and under the
 * narrow-never-widen invariant every remaining gap had to be paid for by
 * voiding — real edges lost in manifests that were perfectly valid.
 *
 * Parsing settles the lexing, and the walk below covers every legal spelling of
 * the same declaration for free: `[ tool.uv.workspace ]`, a `[tool.uv]` table
 * carrying `workspace = { members = [...] }`, and a top-level
 * `tool.uv.workspace.members` dotted key all arrive as the same nested tables.
 * Each is ordinary TOML that a user can write today, that uv reads as a
 * workspace, and that the previous reader silently found no members in — the
 * same failure shape as issue #107 itself.
 *
 * A malformed manifest declares nothing rather than failing the build: one
 * unparseable `pyproject.toml` anywhere in the tree must not cost the whole
 * project its Python edges, which is why an unreadable file is skipped in
 * {@link buildPythonManifests} too.
 *
 * A leading byte-order mark is stripped first. Both this parser and `tomllib`
 * reject one, since the TOML grammar has no place for it, but uv's parser skips
 * it and locks the workspace normally — so without stripping, a manifest saved
 * with a BOM would lose every member it declares. uv's behaviour is the one
 * being modelled.
 */
function workspaceTable(source: string): ReadTable | null {
  let cursor: TomlValue | undefined;
  try {
    cursor = parseToml(source.replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
  // A missing key yields undefined, which the next step rejects, so one check
  // per step covers both a key that is absent and a value that cannot hold one.
  //
  // These lookups read through the prototype chain, since the parser returns
  // plain objects rather than null-prototype ones. None of the five names this
  // reader asks for — tool, uv, workspace, members, exclude — exists on
  // Object.prototype, so no manifest can reach an inherited value, and an
  // own-key check ahead of each one could never change an outcome.
  for (const key of ["tool", "uv", "workspace"]) {
    if (!isTable(cursor)) return null;
    const table: ReadTable = cursor;
    cursor = table[key];
  }
  return isTable(cursor) ? cursor : null;
}

/**
 * Whether a parsed value can be looked up by key. A TOML date parses to an
 * object and passes this too, but no key can be found under one, so it reaches
 * the same void as any other undeclared workspace.
 */
function isTable(value: TomlValue | undefined): value is TomlTable {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * One `members`/`exclude` value as patterns this reader can apply, or null when
 * it cannot apply them faithfully — the caller's signal to void.
 *
 * Null covers three shapes that mean the same thing here: the key is absent, it
 * holds something other than an array of strings, or an entry uses glob syntax
 * beyond the `*` and `**` translated below. The caller separates out an absent
 * `exclude` before asking, since that is an ordinary manifest excluding
 * nothing rather than an unreadable one.
 */
function patternList(value: TomlValue | undefined): string[] | null {
  // A type predicate rather than a cast, so the narrowing is proven by the same
  // check that guards it — the invariant rests on this one holding.
  if (!Array.isArray(value) || !value.every((entry): entry is string => typeof entry === "string")) {
    return null;
  }
  return value.some(usesUnsupportedGlob) ? null : value;
}

/**
 * Whether a member pattern uses glob syntax beyond the `*` and `**` this
 * reader translates. uv matches with a full globset, so a character class,
 * a `?`, a brace alternation or an escape selects a different set than a
 * literal reading of the same text would.
 *
 * The pattern examined here is the parsed value, so a TOML escape sequence has
 * already been resolved: `"packages/a\\b"` arrives carrying one backslash,
 * which globset reads as an escape and this check rejects.
 */
function usesUnsupportedGlob(pattern: string): boolean {
  return /[?[\]{}\\]/.test(pattern);
}

/**
 * Project-relative directories of the `[tool.uv.workspace]` members a manifest
 * declares, selected from `allManifestDirs` — a member glob only matters here
 * when a real manifest sits at the path it names.
 *
 * uv member entries are globs relative to the declaring manifest
 * (`members = ["packages/*"]`), with an optional `exclude` list of the same
 * shape. Only `*` and `**` are translated, and a lone `*` does not mean the
 * same thing in the two lists — see the note beside the translation below.
 *
 * The document is parsed rather than scanned (see {@link workspaceTable}), so
 * a `members` key belonging to some other tool is a different key rather than
 * nearby text, and only glob translation is left to approximate.
 *
 * **The invariant is that this reader may narrow what a manifest declares,
 * never widen it**, and the whole section is voided the moment it meets
 * anything it cannot represent exactly: an unparseable document, a `members`
 * or `exclude` value that is not an array of strings, or glob syntax beyond
 * `*` and `**`. Voiding falls back to ancestor-path scoping, which resolves
 * strictly fewer imports.
 *
 * The invariant has to hold for `exclude` as well as `members`, and that is
 * why approximating is not enough. Dropping a member costs an edge that
 * should have resolved. Dropping an *exclusion* admits a package the manifest
 * explicitly excludes, and draws a cross-package edge uv would not — the
 * reader inventing a declaration rather than missing one. An earlier revision
 * stripped comments before reading the array, which truncated
 * `exclude = ["packages/#legacy", "packages/legacy"]` at the `#` and lost the
 * real exclusion behind it.
 *
 * A `#` inside a string is not itself a problem and is read as the literal
 * path character it is: `exclude = ["packages/#legacy"]` names a directory
 * that does not exist, matches nothing, and leaves `legacy` a member, which
 * is what uv does with the same bytes.
 */
function declaredWorkspaceMembers(
  source: string,
  manifestDir: string,
  allManifestDirs: string[],
): string[] {
  const workspace = workspaceTable(source);
  if (workspace === null) return [];

  const memberPatterns = patternList(workspace.members);
  if (memberPatterns === null) return [];
  // An absent `exclude` is an ordinary manifest excluding nothing. One that is
  // present and unreadable voids alongside `members`, since ignoring it would
  // admit exactly the package the manifest set out to keep out. TOML has no
  // null, so an undefined value here can only mean the key is absent.
  const excludePatterns = workspace.exclude === undefined ? [] : patternList(workspace.exclude);
  if (excludePatterns === null) return [];

  // Split on the wildcards first and quote only the literal spans between
  // them, so every other regex metacharacter matches itself. `**` always
  // spans separators; what a lone `*` spans is `singleStar`, and the two
  const prefix = manifestDir === "." ? "" : `${manifestDir}/`;
  const relativeToManifest = (dir: string): string | null => {
    if (!prefix) return dir;
    return dir.startsWith(prefix) ? dir.slice(prefix.length) : null;
  };

  // uv expands `members` by globbing the filesystem, where a lone `*` selects
  // one path segment, and matches `exclude` as a pattern against the member's
  // whole path, where it does not stop at a separator. Two code paths, two
  // meanings for the same character: `members = ["packages/*"]` leaves
  // `packages/alpha/inner` out, while `exclude = ["*legacy"]` takes
  // `packages/legacy` and `exclude = ["*"]` empties the workspace.
  //
  // Checked on uv 0.10.0 and 0.11.8, which agree on every one of these, so
  // this is uv's model rather than one release's behaviour.
  //
  // The asymmetry has to be honoured because the invariant is not symmetric.
  // A narrow `*` on the include side registers fewer roots than uv, which
  // costs at most an edge. A narrow `*` on the exclude side fails to exclude,
  // which admits a package the manifest named and draws an edge uv would not.
  const included = memberPatterns.map((p) => globToRegex(p.replace(/\/+$/, ""), "[^/]*"));
  if (included.length === 0) return [];
  const excluded = excludePatterns.map((p) => globToRegex(p.replace(/\/+$/, ""), ".*"));

  return allManifestDirs.filter((dir) => {
    if (dir === manifestDir) return false;
    const rel = relativeToManifest(dir);
    if (rel === null) return false;
    return included.some((re) => re.test(rel)) && !excluded.some((re) => re.test(rel));
  });
}

/**
 * Compile a glob pattern into a regular expression.
 * `**` spans separators; `singleStar` controls what a lone `*` spans.
 */
function globToRegex(pattern: string, singleStar: "[^/]*" | ".*"): RegExp {
  const quote = (literal: string) => literal.replace(/[.+^${}()|[\]\\?*]/g, "\\$&");
  const body = pattern
    .split("**")
    .map((span) => span.split("*").map(quote).join(singleStar))
    .join(".*");
  return new RegExp(`^${body}$`);
}

/**
 * The import roots that apply to one source file, nearest first.
 *
 * Two rules, each fixing a way a flat list of every root in the tree resolves
 * an import to the wrong file:
 *
 * **Scope.** A manifest applies to a file only when it sits on the file's
 * ancestor path, or when an ancestor manifest declares it as a workspace
 * member. A repo's `examples/demo/pyproject.toml`, a checked-in `third_party/`
 * sdist and an editable checkout inside an environment directory all carry
 * manifests while sitting on no `sys.path` the file could import through;
 * without this rule each one registers roots globally and turns an import that
 * correctly resolved to nothing into a fabricated edge. Workspace members are
 * the exception because that is exactly what a member declaration states: the
 * sibling package IS importable from here, and resolving cross-package imports
 * is what issue #107 is about.
 *
 * **Order.** Roots containing the file come first, deepest first, so a package
 * resolves its own modules before a sibling's. Without this, a per-service
 * monorepo of flat `uv init --app` services — each with its own `config.py` —
 * resolved `import config` to whichever service sorted first alphabetically,
 * drawing a confident edge into another service's file. Remaining in-scope
 * roots follow lexicographically: they are the cross-package candidates, where
 * nothing about the import says which package was meant, so the tie is broken
 * the same way on every machine rather than left to walk order.
 *
 * `relSourceDir` is the file's directory, project-relative and
 * forward-slashed, `"."` for a file at the root.
 */
export function pythonRootsForFile(
  manifests: PythonManifest[],
  relSourceDir: string,
): string[] {
  const isAncestorOf = (dir: string, target: string): boolean =>
    dir === "." || dir === target || target.startsWith(`${dir}/`);

  const ancestors = manifests.filter((m) => isAncestorOf(m.dir, relSourceDir));
  const inScope = new Set(ancestors.map((m) => m.dir));
  for (const m of ancestors) {
    for (const member of m.members) inScope.add(member);
  }

  const roots: string[] = [];
  for (const m of manifests) {
    if (inScope.has(m.dir)) roots.push(...m.roots);
  }

  const contains = (root: string): boolean =>
    root === "." || relSourceDir === root || relSourceDir.startsWith(`${root}/`);

  return [...new Set(roots)].sort((a, b) => {
    const aContains = contains(a);
    const bContains = contains(b);
    if (aContains !== bContains) return aContains ? -1 : 1;
    // Deepest containing root first; "." is the shallowest and sorts last
    // among them, so a package's own root outranks the project root.
    if (aContains) return b.length - a.length || a.localeCompare(b);
    return a.localeCompare(b);
  });
}

/**
 * Discover every `Cargo.toml` under `projectPath`, project-relative and
 * forward-slash-normalized.
 *
 * `Cargo.toml` is not a graphable file (no AST grammar, not an extra
 * extension), so it is never in the set returned by `getGraphableFiles` — this
 * walk is independent of that set, exactly like {@link findGoModFiles} (the
 * fileSet-scan trap from issue #82 applies here identically). The same ignore
 * filter `getGraphableFiles` uses is applied, with the same trailing-slash
 * convention for directories.
 *
 * `target/` is skipped unconditionally by directory name. Additionally, any
 * directory carrying `CACHEDIR.TAG` (created by Cargo per the Cache Directory
 * Tagging Standard) or `.cargo-ok` is skipped unconditionally: this defends
 * against custom `CARGO_TARGET_DIR` directory names where Cargo unpacks
 * dependencies and build artifacts during compilation.
 */
function findCargoManifests(projectPath: string): string[] {
  const ig = createIgnoreFilter(projectPath);
  const results: string[] = [];
  const walk = (dir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    // A Cargo target / build directory contains CACHEDIR.TAG at its root,
    // created by Cargo during build (per the Cache Directory Tagging Standard).
    // Skipping any directory carrying this tag or .cargo-ok prevents unpacked
    // dependencies and vendored build artifacts under non-default CARGO_TARGET_DIR
    // names from registering as project crates.
    if (
      dir !== projectPath &&
      entries.some((e) => e.name === "CACHEDIR.TAG" || e.name === ".cargo-ok")
    ) {
      return;
    }
    for (const entry of entries) {
      const relPath = toForwardSlash(path.relative(projectPath, path.join(dir, entry.name)));
      if (shouldIgnore(ig, entry.isDirectory() ? `${relPath}/` : relPath)) continue;
      if (entry.isDirectory()) {
        if (entry.name === "target") continue;
        walk(path.join(dir, entry.name));
      } else if (entry.name === "Cargo.toml") {
        // Mirrors findGoModFiles: readdirSync Dirents do not follow symlinks,
        // so a symlinked manifest reports isFile()===false and would be missed.
        let isFile = entry.isFile();
        if (!isFile && entry.isSymbolicLink()) {
          try {
            isFile = statSync(path.join(dir, entry.name)).isFile();
          } catch {
            continue;
          }
        }
        if (isFile) results.push(relPath);
      }
    }
  };
  walk(projectPath);
  // Sorted so a name declared by two manifests resolves to the same crate on
  // every machine.
  return results.sort();
}

/** One crate found in the tree: what it is called, and where its modules start. */
export interface RustCrate {
  /** Project-relative directory holding its `Cargo.toml`; `"."` at the root. */
  dir: string;
  /**
   * The name other crates import it by — `[package] name` with dashes turned
   * into underscores, which is the translation Cargo itself performs. Null for
   * a manifest that declares no package (a `[workspace]`-only root) or no
   * library target, neither of which anything can import by name.
   */
  name: string | null;
  /**
   * `[package] name` with dashes turned into underscores, which is the name a
   * dependency on this crate is declared under — while `name` above is what
   * the code writes, and the two differ wherever `[lib] name` is set. Null for
   * a manifest that declares no package.
   */
  packageName: string | null;
  /**
   * Set when the manifest could not be parsed. The crate still contributes its
   * convention targets, but nothing is known about what it declares, and a
   * check that reads "declares nothing" off an unread manifest would cost the
   * package every cross-crate edge — one unreadable `Cargo.toml` must not.
   */
  manifestUnread?: true;
  /** Project-relative path of the library root module, when the crate has one. */
  libRoot: string | null;
  /**
   * Project-relative paths of every root module the manifest implies: the
   * library, plus each binary, integration test, example and benchmark, plus
   * the build script. Each is the top of its own module tree, which is what
   * `crate::` is relative to.
   */
  roots: string[];
  /**
   * The Rust edition the manifest declares, defaulting to `"2015"` when the
   * key is absent, as Cargo does. It decides both target autodiscovery and
   * where an unanchored path in a `use` starts counting from.
   */
  edition: string;
  /**
   * Map from local dependency name / alias (with dashes turned to underscores)
   * to the target crate's package name (with dashes turned to underscores).
   *
   * Covers:
   *   [dependencies]
   *   my_alias = { package = "actual-package-name", ... }
   * as well as `[workspace.dependencies]` referenced via `workspace = true`.
   */
  aliases?: Record<string, string>;
  /**
   * The dependency names this manifest fetches from outside the project — a
   * registry or a git remote — rather than from a directory of its own.
   *
   * A dependency with no `path` is a different crate from a project crate that
   * happens to carry the same name, and cargo compiles against the fetched one.
   * `log = "0.4"` beside a workspace member also called `log` drew an edge into
   * that member: verified on cargo 1.98.0 with a `compile_error!` in the local
   * crate, which builds clean because rustc never reads it.
   */
  externalDeps?: string[];
}

/** A parsed `Cargo.toml` as this reader consumes it. */
type CargoTable = Record<string, TomlValue | undefined>;

function asTable(value: TomlValue | undefined): CargoTable | null {
  // isTable admits a TOML date, which carries none of the keys read below and
  // so reaches the same "declares nothing" path as any other non-table.
  return isTable(value) ? value : null;
}

/**
 * A declared target's `path`, when the entry carries one, in the spelling the
 * file set uses.
 *
 * Cargo accepts `path = "./src/api.rs"` and `path = "src/./api.rs"`; the file
 * set holds neither, so the raw string never matched and the declaration was
 * silently dropped. What followed was worse than losing the target: a `[lib]`
 * declared that way erased the crate's name and roots entirely, so every
 * sibling depending on it lost its edges, and a `[[bin]]` fell through to
 * convention and rooted the file one directory too deep — `mod part;` in
 * `src/tools/tool.rs` reached `src/tools/tool/part.rs` instead of
 * `src/tools/part.rs`. Verified with cargo 1.98.0: `cargo metadata` reports
 * the target at the normalized path and `cargo build` compiles against the
 * sibling, with a `compile_error!` in the deeper file proving it is never read.
 *
 * Backslashes are folded first: a manifest written on Windows may spell the
 * separator that way, and the file set is forward-slashed throughout.
 */
function declaredTargetPath(entry: TomlValue | undefined): string | null {
  const table = asTable(entry);
  const declared = table?.path;
  if (typeof declared !== "string") return null;
  const normalized = toForwardSlash(path.posix.normalize(declared.replace(/\\/g, "/")));
  // `normalize` turns "" into "." and leaves a trailing slash on a directory;
  // neither names a file, and passing them on would match nothing anyway.
  //
  // Returning null hands the target to convention rather than dropping it, and
  // that is deliberate. Cargo 1.98.0 refuses such a manifest outright — "path
  // `…/` for lib `x` is a directory, but a source file was expected" — so no
  // build exists to mirror and the oracle names no right answer. Dropping the
  // target is the more expensive of the two wrongs: it takes the crate's name
  // and roots with it, and every edge its dependents draw.
  return normalized === "." || normalized === "" ? null : normalized.replace(/\/+$/, "");
}

/**
 * The **package names** a manifest sends to a local directory through
 * `[patch.crates-io]` or the deprecated `[replace]`.
 *
 * Such a name reads as a registry dependency where it is declared, and cargo
 * builds it from the path anyway. `[patch]` is keyed by source, `[replace]` by
 * package spec (`"log:0.4.0"`), and only an entry carrying a `path` moves the
 * crate inside the project.
 *
 * Package names, not the names the importing crate writes: `alias = { package =
 * "itoa" }` is patched under `itoa` and imported as `alias`, so the caller has
 * to translate before matching. And only the `crates-io` source: a
 * `[patch.crates-io]` does not touch a dependency taken from a git remote,
 * which cargo keeps fetching — verified on 1.98.0, where the dep-info names the
 * checkout under `CARGO_HOME/git` and never the local directory.
 *
 * **The version is not compared**, and that is a known cost: cargo applies a
 * patch only when the local crate's version satisfies the requirement, so
 * `itoa = "1.0.18"` patched by a local `9.9.9` builds against the registry
 * while this reads the patch as active. Matching it takes a semver
 * implementation this module does not have, and the reading errs toward the
 * project's own crate — the same direction the resolver took before any of this
 * existed.
 */
function collectPatchedPaths(manifest: CargoTable | null): Set<string> {
  const patched = new Set<string>();
  if (!manifest) return patched;

  const readEntries = (tableValue: TomlValue | undefined): void => {
    const table = asTable(tableValue);
    if (!table) return;
    for (const [key, value] of Object.entries(table)) {
      if (!isTable(value) || typeof value.path !== "string") continue;
      // A `[replace]` key carries the version after a colon; a `[patch]` one
      // does not, and splitting is harmless there.
      patched.add(key.split(":")[0].replace(/-/g, "_"));
    }
  };

  const patchSection = asTable(manifest.patch);
  if (patchSection) {
    for (const [source, entries] of Object.entries(patchSection)) {
      // `[patch."https://github.com/…"]` patches that remote, not the registry,
      // and a dependency taken from anywhere else is untouched by it.
      if (source !== "crates-io") continue;
      readEntries(entries);
    }
  }
  readEntries(manifest.replace);

  return patched;
}

/**
 * Extract dependency aliases declared in a `Cargo.toml` table (e.g. `[dependencies]`,
 * `[dev-dependencies]`, `[build-dependencies]`, `[target.*.dependencies]`).
 *
 * Normalizes dashes to underscores for both the local alias name and the target
 * crate package name. If `dep.workspace = true`, resolves against workspace
 * dependencies declared in the enclosing workspace manifest.
 */
function extractCargoAliases(
  manifest: CargoTable | null,
  wsDeps: Map<string, string>,
  wsLocalDeps?: Set<string>,
  externalDeps?: Set<string>,
  gitDeps?: Set<string>,
): Record<string, string> {
  if (!manifest) return {};
  const aliases: Record<string, string> = {};

  const processDepTable = (tableValue: TomlValue | undefined): void => {
    const table = asTable(tableValue);
    if (!table) return;
    for (const [depKey, depVal] of Object.entries(table)) {
      const alias = depKey.replace(/-/g, "_");
      if (isTable(depVal)) {
        // A `path` is what makes a dependency the project's own; anything else
        // — a version, a git remote — is fetched from outside, whatever the
        // project happens to hold under the same name. A `workspace = true`
        // entry inherits the answer from where the workspace declares it.
        const local =
          typeof depVal.path === "string" ||
          (depVal.workspace === true && (wsLocalDeps?.has(alias) ?? false));
        if (!local) externalDeps?.add(alias);
        // A git dependency is fetched from its remote whatever
        // `[patch.crates-io]` says, so it must not be handed back to a local
        // crate by one.
        if (typeof depVal.git === "string") gitDeps?.add(alias);
        if (typeof depVal.package === "string") {
          aliases[alias] = depVal.package.replace(/-/g, "_");
        } else if (depVal.workspace === true) {
          const wsTarget = wsDeps.get(alias) ?? wsDeps.get(depKey.replace(/_/g, "-"));
          aliases[alias] = wsTarget ?? alias;
        } else {
          aliases[alias] = alias;
        }
      } else if (typeof depVal === "string") {
        // `dep = "1.0"` is a version and nothing else: always from a registry.
        externalDeps?.add(alias);
        aliases[alias] = alias;
      }
    }
  };

  processDepTable(manifest.dependencies);
  processDepTable(manifest["dev-dependencies"]);
  processDepTable(manifest["build-dependencies"]);

  const targetSection = asTable(manifest.target);
  if (targetSection) {
    for (const targetVal of Object.values(targetSection)) {
      const targetTable = asTable(targetVal);
      if (!targetTable) continue;
      processDepTable(targetTable.dependencies);
      processDepTable(targetTable["dev-dependencies"]);
      processDepTable(targetTable["build-dependencies"]);
    }
  }

  return aliases;
}

/**
 * Build the crate map for a Rust project, one entry per `Cargo.toml`.
 *
 * Rust names its own code three ways, and only one of them says anything about
 * the filesystem. `mod foo;` names a sibling file, which the resolver already
 * followed. `crate::`, `super::` and `self::` name a position in the module
 * tree, whose root is a target's root module — `src/lib.rs`, `src/main.rs`, or
 * whatever `[[bin]] path` declares. `some_crate::` names a whole other crate,
 * which is only in this project if a manifest here declares it, under a name
 * whose dashes Cargo turns into underscores (`sailor-core` is imported as
 * `sailor_core`). None of the three resolved before this map existed: every
 * specifier containing `::` returned null, so a Rust project's file graph came
 * out as its bare `mod` declarations and nothing else.
 *
 * Targets are read from the manifest where declared and taken by convention
 * otherwise, matching Cargo's own autodiscovery rules per edition:
 *   - `autobins`, `autotests`, `autoexamples`, `autobenches`, `autolib` flags
 *     turn off autodiscovery for their respective directories when set to `false`.
 *   - In edition 2015, autodiscovery is turned off by default for a target type
 *     when at least one target of that type is manually declared. In edition
 *     2018+, autodiscovery remains enabled unless explicitly set to `false`.
 *   - `[package] build = false` disables the build script target (`build.rs`).
 *   - `[workspace] exclude` patterns exclude matching directories from being
 *     registered as importable workspace members (`name = null`).
 *
 * The manifest is parsed with the same TOML reader the Python side uses rather
 * than scanned, so a `path` key belonging to a dependency is a different key
 * rather than nearby text. A manifest that cannot be parsed contributes its
 * convention targets and no name: one unreadable `Cargo.toml` must not cost the
 * whole project its Rust edges.
 *
 * Call this once per graph build and pass the result to resolveImport.
 */
export function buildRustCrateMap(
  fileSet: Set<string>,
  projectPath: string,
  recorder?: GraphInputRecorder,
): RustCrate[] {
  const root = path.resolve(projectPath);
  const relManifests = findCargoManifests(root);
  if (relManifests.length === 0) return [];

  const rustFiles = [...fileSet].filter((f) => f.endsWith(".rs")).sort();
  const parsedManifests: Array<{ relManifest: string; dir: string; manifest: CargoTable | null }> = [];

  for (const relManifest of relManifests) {
    const dir = toForwardSlash(path.dirname(relManifest)); // "." at the root
    let manifest: CargoTable | null = null;
    const manifestAbs = path.join(root, relManifest);
    try {
      // Recorded before the BOM is stripped: the record describes the bytes on
      // disk, which is what the next update re-hashes.
      const source = readFileSync(manifestAbs, "utf8");
      recorder?.read(manifestAbs, source);
      manifest = asTable(parseToml(source.replace(/^\uFEFF/, "")));
    } catch {
      recorder?.unreadable(manifestAbs);
      // Unreadable or malformed manifest: its convention targets still count.
    }
    parsedManifests.push({ relManifest, dir, manifest });
  }

  // Collect all workspace tables to resolve `[workspace] exclude` and `[workspace.dependencies]`.
  //
  // The whole manifest travels beside the `[workspace]` table: `[patch]` is a
  // top-level section of the workspace root, not part of that table, and the
  // members inherit it.
  const workspaceManifests = parsedManifests
    .filter((m) => m.manifest?.workspace !== undefined && isTable(m.manifest.workspace))
    .map((m) => ({
      dir: m.dir,
      table: m.manifest?.workspace as CargoTable,
      root: m.manifest as CargoTable,
    }));

  const findEnclosingWorkspace = (
    dir: string,
  ): { dir: string; table: CargoTable; root: CargoTable } | null => {
    let best: { dir: string; table: CargoTable; root: CargoTable } | null = null;
    for (const ws of workspaceManifests) {
      const isAncestor = ws.dir === "." || dir === ws.dir || dir.startsWith(`${ws.dir}/`);
      if (isAncestor && (best === null || ws.dir.length > best.dir.length)) {
        best = ws;
      }
    }
    return best;
  };

  const crates: RustCrate[] = [];

  for (const { dir, manifest } of parsedManifests) {
    // Normalized after joining, not before: a declared `path = "../bar/src/lib.rs"`
    // is legal — cargo builds it — and joining it raw produces
    // `crates/foo/../bar/src/lib.rs`, which the file set never holds, so the
    // declaration was dropped and with it the crate's name and roots. The
    // convention paths passed through here are already clean, so this only ever
    // changes a declared one.
    // An absolute path is legal too, and cargo builds it: there is nothing to
    // join, and joining it would produce `crates/foo//Users/…`. Where it points
    // inside the project it becomes the project-relative spelling the file set
    // holds; where it points outside, nothing in the tree can match it and it
    // falls through to null, which is the right answer for a file that is not
    // part of the project.
    const under = (relative: string): string => {
      if (path.posix.isAbsolute(relative) || path.isAbsolute(relative)) {
        const rel = path.relative(projectPath, relative);
        return rel && !rel.startsWith("..") ? toForwardSlash(rel) : toForwardSlash(relative);
      }
      return toForwardSlash(path.posix.normalize(dir === "." ? relative : `${dir}/${relative}`));
    };

    const enclosingWs = findEnclosingWorkspace(dir);
    const wsDeps = new Map<string, string>();
    // Which of the workspace's own dependency entries carry a `path`, which is
    // what a member's `dep = { workspace = true }` inherits along with the name.
    const wsLocalDeps = new Set<string>();

    if (enclosingWs) {
      const wsDepsTable = asTable(enclosingWs.table.dependencies);
      if (wsDepsTable) {
        for (const [depKey, depVal] of Object.entries(wsDepsTable)) {
          const normKey = depKey.replace(/-/g, "_");
          if (isTable(depVal) && typeof depVal.path === "string") wsLocalDeps.add(normKey);
          if (isTable(depVal) && typeof depVal.package === "string") {
            wsDeps.set(normKey, depVal.package.replace(/-/g, "_"));
          } else {
            wsDeps.set(normKey, normKey);
          }
        }
      }
    }

    // `[patch]` sends a name that reads as a registry dependency to a directory
    // instead, and it is how a workspace makes its members depend on each other
    // by version. tokio does exactly this for all five of its crates: read as
    // registry names, 473 real edges went with them.
    //
    // Only the workspace root's, or the manifest's own when it belongs to no
    // workspace. Cargo says so out loud where a member writes one — "patch for
    // the non root package will be ignored, specify patch at the workspace
    // root" — and honouring it there drew an edge into a crate the build never
    // touches.
    const patchedLocally = collectPatchedPaths(enclosingWs ? enclosingWs.root : manifest);

    const pkg = asTable(manifest?.package);
    const lib = asTable(manifest?.lib);
    // A manifest with no `edition` key is a 2015 manifest — Cargo warns about
    // it and carries on. Reading only the explicit spelling left every such
    // package on 2018 rules, and a `[[bin]]` declared beside an undeclared
    // file in `src/bin/` then handed the file a crate root Cargo never gives
    // it. Old manifests are exactly the ones that omit the key.
    //
    // `edition.workspace = true` is not a missing key: the member inherits
    // `[workspace.package] edition`, and `pkg.edition` is the table
    // `{ workspace: true }` rather than a string. Read as a plain key only,
    // every member of every workspace that centralises its edition — the
    // recommended layout — fell back to 2015, which turns off autodiscovery
    // next to a declared `[[bin]]` and reads unanchored `use` paths from the
    // crate root instead of the module directory. Verified with cargo 1.70,
    // 1.85 and 1.98: the member compiles `async fn`, and `cargo metadata`
    // reports edition 2021 for it; with the key omitted entirely, the same
    // member reports 2015 and rejects `async fn` — inheritance happens only
    // when the member asks for it.
    const wsPackage = enclosingWs ? asTable(enclosingWs.table.package) : null;
    const inheritsEdition = isTable(pkg?.edition) && pkg.edition.workspace === true;
    const inheritedEdition =
      inheritsEdition && typeof wsPackage?.edition === "string" ? wsPackage.edition : null;
    const edition =
      typeof pkg?.edition === "string" ? pkg.edition : (inheritedEdition ?? "2015");
    const is2015 = edition === "2015";

    const declaredLib = declaredTargetPath(manifest?.lib);
    const autolib = typeof pkg?.autolib === "boolean" ? pkg.autolib : true;
    const conventionLib = under("src/lib.rs");
    const libRoot =
      declaredLib && fileSet.has(under(declaredLib))
        ? under(declaredLib)
        : (manifest?.lib !== undefined || autolib) && fileSet.has(conventionLib)
          ? conventionLib
          : null;

    // `[lib] name` overrides the package name for the importable target; both
    // spellings reach the same file, so both are recorded by the caller's map.
    //
    // `[workspace] exclude` does NOT take a package out of the importable set,
    // however much it looks like it should: it only keeps the member out of
    // the default set of workspace-wide commands. A member of the workspace
    // can still depend on an excluded package by path, and does — checked by
    // building exactly that and watching `cargo check` accept it. Reading
    // `exclude` as "not importable" lost a real edge.
    const declaredName = typeof lib?.name === "string" ? lib.name : null;
    const packageName = typeof pkg?.name === "string" ? pkg.name : null;
    const name = libRoot ? ((declaredName ?? packageName)?.replace(/-/g, "_") ?? null) : null;

    const roots = new Set<string>();
    if (libRoot) roots.add(libRoot);

    // Explicitly declared targets. An array-of-tables key holds one table per
    // target; a manifest that spells it as a single table is malformed for
    // Cargo, and declaredTargetPath reads it as one entry rather than failing.
    for (const key of ["bin", "test", "example", "bench"]) {
      const declared = manifest?.[key];
      for (const entry of Array.isArray(declared) ? declared : [declared]) {
        const targetPath = declaredTargetPath(entry);
        const targetEntryTable = asTable(entry);
        if (targetPath && fileSet.has(under(targetPath))) {
          roots.add(under(targetPath));
        } else if (!targetPath && typeof targetEntryTable?.name === "string") {
          const targetName = targetEntryTable.name;
          if (key === "bin") {
            const candidates = [`src/bin/${targetName}.rs`, `src/bin/${targetName}/main.rs`];
            if (targetName === (packageName ?? name)) candidates.push("src/main.rs");
            for (const cand of candidates) {
              if (fileSet.has(under(cand))) roots.add(under(cand));
            }
          } else if (key === "test") {
            for (const cand of [`tests/${targetName}.rs`, `tests/${targetName}/main.rs`]) {
              if (fileSet.has(under(cand))) roots.add(under(cand));
            }
          } else if (key === "example") {
            for (const cand of [`examples/${targetName}.rs`, `examples/${targetName}/main.rs`]) {
              if (fileSet.has(under(cand))) roots.add(under(cand));
            }
          } else if (key === "bench") {
            for (const cand of [`benches/${targetName}.rs`, `benches/${targetName}/main.rs`]) {
              if (fileSet.has(under(cand))) roots.add(under(cand));
            }
          }
        }
      }
    }

    // Build script target: `build = false` in [package] explicitly disables it.
    if (pkg?.build !== false) {
      const buildScript = typeof pkg?.build === "string" ? pkg.build : "build.rs";
      if (fileSet.has(under(buildScript))) roots.add(under(buildScript));
    }

    // Convention targets, as Cargo autodiscovers them according to edition and flags.
    const autoBins =
      typeof pkg?.autobins === "boolean"
        ? pkg.autobins
        : !(is2015 && manifest?.bin !== undefined);
    if (autoBins) {
      if (fileSet.has(under("src/main.rs"))) roots.add(under("src/main.rs"));
      const prefix = `${under("src/bin")}/`;
      for (const file of rustFiles) {
        if (!file.startsWith(prefix)) continue;
        const rest = file.slice(prefix.length);
        // `<dir>/name.rs` is a target; `<dir>/name/main.rs` is a target whose
        // own modules live beside it. Anything deeper is a module of one of
        // those, not a target of its own.
        if (!rest.includes("/")) roots.add(file);
        else if (rest.split("/").length === 2 && rest.endsWith("/main.rs")) roots.add(file);
      }
    }

    const autoTests =
      typeof pkg?.autotests === "boolean"
        ? pkg.autotests
        : !(is2015 && manifest?.test !== undefined);
    if (autoTests) {
      const prefix = `${under("tests")}/`;
      for (const file of rustFiles) {
        if (!file.startsWith(prefix)) continue;
        const rest = file.slice(prefix.length);
        if (!rest.includes("/")) roots.add(file);
        else if (rest.split("/").length === 2 && rest.endsWith("/main.rs")) roots.add(file);
      }
    }

    const autoExamples =
      typeof pkg?.autoexamples === "boolean"
        ? pkg.autoexamples
        : !(is2015 && manifest?.example !== undefined);
    if (autoExamples) {
      const prefix = `${under("examples")}/`;
      for (const file of rustFiles) {
        if (!file.startsWith(prefix)) continue;
        const rest = file.slice(prefix.length);
        if (!rest.includes("/")) roots.add(file);
        else if (rest.split("/").length === 2 && rest.endsWith("/main.rs")) roots.add(file);
      }
    }

    const autoBenches =
      typeof pkg?.autobenches === "boolean"
        ? pkg.autobenches
        : !(is2015 && manifest?.bench !== undefined);
    if (autoBenches) {
      const prefix = `${under("benches")}/`;
      for (const file of rustFiles) {
        if (!file.startsWith(prefix)) continue;
        const rest = file.slice(prefix.length);
        if (!rest.includes("/")) roots.add(file);
        else if (rest.split("/").length === 2 && rest.endsWith("/main.rs")) roots.add(file);
      }
    }

    const externalDeps = new Set<string>();
    const gitDeps = new Set<string>();
    const aliases = extractCargoAliases(manifest, wsDeps, wsLocalDeps, externalDeps, gitDeps);
    // The patch table names packages, the dependency table names whatever this
    // crate imports them as: `alias = { package = "itoa" }` is patched under
    // `itoa` and written as `alias`, so the translation has to happen here.
    for (const alias of [...externalDeps]) {
      if (gitDeps.has(alias)) continue;
      if (patchedLocally.has(aliases[alias] ?? alias)) externalDeps.delete(alias);
    }
    const crateEntry: RustCrate = {
      dir,
      name,
      packageName: packageName?.replace(/-/g, "_") ?? null,
      libRoot,
      roots: [...roots].sort(),
      edition,
    };
    if (manifest === null) crateEntry.manifestUnread = true;
    if (Object.keys(aliases).length > 0) {
      crateEntry.aliases = aliases;
    }
    if (externalDeps.size > 0) {
      crateEntry.externalDeps = [...externalDeps].sort();
    }

    crates.push(crateEntry);
  }

  return crates;
}

/**
 * The directory a Rust file's submodules live in.
 *
 * A crate root (`src/lib.rs`, `src/main.rs`, `src/bin/tool.rs`) and a `mod.rs`
 * both own the directory they sit in — `mod foo;` in either names `foo.rs`
 * beside them. Every other file owns the directory named after it: `mod bar;`
 * inside `src/foo.rs` names `src/foo/bar.rs`, never `src/bar.rs`.
 *
 * `lib.rs` and `main.rs` own their directory by convention as well as by being
 * roots, so a tree with no `Cargo.toml` — where no root is known — still reads
 * them the way Cargo would.
 */
function rustModuleDir(relFile: string, isCrateRoot: boolean): string {
  const dir = toForwardSlash(path.dirname(relFile));
  if (isCrateRoot || ["mod.rs", "lib.rs", "main.rs"].includes(path.basename(relFile))) return dir;
  const stem = path.basename(relFile, ".rs");
  return dir === "." ? stem : `${dir}/${stem}`;
}

/** Join a module directory and a path below it, with `"."` meaning the root. */
function underModuleDir(moduleDir: string, relative: string): string {
  return moduleDir === "." ? relative : `${moduleDir}/${relative}`;
}

/**
 * The crate root module governing one file, and the directory that root's
 * module tree starts from.
 *
 * A file can sit under several roots — `src/bin/tool.rs` is a root of its own
 * while also sitting under `src/lib.rs`'s directory — so the deepest module
 * directory wins, and a file that IS a root is its own. Null when no manifest
 * covers the file, which is what keeps `crate::` unresolved rather than
 * guessed in a tree with no `Cargo.toml`.
 */
function rustRootForFile(
  crates: RustCrate[],
  relFile: string,
): { root: string; moduleDir: string } | null {
  // The answer depends only on the file and the crate map, and every import in
  // a file asks it again — around twenty times per file, once per `use`. On a
  // workspace of a hundred crates that repetition measured two seconds of the
  // build. The cache is keyed on the crate map itself, so it lives exactly as
  // long as the build that produced it and never outlives a stale map.
  let perFile = rustRootCache.get(crates);
  if (!perFile) {
    perFile = new Map();
    rustRootCache.set(crates, perFile);
  }
  const cached = perFile.get(relFile);
  if (cached !== undefined) return cached;

  let best: { root: string; moduleDir: string } | null = null;
  for (const crate of crates) {
    for (const root of crate.roots) {
      const moduleDir = rustModuleDir(root, true);
      if (root === relFile) {
        best = { root, moduleDir };
        break;
      }
      const covers = moduleDir === "." || relFile.startsWith(`${moduleDir}/`);
      if (covers && (best === null || moduleDir.length > best.moduleDir.length)) {
        best = { root, moduleDir };
      }
    }
    if (best?.root === relFile) break;
  }
  perFile.set(relFile, best);
  return best;
}

/** Per-build memo for {@link rustRootForFile}; see the note in that function. */
const rustRootCache = new WeakMap<
  RustCrate[],
  Map<string, { root: string; moduleDir: string } | null>
>();

/**
 * The file holding the module that owns `moduleDir`, in either of the two
 * layouts Rust allows for a module with children: `foo.rs` beside `foo/`, or
 * `foo/mod.rs` inside it.
 */
function rustModuleFile(moduleDir: string, fileSet: Set<string>): string | null {
  if (moduleDir === ".") return null;
  for (const candidate of [`${moduleDir}.rs`, `${moduleDir}/mod.rs`]) {
    if (fileSet.has(candidate)) return candidate;
  }
  return null;
}

/**
 * Walk a module path down from a module directory to the file that holds it.
 *
 * The trailing segments of a Rust path name items, not modules — `crate::db::
 * Connection` ends at a type — and nothing in the path says where the modules
 * stop. So the longest prefix that names a file wins, and a path that names
 * only items in the root resolves to the root module itself.
 */
function resolveRustModulePath(
  moduleDir: string,
  segments: string[],
  rootFile: string | null,
  fileSet: Set<string>,
): string | null {
  for (let k = segments.length; k >= 1; k--) {
    const base = underModuleDir(moduleDir, segments.slice(0, k).join("/"));
    if (fileSet.has(`${base}.rs`)) return `${base}.rs`;
    if (fileSet.has(`${base}/mod.rs`)) return `${base}/mod.rs`;
  }
  return rootFile && fileSet.has(rootFile) ? rootFile : null;
}

/**
 * The crates rustc provides without any manifest declaring them: `std` and
 * its two pieces, the proc-macro bridge, and the test harness. A path that
 * names one reaches no file of this project, in any edition.
 */
const RUST_BUILTIN_CRATES = new Set(["std", "core", "alloc", "proc_macro", "test"]);

/**
 * Resolve one Rust module path to the project file it names.
 *
 * `relSourceFile` is the importing file, project-relative and forward-slashed.
 * `crates` comes from {@link buildRustCrateMap}; an empty list leaves
 * `crate::` and cross-crate paths unresolved, which is what a tree carrying no
 * `Cargo.toml` should produce.
 *
 * `super::` and `self::` are answered from the file's own position rather than
 * from its crate root, so they resolve in a manifest-less tree too. Climbing
 * stops at the crate root's directory when a root is known: a path cannot leave
 * its crate through `super`, and without the guard `super::super::x` at the top
 * of a workspace member would reach into a sibling's files.
 */
export function resolveRustImport(
  specifier: string,
  relSourceFile: string,
  fileSet: Set<string>,
  crates: RustCrate[],
  declaredMods?: Map<string, string>,
  isDeclaration?: boolean,
): string | null {
  const own = rustRootForFile(crates, relSourceFile);
  const isRoot = own?.root === relSourceFile;
  const ownModuleDir = rustModuleDir(relSourceFile, isRoot);

  // A `#[path = "…"]` attribute arrives as the path it declares, extension and
  // all, which no module path ever carries.
  //
  // On a declared module it is relative to the directory the declaring file
  // sits in — never to the directory that file's submodules live in, so
  // `src/a/b.rs` and `src/a/mod.rs` both reach `src/a/moved.rs`. Written
  // inside an inline `mod`, it counts from the file's own module directory
  // instead, one directory deeper per inline level; extractImports marks that
  // form with a `self/` head, since nothing in the path itself tells them
  // apart.
  if (specifier.endsWith(".rs")) {
    const fromInline = specifier.startsWith("self/");
    const base = fromInline ? ownModuleDir : path.dirname(relSourceFile);
    const declared = toForwardSlash(
      path.normalize(path.join(base, fromInline ? specifier.slice("self/".length) : specifier)),
    );
    return fileSet.has(declared) ? declared : null;
  }

  // `use ::config::Item;` says the head names a crate and not a module in
  // scope — it is how a file that also has a local `config` reaches the other
  // one. Since a local module otherwise wins, the marker has to survive.
  //
  // What it means, though, is an edition rule: `::` is the extern prelude from
  // 2018 on, and the crate root in 2015, where it says nothing a bare head does
  // not already say. Checked on 1.98.0 with one crate carrying `pub mod log;`
  // and `use ::log::LocalMarker;`: it compiles in 2015 and is E0432 in 2018.
  const globalMarker = specifier.startsWith("::");

  const segments = specifier
    .split("::")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) return null;

  // The package whose manifest governs this file, which is what says under
  // which names its dependencies are imported: the same crate answers to
  // different names in two members of one workspace. The innermost manifest
  // containing the file wins, so depth is what ranks them — and the root's
  // `"."` names no directory at all, it is the empty prefix. Measured by its
  // length it is one character, which ties with every member directory of one
  // character and, the sort being stable and manifests walked shallowest
  // first, wins the tie: every file of `a/` was then governed by the root's
  // manifest. A `[workspace]`-only root declares no dependency and no edition,
  // so `a/`'s crates went unreachable and its 2018-or-later files were read as
  // 2015 (review finding).
  const depthOf = (crate: RustCrate): number => (crate.dir === "." ? 0 : crate.dir.length);
  const importingCrate = crates
    .filter((crate) => crate.dir === "." || relSourceFile.startsWith(`${crate.dir}/`))
    .sort((a, b) => depthOf(b) - depthOf(a))[0];

  // A crate this project declares, preferring one whose directory contains the
  // importing file — two manifests can carry the same package name, and a
  // workspace member's own name must not resolve into an unrelated checkout.
  const crateNamed = (name: string): RustCrate | null => {
    // A name the manifest fetches from a registry or a git remote is that
    // crate, not a project crate of the same name: cargo compiles against what
    // it fetched, and the local one is never in scope. `log = "0.4"` beside a
    // workspace member also called `log` drew an edge into the member —
    // verified on cargo 1.98.0, where a `compile_error!` in it does not stop
    // the build because rustc never reads the file.
    if (importingCrate?.externalDeps?.includes(name)) return null;
    // Only what the importing package declares is in its extern prelude. A
    // sibling of the workspace it does not depend on is not reachable, and
    // rustc refuses the path with E0432 — yet the raw name used to be searched
    // across every crate of the project, so `use helper::Thing` drew an edge
    // into a sibling `helper` the manifest never named (review finding). The
    // one name a package reaches without declaring it is its own library,
    // which its binaries, tests and examples import by that name.
    //
    // A dependency is declared under its package name (or an alias of it), but
    // the code writes its *library* name, and the two differ wherever the
    // dependency sets `[lib] name` — `rust-crypto` is imported as `crypto`. So
    // the fence admits a name in two ways: it is a key of `aliases`, which
    // holds every declared dependency under the name the code writes for it;
    // or it is the library name of a project crate declared under its own
    // package name — not renamed, since `tools = { package = "helper" }` puts
    // the crate in scope as `tools` and nothing else. A manifest that could not be read
    // declares nothing that can be known, and is not fenced at all — the
    // alternative costs that package every cross-crate edge. A file outside
    // every manifest has no package to ask, and is left as it was.
    if (importingCrate && !importingCrate.manifestUnread && name !== importingCrate.name) {
      const declared = Object.entries(importingCrate.aliases ?? {});
      // Renamed, the alias is what cargo hands rustc as the crate's name.
      const renamed = declared.some(([alias, target]) => alias !== target && alias === name);
      // Declared under its own package name, the crate's name to rustc is its
      // library name — cargo passes `--extern otherlib=…` for a dependency
      // written `other = { path = "../other" }` whose `[lib] name` is
      // `otherlib`, and `use other::Thing` is E0432 there. Where the project
      // holds no crate of that package name, the dependency comes from outside
      // and the package name is all that is known of it.
      const plain = new Set(declared.filter(([alias, target]) => alias === target).map(([alias]) => alias));
      const libraryOfPlain = crates.some(
        (crate) => crate.name === name && crate.packageName !== null && plain.has(crate.packageName),
      );
      const plainFromOutside =
        plain.has(name) && !crates.some((crate) => crate.packageName === name && crate.libRoot);
      if (!renamed && !libraryOfPlain && !plainFromOutside) return null;
    }
    // `dep = { package = "real-name" }` renames a dependency for the crate
    // that declares it, and the code then writes the alias. The alias appears
    // in no `[package] name`, so without this the path resolved to nothing —
    // or worse, to a local module that happened to carry the alias.
    const declared = importingCrate?.aliases?.[name] ?? name;
    // What the alias resolves to is a package name, and what the code wrote
    // may be a library name; a crate answers to either. `dep = { path = "…",
    // package = "other" }` where `other` sets `[lib] name = "otherlib"` reached
    // nothing when only the library name was compared.
    const candidates = crates.filter(
      (crate) => (crate.name === declared || crate.packageName === declared) && crate.libRoot,
    );
    if (candidates.length === 0) return null;
    return (
      candidates.sort((a, b) => {
        const aCovers = a.dir === "." || relSourceFile.startsWith(`${a.dir}/`);
        const bCovers = b.dir === "." || relSourceFile.startsWith(`${b.dir}/`);
        if (aCovers !== bCovers) return aCovers ? -1 : 1;
        return b.dir.length - a.dir.length || a.dir.localeCompare(b.dir);
      })[0] ?? null
    );
  };

  const head = segments[0];

  // Whether the head names a module this very file declares. It gates both
  // shapes an unanchored path takes — a head on its own and a head with
  // segments below it — because scope is what decides them, not length.
  // Left undefined by a caller, it keeps the older, looser reading, so every
  // existing caller behaves as before.
  const declaredHere = declaredMods === undefined || declaredMods.has(head);

  // Where the declaration put that module's file, when it moved it. A
  // `#[path = "custom.rs"] mod foo;` names `foo` and files it under
  // `custom.rs`, and the name alone reaches neither: `src/foo.rs` does not
  // exist, so the path fell through to the crate of that name and drew an edge
  // into an unrelated library. What rustc does with the children is the other
  // half — they sit BESIDE the file the attribute names, `src/inner.rs` and
  // not `src/custom/inner.rs`, which E0583 states outright on 1.70.0 and
  // 1.98.0.
  const declaredFile = ((): string | null => {
    const spec = declaredMods?.get(head);
    if (!spec?.endsWith(".rs")) return null;
    const fromInline = spec.startsWith("self/");
    const base = fromInline ? ownModuleDir : path.dirname(relSourceFile);
    const declared = toForwardSlash(
      path.normalize(path.join(base, fromInline ? spec.slice("self/".length) : spec)),
    );
    return fileSet.has(declared) ? declared : null;
  })();

  // In edition 2015 an unanchored path is absolute from the crate root rather
  // than relative to this file's scope.
  //
  // **That reading is deliberately not acted on for resolution.** Acting on it
  // means answering a path with no declaration behind it, and every attempt to
  // bound that produced a fresh way to draw an edge rustc rejects: a bare
  // `use b;` between two integration-test crates, an undeclared sibling file, a
  // `mod` declared in a nested block, a virtual workspace's root crate claiming
  // its members' declarations. Each was found by a reviewer running cargo,
  // after the previous one was closed.
  //
  // So the gate stays on for every edition: resolve what a declaration proves,
  // and leave the rest unresolved. The cost is one real edge — `use foo::AtRoot;`
  // in `src/deep/mod.rs` with `mod foo;` in `lib.rs` compiles and draws nothing
  // — which `main` never drew either, so nothing published regresses. Fewer
  // edges, none of them wrong, and the remainder is documentation rather than
  // another round.
  const edition2015 = importingCrate?.edition === "2015" && own !== null;

  // The edition still decides the leading `::`, which is a separate question:
  // the marker names an external crate only where the extern prelude exists. In
  // 2015 it is the same crate root an unanchored path counts from, and letting
  // it through sent the path looking for a workspace crate of that name — or,
  // finding none, to nothing at all. That case is answered first below, from
  // the root and nowhere else.
  const global = globalMarker && !edition2015;

  const target = ((): string | null => {
    // In edition 2015 the leading `::` is the crate root, and the crate root
    // only: the same one `crate::` names, never this file's scope. Read
    // through the file's own declarations, `use ::foo::Item` in a child that
    // carried `#[path = "local.rs"] mod foo;` was answered with that local
    // file, while rustc reaches the root's `foo` — a review finding left open
    // from an earlier round. So the file's declaration map is not consulted
    // at all here.
    //
    // Three things a name at the root can be, tried in this order. A module
    // of the root, found by walking from the root's directory — with no file
    // to fall back on, since a walk that lands on the root whenever nothing
    // matches would answer every other case with the root too (found by
    // review: it made the two branches below unreachable). A crate the package
    // declares, which `extern crate foo;` at the root puts there — a root
    // declaring both a module and a crate of one name is E0260, so only one
    // exists; a registry crate is such a crate and resolves to nothing. And
    // otherwise an item the root defines or re-exports — `use ::BrotliResult;`
    // — which is the root file itself, unless the name is one of the crates
    // rustc provides without any manifest: those are not items of this crate.
    //
    // A 2015 file outside every target has no root to count from, and is left
    // unresolved rather than guessed.
    if (globalMarker && importingCrate?.edition === "2015") {
      if (!own) return null;
      const atRoot = resolveRustModulePath(own.moduleDir, segments, null, fileSet);
      if (atRoot) return atRoot;
      const crate = crateNamed(head);
      if (crate?.libRoot) {
        return segments.length === 1
          ? crate.libRoot
          : resolveRustModulePath(rustModuleDir(crate.libRoot, true), segments.slice(1), crate.libRoot, fileSet);
      }
      const declaresIt =
        importingCrate.externalDeps?.includes(head) ||
        Object.hasOwn(importingCrate.aliases ?? {}, head) ||
        RUST_BUILTIN_CRATES.has(head);
      return declaresIt ? null : own.root;
    }

    // A bare specifier is a `mod foo;` declaration (see extractImports), which
    // names a file in the declaring file's own module directory. `use foo;` —
    // a whole crate, no path — and `extern crate foo;` arrive in the same
    // shape, so the local module is tried first and the crate name second:
    // only one of the two exists in any tree that compiles.
    //
    // Which of the two it is, the declaration decides: `mod foo;` puts `foo`
    // among the names this file declares, `use foo;` does not. Without that
    // gate an orphan `src/serde.rs` — a file no `mod` names, left by a
    // refactor — captured `use serde;` and drew an edge rustc does not: on
    // cargo 1.70.0 and 1.98.0 that line reaches the dependency with the file
    // sitting right there.
    if (segments.length === 1 && !["crate", "self", "super"].includes(head)) {
      if (global) return crateNamed(head)?.libRoot ?? null;
      // A declaration is answered by the declaration: from the declaring
      // file's own module directory, or from wherever `#[path]` filed it. It
      // is never a crate, so it never falls through to one.
      if (isDeclaration) {
        return declaredFile ?? resolveRustModulePath(ownModuleDir, [head], null, fileSet);
      }
      // A `use foo;` in edition 2015 counts from the crate root even when this
      // very file declares `foo` — checked on 1.70.0 and 1.98.0, where
      // `use foo::Nested;` beside `mod foo;` is E0432 while `use foo::AtRoot;`
      // reaches the root's module. Telling the two apart takes knowing which
      // of them wrote the specifier, which is why the caller now says so — and
      // a caller that says nothing keeps the older reading, where a bare head
      // is tried from the file's own directory whatever the edition.
      const local = declaredHere
        ? (declaredFile ?? resolveRustModulePath(ownModuleDir, [head], null, fileSet))
        : null;
      if (local) return local;
      // A name this file declares as a module is not a crate, whatever the
      // manifest carries: rustc reads the module. Falling through drew an edge
      // into a same-named library whenever the module's own file was somewhere
      // the name alone could not reach — which is every `#[path]`.
      if (declaredMods?.has(head)) return null;
      return crateNamed(head)?.libRoot ?? null;
    }

    if (head === "crate") {
      if (!own) return null;
      return resolveRustModulePath(own.moduleDir, segments.slice(1), own.root, fileSet);
    }

    if (head === "self" || head === "super") {
      let moduleDir = ownModuleDir;
      let rest = segments;
      while (rest.length > 0 && (rest[0] === "self" || rest[0] === "super")) {
        if (rest[0] === "super") {
          // The crate root's own directory is the top: `super` from a module
          // directly under it would leave the crate.
          if (own && moduleDir === own.moduleDir) return null;
          moduleDir = toForwardSlash(path.dirname(moduleDir));
        }
        rest = rest.slice(1);
      }
      // What the climb landed on is a module too, and `super::Item` names an
      // item declared right there — in `foo.rs` beside `foo/`, or in
      // `foo/mod.rs`. Without this the whole `foo.rs`-plus-`foo/` layout, which
      // is the one rustc recommends, lost every `super::` edge out of a child.
      //
      // The crate root is that module for the top of the tree, and it is named
      // by neither convention: `src` holds no `src.rs` and no `src/mod.rs`, so
      // `super::Item` written in `src/foo.rs` — the commonest `super::` there
      // is — resolved to nothing until the root was checked by name.
      const parent =
        own && moduleDir === own.moduleDir
          ? own.root
          : rustModuleFile(moduleDir, fileSet);
      return resolveRustModulePath(
        moduleDir,
        rest,
        parent === relSourceFile ? null : parent,
        fileSet,
      );
    }

    // A uniform path: since Rust 2018 a `use` may start at a module in scope
    // without saying `self::`, and `pub use inner::Thing;` beside `mod inner;`
    // is how a crate republishes its own modules.
    //
    // This is tried before the crate names because that is the order rustc
    // resolves in: a module in scope wins, and the extern prelude is consulted
    // last. Reading the crate names first drew an edge into an unrelated
    // sibling crate whenever a local module happened to carry its name —
    // `config`, `log` and `utils` are both common module names and published
    // crate names — and did so without the importing package declaring any
    // dependency on it.
    //
    // In edition 2015 an unanchored path is absolute from the crate root
    // instead: `use registry::write;` in `src/client.rs` names
    // `src/registry.rs`, and rustc rejects that same line from 2018 on. A
    // crate with no manifest keeps the 2018 reading, which is what a bare
    // tree of `.rs` files most likely is.
    //
    // The head must name a module the file actually declares. Matching a
    // sibling `.rs` file by name alone is a filesystem answer to a question
    // about scope: it let a third-party head capture the import whenever a
    // file of that name happened to exist, and in `tests/` — where each file
    // is its own integration-test crate and none can import another — it drew
    // an edge Rust cannot express at all. rustc agrees the declaration is the
    // gate: with `mod log;` present, `use log::item;` reaches the module and
    // not the dependency. `declaredMods` left undefined keeps the older,
    // looser reading, so every existing caller behaves as before.
    //
    // The gate is on in every edition. An earlier round wrote here that it was
    // a 2018 rule only, on the ground that `use registry::write;` in
    // `src/client.rs` compiles with `mod registry;` written in `lib.rs` — true
    // of rustc, and the edge is indeed one this resolver does not draw. What
    // the decision recorded above `edition2015` says is that acting on it costs
    // more than it buys: see that comment for the four ways it drew edges rustc
    // rejects. This paragraph is what that decision replaced (review finding:
    // it contradicted the code and the other comment both).
    // A head the declaration moved is answered from where it moved it, and its
    // own children from the directory that file sits in — `src/inner.rs` for a
    // module filed at `src/custom.rs`, which is what E0583 asks for.
    if (!global && declaredFile) {
      const below = resolveRustModulePath(
        toForwardSlash(path.dirname(declaredFile)),
        segments.slice(1),
        declaredFile,
        fileSet,
      );
      if (below) return below;
    }

    const local =
      global || !declaredHere
        ? null
        : resolveRustModulePath(ownModuleDir, segments, null, fileSet);
    if (local) return local;

    // A name this file declares as a module is not a crate; see the same guard
    // on the single-segment branch.
    if (!global && declaredMods?.has(head)) return null;

    const crate = crateNamed(head);
    if (crate?.libRoot) {
      return resolveRustModulePath(
        rustModuleDir(crate.libRoot, true),
        segments.slice(1),
        crate.libRoot,
        fileSet,
      );
    }
    return null;
  })();

  // A file never imports itself. `use crate::db::Connection;` written inside
  // `#[cfg(test)] mod tests` in `db.rs` names that very file, and so does a
  // `super::` path that climbs back to its own module: recorded as an edge,
  // each becomes a node depending on itself.
  return target === relSourceFile ? null : target;
}

/**
 * Pre-built index mapping GDScript class_name declarations to their file paths.
 * Normal graph construction builds one scoped index per Godot project with
 * buildGodotProjectIndexes() to avoid repeated file reads and cross-project
 * name leakage.
 */
export type ClassNameIndex = Map<string, string>;

/**
 * Scan all .gd files in a fileSet for `class_name X` declarations and build
 * a global Map<className, relativePath>.
 *
 * @deprecated Legacy helper retained for compatibility. New graph-building
 * code should use buildGodotProjectIndexes() so class names remain scoped to
 * their nearest Godot project.
 */
export function buildClassNameIndex(
  projectPath: string,
  fileSet: Set<string>,
): ClassNameIndex {
  const index: ClassNameIndex = new Map();
  for (const relPath of fileSet) {
    if (!relPath.endsWith(".gd")) continue;
    const absPath = path.join(projectPath, relPath);
    try {
      const content = readFileSync(absPath, "utf-8");
      const className = extractClassNameFromGdscript(content);
      if (className) {
        index.set(className, relPath);
      }
    } catch {
      // Skip unreadable files
    }
  }
  return index;
}

/**
 * A per-Godot-project class_name index. Maps each Godot project root
 * (absolute path to the directory containing project.godot) to a
 * ClassNameIndex scoped to the .gd files under that root.
 *
 * This supports repositories with multiple Godot projects (nested or
 * sibling), where each project has its own class_name registry and
 * res:// root. A class_name in one project must not resolve extends
 * in another project.
 */
export type GodotProjectIndexes = Map<string, ClassNameIndex>;

/**
 * A per-Godot-project UID index. Maps `uid://...` strings to relative
 * file paths within the project. Built from `.uid` sidecar files and
 * `uid="uid://..."` attributes in `.tscn`/`.tres` file headers.
 *
 * Godot prefers UIDs over text paths for resource loading. When both
 * are present in an `[ext_resource]` declaration, the UID takes priority
 * and the text path is used only as a fallback when the UID cannot be
 * resolved.
 */
export type GodotUidIndex = Map<string, string>;
export type GodotProjectUidIndexes = Map<string, GodotUidIndex>;
/** Per-graph-build cache for nearest project.godot lookups. */
export type GodotRootCache = Map<string, string | null>;

/**
 * Build per-Godot-project UID indexes from `.uid` sidecar files and
 * `.tscn`/`.tres` file headers.
 *
 * For each `.uid` sidecar file (e.g. `Player.gd.uid`), reads the UID
 * string and maps it to the corresponding resource file. For `.tscn`
 * and `.tres` files, parses the `uid="uid://..."` attribute from the
 * file header.
 *
 * @param projectPath - Absolute path to the SocratiCode indexing root
 * @param fileSet - Set of relative file paths
 * @returns Map of Godot project root (absolute) → UID index (uid:// → relative path)
 */
export function buildGodotUidIndexes(
  projectPath: string,
  fileSet: Set<string>,
  rootCache: GodotRootCache = new Map(),
  recorder?: GraphInputRecorder,
): GodotProjectUidIndexes {
  const indexes: GodotProjectUidIndexes = new Map();

  for (const relPath of fileSet) {
    // .uid sidecar files: <file>.uid contains a single line "uid://..."
    if (relPath.endsWith(".uid")) {
      const absPath = path.join(projectPath, relPath);
      const godotRoot = walkUpForGodotProject(path.dirname(absPath), rootCache);
      if (!godotRoot) continue;

      let index = indexes.get(godotRoot);
      if (!index) {
        index = new Map();
        indexes.set(godotRoot, index);
      }

      try {
        // A `.uid` sidecar is never a graph node, so this read is the only
        // place it is seen. Recorded whole, before the trim, so the hash
        // describes the file rather than what was parsed out of it.
        const raw = readFileSync(absPath, "utf-8");
        recorder?.read(absPath, raw);
        const content = raw.trim();
        if (content.startsWith("uid://")) {
          // The resource file is the .uid path without the .uid suffix
          const resourcePath = relPath.slice(0, -4); // strip ".uid"
          // A stale sidecar must not create a graph node for a missing file.
          if (fileSet.has(resourcePath)) index.set(content, resourcePath);
        }
      } catch {
        // A sidecar is never a graph node, so the main read loop skips it and
        // this is the only place it is seen — including when it fails.
        recorder?.unreadable(absPath);
      }
      continue;
    }

    // .tscn/.tres files: parse uid="uid://..." from the file header
    if (relPath.endsWith(".tscn") || relPath.endsWith(".tres")) {
      const absPath = path.join(projectPath, relPath);
      const godotRoot = walkUpForGodotProject(path.dirname(absPath), rootCache);
      if (!godotRoot) continue;

      let index = indexes.get(godotRoot);
      if (!index) {
        index = new Map();
        indexes.set(godotRoot, index);
      }

      try {
        const content = readFileSync(absPath, "utf-8");
        recorder?.read(absPath, content);
        // The uid attribute appears in the first section header:
        // [gd_scene ... uid="uid://..."] or [gd_resource ... uid="uid://..."]
        const match = content.match(/^\[gd_(?:scene|resource)\b[^\]]*\buid="(uid:\/\/[^"]+)"/m);
        if (match) {
          index.set(match[1], relPath);
        }
      } catch {
        // Skip unreadable files
      }
    }
  }

  return indexes;
}

/**
 * Build per-Godot-project class_name indexes for a set of files.
 *
 * For each .gd file, finds the nearest project.godot ancestor and adds
 * the file's class_name to that project's index. Files not under any
 * project.godot are skipped (they have no Godot project context).
 *
 * @param projectPath - Absolute path to the SocratiCode indexing root
 * @param fileSet - Set of relative file paths
 * @returns Map of Godot project root (absolute) → ClassNameIndex (relative paths)
 */
export function buildGodotProjectIndexes(
  projectPath: string,
  fileSet: Set<string>,
  rootCache: GodotRootCache = new Map(),
  recorder?: GraphInputRecorder,
): GodotProjectIndexes {
  const indexes: GodotProjectIndexes = new Map();

  // Scan .gd, .tscn, and .tres files. .gd files contribute class_name
  // entries to their project's index. .tscn/.tres files are scanned only
  // to discover resource-only nested projects (a project with no .gd files
  // but with .tscn/.tres files still needs its root in the map so that
  // res:// paths in those resource files resolve correctly).
  for (const relPath of fileSet) {
    const isGd = relPath.endsWith(".gd");
    const isResource = relPath.endsWith(".tscn") || relPath.endsWith(".tres");
    if (!isGd && !isResource) continue;

    const absPath = path.join(projectPath, relPath);
    const godotRoot = walkUpForGodotProject(path.dirname(absPath), rootCache);
    if (!godotRoot) continue;

    // Ensure this project root is in the map (even if the file has no
    // class_name — resource-only projects need an entry).
    let index = indexes.get(godotRoot);
    if (!index) {
      index = new Map();
      indexes.set(godotRoot, index);
    }

    // Only .gd files can contribute class_name entries
    if (!isGd) continue;

    try {
      const content = readFileSync(absPath, "utf-8");
      recorder?.read(absPath, content);
      const className = extractClassNameFromGdscript(content);
      if (className) {
        index.set(className, relPath);
      }
    } catch {
      // Skip unreadable files
    }
  }

  return indexes;
}

/**
 * Find the nearest Godot project root for a given source file.
 *
 * Walks up from the file's directory looking for project.godot.
 * Returns the absolute path to the directory containing it, or null
 * if no project.godot is found. This is per-file (not per-repo) to
 * support repositories with multiple Godot projects.
 *
 * @param sourceFile - Absolute path to the source file
 * @param godotProjectIndexes - Retained for compatibility with existing callers.
 * @param rootCache - Optional cache scoped to one graph build.
 */
export function findGodotRootForFile(
  sourceFile: string,
  _godotProjectIndexes?: GodotProjectIndexes,
  rootCache: GodotRootCache = new Map(),
): string | null {
  // Always walk the filesystem from the file's directory to find the
  // NEAREST project.godot. This is critical for nested projects:
  //
  //   repo/project.godot
  //   repo/outer.gd
  //   repo/game/project.godot
  //   repo/game/scene.tscn
  //
  // scene.tscn must resolve to repo/game (the nearest root), not repo
  // (an outer root that happens to be in the indexes map). The indexes
  // map is a cache of known roots, but it does not prove that a known
  // root is the *nearest* one — a nearer project.godot may exist on
  // disk that was not in the fileSet when the indexes were built.
  //
  // The filesystem walk is cheap (stat calls walking up from the file's
  // directory, typically 1-3 hops) and guarantees correctness.
  return walkUpForGodotProject(path.dirname(sourceFile), rootCache);
}

/**
 * Resolve a module specifier to a relative file path within the project.
 * Returns null if the module is external (e.g., npm package, stdlib).
 *
 * `language` is a display label as produced by `getLanguageFromExtension`
 * (e.g. "shell", "typescript") — that is what `buildCodeGraph` passes. "bash"
 * has its own case below as a synonym for "shell". The capitalised `Lang`
 * grammar names ("JavaScript", "TypeScript", "Tsx", "Html", "Css") match no
 * case. Not every display label has one either, so a switch miss is always
 * possible, and it returns the same null an external module does.
 *
 * @param aliases - Optional path aliases (tsconfig/jsconfig paths) for JS/TS resolution
 * @param classNameIndex - Pre-built GDScript class_name → file path index for O(1) extends resolution
 * @param godotProjectRoot - Pre-resolved Godot project root (directory containing project.godot).
 *   When provided, res:// paths resolve relative to this instead of walking the filesystem per call.
 * @param godotUidIndex - Pre-built UID → relative path index for uid:// resolution.
 *   When provided, uid:// paths are resolved via this index. When absent,
 *   uid:// paths cannot be resolved and return null.
 * @param fallbackSpecifier - Optional path fallback for a primary uid:// specifier.
 * @param godotImportKind - GDScript construct that supplied the path. Runtime
 *   load paths use the Godot project root; extends and preload use the source directory.
 */
export function resolveImport(
  moduleSpecifier: string,
  sourceFile: string,
  projectPath: string,
  fileSet: Set<string>,
  language: string,
  aliases?: PathAliases,
  jvmSuffixMap?: Map<string, string>,
  csNamespaceMap?: Map<string, string[]>,
  goModuleInfo?: GoModuleInfo[] | null,
  phpPsr4Map?: Map<string, string[]>,
  dartPackageMap?: Map<string, string>,
  pythonImportRoots?: string[],
  elixirModuleMap?: Map<string, string[]>,
  phpFqcnMap?: Map<string, string[]>,
  rustCrates?: RustCrate[],
  rustDeclaredMods?: Map<string, string>,
  rustIsDeclaration?: boolean,
  classNameIndex?: ClassNameIndex,
  godotProjectRoot?: string | null,
  godotUidIndex?: GodotUidIndex,
  fallbackSpecifier?: string,
  godotImportKind?: "extends" | "preload" | "load",
): string | null {
  // Skip obvious external/stdlib modules. Go is excluded from this
  // pre-check because its external classifier in `isExternalModule`
  // treats any `golang.org/...` import as external, which would block
  // valid local imports for projects whose own module path starts with
  // `golang.org/` (e.g. someone working on `golang.org/x/sync` itself).
  // The Go case below performs its own module-path-aware classification
  // and returns null for everything outside the local module.
  if (language !== "go" && isExternalModule(moduleSpecifier, language)) return null;

  const sourceDir = path.dirname(sourceFile);

  switch (language) {
    case "javascript":
    case "typescript":
    case "svelte":
    case "vue": {
      const jsExtensions = [".svelte", ".vue", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
      // Relative imports: ./foo, ../bar
      if (moduleSpecifier.startsWith(".")) {
        return resolveRelativePath(moduleSpecifier, sourceDir, projectPath, fileSet, jsExtensions);
      }
      // Try path alias resolution
      return resolveAliasPath(moduleSpecifier, projectPath, fileSet, jsExtensions, aliases);
    }

    case "css":
    case "scss":
    case "sass":
    case "less":
    case "stylus": {
      const cssExtensions = [".css", ".scss", ".sass", ".less", ".styl"];
      // CSS @import: ./variables.css, ../mixins.scss
      if (moduleSpecifier.startsWith(".")) {
        return resolveRelativePath(moduleSpecifier, sourceDir, projectPath, fileSet, cssExtensions);
      }
      // Try path alias resolution (e.g., $lib/styles/vars.css)
      return resolveAliasPath(moduleSpecifier, projectPath, fileSet, cssExtensions, aliases);
    }

    case "python": {
      // No import edge from a file to itself (#157). A module that names
      // itself is resolvable in CPython — `import mymodule` inside a
      // top-level `mymodule.py` really does import a second copy — but as a
      // graph edge it is noise, and every case seen in the wild is a
      // first-party module named after the third-party package it wraps
      // (`whisperx.py` doing `import whisperx`), where the true target is the
      // installed distribution and no first-party edge exists at all.
      //
      // Every probe is guarded, but the disposition differs. The sibling probe
      // is a guess at a directory Python may not have on `sys.path` at all, so
      // a self match there falls through to the probes behind it, which are
      // the manifest-declared roots — the only ones that run after it:
      // `packages/pkg-a/src/ns/requests.py` importing `requests` must still
      // find the legitimate `packages/pkg-a/src/requests.py` that pkg-a's
      // declared root supplies. Every other absolute probe stands for a real
      // path entry, so a self match there ends resolution — see the comment
      // above `direct`. The relative branch has nothing to fall through to:
      // it reaches a self match for
      // `from . import x` written in a package's own `__init__.py`, which
      // resolves the bare `.` to that same `__init__.py` — the commonest
      // self-edge in any Python tree.
      const relSourceFile = toForwardSlash(path.relative(projectPath, sourceFile));
      const notSelf = (candidate: string | null): string | null =>
        candidate === null || candidate === relSourceFile ? null : candidate;

      // Relative: .foo, ..bar
      if (moduleSpecifier.startsWith(".")) {
        const dots = moduleSpecifier.match(/^\.+/)?.[0].length ?? 0;
        let baseDir = sourceDir;
        for (let i = 1; i < dots; i++) {
          baseDir = path.dirname(baseDir);
        }
        const rest = moduleSpecifier.slice(dots).replace(/\./g, "/");
        return notSelf(resolveRelativePath(rest || ".", baseDir, projectPath, fileSet, [".py"]));
      }
      // Absolute: foo.bar.baz → foo/bar/baz.py or foo/bar/baz/__init__.py
      const modulePath = moduleSpecifier.replace(/\./g, "/");

      // A self match at a probe that stands for a real `sys.path` entry ENDS
      // resolution rather than falling through. Whichever directory a probe
      // stands for — the project root, `src/`, `lib/`, a manifest-declared
      // root — a match under it that IS the source file means that directory
      // is the source file's own path entry, and a path entry that already
      // supplies the module is not searched past. Root `mod.py` doing
      // `import mod` beside a `src/mod.py` imports itself; answering with
      // `src/mod.py` trades the self-edge for an edge to an unrelated module,
      // which is worse. The same holds one probe down (`src/mod.py` must not
      // answer with `lib/mod.py`) and at the manifest roots, where the
      // fall-through reached a *sibling workspace package*:
      // `packages/pkg-a/src/requests.py` importing `requests` answered with
      // `packages/pkg-b/src/requests.py`, a fabricated cross-package edge.
      //
      // Only the sibling probe still falls through, because it alone is a
      // guess rather than a path entry: `packages/pkg-a/src/ns/requests.py`
      // has no `sys.path` entry at `.../src/ns`, so the discarded sibling
      // match must yield to the declared root that really supplies the module.
      const direct = resolveRelativePath(modulePath, projectPath, projectPath, fileSet, [".py"]);
      if (direct === relSourceFile) return null;
      if (direct) return direct;

      // Try common Python source directories (src layout)
      const pySrcDirs = ["src", "lib"];
      for (const dir of pySrcDirs) {
        const inSrc = resolveRelativePath(
          path.join(dir, modulePath), projectPath, projectPath, fileSet, [".py"],
        );
        if (inSrc === relSourceFile) return null;
        if (inSrc) return inSrc;
      }

      // Sibling-flat fallback (issue #46). Common in service-style monorepos
      // where each top-level directory is a runnable Python application root
      // and `import config` from `service-a/main.py` means
      // `service-a/config.py` because the file is run via `python main.py`
      // from inside its own directory. resolveRelativePath also handles the
      // `<sourceDir>/<module>/__init__.py` package case via its built-in
      // Python init fallback.
      //
      // Ahead of the manifest-declared roots below, which is what CPython
      // does: sys.path[0] is the script's own directory, ahead of every
      // installed-distribution entry, so where a sibling file and a package
      // root both offer the module, the sibling is what actually gets
      // imported.
      //
      // A NON-SELF collision here is left alone, deliberately (#157). Where a
      // first-party module shares a name with a third-party distribution —
      // `src/pkg/requests.py` beside `src/pkg/client.py` doing `import
      // requests` — which one CPython loads depends on how the file is run,
      // and the tree does not say. Imported as `pkg.client`, `sys.path` finds
      // the installed distribution; executed as `python src/pkg/client.py`,
      // `sys.path[0]` is `src/pkg` and the sibling wins. An `__init__.py` does
      // not settle it: `sys.path[0]` is the SCRIPT's directory whether or not
      // the directory is also a package, so gating on one would drop the
      // legitimate #46 edge from a directly executed service directory that
      // happens to contain `__init__.py`. The same ambiguity covers PEP 420
      // namespace packages, which have no `__init__.py` to test at all.
      //
      // So the sibling stands in every non-self case, and only the
      // unambiguous self-resolution above is removed. Narrowing this needs
      // evidence of execution mode that the resolver does not currently have —
      // not an inference from layout.
      const sibling = notSelf(
        resolveRelativePath(modulePath, sourceDir, projectPath, fileSet, [".py"]),
      );
      if (sibling) return sibling;

      // Manifest-declared import roots (issue #107), nearest first. The probes
      // above reach `src/` and `lib/` at the project root and the importing
      // file's own directory; neither reaches `<package>/src/`, where a
      // workspace puts each package's modules, so cross-package imports and a
      // package's own absolute self-imports resolved to nothing.
      //
      // The list is already scoped to this file and ordered by proximity by
      // pythonRootsForFile — a root that is not on the file's ancestor path
      // and not a declared workspace member never appears here, and a package's
      // own root is tried before a sibling package's.
      //
      // A self match here ends resolution, like the root and `src/` probes
      // above: the roots are ordered containing-first, so the root that
      // supplies the source file itself is the nearest path entry this file
      // has, and every root behind it belongs to a sibling package.
      for (const importRoot of pythonImportRoots ?? []) {
        const inRoot = resolveRelativePath(
          path.posix.join(importRoot, modulePath), projectPath, projectPath, fileSet, [".py"],
        );
        if (inRoot === relSourceFile) return null;
        if (inRoot) return inRoot;
      }

      return null;
    }

    case "go": {
      // Local Go imports are rooted at the module path declared in each
      // go.mod (built by buildGoModuleInfo at graph-build time). A project
      // may contain several modules (a monorepo with nested go.mod files),
      // so pick the module whose declared path is the longest STRUCTURAL
      // prefix of the import, then strip that prefix to get the package's
      // directory relative to the module and look up its representative
      // file. Anything else (stdlib like "fmt", third-party packages like
      // "github.com/x/y", or a path that only shares a textual prefix)
      // resolves to null.
      const modules = goModuleInfo ?? [];
      if (modules.length === 0) return null;

      let chosen: GoModuleInfo | null = null;
      for (const mod of modules) {
        // Structural prefix only: the import equals the module path (its
        // root package) or is a direct subpackage (module path + "/").
        // A bare textual prefix is NOT a match — e.g. with modules
        // github.com/x and github.com/x/y, the import github.com/x/yother
        // must resolve via github.com/x, not be misrouted to github.com/x/y
        // and then rejected as a missing package.
        const isMatch =
          moduleSpecifier === mod.modulePath ||
          moduleSpecifier.startsWith(`${mod.modulePath}/`);
        if (!isMatch) continue;
        if (chosen === null || mod.modulePath.length > chosen.modulePath.length) {
          chosen = mod;
        }
      }
      if (!chosen) return null;

      const rest = moduleSpecifier.slice(chosen.modulePath.length);
      // rest === "" → the module's root package (the dir containing go.mod).
      // rest starts with "/" → a subpackage; strip the leading slash.
      // Anything else (an import that shares the prefix but isn't a real
      // subpackage, e.g. `github.com/user/repo-other`) is external.
      let moduleRelDir: string;
      if (rest === "") {
        moduleRelDir = ".";
      } else if (rest.startsWith("/")) {
        moduleRelDir = rest.slice(1);
      } else {
        return null;
      }
      // packageMap values are already project-relative fileSet entries,
      // so no further translation is needed — even for a nested module.
      return chosen.packageMap.get(moduleRelDir) ?? null;
    }

    case "java":
    case "kotlin":
    case "scala": {
      // com.example.Foo → com/example/Foo.java (or .kt, .scala)
      const filePath = moduleSpecifier.replace(/\./g, "/");
      const exts = language === "java" ? [".java"] : language === "kotlin" ? [".kt", ".kts"] : [".scala"];

      // 1. Try direct resolution from project root (single-module layout).
      const direct = resolveRelativePath(filePath, projectPath, projectPath, fileSet, exts);
      if (direct) return direct;

      // 2. Try common source directories (Maven/Gradle single-module convention).
      const jvmSrcDirs = [
        `src/main/${language}`,  // src/main/java, src/main/kotlin, src/main/scala
        "src/main",
        "src",
      ];
      for (const dir of jvmSrcDirs) {
        const inSrc = resolveRelativePath(
          path.join(dir, filePath), projectPath, projectPath, fileSet, exts,
        );
        if (inSrc) return inSrc;
      }

      // 3. Fallback: suffix-map lookup for multi-module Maven/Gradle projects.
      //    e.g. module-a/sub/src/main/java/com/example/Foo.java
      //    The map is built once per graph build (O(n)) and looked up in O(1).
      if (jvmSuffixMap) {
        for (const ext of exts) {
          const classPath = filePath + ext;
          const found = jvmSuffixMap.get(classPath);
          if (found) return found;
        }
      }

      return null;
    }

    case "c":
    case "cpp": {
      // #include "relative/path.h"
      return resolveRelativePath(moduleSpecifier, sourceDir, projectPath, fileSet, []);
    }

    case "ruby": {
      if (moduleSpecifier.startsWith("./") || moduleSpecifier.startsWith("../")) {
        return resolveRelativePath(moduleSpecifier, sourceDir, projectPath, fileSet, [".rb"]);
      }
      return resolveRelativePath(moduleSpecifier, projectPath, projectPath, fileSet, [".rb"]);
    }

    case "php": {
      // A `use` names a namespace, a require/include names a file, and both
      // arrive here as one specifier. Shape decides which: a namespace path is
      // identifier segments joined by backslashes and can hold nothing else.
      //
      // The leading `\` of a fully-qualified name (`use \App\Models\User;`) is
      // stripped once, for every branch below rather than only inside the
      // PSR-4 lookup where it used to be handled. Left on, it made the
      // heuristics build `/App/Models/User` — an absolute path resolving
      // outside the project — so a project with no composer.json missed every
      // fully-qualified import it made.
      const namespaced = moduleSpecifier.replace(/^\\+/, "");

      if (PHP_NAMESPACE_SHAPE.test(namespaced)) {
        // Declared PSR-4 first — composer.json is the authority on where a
        // namespace lives, and everything below it can only infer. Longest
        // matching prefix wins so `Acme\Auth\Database\Seeders\` beats the
        // shorter `Acme\Auth\` that also prefixes it.
        if (phpPsr4Map && phpPsr4Map.size > 0) {
          let bestPrefix = "";
          for (const prefix of phpPsr4Map.keys()) {
            if (namespaced.startsWith(prefix) && prefix.length > bestPrefix.length) {
              bestPrefix = prefix;
            }
          }
          // An exact prefix match leaves nothing to look up: the specifier
          // names the prefix's own base directory, not a file in it. Composer
          // rejects a PSR-4 prefix that does not end in a separator, so this
          // needs a hand-edited manifest — but left unguarded, `use Foo;`
          // against a `"Foo": "src/"` entry probes the bare directory, and
          // resolveRelativePath's extension and index fallbacks land it on
          // `src.php` or `src/index.php`: a wrong edge rather than a missing
          // one.
          const relative = bestPrefix
            ? namespaced.slice(bestPrefix.length).replace(/\\/g, "/")
            : "";
          if (bestPrefix && relative) {
            for (const dir of phpPsr4Map.get(bestPrefix) ?? []) {
              const candidate = dir ? `${dir}/${relative}` : relative;
              const hit = resolveRelativePath(candidate, projectPath, projectPath, fileSet, [".php"]);
              if (hit) return hit;
            }
          }
        }

        // Then what the declarations themselves say. This is the only branch
        // that can reach a package whose namespaces are registered at run time
        // rather than declared in a manifest, and it is exact where the
        // heuristics below are a guess, so it outranks them.
        const declared = phpFqcnMap?.get(namespaced);
        if (declared && declared.length > 0) return declared[0];

        // Layout heuristics, for a namespace no manifest declares and no
        // in-project file claims. Single-segment names are excluded, as they
        // were before: `use Foo;` names the global namespace, and probing it
        // as a path would attach any same-named file in the tree to it.
        if (!namespaced.includes("\\")) return null;

        const filePath = namespaced.replace(/\\/g, "/");
        // Try exact case first
        const exact = resolveRelativePath(filePath, projectPath, projectPath, fileSet, [".php"]);
        if (exact) return exact;

        // PSR-4 convention: lowercase first segment (App → app)
        const segments = filePath.split("/");
        if (segments.length > 1) {
          segments[0] = segments[0].toLowerCase();
          const lowered = segments.join("/");
          const loweredResult = resolveRelativePath(lowered, projectPath, projectPath, fileSet, [".php"]);
          if (loweredResult) return loweredResult;
        }

        // Try common Composer src directories (namespace root → src/ or lib/)
        const srcDirs = ["src", "lib"];
        for (const dir of srcDirs) {
          // Skip first segment (namespace root) and look under src/
          const withoutRoot = segments.slice(1).join("/");
          if (withoutRoot) {
            const inSrc = resolveRelativePath(
              path.join(dir, withoutRoot), projectPath, projectPath, fileSet, [".php"],
            );
            if (inSrc) return inSrc;
          }
        }

        return null;
      }

      // require/include. An explicit `./` or `../` is source-relative, which
      // is also the form `__DIR__ . '<literal>'` is emitted as.
      if (moduleSpecifier.startsWith("./") || moduleSpecifier.startsWith("../")) {
        return resolveRelativePath(moduleSpecifier, sourceDir, projectPath, fileSet, [".php"]);
      }
      // A bare `require 'inc/util.php'` is resolved against the include_path
      // at run time, which always starts with the including file's own
      // directory and typically also carries the project root. Try both, in
      // that order — the ruby resolver's shape, for the same reason. Before
      // this, only `./`-prefixed paths resolved and every bare require was
      // dropped, which in an include-driven tree is most of them.
      return resolveRelativePath(moduleSpecifier, sourceDir, projectPath, fileSet, [".php"])
        ?? resolveRelativePath(moduleSpecifier, projectPath, projectPath, fileSet, [".php"]);
    }

    case "rust": {
      // `mod foo;`, `crate::`, `super::`, `self::` and cross-crate paths all
      // resolve against the crate map. Before it, everything carrying `::`
      // returned null and a Rust graph held only bare `mod` declarations. An
      // empty map still resolves `mod`, `super` and `self` from the file's own
      // position.
      return resolveRustImport(
        moduleSpecifier,
        toForwardSlash(path.relative(projectPath, sourceFile)),
        fileSet,
        rustCrates ?? [],
        rustDeclaredMods,
        rustIsDeclaration,
      );
    }

    case "csharp": {
      // C# `using X.Y.Z;` resolves via a namespace lookup map built once
      // at graph-build time. Project-internal namespaces map to one or
      // more files (multi-file namespaces are common in real .NET
      // projects). External namespaces (`System.*`, `Microsoft.*`, etc.)
      // are filtered earlier by `isExternalModule`.
      //
      // When a namespace spans multiple files we return the first
      // candidate as the resolved dependency. This produces meaningful
      // edges instead of the previous always-null behaviour, which left
      // C# file graphs empty and silently degraded the symbol-level
      // tools' cross-file resolution. A multi-file fan-out improvement
      // is tracked as a follow-up.
      if (csNamespaceMap) {
        const candidates = csNamespaceMap.get(moduleSpecifier);
        if (candidates && candidates.length > 0) {
          return candidates[0];
        }
      }
      return null;
    }

    case "swift": {
      if (moduleSpecifier.startsWith("./") || moduleSpecifier.startsWith("../")) {
        return resolveRelativePath(moduleSpecifier, sourceDir, projectPath, fileSet, [".swift"]);
      }
      return null;
    }

    case "shell":
    case "bash": {
      // `source ./script.sh` / `. ./script.sh` (see extractImports). Shell
      // resolves the argument against the run-time cwd, so nothing here is
      // exact; an explicit ./ or ../ is assumed script-relative by convention,
      // which is the only form worth guessing. Anything else stays unresolved:
      // a bare `source lib.sh` searches PATH and then the run-time cwd when bash
      // is not in POSIX mode, and `source lib/x.sh` is cwd-relative too but
      // carries no ./ to invoke that convention.
      if (!moduleSpecifier.startsWith("./") && !moduleSpecifier.startsWith("../")) return null;
      if (!hasLiteralShellPathShape(moduleSpecifier)) return null;

      // No candidate extensions — shell loads the literal path, with no
      // extension search.
      return resolveRelativePath(moduleSpecifier, sourceDir, projectPath, fileSet, []);
    }

    case "dart": {
      // `dart:` never reaches here: isExternalModule classifies it external
      // and the pre-check above already returned null.
      if (moduleSpecifier.startsWith("package:")) {
        // `package:<name>/<rest>` → `<package_root>/lib/<rest>`. The `lib/`
        // segment is pub's universal mapping (a package URI's root IS the
        // package's lib/ directory), so resolving <rest> against the package
        // root alone would match nothing. A name absent from the map is an
        // external package (package:flutter, pub.dev deps) and stays null —
        // as does everything when no map was built (no pubspec.yaml found,
        // or a pre-#106 caller that does not pass one).
        const rest = moduleSpecifier.slice("package:".length);
        const slash = rest.indexOf("/");
        if (slash <= 0) return null; // `package:name` alone names no file
        const packageDir = dartPackageMap?.get(rest.slice(0, slash));
        if (packageDir === undefined) return null;
        const packagePath = rest.slice(slash + 1);
        // `package:<name>/` names no file, and the extension fallbacks in
        // resolveRelativePath would resolve the bare lib target onto a decoy
        // `lib.dart` or `lib/index.dart` — a wrong edge, not a missing one.
        if (packagePath === "") return null;
        // No valid package URI carries dot segments or backslashes;
        // path.posix.join would normalize dot segments (and win32
        // path.resolve treats a backslash as a separator), either of which
        // could escape lib/ onto an unrelated in-project file, drawing an
        // edge the code never expresses.
        if (packagePath.includes("\\")) return null;
        if (packagePath.split("/").some((segment) => segment === "." || segment === "..")) {
          return null;
        }
        const libPath = path.posix.join(packageDir, "lib", packagePath);
        return resolveRelativePath(libPath, projectPath, projectPath, fileSet, [".dart"]);
      }
      return resolveRelativePath(moduleSpecifier, sourceDir, projectPath, fileSet, [".dart"]);
    }

    case "elixir": {
      return elixirModuleMap?.get(moduleSpecifier)?.[0] ?? null;
    }

    case "lua": {
      // require("foo.bar") → foo/bar.lua
      const luaPath = moduleSpecifier.replace(/\./g, "/");
      return resolveRelativePath(luaPath, projectPath, projectPath, fileSet, [".lua"]);
    }

    case "gdscript": {
      // uid:// paths — resolve via the UID index (Godot prefers UIDs
      // over text paths for resource loading)
      if (moduleSpecifier.startsWith("uid://")) {
        if (godotUidIndex) {
          const resolved = godotUidIndex.get(moduleSpecifier);
          if (resolved) return resolved;
        }
        // Try fallback specifier (path from ext_resource) if UID resolution missed
        if (fallbackSpecifier) {
          return resolveImport(
            fallbackSpecifier, sourceFile, projectPath, fileSet, language,
            aliases, jvmSuffixMap, csNamespaceMap, goModuleInfo,
            phpPsr4Map, dartPackageMap, pythonImportRoots,
            elixirModuleMap, phpFqcnMap,
            rustCrates, rustDeclaredMods, rustIsDeclaration,
            classNameIndex, godotProjectRoot, godotUidIndex,
            undefined, godotImportKind,
          );
        }
        // Without a UID index or fallback, uid:// paths cannot be resolved
        return null;
      }
      // preload/load: res://path/to/file.gd → resolve relative to Godot project root
      if (moduleSpecifier.startsWith("res://")) {
        const resPath = moduleSpecifier.slice("res://".length);
        if (resPath.endsWith(".uid")) return null;
        // Use pre-resolved root if available; fall back to filesystem walk for ad-hoc calls
        const godotRoot = godotProjectRoot !== undefined ? godotProjectRoot : findGodotProjectRoot(sourceFile);
        // Do NOT fall back to projectPath when no Godot root is found.
        // res:// is Godot-specific and must resolve relative to a project.godot
        // directory. Falling back to the arbitrary SocratiCode indexing root
        // would produce false edges in repos without a Godot project.
        if (!godotRoot) return null;
        // Direct file-set matching only — no extension fallback. res:// paths
        // in GDScript are explicit (res://scripts/Player.gd), so the specifier
        // already includes the correct extension. Adding fallback extensions
        // would falsely resolve res://assets/player.png to assets/player.tscn
        // when the .png is not in the project file set.
        return resolveRelativePath(resPath, godotRoot, projectPath, fileSet, []);
      }
      // Relative extends/preload paths use the script directory. Runtime
      // load() paths are localized by ResourceLoader against the res:// root.
      // Callers predating godotImportKind retain the previous source-relative
      // behavior, preserving the public resolver helper's compatibility.
      // Exclude class: prefixed specifiers and scheme:// paths.
      if (!path.isAbsolute(moduleSpecifier) && !moduleSpecifier.includes("://") && !moduleSpecifier.startsWith("class:")) {
        if (moduleSpecifier.endsWith(".uid")) return null;
        if (godotImportKind === "load") {
          const godotRoot = godotProjectRoot !== undefined ? godotProjectRoot : findGodotProjectRoot(sourceFile);
          if (!godotRoot) return null;
          return resolveRelativePath(moduleSpecifier, godotRoot, projectPath, fileSet, []);
        }
        return resolveRelativePath(moduleSpecifier, path.dirname(sourceFile), projectPath, fileSet, []);
      }
      // extends ClassName → resolve via class_name convention
      // The import extractor prefixes class-name references with "class:"
      if (moduleSpecifier.startsWith("class:")) {
        // class_name resolution is project-scoped: without a Godot project
        // root (explicit null), do not attempt resolution. An undefined
        // godotProjectRoot means the caller didn't pre-resolve it (ad-hoc
        // calls, tests) — fall back to filesystem walk in resolveByClassName.
        if (godotProjectRoot === null) return null;
        const className = moduleSpecifier.slice("class:".length);
        return resolveByClassName(className, sourceFile, projectPath, fileSet, classNameIndex);
      }
      return null;
    }

    case "godot-resource": {
      // uid:// paths — resolve via the UID index (Godot prefers UIDs
      // over text paths for resource loading)
      if (moduleSpecifier.startsWith("uid://")) {
        if (godotUidIndex) {
          const resolved = godotUidIndex.get(moduleSpecifier);
          if (resolved) return resolved;
        }
        // Try fallback specifier (path from ext_resource) if UID resolution missed
        if (fallbackSpecifier) {
          return resolveImport(
            fallbackSpecifier, sourceFile, projectPath, fileSet, language,
            aliases, jvmSuffixMap, csNamespaceMap, goModuleInfo,
            phpPsr4Map, dartPackageMap, pythonImportRoots,
            elixirModuleMap, phpFqcnMap,
            rustCrates, rustDeclaredMods, rustIsDeclaration,
            classNameIndex, godotProjectRoot, godotUidIndex,
          );
        }
        // Without a UID index or fallback, uid:// paths cannot be resolved
        return null;
      }
      // .tscn/.tres files reference other resources via [ext_resource]
      // declarations with res:// paths or relative paths.
      if (moduleSpecifier.startsWith("res://")) {
        const resPath = moduleSpecifier.slice("res://".length);
        if (resPath.endsWith(".uid")) return null;
        const godotRoot = godotProjectRoot !== undefined ? godotProjectRoot : findGodotProjectRoot(sourceFile);
        // Do NOT fall back to projectPath — res:// is Godot-specific.
        if (!godotRoot) return null;
        return resolveRelativePath(resPath, godotRoot, projectPath, fileSet, []);
      }
      // Relative path (e.g. "material.tres") — resolve relative to the
      // directory containing the .tscn/.tres file, per Godot TSCN docs.
      if (!path.isAbsolute(moduleSpecifier)) {
        if (moduleSpecifier.endsWith(".uid")) return null;
        const sourceDir = path.dirname(sourceFile);
        return resolveRelativePath(moduleSpecifier, sourceDir, projectPath, fileSet, []);
      }
      return null;
    }

    default:
      return null;
  }
}

/** Check if a module specifier refers to an external/stdlib module */
function isExternalModule(spec: string, language: string): boolean {
  switch (language) {
    case "python":
      // Common stdlib modules
      return ["os", "sys", "re", "json", "math", "datetime", "collections",
              "typing", "pathlib", "io", "functools", "itertools", "abc",
              "asyncio", "unittest", "logging", "argparse", "subprocess",
              "socket", "http", "urllib", "hashlib", "copy", "enum",
              "dataclasses", "contextlib", "textwrap", "string", "struct",
              "time", "threading", "multiprocessing", "xml", "csv",
              "sqlite3", "pickle", "shelve", "tempfile", "shutil", "glob",
             ].includes(spec.split(".")[0]);
    case "go":
      return !spec.includes("/") || spec.startsWith("golang.org/") || !spec.includes(".");
    case "java":
    case "kotlin":
    case "scala":
      return spec.startsWith("java.") || spec.startsWith("javax.") ||
             spec.startsWith("kotlin.") || spec.startsWith("kotlinx.") ||
             spec.startsWith("scala.") || spec.startsWith("android.");
    case "csharp":
      return spec.startsWith("System.") || spec === "System" ||
             spec.startsWith("Microsoft.");
    case "rust":
      return spec.startsWith("std::") || spec.startsWith("core::") || spec.startsWith("alloc::");
    case "swift":
      return ["Foundation", "UIKit", "SwiftUI", "Combine", "CoreData",
              "CoreGraphics", "CoreLocation", "MapKit", "XCTest"].includes(spec);
    case "php":
      return false; // PHP doesn't have stdlib imports in the same way
    case "ruby":
      return !spec.startsWith("./") && !spec.startsWith("../") && !spec.includes("/");
    case "dart":
      // Only the SDK scheme is unconditionally external. `package:` URIs are
      // NOT: the project's own code is imported that way by convention
      // (issue #106), so they classify as resolvable and the dart case in
      // resolveImport decides via the pubspec-derived package map — in-repo
      // names resolve, unknown names (real external packages) return null.
      return spec.startsWith("dart:");
    case "lua":
      // Common Lua stdlib/C modules
      return ["string", "table", "math", "io", "os", "coroutine",
              "debug", "package", "utf8", "bit32"].includes(spec.split(".")[0]);
    case "gdscript":
      // res://, uid://, and class: prefixes are always project-internal.
      // Relative paths (not starting with / or a scheme) are also internal.
      // Everything else is treated as external (Godot built-in types like Node2D).
      if (spec.startsWith("res://") || spec.startsWith("class:") || spec.startsWith("uid://")) return false;
      // Relative paths: contains a path separator or has a file extension
      // like .gd, .tscn, .tres — these are file references, not class names
      if (!path.isAbsolute(spec) && (spec.includes("/") || spec.endsWith(".gd") || spec.endsWith(".tscn") || spec.endsWith(".tres"))) return false;
      return true;
    case "godot-resource":
      // .tscn/.tres files produce res:// paths and relative paths (relative
      // to the .tscn/.tres file's directory, per Godot TSCN docs).
      // Both forms are project-internal; there are no external imports.
      return false;
    default:
      return false;
  }
}

/** Try resolving a module specifier via path aliases (tsconfig/jsconfig paths) */
function resolveAliasPath(
  moduleSpecifier: string,
  projectPath: string,
  fileSet: Set<string>,
  extensions: string[],
  aliases?: PathAliases,
): string | null {
  if (!aliases?.entries) return null;
  for (const [prefix, targets] of aliases.entries) {
    // Wildcard aliases end with "/" (from "$lib/*") — match as prefix
    // Exact aliases (no trailing "/") — match only the exact specifier
    const isWildcard = prefix.endsWith("/");
    const matches = isWildcard
      ? moduleSpecifier.startsWith(prefix)
      : moduleSpecifier === prefix;

    if (matches) {
      const rest = moduleSpecifier.slice(prefix.length);
      for (const target of targets) {
        const resolved = resolveRelativePath(
          path.join(target, rest), projectPath, projectPath, fileSet, extensions,
        );
        if (resolved) return resolved;
      }
    }
  }
  return null;
}

/**
 * Whether a shell `source` specifier has the shape of a literal path. This reads
 * the text only — a well-shaped specifier naming a file that does not exist is
 * still true here, and fails later at the file-set lookup.
 *
 * None of the shapes below can be told apart from a literal path here, and each
 * has to be screened before resolution rather than after, because normalising
 * them lands on a file the shell would not open — and a match there is the
 * failure being prevented rather than a salvage:
 *
 * - extractImports captures the whole argument list, so any whitespace-class
 *   character means the text cannot be told apart from a word list or a path
 *   still carrying its quotes. Bash splits on fewer of them than `\s` matches —
 *   its default IFS is space, tab and newline — but skipping all of them errs
 *   toward dropping an edge rather than inventing one.
 * - A backslash is a shell escape and never a separator, so the unescaped path
 *   is unknowable here; `path.resolve` treats it as a separator on win32, which
 *   would cancel `./x\..\lib.sh` down to a file the script never names.
 * - A trailing `/` or `/.` names a directory, which cannot be sourced, and
 *   normalisation would drop that trailing segment, landing on the same-named
 *   file.
 * - A `..` following a named segment cancels it lexically during normalisation,
 *   so `./x/../lib.sh` lands on lib.sh beside the script. The shell walks
 *   components instead and loads nothing when `x` is absent or is not a
 *   directory. Only a leading run of `.`/`..` anchors, and an empty segment from
 *   `//` does not end that run.
 *
 * These screen the raw captured text, so a change that honours quoting and
 * strips arguments has to unquote and split upstream of here.
 */
export function hasLiteralShellPathShape(specifier: string): boolean {
  if (/\s/.test(specifier) || specifier.includes("\\")) return false;
  if (specifier.endsWith("/") || specifier.endsWith("/.")) return false;
  const segments = specifier.split("/");
  const firstNamedIndex = segments.findIndex((s) => s !== "" && s !== "." && s !== "..");
  // The index check is not redundant: a negative `fromIndex` counts back from
  // the end, so dropping it would search only the last segment.
  return firstNamedIndex === -1 || !segments.includes("..", firstNamedIndex);
}

/** Resolve a potentially extensionless path to an actual file */
function resolveRelativePath(
  modulePath: string,
  baseDir: string,
  projectPath: string,
  fileSet: Set<string>,
  extensions: string[],
): string | null {
  const fullPath = path.resolve(baseDir, modulePath);
  const relPath = toForwardSlash(path.relative(projectPath, fullPath));

  // Direct match
  if (fileSet.has(relPath)) return relPath;

  // Try with extensions appended (for extensionless imports)
  for (const ext of extensions) {
    const withExt = relPath + ext;
    if (fileSet.has(withExt)) return withExt;
  }

  // Handle TypeScript .js→.ts extension mapping:
  // When a TS file imports "./foo.js", the actual file is "./foo.ts"
  const existingExt = path.extname(relPath);
  if (existingExt && extensions.length > 0) {
    const baseName = relPath.slice(0, -existingExt.length);
    for (const ext of extensions) {
      if (ext !== existingExt) {
        const swapped = baseName + ext;
        if (fileSet.has(swapped)) return swapped;
      }
    }
  }

  // Try as directory with index file
  for (const ext of extensions) {
    const indexFile = toForwardSlash(path.join(relPath, `index${ext}`));
    if (fileSet.has(indexFile)) return indexFile;
  }

  // SCSS/Sass partial: @import "variables" → _variables.scss
  if (extensions.some((e) => [".scss", ".sass", ".less", ".styl"].includes(e))) {
    const dir = path.dirname(relPath);
    const base = path.basename(relPath);
    if (!base.startsWith("_")) {
      // Try _name (direct)
      const partial = toForwardSlash(path.join(dir, `_${base}`));
      if (fileSet.has(partial)) return partial;
      // Try _name with extensions
      for (const ext of extensions) {
        const partialExt = toForwardSlash(path.join(dir, `_${base}${ext}`));
        if (fileSet.has(partialExt)) return partialExt;
      }
    }
  }

  // Python: try __init__.py
  if (extensions.includes(".py")) {
    const initFile = toForwardSlash(path.join(relPath, "__init__.py"));
    if (fileSet.has(initFile)) return initFile;
  }

  return null;
}

/**
 * Walk up from a starting directory looking for project.godot.
 * Returns the absolute path to the directory containing it, or null if not
 * found within 50 levels or at the filesystem root. Shared by both
 * {@link findGodotProjectRootForProject} and {@link findGodotProjectRoot}.
 */
function walkUpForGodotProject(startDir: string, rootCache?: GodotRootCache): string | null {
  let dir = path.resolve(startDir);
  const visited: string[] = [];
  for (let i = 0; i < 50; i++) {
    if (rootCache?.has(dir)) {
      const cached = rootCache.get(dir) ?? null;
      for (const visitedDir of visited) rootCache.set(visitedDir, cached);
      return cached;
    }
    visited.push(dir);
    const godotProject = path.join(dir, "project.godot");
    try {
      if (existsSync(godotProject)) {
        for (const visitedDir of visited) rootCache?.set(visitedDir, dir);
        return dir;
      }
    } catch {
      // Ignore stat errors
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // Reached filesystem root
    dir = parent;
  }
  for (const visitedDir of visited) rootCache?.set(visitedDir, null);
  return null;
}

/**
 * Find the Godot project root for a set of files by checking if project.godot
 * exists at the project path or any parent. Called once per graph build so
 * that res:// resolution doesn't walk the filesystem for every import.
 * Returns the absolute path to the directory containing project.godot,
 * or null if not found.
 */
export function findGodotProjectRootForProject(projectPath: string): string | null {
  return walkUpForGodotProject(path.resolve(projectPath));
}

/**
 * Find the Godot project root by walking up from a source file looking for
 * project.godot. Returns the absolute path to the directory containing it,
 * or null if not found. Used as a fallback when no pre-resolved root is
 * passed to resolveImport (tests, ad-hoc calls).
 */
function findGodotProjectRoot(sourceFile: string): string | null {
  return walkUpForGodotProject(path.dirname(sourceFile));
}

/**
 * Normalize a `res://`-relative path by collapsing `./` and `../` segments.
 * E.g. `scripts/../core/GameManager.gd` → `core/GameManager.gd`.
 * Unlike path.normalize, this preserves forward slashes and does not
 * resolve to an absolute path.
 */
function normalizeResPath(resPath: string): string {
  const parts = resPath.split("/");
  const result: string[] = [];
  for (const part of parts) {
    if (part === "." || part === "") continue;
    if (part === "..") {
      result.pop();
      continue;
    }
    result.push(part);
  }
  return result.join("/");
}

/**
 * Parse the `[autoload]` section from a Godot `project.godot` file and build
 * a map of autoload name → relative script path.
 *
 * The `[autoload]` section has the form:
 *   [autoload]
 *   GameManager="*res://scripts/core/GameManager.gd"
 *   InputManager="res://scripts/core/InputManager.gd"
 *
 * The leading `*` means the autoload is enabled (singleton). Both `*` and
 * non-`*` entries are included — the autoload name is still a global type
 * regardless of singleton status.
 *
 * @param godotProjectRoot - Absolute path to the directory containing project.godot
 * @returns Map of autoload name → relative path (forward-slash, relative to project root)
 */
export function parseGodotAutoloads(
  godotProjectRoot: string,
  recorder?: GraphInputRecorder,
): Map<string, string> {
  const autoloads = new Map<string, string>();
  const projectFile = path.join(godotProjectRoot, "project.godot");
  let content: string;
  try {
    content = readFileSync(projectFile, "utf-8");
  } catch {
    recorder?.unreadable(projectFile);
    return autoloads;
  }
  recorder?.read(projectFile, content);

  // Find the [autoload] section and parse key="value" lines until the next
  // section header or end of file.
  const lines = content.split("\n");
  let inAutoloadSection = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) {
      inAutoloadSection = trimmed === "[autoload]";
      continue;
    }
    if (!inAutoloadSection) continue;
    // Match: Name="*res://path/to/file.gd" or Name="res://path/to/file.gd"
    const match = trimmed.match(/^([A-Za-z_][\w]*)\s*=\s*"?\*?res:\/\/([^"]+)"?$/);
    if (!match) continue;
    const [, name, resPath] = match;
    // Normalize: collapse ./ and ../ segments so paths like
    // `res://scripts/../core/GameManager.gd` resolve correctly.
    const normalized = normalizeResPath(resPath);
    autoloads.set(name, toForwardSlash(normalized));
  }

  return autoloads;
}

/**
 * Resolve a GDScript class_name reference to a .gd file.
 *
 * Godot class identity comes from the `class_name` declaration, not the
 * filename. A file named `Foo.gd` that does not declare `class_name Foo`
 * must never resolve a bare `extends Foo` — Godot itself resolves bare class
 * references through the globally registered `class_name` table, and an
 * unnamed script is referenced by path (`preload`/`load`/`res://`), not by
 * name. So this function consults ONLY `class_name` declarations:
 *
 *  - When a classNameIndex is available (normal graph-build path), a single
 *    O(1) Map lookup with no file reads.
 *  - Otherwise (tests, ad-hoc calls), a disk scan of `class_name`
 *    declarations in `.gd` files.
 *
 * Filename-based resolution is intentionally NOT performed.
 */
function resolveByClassName(
  className: string,
  sourceFile: string,
  projectPath: string,
  fileSet: Set<string>,
  classNameIndex?: ClassNameIndex,
): string | null {
  const selfRelPath = toForwardSlash(path.relative(projectPath, sourceFile));

  // When an index is available, class_name is the authoritative identity.
  if (classNameIndex) {
    const resolved = classNameIndex.get(className);
    if (resolved && resolved !== selfRelPath) {
      return resolved;
    }
    return null;
  }

  // Without an index (tests, ad-hoc calls): scan .gd files on disk for
  // class_name declarations. Filename matching is intentionally skipped —
  // a file named <ClassName>.gd without a class_name declaration does not
  // define that class in Godot.
  for (const relPath of fileSet) {
    if (!relPath.endsWith(".gd")) continue;
    if (relPath === selfRelPath) continue;
    const absPath = path.join(projectPath, relPath);
    try {
      const content = readFileSync(absPath, "utf-8");
      const declaredName = extractClassNameFromGdscript(content);
      if (declaredName === className) {
        return relPath;
      }
    } catch {
      // Skip unreadable files
    }
  }

  return null;
}
