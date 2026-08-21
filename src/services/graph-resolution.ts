// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited
import { type Dirent, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parse as parseToml, type TomlTable, type TomlValue } from "smol-toml";
import { toForwardSlash } from "../constants.js";
import type { PathAliases } from "./graph-aliases.js";
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
    try {
      source = readFileSync(path.join(projectPath, f), "utf-8");
    } catch {
      continue;
    }
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
export function buildPhpPsr4Map(projectPath: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const root = path.resolve(projectPath);

  for (const relManifest of findComposerManifests(root)) {
    const manifest = path.join(root, relManifest);
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(manifest, "utf8"));
    } catch {
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
    try {
      goModSource = readFileSync(path.join(projectPath, goModRel), "utf-8");
    } catch {
      continue;
    }

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
export function buildDartPackageMap(projectPath: string): Map<string, string> {
  const map = new Map<string, string>();
  const root = path.resolve(projectPath);
  for (const relManifest of findPubspecFiles(root)) {
    let source: string;
    try {
      source = readFileSync(path.join(root, relManifest), "utf8");
    } catch {
      continue; // unreadable manifest — the other manifests still count
    }
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
export function buildPythonManifests(projectPath: string): PythonManifest[] {
  const root = path.resolve(projectPath);
  const relManifests = findPyProjectManifests(root);
  const dirs = relManifests.map((m) => toForwardSlash(path.dirname(m))); // "." at the root

  return relManifests.map((relManifest, i) => {
    const dir = dirs[i];
    let source = "";
    try {
      source = readFileSync(path.join(root, relManifest), "utf8");
    } catch {
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
  // sides of the declaration do not agree on it. Naming both spellings in the
  // type rejects a fragment that is neither — a `".+"` or a `"[^/]"` that
  // would quietly change what every pattern matches. It does not stop the two
  // being transposed, since each is valid at either call site; the tests that
  // assert each side separately are what pin that.
  const toRe = (pattern: string, singleStar: "[^/]*" | ".*"): RegExp => {
    const quote = (literal: string) => literal.replace(/[.+^${}()|[\]\\?*]/g, "\\$&");
    const body = pattern
      .split("**")
      .map((span) => span.split("*").map(quote).join(singleStar))
      .join(".*");
    return new RegExp(`^${body}$`);
  };
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
  const included = memberPatterns.map((p) => toRe(p.replace(/\/+$/, ""), "[^/]*"));
  if (included.length === 0) return [];
  const excluded = excludePatterns.map((p) => toRe(p.replace(/\/+$/, ""), ".*"));

  return allManifestDirs.filter((dir) => {
    if (dir === manifestDir) return false;
    const rel = relativeToManifest(dir);
    if (rel === null) return false;
    return included.some((re) => re.test(rel)) && !excluded.some((re) => re.test(rel));
  });
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
 * Resolve a module specifier to a relative file path within the project.
 * Returns null if the module is external (e.g., npm package, stdlib).
 *
 * `language` is a display label as produced by `getLanguageFromExtension`
 * (e.g. "shell", "typescript") — that is what `buildCodeGraph` passes. "bash"
 * has its own case below as a synonym for "shell". The capitalised `Lang`
 * grammar names ("JavaScript", "TypeScript", "Tsx", "Html", "Css") match no
 * case. Not every display label has one either, so a switch miss is always
 * possible, and it returns the same null an external module does.
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
      // Relative: .foo, ..bar
      if (moduleSpecifier.startsWith(".")) {
        const dots = moduleSpecifier.match(/^\.+/)?.[0].length ?? 0;
        let baseDir = sourceDir;
        for (let i = 1; i < dots; i++) {
          baseDir = path.dirname(baseDir);
        }
        const rest = moduleSpecifier.slice(dots).replace(/\./g, "/");
        return resolveRelativePath(rest || ".", baseDir, projectPath, fileSet, [".py"]);
      }
      // Absolute: foo.bar.baz → foo/bar/baz.py or foo/bar/baz/__init__.py
      const modulePath = moduleSpecifier.replace(/\./g, "/");
      const direct = resolveRelativePath(modulePath, projectPath, projectPath, fileSet, [".py"]);
      if (direct) return direct;

      // Try common Python source directories (src layout)
      const pySrcDirs = ["src", "lib"];
      for (const dir of pySrcDirs) {
        const inSrc = resolveRelativePath(
          path.join(dir, modulePath), projectPath, projectPath, fileSet, [".py"],
        );
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
      const sibling = resolveRelativePath(modulePath, sourceDir, projectPath, fileSet, [".py"]);
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
      for (const importRoot of pythonImportRoots ?? []) {
        const inRoot = resolveRelativePath(
          path.posix.join(importRoot, modulePath), projectPath, projectPath, fileSet, [".py"],
        );
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
      // PSR-4: App\Models\User → app/Models/User.php
      if (moduleSpecifier.includes("\\")) {
        // Declared PSR-4 first — composer.json is the authority on where a
        // namespace lives, and the heuristics below can only guess. Longest
        // matching prefix wins so `Acme\Auth\Database\Seeders\` beats the
        // shorter `Acme\Auth\` that also prefixes it.
        if (phpPsr4Map && phpPsr4Map.size > 0) {
          const namespaced = moduleSpecifier.replace(/^\\+/, "");
          let bestPrefix = "";
          for (const prefix of phpPsr4Map.keys()) {
            if (namespaced.startsWith(prefix) && prefix.length > bestPrefix.length) {
              bestPrefix = prefix;
            }
          }
          if (bestPrefix) {
            const relative = namespaced.slice(bestPrefix.length).replace(/\\/g, "/");
            for (const dir of phpPsr4Map.get(bestPrefix) ?? []) {
              const candidate = dir ? `${dir}/${relative}` : relative;
              const hit = resolveRelativePath(candidate, projectPath, projectPath, fileSet, [".php"]);
              if (hit) return hit;
            }
          }
        }

        const filePath = moduleSpecifier.replace(/\\/g, "/");
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
      if (moduleSpecifier.startsWith("./") || moduleSpecifier.startsWith("../")) {
        return resolveRelativePath(moduleSpecifier, sourceDir, projectPath, fileSet, [".php"]);
      }
      return null;
    }

    case "rust": {
      // mod foo → foo.rs or foo/mod.rs
      if (!moduleSpecifier.includes("::")) {
        const candidates = [
          path.join(sourceDir, `${moduleSpecifier}.rs`),
          path.join(sourceDir, moduleSpecifier, "mod.rs"),
        ];
        for (const candidate of candidates) {
          const rel = toForwardSlash(path.relative(projectPath, candidate));
          if (fileSet.has(rel)) return rel;
        }
      }
      return null;
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

    case "lua": {
      // require("foo.bar") → foo/bar.lua
      const luaPath = moduleSpecifier.replace(/\./g, "/");
      return resolveRelativePath(luaPath, projectPath, projectPath, fileSet, [".lua"]);
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
