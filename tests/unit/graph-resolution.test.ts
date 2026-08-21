// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildCsNamespaceMap,
  buildDartPackageMap,
  buildGoModuleInfo,
  buildJvmSuffixMap,
  buildPythonManifests,
  hasLiteralShellPathShape,
  type PythonManifest,
  pythonRootsForFile,
  resolveImport,
} from "../../src/services/graph-resolution.js";

// ── Helper to create temp project layouts ─────────────────────────────

interface TempProject {
  root: string;
  fileSet: Set<string>;
  cleanup: () => void;
}

function createTempProject(
  files: Record<string, string>,
): TempProject {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "socraticode-resolve-"));
  const fileSet = new Set<string>();

  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = path.join(root, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
    fileSet.add(relPath);
  }

  return {
    root,
    fileSet,
    cleanup: () => {
      try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
    },
  };
}

describe("graph-resolution", () => {
  let project: TempProject | null = null;

  afterEach(() => {
    project?.cleanup();
    project = null;
  });

  describe("TypeScript/JavaScript resolution", () => {
    it("resolves relative imports with .js extension to .ts files", () => {
      project = createTempProject({
        "src/index.ts": "",
        "src/utils.ts": "",
      });

      const result = resolveImport(
        "./utils.js",
        path.join(project.root, "src/index.ts"),
        project.root,
        project.fileSet,
        "typescript",
      );

      expect(result).toBe("src/utils.ts");
    });

    it("resolves relative imports without extension", () => {
      project = createTempProject({
        "src/index.ts": "",
        "src/helpers.ts": "",
      });

      const result = resolveImport(
        "./helpers",
        path.join(project.root, "src/index.ts"),
        project.root,
        project.fileSet,
        "typescript",
      );

      expect(result).toBe("src/helpers.ts");
    });

    it("resolves imports to index files", () => {
      project = createTempProject({
        "src/app.ts": "",
        "src/utils/index.ts": "",
      });

      const result = resolveImport(
        "./utils",
        path.join(project.root, "src/app.ts"),
        project.root,
        project.fileSet,
        "typescript",
      );

      expect(result).toBe("src/utils/index.ts");
    });

    it("resolves parent directory imports", () => {
      project = createTempProject({
        "src/utils/helper.ts": "",
        "src/types.ts": "",
      });

      const result = resolveImport(
        "../types",
        path.join(project.root, "src/utils/helper.ts"),
        project.root,
        project.fileSet,
        "typescript",
      );

      expect(result).toBe("src/types.ts");
    });

    it("returns null for npm package imports", () => {
      project = createTempProject({
        "src/index.ts": "",
      });

      const result = resolveImport(
        "lodash",
        path.join(project.root, "src/index.ts"),
        project.root,
        project.fileSet,
        "typescript",
      );

      expect(result).toBeNull();
    });

    it("returns null for npm scoped package imports", () => {
      project = createTempProject({
        "src/index.ts": "",
      });

      const result = resolveImport(
        "@types/node",
        path.join(project.root, "src/index.ts"),
        project.root,
        project.fileSet,
        "typescript",
      );

      expect(result).toBeNull();
    });

    it("resolves direct .ts file imports", () => {
      project = createTempProject({
        "src/index.ts": "",
        "src/config.ts": "",
      });

      const result = resolveImport(
        "./config.ts",
        path.join(project.root, "src/index.ts"),
        project.root,
        project.fileSet,
        "typescript",
      );

      expect(result).toBe("src/config.ts");
    });
  });

  describe("Python resolution", () => {
    it("resolves relative imports", () => {
      project = createTempProject({
        "src/main.py": "",
        "src/models.py": "",
      });

      const result = resolveImport(
        ".models",
        path.join(project.root, "src/main.py"),
        project.root,
        project.fileSet,
        "python",
      );

      expect(result).toBe("src/models.py");
    });

    it("resolves absolute package imports", () => {
      project = createTempProject({
        "app.py": "",
        "utils/helpers.py": "",
      });

      const result = resolveImport(
        "utils.helpers",
        path.join(project.root, "app.py"),
        project.root,
        project.fileSet,
        "python",
      );

      expect(result).toBe("utils/helpers.py");
    });

    it("resolves __init__.py for package imports", () => {
      project = createTempProject({
        "app.py": "",
        "utils/__init__.py": "",
      });

      const result = resolveImport(
        "utils",
        path.join(project.root, "app.py"),
        project.root,
        project.fileSet,
        "python",
      );

      expect(result).toBe("utils/__init__.py");
    });

    it("returns null for stdlib imports", () => {
      project = createTempProject({
        "app.py": "",
      });

      const result = resolveImport(
        "os",
        path.join(project.root, "app.py"),
        project.root,
        project.fileSet,
        "python",
      );

      expect(result).toBeNull();
    });

    it("returns null for json stdlib", () => {
      project = createTempProject({
        "app.py": "",
      });

      const result = resolveImport(
        "json",
        path.join(project.root, "app.py"),
        project.root,
        project.fileSet,
        "python",
      );

      expect(result).toBeNull();
    });

    it("resolves absolute imports under src/ directory (src layout)", () => {
      project = createTempProject({
        "app.py": "",
        "src/mypackage/utils.py": "",
      });

      const result = resolveImport(
        "mypackage.utils",
        path.join(project.root, "app.py"),
        project.root,
        project.fileSet,
        "python",
      );

      expect(result).toBe("src/mypackage/utils.py");
    });

    it("resolves sibling-flat imports in service-style monorepos (#46)", () => {
      // service-a/main.py runs as `python main.py` from inside service-a/,
      // so `import config` resolves to service-a/config.py at runtime.
      project = createTempProject({
        "service-a/main.py": "",
        "service-a/config.py": "",
        "service-b/main.py": "",
        "service-b/config.py": "",
      });

      const result = resolveImport(
        "config",
        path.join(project.root, "service-a/main.py"),
        project.root,
        project.fileSet,
        "python",
      );

      expect(result).toBe("service-a/config.py");
    });

    it("resolves sibling-flat imports for dotted module paths", () => {
      // `import shared.utils` from service-a/main.py with shared/utils.py
      // sitting next to main.py.
      project = createTempProject({
        "service-a/main.py": "",
        "service-a/shared/utils.py": "",
      });

      const result = resolveImport(
        "shared.utils",
        path.join(project.root, "service-a/main.py"),
        project.root,
        project.fileSet,
        "python",
      );

      expect(result).toBe("service-a/shared/utils.py");
    });

    it("resolves sibling packages via __init__.py", () => {
      // `import config` resolves to service-a/config/__init__.py when no
      // bare service-a/config.py exists.
      project = createTempProject({
        "service-a/main.py": "",
        "service-a/config/__init__.py": "",
      });

      const result = resolveImport(
        "config",
        path.join(project.root, "service-a/main.py"),
        project.root,
        project.fileSet,
        "python",
      );

      expect(result).toBe("service-a/config/__init__.py");
    });

    it("preserves project-root precedence when the same name exists at root and as a sibling", () => {
      // Backward-compat guarantee: `import config` from service-a/main.py
      // still resolves to the project-root config.py if one exists, so
      // existing layouts do not change after this PR. The sibling fallback
      // only fires when the project-root lookup fails.
      project = createTempProject({
        "config.py": "",
        "service-a/main.py": "",
        "service-a/config.py": "",
      });

      const result = resolveImport(
        "config",
        path.join(project.root, "service-a/main.py"),
        project.root,
        project.fileSet,
        "python",
      );

      expect(result).toBe("config.py");
    });

    it("returns null when neither project-root, src/, lib/, nor sibling have the module", () => {
      project = createTempProject({
        "service-a/main.py": "",
      });

      const result = resolveImport(
        "config",
        path.join(project.root, "service-a/main.py"),
        project.root,
        project.fileSet,
        "python",
      );

      expect(result).toBeNull();
    });
  });

  // ── Python manifest-declared import roots (#107) ──────────────────────

  describe("Python src-layout resolution (#107)", () => {
    // `uv init --lib`, hatchling and setuptools all generate
    // `<package>/src/<module>/`, so in a workspace every cross-package import
    // — and every package's own absolute self-import — named a path the
    // project-root `src/`+`lib/` probe could not reach. A 362-file uv
    // workspace built 3 edges. These tests pin the mechanism the fix rests
    // on: the roots the pyproject.toml manifests declare, scoped to the
    // importing file and tried nearest first.

    const pyResolve = (spec: string, from: string, p: TempProject) => {
      const manifests = buildPythonManifests(p.root);
      const roots = pythonRootsForFile(manifests, path.posix.dirname(from));
      return resolveImport(
        spec,
        path.join(p.root, from),
        p.root,
        p.fileSet,
        "python",
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        roots,
      );
    };

    // The reporter's layout: dashed distribution directory, intervening src/,
    // underscored module name — a three-way mismatch no name-shaped guess
    // can bridge. The root manifest declares the members, which is what puts
    // one package's roots in scope for another's files.
    const workspace = {
      "pyproject.toml": '[tool.uv.workspace]\nmembers = ["packages/*"]\n',
      "packages/adapter-legislature/pyproject.toml": '[project]\nname = "adapter-legislature"\n',
      "packages/adapter-legislature/src/adapter_legislature/tenure_spans.py": "",
      "packages/adapter-sos/pyproject.toml": '[project]\nname = "adapter-sos"\n',
      "packages/adapter-sos/src/adapter_sos/house/build.py": "",
      "packages/adapter-sos/src/adapter_sos/db.py": "",
    };

    it("resolves a cross-package import through a nested src/ root", () => {
      project = createTempProject(workspace);

      const result = pyResolve(
        "adapter_legislature.tenure_spans",
        "packages/adapter-sos/src/adapter_sos/house/build.py",
        project,
      );

      expect(result).toBe(
        "packages/adapter-legislature/src/adapter_legislature/tenure_spans.py",
      );
    });

    it("resolves a package's own absolute self-import", () => {
      // Confirmed broken on main too: a package could not even import itself
      // by its absolute module name, only relatively.
      project = createTempProject(workspace);

      const result = pyResolve(
        "adapter_sos.db",
        "packages/adapter-sos/src/adapter_sos/house/build.py",
        project,
      );

      expect(result).toBe("packages/adapter-sos/src/adapter_sos/db.py");
    });

    it("resolves a single-module distribution with no package directory", () => {
      // The load-bearing case for registering ROOTS rather than enumerating
      // the module names under them: `src/solo_mod.py` is the whole importable
      // surface and no directory bears the module's name, so a name
      // enumeration would never see it.
      project = createTempProject({
        "pyproject.toml": '[tool.uv.workspace]\nmembers = ["packages/*"]\n',
        "packages/solo/pyproject.toml": '[project]\nname = "solo"\n',
        "packages/solo/src/solo_mod.py": "",
        "app/main.py": "",
      });

      expect(pyResolve("solo_mod", "app/main.py", project)).toBe(
        "packages/solo/src/solo_mod.py",
      );
    });

    it("resolves a PEP 420 namespace package with no __init__.py", () => {
      // Registering roots asks nothing about what a directory contains, so
      // implicit namespace packages resolve without a special case.
      project = createTempProject({
        "pyproject.toml": '[tool.uv.workspace]\nmembers = ["packages/*"]\n',
        "packages/ns-pkg/pyproject.toml": '[project]\nname = "ns-pkg"\n',
        "packages/ns-pkg/src/acme/plugins/loader.py": "",
        "app/main.py": "",
      });

      expect(pyResolve("acme.plugins.loader", "app/main.py", project)).toBe(
        "packages/ns-pkg/src/acme/plugins/loader.py",
      );
    });

    it("resolves a flat-layout package beside its own manifest", () => {
      // Not every packaged project uses src/; the manifest directory itself
      // is an import root in the flat layout.
      project = createTempProject({
        "pyproject.toml": '[tool.uv.workspace]\nmembers = ["packages/*"]\n',
        "packages/flatpkg/pyproject.toml": '[project]\nname = "flatpkg"\n',
        "packages/flatpkg/flat_mod/thing.py": "",
        "app/main.py": "",
      });

      expect(pyResolve("flat_mod.thing", "app/main.py", project)).toBe(
        "packages/flatpkg/flat_mod/thing.py",
      );
    });

    it("resolves a package import to __init__.py under a nested root", () => {
      project = createTempProject({
        "pyproject.toml": '[tool.uv.workspace]\nmembers = ["packages/*"]\n',
        "packages/adapter-sos/pyproject.toml": '[project]\nname = "adapter-sos"\n',
        "packages/adapter-sos/src/adapter_sos/__init__.py": "",
        "app/main.py": "",
      });

      expect(pyResolve("adapter_sos", "app/main.py", project)).toBe(
        "packages/adapter-sos/src/adapter_sos/__init__.py",
      );
    });

    it("returns null for a module absent from every declared root", () => {
      // Third-party imports must stay unresolved rather than be guessed into
      // the project tree.
      project = createTempProject(workspace);

      expect(
        pyResolve("requests.adapters", "packages/adapter-sos/src/adapter_sos/db.py", project),
      ).toBeNull();
    });

    it("returns null for a src-layout import when no roots are passed", () => {
      // Back-compat pin: every pre-#107 caller omits the list, and that
      // omission must reproduce the old behavior exactly rather than
      // half-resolving through some default.
      project = createTempProject(workspace);

      const result = resolveImport(
        "adapter_legislature.tenure_spans",
        path.join(project.root, "packages/adapter-sos/src/adapter_sos/house/build.py"),
        project.root,
        project.fileSet,
        "python",
      );

      expect(result).toBeNull();
    });

    it("preserves project-root precedence over a manifest root", () => {
      // Backward-compat guarantee, mirroring the #46 pin above: a layout that
      // already resolved to the project-root file still resolves to it.
      project = createTempProject({
        "config.py": "",
        "pyproject.toml": '[tool.uv.workspace]\nmembers = ["packages/*"]\n',
        "packages/pkg-a/pyproject.toml": '[project]\nname = "pkg-a"\n',
        "packages/pkg-a/src/config.py": "",
        "packages/pkg-a/src/pkg_a/main.py": "",
      });

      expect(pyResolve("config", "packages/pkg-a/src/pkg_a/main.py", project)).toBe("config.py");
    });

    it("prefers the sibling-flat guess over a manifest root", () => {
      // CPython puts the script's own directory at sys.path[0], ahead of every
      // installed-distribution entry, so where a sibling file and a package
      // root both offer the module, the sibling is what actually gets
      // imported. Both match here; the sibling wins.
      project = createTempProject({
        "pyproject.toml": '[tool.uv.workspace]\nmembers = ["packages/*"]\n',
        "packages/pkg-a/pyproject.toml": '[project]\nname = "pkg-a"\n',
        "packages/pkg-a/src/shared/utils.py": "",
        "packages/pkg-a/src/pkg_a/main.py": "",
        "packages/pkg-a/src/pkg_a/shared/utils.py": "",
      });

      expect(pyResolve("shared.utils", "packages/pkg-a/src/pkg_a/main.py", project)).toBe(
        "packages/pkg-a/src/pkg_a/shared/utils.py",
      );
    });

    it("keeps each service's flat modules local in a per-service monorepo", () => {
      // Two flat `uv init --app` services, each with its own config.py. A flat
      // list of every root in the tree resolved beta's `import config` to
      // alpha's file, because alpha sorted first — a confident edge into
      // another service, with an unchanged edge count so no yield signal could
      // surface it.
      project = createTempProject({
        "services/alpha-svc/pyproject.toml": '[project]\nname = "alpha-svc"\n',
        "services/alpha-svc/main.py": "",
        "services/alpha-svc/config.py": "",
        "services/beta-svc/pyproject.toml": '[project]\nname = "beta-svc"\n',
        "services/beta-svc/main.py": "",
        "services/beta-svc/config.py": "",
      });

      expect(pyResolve("config", "services/beta-svc/main.py", project)).toBe(
        "services/beta-svc/config.py",
      );
      expect(pyResolve("config", "services/alpha-svc/main.py", project)).toBe(
        "services/alpha-svc/config.py",
      );
    });

    it("prefers the importing package's own root over a sibling's for a non-sibling import", () => {
      // Proximity ordering, in the case the #46 fallback cannot reach: the
      // module sits under both packages' src/ roots but next to neither file,
      // so only ordering by containment picks the importer's own package.
      //
      // The importer is the alphabetically LATER package on purpose. With
      // pkg-a importing, lexicographic order would land on the right file by
      // accident and the test could not tell proximity from luck — which is
      // how a flat sorted list passed review while resolving beta-svc's
      // `import config` to alpha-svc's file.
      project = createTempProject({
        "pyproject.toml": '[tool.uv.workspace]\nmembers = ["packages/*"]\n',
        "packages/pkg-a/pyproject.toml": '[project]\nname = "pkg-a"\n',
        "packages/pkg-a/src/shared/utils.py": "",
        "packages/pkg-b/pyproject.toml": '[project]\nname = "pkg-b"\n',
        "packages/pkg-b/src/shared/utils.py": "",
        "packages/pkg-b/src/pkg_b/main.py": "",
      });

      expect(pyResolve("shared.utils", "packages/pkg-b/src/pkg_b/main.py", project)).toBe(
        "packages/pkg-b/src/shared/utils.py",
      );
    });

    it("does not resolve through a manifest in a non-importable subtree", () => {
      // A sample app, cookiecutter template, docs project, checked-in sdist or
      // per-fixture manifest sits on no sys.path the importing file could
      // reach. Registering its roots globally turns an import that correctly
      // resolved to nothing into a fabricated edge.
      project = createTempProject({
        "pyproject.toml": '[project]\nname = "mainpkg"\n',
        "src/mainpkg/app.py": "",
        "examples/demo/pyproject.toml": '[project]\nname = "demo"\n',
        "examples/demo/settings.py": "",
      });

      expect(pyResolve("settings", "src/mainpkg/app.py", project)).toBeNull();
    });

    it("still resolves within a non-importable subtree's own files", () => {
      // The example project is out of scope for the main package, not broken
      // in itself: its own manifest is on its own files' ancestor path.
      project = createTempProject({
        "pyproject.toml": '[project]\nname = "mainpkg"\n',
        "examples/demo/pyproject.toml": '[project]\nname = "demo"\n',
        "examples/demo/src/demo_pkg/app.py": "",
        "examples/demo/src/demo_pkg/settings.py": "",
      });

      expect(pyResolve("demo_pkg.settings", "examples/demo/src/demo_pkg/app.py", project)).toBe(
        "examples/demo/src/demo_pkg/settings.py",
      );
    });

    it("still resolves relative imports when roots are present", () => {
      project = createTempProject({
        "pyproject.toml": '[project]\nname = "pkg-a"\n',
        "src/pkg_a/main.py": "",
        "src/pkg_a/models.py": "",
      });

      expect(pyResolve(".models", "src/pkg_a/main.py", project)).toBe("src/pkg_a/models.py");
    });

    it("keeps stdlib imports external even with roots present", () => {
      // A project directory named after a stdlib module must not start
      // drawing edges for `import os`.
      project = createTempProject({
        "pyproject.toml": '[project]\nname = "pkg-a"\n',
        "src/os.py": "",
        "src/pkg_a/main.py": "",
      });

      expect(pyResolve("os", "src/pkg_a/main.py", project)).toBeNull();
    });
  });

  describe("buildPythonManifests", () => {
    it("registers both the manifest directory and its src/ subdirectory", () => {
      // The layout is not derivable from the import, so both candidates are
      // registered; a root that does not exist holds no files and matches
      // nothing.
      project = createTempProject({
        "packages/pkg-a/pyproject.toml": "",
      });

      const [manifest] = buildPythonManifests(project.root);

      expect(manifest.dir).toBe("packages/pkg-a");
      expect(manifest.roots).toEqual(["packages/pkg-a", "packages/pkg-a/src"]);
    });

    it("maps a root-level manifest to '.' and 'src'", () => {
      project = createTempProject({ "pyproject.toml": "" });

      const [manifest] = buildPythonManifests(project.root);

      expect(manifest.dir).toBe(".");
      expect(manifest.roots).toEqual([".", "src"]);
    });

    it("resolves workspace member globs against the manifests found", () => {
      project = createTempProject({
        "pyproject.toml": '[tool.uv.workspace]\nmembers = ["packages/*"]\n',
        "packages/alpha/pyproject.toml": "",
        "packages/zeta/pyproject.toml": "",
        "examples/demo/pyproject.toml": "",
      });

      const root = buildPythonManifests(project.root).find((m) => m.dir === ".");

      expect(root?.members).toEqual(["packages/alpha", "packages/zeta"]);
    });

    it("honours an exclude list alongside members", () => {
      project = createTempProject({
        "pyproject.toml":
          '[tool.uv.workspace]\nmembers = ["packages/*"]\nexclude = ["packages/legacy"]\n',
        "packages/alpha/pyproject.toml": "",
        "packages/legacy/pyproject.toml": "",
      });

      const root = buildPythonManifests(project.root).find((m) => m.dir === ".");

      expect(root?.members).toEqual(["packages/alpha"]);
    });

    // An entry this reader cannot represent means something different in the
    // two arrays, which is why they share one void. Losing a MEMBER costs an
    // edge that should have resolved. Losing an EXCLUSION admits a package the
    // manifest explicitly excludes and draws a cross-package edge uv would
    // not — the reader inventing a declaration rather than missing one. These
    // pin the exclude side, whose only case used to be the plain literal.

    it("voids the section when an exclude entry is truncated by a comment", () => {
      // The regression: comment-stripping cut the array at the `#`, so the
      // real exclusion behind it vanished and `legacy` became a member.
      // Reading strings as opaque keeps both entries, and the exclusion holds.
      project = createTempProject({
        "pyproject.toml":
          '[tool.uv.workspace]\nmembers = ["packages/*"]\nexclude = ["packages/#legacy", "packages/legacy"]\n',
        "packages/alpha/pyproject.toml": "",
        "packages/legacy/pyproject.toml": "",
      });

      const root = buildPythonManifests(project.root).find((m) => m.dir === ".");

      expect(root?.members).toEqual(["packages/alpha"]);
    });

    // uv expands `members` by globbing the filesystem, where a lone `*` selects
    // one path segment, but matches `exclude` against the member's whole path,
    // where it does not stop at a separator. Translating both with the same
    // narrow `*` under-excluded, and under-excluding is the direction that
    // invents an edge. All three checked against uv 0.10.0 and 0.11.8, which
    // agree.

    it("excludes through a `*` that spans a path separator", () => {
      // `*legacy` does not match `packages/legacy` a segment at a time, so a
      // segment-wise `*` kept legacy a member and drew a cross-package edge to
      // the one package the manifest named to keep out.
      project = createTempProject({
        "pyproject.toml": '[tool.uv.workspace]\nmembers = ["packages/*"]\nexclude = ["*legacy"]\n',
        "packages/alpha/pyproject.toml": "",
        "packages/legacy/pyproject.toml": "",
      });

      const root = buildPythonManifests(project.root).find((m) => m.dir === ".");

      expect(root?.members).toEqual(["packages/alpha"]);
    });

    it("empties the workspace when a bare `*` is excluded", () => {
      // Not an exotic spelling, and the whole point of the asymmetry: uv reads
      // this as excluding every member, leaving the root alone.
      project = createTempProject({
        "pyproject.toml": '[tool.uv.workspace]\nmembers = ["packages/*"]\nexclude = ["*"]\n',
        "packages/alpha/pyproject.toml": "",
        "packages/legacy/pyproject.toml": "",
      });

      const root = buildPythonManifests(project.root).find((m) => m.dir === ".");

      expect(root?.members).toEqual([]);
    });

    it("keeps a member whose path a `*` in the include list cannot span", () => {
      // The include side must NOT gain the spanning `*`: uv globs the
      // filesystem for members, so `packages/*` stops at a segment and
      // `packages/alpha/inner` is not a member. Widening it here would
      // register a root over a package the workspace never declared.
      project = createTempProject({
        "pyproject.toml": '[tool.uv.workspace]\nmembers = ["packages/*"]\n',
        "packages/alpha/pyproject.toml": "",
        "packages/alpha/inner/pyproject.toml": "",
      });

      const root = buildPythonManifests(project.root).find((m) => m.dir === ".");

      expect(root?.members).toEqual(["packages/alpha"]);
    });

    it("keeps a package a member when the only exclusion names a `#` path", () => {
      // Looks like the case above and is not: uv reads `packages/#legacy` as a
      // literal path that matches nothing, so `legacy` stays a member and the
      // cross-package edge is correct. Voiding here would drop a real edge.
      project = createTempProject({
        "pyproject.toml":
          '[tool.uv.workspace]\nmembers = ["packages/*"]\nexclude = ["packages/#legacy"]\n',
        "packages/alpha/pyproject.toml": "",
        "packages/legacy/pyproject.toml": "",
      });

      const root = buildPythonManifests(project.root).find((m) => m.dir === ".");

      expect(root?.members).toEqual(["packages/alpha", "packages/legacy"]);
    });

    it("voids the section when an exclude entry uses a glob character class", () => {
      // uv honours `[a]` as a class and excludes legacy. Matching it literally
      // would exclude nothing and admit legacy, so the section is voided.
      project = createTempProject({
        "pyproject.toml":
          '[tool.uv.workspace]\nmembers = ["packages/*"]\nexclude = ["packages/leg[a]cy"]\n',
        "packages/alpha/pyproject.toml": "",
        "packages/legacy/pyproject.toml": "",
      });

      const root = buildPythonManifests(project.root).find((m) => m.dir === ".");

      expect(root?.members).toEqual([]);
    });

    it("voids the section when an exclude entry is not a quoted scalar", () => {
      // A bare word is not a TOML value, so the document does not parse and the
      // manifest declares nothing. Reading the members and ignoring the
      // unreadable exclude would admit exactly the package it kept out.
      project = createTempProject({
        "pyproject.toml":
          '[tool.uv.workspace]\nmembers = ["packages/*"]\nexclude = [packages/legacy]\n',
        "packages/alpha/pyproject.toml": "",
        "packages/legacy/pyproject.toml": "",
      });

      const root = buildPythonManifests(project.root).find((m) => m.dir === ".");

      expect(root?.members).toEqual([]);
    });

    it("voids the section when an exclude entry uses a `?` wildcard", () => {
      project = createTempProject({
        "pyproject.toml":
          '[tool.uv.workspace]\nmembers = ["packages/*"]\nexclude = ["packages/legac?"]\n',
        "packages/alpha/pyproject.toml": "",
        "packages/legacy/pyproject.toml": "",
      });

      const root = buildPythonManifests(project.root).find((m) => m.dir === ".");

      expect(root?.members).toEqual([]);
    });

    // uv reads each of the following as a workspace declaring `packages/*`,
    // confirmed against uv 0.11.8 on identical manifests. Every one is ordinary
    // TOML a user can write today; a reader matching the header as text found
    // no members in any of them and said nothing about why — the same silent
    // shape as issue #107 itself.

    it("reads members from a spaced table header", () => {
      project = createTempProject({
        "pyproject.toml": '[ tool.uv.workspace ]\nmembers = ["packages/*"]\n',
        "packages/alpha/pyproject.toml": "",
      });

      const root = buildPythonManifests(project.root).find((m) => m.dir === ".");

      expect(root?.members).toEqual(["packages/alpha"]);
    });

    it("reads members from an inline workspace table under [tool.uv]", () => {
      project = createTempProject({
        "pyproject.toml": '[tool.uv]\nworkspace = { members = ["packages/*"] }\n',
        "packages/alpha/pyproject.toml": "",
      });

      const root = buildPythonManifests(project.root).find((m) => m.dir === ".");

      expect(root?.members).toEqual(["packages/alpha"]);
    });

    it("reads members from a top-level dotted key", () => {
      // Dotted keys belong to the table they sit under, so this one declares a
      // workspace only because it precedes `[project]`. uv agrees.
      project = createTempProject({
        "pyproject.toml": 'tool.uv.workspace.members = ["packages/*"]\n[project]\nname = "root"\n',
        "packages/alpha/pyproject.toml": "",
      });

      const root = buildPythonManifests(project.root).find((m) => m.dir === ".");

      expect(root?.members).toEqual(["packages/alpha"]);
    });

    it("reads members past a comment containing a string delimiter", () => {
      // A `"""` inside a comment opens nothing. Treating it as a delimiter
      // blanked the rest of the file, and the real table below it vanished.
      project = createTempProject({
        "pyproject.toml": '# """\n[tool.uv.workspace]\nmembers = ["packages/*"]\n',
        "packages/alpha/pyproject.toml": "",
      });

      const root = buildPythonManifests(project.root).find((m) => m.dir === ".");

      expect(root?.members).toEqual(["packages/alpha"]);
    });

    it("reads members from a manifest saved with a byte-order mark", () => {
      // uv's parser skips a BOM and locks the workspace; TOML's grammar has no
      // place for one, so `tomllib` and this parser both reject the document.
      // Without stripping it the manifest would lose every member it declares.
      project = createTempProject({
        "pyproject.toml": '\uFEFF[tool.uv.workspace]\nmembers = ["packages/*"]\n',
        "packages/alpha/pyproject.toml": "",
      });

      const root = buildPythonManifests(project.root).find((m) => m.dir === ".");

      expect(root?.members).toEqual(["packages/alpha"]);
    });

    it("reads a member spelled as a multi-line string", () => {
      // A legal, if unusual, way to write the same glob. uv resolves it.
      project = createTempProject({
        "pyproject.toml": '[tool.uv.workspace]\nmembers = ["""packages/*"""]\n',
        "packages/alpha/pyproject.toml": "",
      });

      const root = buildPythonManifests(project.root).find((m) => m.dir === ".");

      expect(root?.members).toEqual(["packages/alpha"]);
    });

    it("reads members from a header carrying a trailing comment", () => {
      // TOML's grammar allows a comment after a table header. Anchoring the
      // header to end-of-line rejected the commented form, and because a
      // manifest with no readable members simply scopes to its own subtree,
      // the failure was silent: every cross-package import went back to null.
      project = createTempProject({
        "pyproject.toml": '[tool.uv.workspace]  # the workspace root\nmembers = ["packages/*"]\n',
        "packages/alpha/pyproject.toml": "",
      });

      const root = buildPythonManifests(project.root).find((m) => m.dir === ".");

      expect(root?.members).toEqual(["packages/alpha"]);
    });

    it("does not read a quoted word inside a comment as a member", () => {
      // A comment sitting in the array would otherwise contribute its quoted
      // text as a member glob.
      project = createTempProject({
        "pyproject.toml":
          '[tool.uv.workspace]\nmembers = [\n  "packages/*",  # not "examples/demo"\n]\n',
        "packages/alpha/pyproject.toml": "",
        "examples/demo/pyproject.toml": "",
      });

      const root = buildPythonManifests(project.root).find((m) => m.dir === ".");

      expect(root?.members).toEqual(["packages/alpha"]);
    });

    it("voids the section when a member uses a glob character class", () => {
      // uv matches with a full globset, so `packages/[ab]*` selects a set this
      // reader cannot compute. Reading the rest of the array and ignoring this
      // entry would be a guess about what the manifest declares; voiding falls
      // back to ancestor-path scoping, which resolves strictly fewer imports.
      project = createTempProject({
        "pyproject.toml": '[tool.uv.workspace]\nmembers = ["packages/[ab]*", "packages/*"]\n',
        "packages/alpha/pyproject.toml": "",
      });

      const root = buildPythonManifests(project.root).find((m) => m.dir === ".");

      expect(root?.members).toEqual([]);
    });

    it("voids the section when a member uses a `?` wildcard", () => {
      project = createTempProject({
        "pyproject.toml": '[tool.uv.workspace]\nmembers = ["packages/alph?"]\n',
        "packages/alpha/pyproject.toml": "",
      });

      const root = buildPythonManifests(project.root).find((m) => m.dir === ".");

      expect(root?.members).toEqual([]);
    });

    it("voids the section when the array is missing a separator", () => {
      // uv refuses to parse this manifest, so it declares nothing. Scanning for
      // quoted runs read two members out of a document that has none.
      project = createTempProject({
        "pyproject.toml": '[tool.uv.workspace]\nmembers = ["packages/alpha" "packages/zeta"]\n',
        "packages/alpha/pyproject.toml": "",
        "packages/zeta/pyproject.toml": "",
      });

      const root = buildPythonManifests(project.root).find((m) => m.dir === ".");

      expect(root?.members).toEqual([]);
    });

    it("voids the section when members is not an array", () => {
      // uv fails the lock outright on this manifest. A single string is not a
      // member list, and guessing that it means a one-element one would be the
      // reader deciding what the manifest meant.
      project = createTempProject({
        "pyproject.toml": '[tool.uv.workspace]\nmembers = "packages/*"\n',
        "packages/alpha/pyproject.toml": "",
      });

      const root = buildPythonManifests(project.root).find((m) => m.dir === ".");

      expect(root?.members).toEqual([]);
    });

    it("voids the section when a member entry is not a string", () => {
      // Keeping the well-formed neighbours would be a guess about a manifest uv
      // rejects, and every entry kept is a root registered over other packages.
      project = createTempProject({
        "pyproject.toml": '[tool.uv.workspace]\nmembers = ["packages/*", 3]\n',
        "packages/alpha/pyproject.toml": "",
      });

      const root = buildPythonManifests(project.root).find((m) => m.dir === ".");

      expect(root?.members).toEqual([]);
    });

    it("voids the section when exclude is not an array", () => {
      // The exclude side needs its own guard: treating an unreadable exclusion
      // as no exclusion admits the one package the manifest names.
      project = createTempProject({
        "pyproject.toml":
          '[tool.uv.workspace]\nmembers = ["packages/*"]\nexclude = "packages/legacy"\n',
        "packages/alpha/pyproject.toml": "",
        "packages/legacy/pyproject.toml": "",
      });

      const root = buildPythonManifests(project.root).find((m) => m.dir === ".");

      expect(root?.members).toEqual([]);
    });

    it("keeps building the graph when a manifest cannot be parsed", () => {
      // A manifest that fails to parse declares nothing; it must not throw out
      // of the walk, or one malformed file anywhere in the tree would cost the
      // whole project its Python roots. Same contract as an unreadable file.
      project = createTempProject({
        "pyproject.toml": "[tool.uv.workspace\nmembers = [",
        "packages/alpha/pyproject.toml": '[tool.uv.workspace]\nmembers = ["inner"]\n',
        "packages/alpha/inner/pyproject.toml": "",
      });

      const manifests = buildPythonManifests(project.root);

      expect(manifests.map((m) => m.dir)).toEqual([
        "packages/alpha/inner",
        "packages/alpha",
        ".",
      ]);
      expect(manifests.find((m) => m.dir === ".")?.members).toEqual([]);
      expect(manifests.find((m) => m.dir === "packages/alpha")?.members).toEqual([
        "packages/alpha/inner",
      ]);
    });

    it("reads a `#` inside a member string as a literal path character", () => {
      // Not a defect and must not be treated as one: uv reads this as a path
      // that happens to contain `#`, matches nothing, and the manifest declares
      // no members. A `#` in a string does not open a comment.
      project = createTempProject({
        "pyproject.toml": '[tool.uv.workspace]\nmembers = ["packages/#alpha"]\n',
        "packages/alpha/pyproject.toml": "",
      });

      const root = buildPythonManifests(project.root).find((m) => m.dir === ".");

      expect(root?.members).toEqual([]);
    });

    it("reads a member string carrying the other quote character", () => {
      // An extraction that stopped at whichever quote came first yielded the
      // member `it` — a directory the manifest never names. Inside a basic
      // string an apostrophe is just a character.
      project = createTempProject({
        "pyproject.toml": '[tool.uv.workspace]\nmembers = ["it\'s/*"]\n',
        "it/pyproject.toml": "",
        "it's/inner/pyproject.toml": "",
      });

      const root = buildPythonManifests(project.root).find((m) => m.dir === ".");

      expect(root?.members).toEqual(["it's/inner"]);
    });

    it("ignores a prose header that a real table header appears to close", () => {
      // The `[tool.other]` line is prose inside the same block, not a table, so
      // a reader that ends the section there never meets the closing delimiter
      // and cannot tell this from a declaration. The whole block is one string
      // value, and the document declares no workspace at all.
      project = createTempProject({
        "pyproject.toml":
          'description = """\n[tool.uv.workspace]\nmembers = ["packages/*"]\n[tool.other]\n"""\n',
        "packages/alpha/pyproject.toml": "",
      });

      const root = buildPythonManifests(project.root).find((m) => m.dir === ".");

      expect(root?.members).toEqual([]);
    });

    it("reads a members list beside a multi-line string in the same table", () => {
      // A multi-line string in the workspace table must not cost the table its
      // real declaration. The prose carries its own `members` line ahead of the
      // real one, so reading the section as text finds the wrong array first.
      project = createTempProject({
        "pyproject.toml":
          '[tool.uv.workspace]\nnotes = """\nmembers = ["packages/legacy"]\n"""\nmembers = ["packages/alpha"]\n',
        "packages/alpha/pyproject.toml": "",
        "packages/legacy/pyproject.toml": "",
      });

      const root = buildPythonManifests(project.root).find((m) => m.dir === ".");

      expect(root?.members).toEqual(["packages/alpha"]);
    });

    it("ignores a workspace header written inside a multi-line string", () => {
      // `tomllib` and uv both report no such table for prose in a description
      // block. Matching the header as text cannot tell the two apart and would
      // invent members for a manifest that declares none.
      project = createTempProject({
        "pyproject.toml":
          'description = """\n[tool.uv.workspace]\nmembers = ["packages/*"]\n"""\n',
        "packages/alpha/pyproject.toml": "",
      });

      const root = buildPythonManifests(project.root).find((m) => m.dir === ".");

      expect(root?.members).toEqual([]);
    });

    it("reads members only from the tool.uv.workspace table", () => {
      // A `members` key under some other tool's table is a different key, not
      // uv's — `[tool.other]` is where this one lives.
      project = createTempProject({
        "pyproject.toml": '[tool.other]\nmembers = ["packages/*"]\n',
        "packages/alpha/pyproject.toml": "",
      });

      const root = buildPythonManifests(project.root).find((m) => m.dir === ".");

      expect(root?.members).toEqual([]);
    });

    it("declares no members for a [tool.uv] table with no workspace", () => {
      // The ordinary single-package uv manifest: `[tool.uv]` present, no
      // workspace under it. The lookup walks two keys successfully and finds
      // nothing at the third, so the value it ends on has to be checked before
      // it is read as a table — otherwise the commonest uv manifest of all
      // takes the whole graph build down with it.
      project = createTempProject({
        "pyproject.toml": '[tool.uv]\ndev-dependencies = ["pytest"]\n',
        "packages/alpha/pyproject.toml": "",
      });

      const root = buildPythonManifests(project.root).find((m) => m.dir === ".");

      expect(root?.members).toEqual([]);
    });

    it("skips manifests under site-packages", () => {
      // Every installed distribution ships a pyproject.toml, and each would
      // register an import root over vendored code that shadows the project's
      // own modules. The virtualenv here is named so that
      // DEFAULT_IGNORE_PATTERNS (.venv/venv/env) does not cover it.
      project = createTempProject({
        "pyproject.toml": "",
        ".venv312/lib/python3.12/site-packages/requests/pyproject.toml": "",
      });

      expect(buildPythonManifests(project.root).map((m) => m.dir)).toEqual(["."]);
    });

    it("skips manifests under dist-packages", () => {
      // Debian and Ubuntu's system Python installs distributions into
      // dist-packages rather than site-packages; both shadow project modules
      // the same way.
      project = createTempProject({
        "pyproject.toml": "",
        "vendored/lib/python3.12/dist-packages/requests/pyproject.toml": "",
      });

      expect(buildPythonManifests(project.root).map((m) => m.dir)).toEqual(["."]);
    });

    it("skips manifests under ignored directories", () => {
      project = createTempProject({
        "pyproject.toml": "",
        "node_modules/some-pkg/pyproject.toml": "",
      });

      expect(buildPythonManifests(project.root).map((m) => m.dir)).toEqual(["."]);
    });

    it("returns an empty list for a project with no manifest", () => {
      // Keeps the resolver's pre-#107 behavior for unpackaged script repos:
      // no manifests means no roots and no extra resolution step at all.
      project = createTempProject({ "app/main.py": "" });

      expect(buildPythonManifests(project.root)).toEqual([]);
    });
  });

  describe("pythonRootsForFile", () => {
    const manifests = (entries: Array<[string, string[]]>): PythonManifest[] =>
      entries.map(([dir, members]) => ({
        dir,
        roots: [dir, dir === "." ? "src" : `${dir}/src`],
        members,
      }));

    it("orders containing roots first, deepest first", () => {
      // A package's own root must outrank the project root, or a name present
      // in both resolves to the wrong one.
      const roots = pythonRootsForFile(
        manifests([[".", ["packages/pkg-a"]], ["packages/pkg-a", []]]),
        "packages/pkg-a/src/pkg_a",
      );

      expect(roots.slice(0, 2)).toEqual(["packages/pkg-a/src", "packages/pkg-a"]);
    });

    it("puts a containing root ahead of one that sorts earlier alphabetically", () => {
      // Containment must beat lexicographic order outright, not merely agree
      // with it. pkg-z's own roots come first even though pkg-a sorts before
      // them, which is the whole of the fix for the cross-service mixup.
      const roots = pythonRootsForFile(
        manifests([
          [".", ["packages/pkg-a", "packages/pkg-z"]],
          ["packages/pkg-a", []],
          ["packages/pkg-z", []],
        ]),
        "packages/pkg-z/src/pkg_z",
      );

      expect(roots.slice(0, 2)).toEqual(["packages/pkg-z/src", "packages/pkg-z"]);
      expect(roots.indexOf("packages/pkg-z")).toBeLessThan(roots.indexOf("packages/pkg-a"));
    });

    it("excludes a manifest that is neither an ancestor nor a declared member", () => {
      // Only the root manifest's roots survive, and `src` precedes `.`
      // because the file sits inside it — deepest containing root first.
      const roots = pythonRootsForFile(
        manifests([[".", []], ["examples/demo", []]]),
        "src/mainpkg",
      );

      expect(roots).toEqual(["src", "."]);
    });

    it("includes a sibling package declared as a workspace member", () => {
      const roots = pythonRootsForFile(
        manifests([
          [".", ["packages/pkg-a", "packages/pkg-b"]],
          ["packages/pkg-a", []],
          ["packages/pkg-b", []],
        ]),
        "packages/pkg-a/src/pkg_a",
      );

      expect(roots).toContain("packages/pkg-b/src");
    });

    it("orders non-containing roots lexicographically for cross-machine determinism", () => {
      // Nothing about a cross-package import says which package was meant, so
      // the tie must break the same way everywhere rather than by walk order.
      const roots = pythonRootsForFile(
        manifests([
          [".", ["packages/pkg-b", "packages/pkg-c"]],
          ["packages/pkg-b", []],
          ["packages/pkg-c", []],
        ]),
        "app",
      );

      expect(roots.filter((r) => r.startsWith("packages/"))).toEqual([
        "packages/pkg-b",
        "packages/pkg-b/src",
        "packages/pkg-c",
        "packages/pkg-c/src",
      ]);
    });

    it("returns nothing when no manifest applies", () => {
      expect(pythonRootsForFile(manifests([["examples/demo", []]]), "src/app")).toEqual([]);
    });
  });

  describe("Rust resolution", () => {
    it("resolves mod declarations to .rs files", () => {
      project = createTempProject({
        "src/main.rs": "",
        "src/config.rs": "",
      });

      const result = resolveImport(
        "config",
        path.join(project.root, "src/main.rs"),
        project.root,
        project.fileSet,
        "rust",
      );

      expect(result).toBe("src/config.rs");
    });

    it("resolves mod declarations to mod.rs", () => {
      project = createTempProject({
        "src/main.rs": "",
        "src/utils/mod.rs": "",
      });

      const result = resolveImport(
        "utils",
        path.join(project.root, "src/main.rs"),
        project.root,
        project.fileSet,
        "rust",
      );

      expect(result).toBe("src/utils/mod.rs");
    });

    it("returns null for std:: imports", () => {
      project = createTempProject({
        "src/main.rs": "",
      });

      const result = resolveImport(
        "std::collections::HashMap",
        path.join(project.root, "src/main.rs"),
        project.root,
        project.fileSet,
        "rust",
      );

      expect(result).toBeNull();
    });
  });

  describe("C/C++ resolution", () => {
    it("resolves relative header includes", () => {
      project = createTempProject({
        "src/main.c": "",
        "src/utils.h": "",
      });

      const result = resolveImport(
        "utils.h",
        path.join(project.root, "src/main.c"),
        project.root,
        project.fileSet,
        "c",
      );

      expect(result).toBe("src/utils.h");
    });

    it("resolves parent directory includes", () => {
      project = createTempProject({
        "src/sub/app.c": "",
        "src/common.h": "",
      });

      const result = resolveImport(
        "../common.h",
        path.join(project.root, "src/sub/app.c"),
        project.root,
        project.fileSet,
        "c",
      );

      expect(result).toBe("src/common.h");
    });
  });

  describe("Ruby resolution", () => {
    it("resolves relative requires", () => {
      project = createTempProject({
        "lib/app.rb": "",
        "lib/models/user.rb": "",
      });

      const result = resolveImport(
        "./models/user",
        path.join(project.root, "lib/app.rb"),
        project.root,
        project.fileSet,
        "ruby",
      );

      expect(result).toBe("lib/models/user.rb");
    });
  });

  describe("PHP resolution", () => {
    it("resolves PSR-4 namespace with lowercase first segment (Laravel convention)", () => {
      project = createTempProject({
        "app/Models/User.php": "",
        "app/Http/Controllers/UserController.php": "",
      });

      const result = resolveImport(
        "App\\Models\\User",
        path.join(project.root, "app/Http/Controllers/UserController.php"),
        project.root,
        project.fileSet,
        "php",
      );

      expect(result).toBe("app/Models/User.php");
    });

    it("resolves PSR-4 namespace with exact case match", () => {
      project = createTempProject({
        "App/Models/User.php": "",
      });

      const result = resolveImport(
        "App\\Models\\User",
        path.join(project.root, "index.php"),
        project.root,
        project.fileSet,
        "php",
      );

      expect(result).toBe("App/Models/User.php");
    });

    it("resolves relative require paths", () => {
      project = createTempProject({
        "config.php": "",
        "bootstrap/app.php": "",
      });

      const result = resolveImport(
        "../config.php",
        path.join(project.root, "bootstrap/app.php"),
        project.root,
        project.fileSet,
        "php",
      );

      expect(result).toBe("config.php");
    });

    it("returns null for unresolvable vendor namespaces", () => {
      project = createTempProject({
        "app/Http/Controllers/UserController.php": "",
      });

      const result = resolveImport(
        "Illuminate\\Http\\Request",
        path.join(project.root, "app/Http/Controllers/UserController.php"),
        project.root,
        project.fileSet,
        "php",
      );

      expect(result).toBeNull();
    });

    it("resolves namespace to src directory", () => {
      project = createTempProject({
        "src/Models/User.php": "",
        "index.php": "",
      });

      const result = resolveImport(
        "MyPackage\\Models\\User",
        path.join(project.root, "index.php"),
        project.root,
        project.fileSet,
        "php",
      );

      expect(result).toBe("src/Models/User.php");
    });
  });

  describe("Java resolution", () => {
    it("resolves fully qualified class imports", () => {
      project = createTempProject({
        "src/App.java": "",
        "com/example/models/User.java": "",
      });

      const result = resolveImport(
        "com.example.models.User",
        path.join(project.root, "src/App.java"),
        project.root,
        project.fileSet,
        "java",
      );

      expect(result).toBe("com/example/models/User.java");
    });

    it("resolves imports under src/main/java (Maven convention)", () => {
      project = createTempProject({
        "src/main/java/com/example/App.java": "",
        "src/main/java/com/example/models/User.java": "",
      });

      const result = resolveImport(
        "com.example.models.User",
        path.join(project.root, "src/main/java/com/example/App.java"),
        project.root,
        project.fileSet,
        "java",
      );

      expect(result).toBe("src/main/java/com/example/models/User.java");
    });

    it("resolves imports under src/ directory", () => {
      project = createTempProject({
        "src/com/example/App.java": "",
        "src/com/example/models/User.java": "",
      });

      const result = resolveImport(
        "com.example.models.User",
        path.join(project.root, "src/com/example/App.java"),
        project.root,
        project.fileSet,
        "java",
      );

      expect(result).toBe("src/com/example/models/User.java");
    });

    it("resolves Kotlin imports under src/main/kotlin", () => {
      project = createTempProject({
        "src/main/kotlin/com/example/App.kt": "",
        "src/main/kotlin/com/example/models/User.kt": "",
      });

      const result = resolveImport(
        "com.example.models.User",
        path.join(project.root, "src/main/kotlin/com/example/App.kt"),
        project.root,
        project.fileSet,
        "kotlin",
      );

      expect(result).toBe("src/main/kotlin/com/example/models/User.kt");
    });

    it("returns null for java stdlib imports", () => {
      project = createTempProject({
        "src/App.java": "",
      });

      const result = resolveImport(
        "java.util.List",
        path.join(project.root, "src/App.java"),
        project.root,
        project.fileSet,
        "java",
      );

      expect(result).toBeNull();
    });
  });

  describe("Dart resolution", () => {
    it("resolves relative imports", () => {
      project = createTempProject({
        "lib/main.dart": "",
        "lib/utils/helpers.dart": "",
      });

      const result = resolveImport(
        "utils/helpers.dart",
        path.join(project.root, "lib/main.dart"),
        project.root,
        project.fileSet,
        "dart",
      );

      expect(result).toBe("lib/utils/helpers.dart");
    });

    it("returns null for package: imports when no package map is passed", () => {
      // Back-compat pin: every pre-#106 caller omits the map, and that
      // omission must reproduce the old behavior exactly — package: imports
      // stay unresolved rather than half-resolving through some default.
      project = createTempProject({
        "lib/main.dart": "",
      });

      const result = resolveImport(
        "package:flutter/material.dart",
        path.join(project.root, "lib/main.dart"),
        project.root,
        project.fileSet,
        "dart",
      );

      expect(result).toBeNull();
    });

    it("returns null for dart: imports", () => {
      project = createTempProject({
        "lib/main.dart": "",
      });

      const result = resolveImport(
        "dart:async",
        path.join(project.root, "lib/main.dart"),
        project.root,
        project.fileSet,
        "dart",
      );

      expect(result).toBeNull();
    });
  });

  // ── Dart package: resolution (#106) ────────────────────────────────────

  describe("Dart package: resolution (#106)", () => {
    // Flutter's own templates import intra-project files as
    // `package:<name>/...`, so before #106 a Flutter project's file graph
    // lost nearly every edge: both the external classifier and the dart
    // case rejected the scheme outright. These tests pin the mechanism the
    // fix rests on — the pubspec-derived name map plus pub's universal
    // `package:<name>/<rest>` → `<package_root>/lib/<rest>` mapping.

    const dartResolve = (
      spec: string,
      from: string,
      p: TempProject,
      map: Map<string, string> | undefined,
    ) =>
      resolveImport(
        spec,
        path.join(p.root, from),
        p.root,
        p.fileSet,
        "dart",
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        map,
      );

    it("resolves an own-package import through lib/", () => {
      // The lib/ segment is the load-bearing detail: pub maps the package
      // URI root to lib/, so resolving <rest> against the package root
      // alone (the shape issue #106 originally proposed) matches nothing.
      project = createTempProject({
        "pubspec.yaml": "name: my_app\nenvironment:\n  sdk: ^3.0.0\n",
        "lib/main.dart": "",
        "lib/src/service.dart": "",
      });
      const map = buildDartPackageMap(project.root);

      const result = dartResolve("package:my_app/src/service.dart", "lib/main.dart", project, map);

      expect(result).toBe("lib/src/service.dart");
    });

    it("returns null for an external package absent from the map", () => {
      // package:flutter and every pub.dev dependency have no in-repo
      // pubspec, so they are not in the map — the edge must be dropped,
      // not guessed into the project tree.
      project = createTempProject({
        "pubspec.yaml": "name: my_app\n",
        "lib/main.dart": "",
      });
      const map = buildDartPackageMap(project.root);

      const result = dartResolve("package:flutter/material.dart", "lib/main.dart", project, map);

      expect(result).toBeNull();
    });

    it("resolves cross-package imports in a monorepo of nested packages", () => {
      // Pub workspaces and melos monorepos import sibling packages with the
      // same package: form as external ones; only the nested-pubspec scan
      // tells the two apart. This is the edge class that makes
      // codebase_impact see cross-package callers.
      project = createTempProject({
        "packages/feature_a/pubspec.yaml": "name: feature_a\n",
        "packages/feature_a/lib/a.dart": "",
        "packages/feature_b/pubspec.yaml": "name: feature_b\n",
        "packages/feature_b/lib/src/b.dart": "",
      });
      const map = buildDartPackageMap(project.root);

      const result = dartResolve(
        "package:feature_b/src/b.dart",
        "packages/feature_a/lib/a.dart",
        project,
        map,
      );

      expect(result).toBe("packages/feature_b/lib/src/b.dart");
    });

    it("rejects dot segments instead of letting them escape lib/", () => {
      // path.posix.join normalizes `..`, so without the guard
      // `package:my_app/../secret.dart` would resolve to a real file OUTSIDE
      // lib/ and draw an edge the source never expresses.
      project = createTempProject({
        "pubspec.yaml": "name: my_app\n",
        "lib/main.dart": "",
        "secret.dart": "",
      });
      const map = buildDartPackageMap(project.root);

      expect(dartResolve("package:my_app/../secret.dart", "lib/main.dart", project, map)).toBeNull();
      expect(dartResolve("package:my_app/./main.dart", "lib/main.dart", project, map)).toBeNull();
    });

    it("rejects backslashes instead of resolving them as path or name", () => {
      // win32 path.resolve treats a backslash as a separator, so without
      // the explicit guard `..\\secret.dart` traverses out of lib/ there.
      // On POSIX that effect is unobservable: toForwardSlash inside
      // resolveRelativePath textually rewrites the backslash and the lookup
      // misses regardless, so this test pins the CONTRACT (backslash URIs
      // never resolve, decoy file present or not) rather than the guard
      // alone — it fails only if both defenses are removed, and the guard
      // is what defends the win32 path this suite cannot execute.
      project = createTempProject({
        "pubspec.yaml": "name: my_app\n",
        "lib/main.dart": "",
        "lib/..\\secret.dart": "",
      });
      const map = buildDartPackageMap(project.root);

      expect(dartResolve("package:my_app/..\\secret.dart", "lib/main.dart", project, map)).toBeNull();
    });

    it("returns null for a bare package:name with no path", () => {
      // `package:my_app` names a package, not a file; slicing it as if a
      // path followed would resolve lib/ itself or throw.
      project = createTempProject({
        "pubspec.yaml": "name: my_app\n",
        "lib/main.dart": "",
      });
      const map = buildDartPackageMap(project.root);

      expect(dartResolve("package:my_app", "lib/main.dart", project, map)).toBeNull();
    });

    it("returns null for package:name/ with an empty path instead of hitting a decoy", () => {
      // The extension fallbacks in resolveRelativePath would otherwise
      // resolve the bare lib target onto `lib.dart` or `lib/index.dart` —
      // an invented edge to a file the import never names.
      project = createTempProject({
        "pubspec.yaml": "name: my_app\n",
        "lib.dart": "",
        "lib/index.dart": "",
        "lib/main.dart": "",
      });
      const map = buildDartPackageMap(project.root);

      expect(dartResolve("package:my_app/", "lib/main.dart", project, map)).toBeNull();
    });

    it("still resolves relative imports when a map is present", () => {
      // The map must only add resolutions, never steal the relative path
      // branch that already worked.
      project = createTempProject({
        "pubspec.yaml": "name: my_app\n",
        "lib/main.dart": "",
        "lib/utils/helpers.dart": "",
      });
      const map = buildDartPackageMap(project.root);

      const result = dartResolve("utils/helpers.dart", "lib/main.dart", project, map);

      expect(result).toBe("lib/utils/helpers.dart");
    });

    it("keeps dart: imports external even with a map present", () => {
      // The SDK scheme must never resolve into the project, whatever the
      // map contains — the classifier narrowing must not have widened it.
      project = createTempProject({
        "pubspec.yaml": "name: my_app\n",
        "lib/main.dart": "",
        "lib/async.dart": "",
      });
      const map = buildDartPackageMap(project.root);

      expect(dartResolve("dart:async", "lib/main.dart", project, map)).toBeNull();
    });
  });

  describe("buildDartPackageMap", () => {
    it("maps the root pubspec to '.' and nested pubspecs to their directories", () => {
      project = createTempProject({
        "pubspec.yaml": "name: my_app\n",
        "packages/feature_a/pubspec.yaml": "name: feature_a\n",
      });

      const map = buildDartPackageMap(project.root);

      expect(map.get("my_app")).toBe(".");
      expect(map.get("feature_a")).toBe("packages/feature_a");
    });

    it("reads a manifest that starts with a UTF-8 BOM", () => {
      // `dart pub get` accepts a BOM'd pubspec, but the BOM sits before the
      // first line's `name:` and defeats a column-0 anchor — the package
      // would silently lose every package: edge, the exact #106 symptom.
      project = createTempProject({
        "pubspec.yaml": "\uFEFFname: my_app\n",
      });

      const map = buildDartPackageMap(project.root);

      expect(map.get("my_app")).toBe(".");
    });

    it("reads quoted names", () => {
      // YAML allows quoting scalars; both quote styles must yield the same
      // name as the bare spelling.
      project = createTempProject({
        "a/pubspec.yaml": 'name: "alpha_pkg"\n',
        "b/pubspec.yaml": "name: 'beta_pkg'\n",
      });

      const map = buildDartPackageMap(project.root);

      expect(map.get("alpha_pkg")).toBe("a");
      expect(map.get("beta_pkg")).toBe("b");
    });

    it("ignores indented name: keys inside dependency blocks", () => {
      // A hosted-dependency block legitimately contains a nested `name:`.
      // An unanchored match would map the DEPENDENCY's name to this
      // package's root and invent edges into the wrong directory.
      project = createTempProject({
        "pubspec.yaml":
          "name: my_app\ndependencies:\n  dep_pkg:\n    hosted:\n      name: hosted_dep\n      url: https://some-pub-server.example\n    version: ^1.0.0\n",
      });

      const map = buildDartPackageMap(project.root);

      expect(map.get("my_app")).toBe(".");
      expect(map.has("hosted_dep")).toBe(false);
    });

    it("contributes nothing from a manifest whose only name: is indented", () => {
      // The anchored regex must not fall back to an indented key when no
      // top-level one exists.
      project = createTempProject({
        "broken/pubspec.yaml": "description: no top-level name here\nmeta:\n  name: nested_only\n",
      });

      const map = buildDartPackageMap(project.root);

      expect(map.size).toBe(0);
    });

    it("skips pubspecs under .dart_tool even when a negation re-includes it", () => {
      // Flutter codegen writes .dart_tool/flutter_gen/pubspec.yaml; mapping
      // it would register a package root over generated state. The default
      // ignore list covers .dart_tool too, so the fixture re-includes it via
      // a .socraticodeignore negation — only the walk's unconditional skip
      // stands between the generated manifest and the map, which is exactly
      // the case the skip exists for.
      project = createTempProject({
        "pubspec.yaml": "name: my_app\n",
        ".socraticodeignore": "!.dart_tool/\n",
        ".dart_tool/flutter_gen/pubspec.yaml": "name: flutter_gen\n",
      });

      const map = buildDartPackageMap(project.root);

      expect(map.get("my_app")).toBe(".");
      expect(map.has("flutter_gen")).toBe(false);
    });

    it("is first-wins in sorted path order for duplicate names", () => {
      // Duplicate names across nested pubspecs are invalid in one pub
      // resolution context but can exist in a monorepo tree; without a
      // deterministic tie-break the graph's edges would differ between
      // rebuilds on different machines.
      project = createTempProject({
        "zeta/pubspec.yaml": "name: dup_pkg\n",
        "alpha/pubspec.yaml": "name: dup_pkg\n",
      });

      const map = buildDartPackageMap(project.root);

      expect(map.get("dup_pkg")).toBe("alpha");
    });
  });

  describe("Lua resolution", () => {
    it("resolves dot-separated module paths", () => {
      project = createTempProject({
        "main.lua": "",
        "utils/math.lua": "",
      });

      const result = resolveImport(
        "utils.math",
        path.join(project.root, "main.lua"),
        project.root,
        project.fileSet,
        "lua",
      );

      expect(result).toBe("utils/math.lua");
    });

    it("returns null for stdlib modules", () => {
      project = createTempProject({
        "main.lua": "",
      });

      const result = resolveImport(
        "string",
        path.join(project.root, "main.lua"),
        project.root,
        project.fileSet,
        "lua",
      );

      expect(result).toBeNull();
    });
  });

  describe("Shell resolution", () => {
    // resolveImport accepts two spellings: the ast-grep grammar name ("bash")
    // and the display name from getLanguageFromExtension ("shell"), which is
    // what buildCodeGraph passes. Both must resolve.
    it("resolves relative source paths for the ast-grep grammar spelling", () => {
      project = createTempProject({
        "run.sh": "",
        "config.sh": "",
      });

      const result = resolveImport(
        "./config.sh",
        path.join(project.root, "run.sh"),
        project.root,
        project.fileSet,
        "bash",
      );

      expect(result).toBe("config.sh");
    });

    it("resolves relative source paths for the shell display-name spelling", () => {
      project = createTempProject({
        "run.sh": "",
        "config.sh": "",
      });

      const result = resolveImport(
        "./config.sh",
        path.join(project.root, "run.sh"),
        project.root,
        project.fileSet,
        "shell",
      );

      expect(result).toBe("config.sh");
    });

    it("resolves parent-relative source paths", () => {
      project = createTempProject({
        "nested/deep/run.sh": "",
        "nested/helper.sh": "",
        "helper.sh": "",
      });

      // A leading run of `.`/`..` anchors, so more than one level has to resolve,
      // and an empty segment from `//` does not end the run.
      for (const [specifier, expected] of [
        ["../helper.sh", "nested/helper.sh"],
        ["../../helper.sh", "helper.sh"],
        [".//../helper.sh", "nested/helper.sh"],
      ]) {
        const result = resolveImport(
          specifier,
          path.join(project.root, "nested/deep/run.sh"),
          project.root,
          project.fileSet,
          "shell",
        );

        expect(result, specifier).toBe(expected);
      }
    });

    it("resolves a forward subdirectory path with a punctuated, mixed-case name", () => {
      project = createTempProject({
        "scripts/run.sh": "",
        "scripts/lib/My_helper-2.sh": "",
      });

      // A literal path is matched verbatim, so ordinary filename punctuation and
      // casing must survive the screens above the resolver.
      const result = resolveImport(
        "./lib/My_helper-2.sh",
        path.join(project.root, "scripts/run.sh"),
        project.root,
        project.fileSet,
        "shell",
      );

      expect(result).toBe("scripts/lib/My_helper-2.sh");
    });

    it("does not resolve a specifier without a ./ or ../ prefix", () => {
      project = createTempProject({
        "run.sh": "",
        "config.sh": "",
        "lib/util.sh": "",
      });

      // `source config.sh` searches PATH, then the run-time cwd when bash is not
      // in POSIX mode, and `source lib/util.sh` is cwd-relative. Either can land
      // on a same-named file, but never on one knowable at index time, so neither
      // implies an edge to the sibling here.
      for (const specifier of ["config.sh", "lib/util.sh"]) {
        const result = resolveImport(
          specifier,
          path.join(project.root, "run.sh"),
          project.root,
          project.fileSet,
          "shell",
        );

        expect(result, specifier).toBeNull();
      }
    });

    // Shell performs no extension search, so resolution is literal: the two
    // cases below are the shapes a candidate extension list would resolve, and
    // each must stay null. The siblings cover both `.bash` and `.zsh`, and an
    // extensionless specifier sits alongside, so these fail for any list
    // containing `.sh`, `.bash`, or `.zsh`.
    it("does not substitute a same-stem sibling for a missing source target", () => {
      project = createTempProject({
        "run.sh": "",
        "config.bash": "",
        "config.zsh": "",
      });

      const result = resolveImport(
        "./config.sh",
        path.join(project.root, "run.sh"),
        project.root,
        project.fileSet,
        "shell",
      );

      expect(result).toBeNull();
    });

    it("does not append an extension to an extensionless source specifier", () => {
      project = createTempProject({
        "run.sh": "",
        "config.sh": "",
      });

      const result = resolveImport(
        "./config",
        path.join(project.root, "run.sh"),
        project.root,
        project.fileSet,
        "shell",
      );

      expect(result).toBeNull();
    });

    it("does not resolve a `..` that cancels a named segment", () => {
      project = createTempProject({
        "scripts/run.sh": "",
        "scripts/lib.sh": "",
      });

      // Each of these normalises onto scripts/lib.sh, a file the script never
      // names. The first needs no shell syntax at all — the segment simply does
      // not exist, which the shell discovers by walking components.
      for (const specifier of ["./nosuchdir/../lib.sh", "./$DIR/../lib.sh", "./*/../lib.sh"]) {
        const result = resolveImport(
          specifier,
          path.join(project.root, "scripts/run.sh"),
          project.root,
          project.fileSet,
          "shell",
        );

        expect(result, specifier).toBeNull();
      }
    });

    it("does not normalise a directory-shaped specifier onto the same-named file", () => {
      project = createTempProject({
        "run.sh": "",
        "lib.sh": "",
      });

      for (const specifier of ["./lib.sh/", "./lib.sh/."]) {
        const result = resolveImport(
          specifier,
          path.join(project.root, "run.sh"),
          project.root,
          project.fileSet,
          "shell",
        );

        expect(result, specifier).toBeNull();
      }
    });

    // Asserted on the predicate rather than through resolveImport because the
    // backslash screen only alters resolution on win32: `path.resolve` treats `\`
    // as a separator there, while on POSIX it is an ordinary character and such a
    // specifier misses the file set either way.
    it("screens non-literal shapes and admits literal ones", () => {
      for (const specifier of ["./x\\..\\lib.sh", "./x/../lib.sh", "./lib.sh/", "./lib.sh/.", "./a b/lib.sh"]) {
        expect(hasLiteralShellPathShape(specifier), specifier).toBe(false);
      }

      for (const specifier of ["./lib.sh", "../lib.sh", "../../lib.sh", ".//../lib.sh", "./lib/My_helper-2.sh"]) {
        expect(hasLiteralShellPathShape(specifier), specifier).toBe(true);
      }
    });

    it("does not resolve a specifier containing whitespace", () => {
      project = createTempProject({
        "run.sh": "",
        "lib.sh": "",
        "dir name/lib.sh": "",
      });

      // The captured specifier is the whole argument list, so any whitespace-class
      // character disqualifies it: unquoted, the shell word-splits and loads
      // nothing; quoted, it is not a bare path.
      for (const specifier of ["./dir name/lib.sh", "./lib.sh --verbose"]) {
        const result = resolveImport(
          specifier,
          path.join(project.root, "run.sh"),
          project.root,
          project.fileSet,
          "shell",
        );

        expect(result, specifier).toBeNull();
      }
    });
  });

  describe("unknown language", () => {
    it("returns null", () => {
      project = createTempProject({
        "file.xyz": "",
      });

      const result = resolveImport(
        "./other",
        path.join(project.root, "file.xyz"),
        project.root,
        project.fileSet,
        "unknown",
      );

      expect(result).toBeNull();
    });
  });

  // ── Go resolution ──────────────────────────────────────────────────────

  describe("Go resolution", () => {
    it("returns null when no goModuleInfo is supplied (no go.mod path active)", () => {
      // Back-compat: when the resolver is called without Go module info
      // (e.g. for projects with no go.mod), every Go import resolves to
      // null. This is the path before issue #45's fix.
      project = createTempProject({
        "main.go": "",
        "internal/helper.go": "",
      });

      const result = resolveImport(
        "github.com/example/pkg",
        path.join(project.root, "main.go"),
        project.root,
        project.fileSet,
        "go",
      );

      expect(result).toBeNull();
    });

    it("resolves a subpackage import to the representative .go file (#45)", () => {
      project = createTempProject({
        "go.mod": "module example.com/myapp\n\ngo 1.21\n",
        "main.go": "",
        "internal/helper.go": "",
        "internal/util.go": "",
      });
      const goInfo = buildGoModuleInfo(project.fileSet, project.root);
      expect(goInfo).toHaveLength(1);

      const result = resolveImport(
        "example.com/myapp/internal",
        path.join(project.root, "main.go"),
        project.root,
        project.fileSet,
        "go",
        undefined,
        undefined,
        undefined,
        goInfo,
      );

      // helper.go is the lexically smallest non-test .go file in
      // internal/, so it's picked as the package's representative.
      expect(result).toBe("internal/helper.go");
    });

    it("resolves the root-package import to a project-root .go file", () => {
      project = createTempProject({
        "go.mod": "module example.com/myapp\n\ngo 1.21\n",
        "main.go": "",
        "doc.go": "",
        "internal/helper.go": "",
      });
      const goInfo = buildGoModuleInfo(project.fileSet, project.root);

      const result = resolveImport(
        "example.com/myapp",
        path.join(project.root, "internal/helper.go"),
        project.root,
        project.fileSet,
        "go",
        undefined,
        undefined,
        undefined,
        goInfo,
      );

      expect(result).toBe("doc.go");
    });

    it("returns null for external imports (not under module path)", () => {
      project = createTempProject({
        "go.mod": "module example.com/myapp\n\ngo 1.21\n",
        "main.go": "",
      });
      const goInfo = buildGoModuleInfo(project.fileSet, project.root);

      const result = resolveImport(
        "github.com/spf13/cobra",
        path.join(project.root, "main.go"),
        project.root,
        project.fileSet,
        "go",
        undefined,
        undefined,
        undefined,
        goInfo,
      );

      expect(result).toBeNull();
    });

    it("returns null when go.mod is missing", () => {
      project = createTempProject({
        "main.go": "",
      });
      const goInfo = buildGoModuleInfo(project.fileSet, project.root);

      // No go.mod on disk → buildGoModuleInfo returns [] → resolver
      // returns null for any Go import.
      expect(goInfo).toEqual([]);
    });

    it("returns null when go.mod has no module directive", () => {
      project = createTempProject({
        "go.mod": "go 1.21\n",
        "main.go": "",
      });
      const goInfo = buildGoModuleInfo(project.fileSet, project.root);

      // go.mod parses but has no module directive → skipped → [].
      expect(goInfo).toEqual([]);
    });

    it("excludes _test.go files from representative selection", () => {
      // service/foo.go and service/foo_test.go both exist in the same
      // directory. The map's representative should be foo.go (the
      // non-test file), not foo_test.go.
      project = createTempProject({
        "go.mod": "module example.com/myapp\n\ngo 1.21\n",
        "service/foo.go": "",
        "service/foo_test.go": "",
        "main.go": "",
      });
      const goInfo = buildGoModuleInfo(project.fileSet, project.root);

      const result = resolveImport(
        "example.com/myapp/service",
        path.join(project.root, "main.go"),
        project.root,
        project.fileSet,
        "go",
        undefined,
        undefined,
        undefined,
        goInfo,
      );

      expect(result).toBe("service/foo.go");
    });

    it("uses lexically smallest non-test file as the representative (determinism)", () => {
      project = createTempProject({
        "go.mod": "module example.com/myapp\n\ngo 1.21\n",
        "pkg/zeta.go": "",
        "pkg/alpha.go": "",
        "pkg/middle.go": "",
        "main.go": "",
      });
      const goInfo = buildGoModuleInfo(project.fileSet, project.root);

      const result = resolveImport(
        "example.com/myapp/pkg",
        path.join(project.root, "main.go"),
        project.root,
        project.fileSet,
        "go",
        undefined,
        undefined,
        undefined,
        goInfo,
      );

      expect(result).toBe("pkg/alpha.go");
    });

    it("resolves local imports when the module path starts with golang.org/", () => {
      // Real-world case: someone working ON one of the Go-team packages
      // like golang.org/x/sync. Their go.mod declares
      // `module golang.org/x/sync` and internal subpackages must resolve
      // locally, even though isExternalModule treats `golang.org/...`
      // imports as external for non-local-module projects.
      project = createTempProject({
        "go.mod": "module golang.org/x/custom\n\ngo 1.21\n",
        "main.go": "",
        "internal/foo.go": "",
      });
      const goInfo = buildGoModuleInfo(project.fileSet, project.root);

      const result = resolveImport(
        "golang.org/x/custom/internal",
        path.join(project.root, "main.go"),
        project.root,
        project.fileSet,
        "go",
        undefined,
        undefined,
        undefined,
        goInfo,
      );

      expect(result).toBe("internal/foo.go");
    });

    it("returns null for a similar-prefix import that is not a subpackage", () => {
      // `example.com/myapp-other/pkg` shares the prefix `example.com/myapp`
      // textually but is a separate module. Must not resolve to anything
      // inside the local project.
      project = createTempProject({
        "go.mod": "module example.com/myapp\n\ngo 1.21\n",
        "pkg/foo.go": "",
        "main.go": "",
      });
      const goInfo = buildGoModuleInfo(project.fileSet, project.root);

      const result = resolveImport(
        "example.com/myapp-other/pkg",
        path.join(project.root, "main.go"),
        project.root,
        project.fileSet,
        "go",
        undefined,
        undefined,
        undefined,
        goInfo,
      );

      expect(result).toBeNull();
    });
  });

  describe("buildGoModuleInfo", () => {
    it("parses a simple go.mod and returns module path + package map", () => {
      project = createTempProject({
        "go.mod": "module example.com/myapp\n\ngo 1.21\n",
        "main.go": "",
        "internal/helper.go": "",
        "internal/util.go": "",
      });

      const goInfo = buildGoModuleInfo(project.fileSet, project.root)[0];

      expect(goInfo).toBeDefined();
      expect(goInfo?.modulePath).toBe("example.com/myapp");
      // Root package
      expect(goInfo?.packageMap.get(".")).toBe("main.go");
      // Subpackage — first lex-sorted file wins
      expect(goInfo?.packageMap.get("internal")).toBe("internal/helper.go");
    });

    it("parses go.mod with leading whitespace and trailing content", () => {
      project = createTempProject({
        "go.mod": "  module github.com/user/repo\n\ngo 1.21\n\nrequire (\n\tgithub.com/x/y v1.0.0\n)\n",
        "main.go": "",
      });

      const goInfo = buildGoModuleInfo(project.fileSet, project.root)[0];

      expect(goInfo?.modulePath).toBe("github.com/user/repo");
    });

    it("returns an empty array when go.mod is missing", () => {
      project = createTempProject({
        "main.go": "",
      });

      const goInfo = buildGoModuleInfo(project.fileSet, project.root);

      expect(goInfo).toEqual([]);
    });

    it("returns an empty array when go.mod has no module directive", () => {
      project = createTempProject({
        "go.mod": "// no module line\ngo 1.21\n",
        "main.go": "",
      });

      const goInfo = buildGoModuleInfo(project.fileSet, project.root);

      expect(goInfo).toEqual([]);
    });

    it("excludes _test.go files from the package map representatives", () => {
      project = createTempProject({
        "go.mod": "module example.com/myapp\n",
        "service/foo_test.go": "",
        "service/foo.go": "",
      });

      const goInfo = buildGoModuleInfo(project.fileSet, project.root)[0];

      expect(goInfo?.packageMap.get("service")).toBe("service/foo.go");
    });

    it("does not include directories that contain only _test.go files", () => {
      project = createTempProject({
        "go.mod": "module example.com/myapp\n",
        "internal/only_test.go": "",
        "main.go": "",
      });

      const goInfo = buildGoModuleInfo(project.fileSet, project.root)[0];

      // Map has "." (for main.go) but no "internal" entry, because the
      // only file there is a test file.
      expect(goInfo?.packageMap.has(".")).toBe(true);
      expect(goInfo?.packageMap.has("internal")).toBe(false);
    });

    it("uses forward-slash keys for nested packages (cross-platform lookup)", () => {
      // Go imports always use forward slashes; the map keys must match
      // that form so resolution works on Windows, where path.dirname
      // would otherwise produce backslash-separated keys for nested
      // packages. The map value preserves the fileSet's native form
      // (test fixtures use forward slashes since createTempProject keys
      // its fileSet by the input relPath).
      project = createTempProject({
        "go.mod": "module example.com/myapp\n",
        "pkg/subpkg/file.go": "",
      });

      const goInfo = buildGoModuleInfo(project.fileSet, project.root)[0];

      expect(goInfo?.packageMap.has("pkg/subpkg")).toBe(true);
      expect(goInfo?.packageMap.get("pkg/subpkg")).toBe("pkg/subpkg/file.go");
    });

    it("resolves nested-package imports", () => {
      project = createTempProject({
        "go.mod": "module example.com/myapp\n",
        "pkg/subpkg/file.go": "",
        "main.go": "",
      });
      const goInfo = buildGoModuleInfo(project.fileSet, project.root);

      const result = resolveImport(
        "example.com/myapp/pkg/subpkg",
        path.join(project.root, "main.go"),
        project.root,
        project.fileSet,
        "go",
        undefined,
        undefined,
        undefined,
        goInfo,
      );

      expect(result).toBe("pkg/subpkg/file.go");
    });
  });

  // ── Nested go.mod (monorepo, issue #82) ───────────────────────────────
  // These cover the case the original #45 fix did not handle: go.mod sits
  // in a subdirectory of the indexed root. buildGoModuleInfo must discover
  // it by walking the tree (go.mod is never in the graphable file set) and
  // offset the package-directory lookup by the module's own subdirectory.
  describe("Go resolution with nested go.mod (monorepo, #82)", () => {
    it("discovers a nested go.mod and resolves imports against it", () => {
      // go.mod lives in `backend/`, not at the indexed root. Imports are
      // rooted at the module path and must be offset by the module's own
      // subdirectory before the file lookup.
      project = createTempProject({
        "backend/go.mod": "module github.com/example/myapp-backend\n\ngo 1.22\n",
        "backend/cmd/server/main.go": "",
        "backend/internal/middleware/auth.go": "",
        "backend/internal/service/user.go": "",
        "frontend/src/app.ts": "",
      });
      const goModules = buildGoModuleInfo(project.fileSet, project.root);
      expect(goModules).toHaveLength(1);
      expect(goModules[0].moduleDir).toBe("backend");
      expect(goModules[0].modulePath).toBe("github.com/example/myapp-backend");

      const result = resolveImport(
        "github.com/example/myapp-backend/internal/middleware",
        path.join(project.root, "backend/cmd/server/main.go"),
        project.root,
        project.fileSet,
        "go",
        undefined,
        undefined,
        undefined,
        goModules,
      );

      // Resolved back to a project-relative path (module dir + module-
      // relative file), not a module-relative one.
      expect(result).toBe("backend/internal/middleware/auth.go");
    });

    it("resolves the module's own root package when go.mod is nested", () => {
      project = createTempProject({
        "backend/go.mod": "module github.com/example/myapp-backend\n\ngo 1.22\n",
        "backend/main.go": "",
        "backend/internal/helper.go": "",
      });
      const goModules = buildGoModuleInfo(project.fileSet, project.root);

      const result = resolveImport(
        "github.com/example/myapp-backend",
        path.join(project.root, "backend/internal/helper.go"),
        project.root,
        project.fileSet,
        "go",
        undefined,
        undefined,
        undefined,
        goModules,
      );

      expect(result).toBe("backend/main.go");
    });

    it("attributes a nested module's files to it, not to a root module", () => {
      // Two modules: one at the root, one nested under `backend/`. Files
      // under `backend/` must resolve only via the nested module's path
      // and never collide with the root module's package map.
      project = createTempProject({
        "go.mod": "module github.com/example/root\n\ngo 1.22\n",
        "rootpkg/foo.go": "",
        "backend/go.mod": "module github.com/example/backend\n\ngo 1.22\n",
        "backend/svc/bar.go": "",
      });
      const goModules = buildGoModuleInfo(project.fileSet, project.root);
      expect(goModules).toHaveLength(2);

      const backend = goModules.find((m) => m.moduleDir === "backend");
      expect(backend).toBeDefined();
      // packageMap keys are MODULE-relative (the module dir is stripped).
      expect(backend?.packageMap.get("svc")).toBe("backend/svc/bar.go");
      // The root module must not have picked up the nested file.
      const root = goModules.find((m) => m.moduleDir === ".");
      expect(root).toBeDefined();
      expect(root?.packageMap.has("backend/svc")).toBe(false);

      const result = resolveImport(
        "github.com/example/backend/svc",
        path.join(project.root, "backend/svc/bar.go"),
        project.root,
        project.fileSet,
        "go",
        undefined,
        undefined,
        undefined,
        goModules,
      );
      expect(result).toBe("backend/svc/bar.go");
    });

    it("owns a nested module under a single-character dir `z/` (depth tie-break, #82 review)", () => {
      // The deepest-module tie-break must use directory DEPTH, not string
      // length: the root module is `"."` (string length 1) and a nested
      // module under `z/` is `"z"` (also string length 1). A string-length
      // comparison ties them and the winner becomes order-dependent, so
      // `z/svc/bar.go` can be mis-attributed to the root module. Directory
      // depth (`.` = 0, `z` = 1) attributes it correctly to the nested one.
      project = createTempProject({
        "go.mod": "module github.com/example/root\n",
        "main.go": "",
        "z/go.mod": "module github.com/example/z\n",
        "z/svc/bar.go": "",
      });
      const goModules = buildGoModuleInfo(project.fileSet, project.root);
      expect(goModules).toHaveLength(2);

      const zMod = goModules.find((m) => m.moduleDir === "z");
      expect(zMod).toBeDefined();
      expect(zMod?.packageMap.get("svc")).toBe("z/svc/bar.go");
      // The root module must not have absorbed the nested file under its
      // project-relative path.
      const rootMod = goModules.find((m) => m.moduleDir === ".");
      expect(rootMod?.packageMap.has("z/svc")).toBe(false);

      const result = resolveImport(
        "github.com/example/z/svc",
        path.join(project.root, "z/svc/bar.go"),
        project.root,
        project.fileSet,
        "go",
        undefined,
        undefined,
        undefined,
        goModules,
      );
      expect(result).toBe("z/svc/bar.go");
    });

    it("matches the longest module path that is a structural (not textual) prefix", () => {
      // Modules `github.com/x` (root) and `github.com/x/y` (nested). The
      // import `github.com/x/yother` shares the textual prefix
      // `github.com/x/y` but is NOT a subpackage of `github.com/x/y` — it
      // is the `yother` package of the root module `github.com/x`.
      // Structural matching (exact or `/`-delimited) routes it correctly;
      // a bare startsWith would misroute it to `github.com/x/y` and fail.
      project = createTempProject({
        "go.mod": "module github.com/x\n\ngo 1.22\n",
        "yother/z.go": "",
        "x/y/go.mod": "module github.com/x/y\n\ngo 1.22\n",
        "x/y/main.go": "",
      });
      const goModules = buildGoModuleInfo(project.fileSet, project.root);
      expect(goModules).toHaveLength(2);

      const result = resolveImport(
        "github.com/x/yother",
        path.join(project.root, "x/y/main.go"),
        project.root,
        project.fileSet,
        "go",
        undefined,
        undefined,
        undefined,
        goModules,
      );
      expect(result).toBe("yother/z.go");
    });

    it("discovers go.mod from disk even when it is absent from the file set", () => {
      // The regression that sank the first #82 attempt: buildGoModuleInfo
      // must NOT rely on go.mod being in the graphable file set, because
      // getGraphableFiles never admits go.mod (no AST grammar). Drop every
      // go.mod entry from the file set and confirm modules are still
      // discovered via the tree walk and imports still resolve.
      project = createTempProject({
        "backend/go.mod": "module github.com/example/myapp-backend\n\ngo 1.22\n",
        "backend/internal/middleware/auth.go": "",
        "backend/cmd/server/main.go": "",
      });
      const fileSetWithoutGoMod = new Set(
        [...project.fileSet].filter((f) => !f.endsWith("go.mod")),
      );

      const goModules = buildGoModuleInfo(fileSetWithoutGoMod, project.root);
      expect(goModules).toHaveLength(1);
      expect(goModules[0].moduleDir).toBe("backend");

      const result = resolveImport(
        "github.com/example/myapp-backend/internal/middleware",
        path.join(project.root, "backend/cmd/server/main.go"),
        project.root,
        fileSetWithoutGoMod,
        "go",
        undefined,
        undefined,
        undefined,
        goModules,
      );
      expect(result).toBe("backend/internal/middleware/auth.go");
    });

    it("returns null for Go imports when no go.mod exists anywhere", () => {
      project = createTempProject({
        "backend/main.go": "",
        "frontend/src/app.ts": "",
      });
      const goModules = buildGoModuleInfo(project.fileSet, project.root);
      expect(goModules).toEqual([]);

      const result = resolveImport(
        "github.com/example/anything/internal",
        path.join(project.root, "backend/main.go"),
        project.root,
        project.fileSet,
        "go",
        undefined,
        undefined,
        undefined,
        goModules,
      );
      expect(result).toBeNull();
    });
  });

  // ── C# resolution ─────────────────────────────────────────────────────

  describe("C# resolution", () => {
    it("returns null when no namespace map is supplied (back-compat)", () => {
      project = createTempProject({
        "Models/User.cs": "namespace MyApp.Models { public class User {} }",
        "Program.cs": "using MyApp.Models;",
      });

      const result = resolveImport(
        "MyApp.Models",
        path.join(project.root, "Program.cs"),
        project.root,
        project.fileSet,
        "csharp",
      );

      expect(result).toBeNull();
    });

    it("resolves a using directive to a file via the namespace map", () => {
      project = createTempProject({
        "Models/User.cs": "namespace MyApp.Models { public class User {} }",
        "Program.cs": "using MyApp.Models;\nnamespace MyApp { class Program {} }",
      });

      const csNamespaceMap = buildCsNamespaceMap(project.fileSet, project.root);
      const result = resolveImport(
        "MyApp.Models",
        path.join(project.root, "Program.cs"),
        project.root,
        project.fileSet,
        "csharp",
        undefined,
        undefined,
        csNamespaceMap,
      );

      expect(result).toBe("Models/User.cs");
    });

    it("returns the first candidate when a namespace spans multiple files", () => {
      project = createTempProject({
        "Services/UserService.cs":
          "namespace MyApp.Services { public class UserService {} }",
        "Services/OrderService.cs":
          "namespace MyApp.Services { public class OrderService {} }",
        "Program.cs": "using MyApp.Services;",
      });

      const csNamespaceMap = buildCsNamespaceMap(project.fileSet, project.root);
      const result = resolveImport(
        "MyApp.Services",
        path.join(project.root, "Program.cs"),
        project.root,
        project.fileSet,
        "csharp",
        undefined,
        undefined,
        csNamespaceMap,
      );

      // Multi-file namespaces resolve to the first registered file. Files are
      // visited in lexicographic order, so OrderService.cs precedes
      // UserService.cs. Multi-file fan-out is a known follow-up.
      expect(result).toBe("Services/OrderService.cs");
    });

    it("returns null for unknown namespaces even with a populated map", () => {
      project = createTempProject({
        "Models/User.cs": "namespace MyApp.Models { public class User {} }",
        "Program.cs": "using MyApp.Unknown;",
      });

      const csNamespaceMap = buildCsNamespaceMap(project.fileSet, project.root);
      const result = resolveImport(
        "MyApp.Unknown",
        path.join(project.root, "Program.cs"),
        project.root,
        project.fileSet,
        "csharp",
        undefined,
        undefined,
        csNamespaceMap,
      );

      expect(result).toBeNull();
    });

    it("filters System.* and Microsoft.* as external before consulting the map", () => {
      project = createTempProject({
        "Program.cs": "namespace System.Collections { class Stub {} }",
      });

      const csNamespaceMap = buildCsNamespaceMap(project.fileSet, project.root);
      const result = resolveImport(
        "System.Collections",
        path.join(project.root, "Program.cs"),
        project.root,
        project.fileSet,
        "csharp",
        undefined,
        undefined,
        csNamespaceMap,
      );

      expect(result).toBeNull();
    });
  });

  // ── buildCsNamespaceMap ───────────────────────────────────────────────

  describe("buildCsNamespaceMap", () => {
    it("indexes block-scoped namespace declarations in lexicographic order", () => {
      project = createTempProject({
        "Models/User.cs": "namespace MyApp.Models { public class User {} }",
        "Models/Order.cs": "namespace MyApp.Models { public class Order {} }",
      });

      const map = buildCsNamespaceMap(project.fileSet, project.root);
      // Files are sorted lexically, so Order.cs comes before User.cs.
      expect(map.get("MyApp.Models")).toEqual([
        "Models/Order.cs",
        "Models/User.cs",
      ]);
    });

    it("returns the same candidate order regardless of fileSet insertion order", () => {
      // Build two projects on the same physical layout but feed buildCsNamespaceMap
      // a Set populated in two different orders, mimicking how fs.readdir() can
      // hand back entries in arbitrary order across filesystems.
      project = createTempProject({
        "Services/UserService.cs":
          "namespace MyApp.Services { public class UserService {} }",
        "Services/OrderService.cs":
          "namespace MyApp.Services { public class OrderService {} }",
        "Services/AccountService.cs":
          "namespace MyApp.Services { public class AccountService {} }",
      });

      const forward = new Set([
        "Services/AccountService.cs",
        "Services/OrderService.cs",
        "Services/UserService.cs",
      ]);
      const reverse = new Set([
        "Services/UserService.cs",
        "Services/OrderService.cs",
        "Services/AccountService.cs",
      ]);

      const a = buildCsNamespaceMap(forward, project.root);
      const b = buildCsNamespaceMap(reverse, project.root);

      expect(a.get("MyApp.Services")).toEqual(b.get("MyApp.Services"));
      expect(a.get("MyApp.Services")?.[0]).toBe("Services/AccountService.cs");
    });

    it("indexes file-scoped namespace declarations (C# 10+)", () => {
      project = createTempProject({
        "Services/UserService.cs":
          "namespace MyApp.Services;\n\npublic class UserService {}",
      });

      const map = buildCsNamespaceMap(project.fileSet, project.root);
      expect(map.get("MyApp.Services")).toEqual(["Services/UserService.cs"]);
    });

    it("registers multiple namespaces declared in the same file", () => {
      project = createTempProject({
        "Mixed.cs":
          "namespace MyApp.A { class A {} }\nnamespace MyApp.B { class B {} }",
      });

      const map = buildCsNamespaceMap(project.fileSet, project.root);
      expect(map.get("MyApp.A")).toEqual(["Mixed.cs"]);
      expect(map.get("MyApp.B")).toEqual(["Mixed.cs"]);
    });

    it("does not match commented-out namespace lines", () => {
      project = createTempProject({
        "Program.cs":
          "// namespace MyApp.Hidden;\nnamespace MyApp.Real { class C {} }",
      });

      const map = buildCsNamespaceMap(project.fileSet, project.root);
      expect(map.has("MyApp.Hidden")).toBe(false);
      expect(map.get("MyApp.Real")).toEqual(["Program.cs"]);
    });

    it("ignores non-.cs files", () => {
      project = createTempProject({
        "notes.txt": "namespace Fake.Namespace;",
        "Program.cs": "namespace Real.Namespace { class C {} }",
      });

      const map = buildCsNamespaceMap(project.fileSet, project.root);
      expect(map.has("Fake.Namespace")).toBe(false);
      expect(map.get("Real.Namespace")).toEqual(["Program.cs"]);
    });

    it("returns an empty map for a project with no .cs files", () => {
      project = createTempProject({ "index.ts": "", "style.css": "" });
      const map = buildCsNamespaceMap(project.fileSet, project.root);
      expect(map.size).toBe(0);
    });

    it("does not duplicate the same file when re-indexed", () => {
      project = createTempProject({
        "Dup.cs": "namespace MyApp.X { class A {} }\nnamespace MyApp.X { class B {} }",
      });

      const map = buildCsNamespaceMap(project.fileSet, project.root);
      expect(map.get("MyApp.X")).toEqual(["Dup.cs"]);
    });

    it("captures nested namespace declarations indented inside an outer block", () => {
      project = createTempProject({
        "Nested.cs":
          "namespace Outer\n{\n    namespace Inner\n    {\n        class C {}\n    }\n}\n",
      });

      const map = buildCsNamespaceMap(project.fileSet, project.root);
      expect(map.get("Outer")).toEqual(["Nested.cs"]);
      expect(map.get("Inner")).toEqual(["Nested.cs"]);
    });

    it("rejects identifiers that do not start with a letter or underscore", () => {
      project = createTempProject({
        // Invalid C# (digit-leading), should not be captured.
        "Bad.cs": "namespace 1Foo { class C {} }",
        // Valid neighbour to make sure the scan still works.
        "Good.cs": "namespace Real.NS { class C {} }",
      });

      const map = buildCsNamespaceMap(project.fileSet, project.root);
      expect(map.has("1Foo")).toBe(false);
      expect(map.get("Real.NS")).toEqual(["Good.cs"]);
    });

    it("requires a `;` or `{` after the namespace name to avoid false positives", () => {
      project = createTempProject({
        // The token `namespace MyApp.Hint` appears here but is not a real
        // declaration (no terminator), so it must not be captured. The
        // real declaration on the next line should be captured.
        "Mixed.cs":
          "// see also: namespace MyApp.Hint in legacy code\nnamespace MyApp.Real { class C {} }",
      });

      const map = buildCsNamespaceMap(project.fileSet, project.root);
      expect(map.has("MyApp.Hint")).toBe(false);
      expect(map.get("MyApp.Real")).toEqual(["Mixed.cs"]);
    });
  });

  // ── Swift resolution ──────────────────────────────────────────────────

  describe("Swift resolution", () => {
    it("resolves relative imports", () => {
      project = createTempProject({
        "Sources/App/main.swift": "",
        "Sources/App/helper.swift": "",
      });

      const result = resolveImport(
        "./helper",
        path.join(project.root, "Sources/App/main.swift"),
        project.root,
        project.fileSet,
        "swift",
      );

      expect(result).toBe("Sources/App/helper.swift");
    });

    it("returns null for framework imports", () => {
      project = createTempProject({
        "main.swift": "",
      });

      const result = resolveImport(
        "Foundation",
        path.join(project.root, "main.swift"),
        project.root,
        project.fileSet,
        "swift",
      );

      expect(result).toBeNull();
    });
  });

  // ── Scala resolution ──────────────────────────────────────────────────

  describe("Scala resolution", () => {
    it("resolves package path to file in src/main/scala", () => {
      project = createTempProject({
        "src/main/scala/com/example/models/User.scala": "",
      });

      const result = resolveImport(
        "com.example.models.User",
        path.join(project.root, "src/main/scala/com/example/App.scala"),
        project.root,
        project.fileSet,
        "scala",
      );

      expect(result).toBe("src/main/scala/com/example/models/User.scala");
    });

    it("returns null for stdlib imports", () => {
      project = createTempProject({
        "Main.scala": "",
      });

      const result = resolveImport(
        "scala.collection.mutable.ListBuffer",
        path.join(project.root, "Main.scala"),
        project.root,
        project.fileSet,
        "scala",
      );

      expect(result).toBeNull();
    });
  });

  // ── Kotlin resolution ─────────────────────────────────────────────────

  describe("Kotlin resolution", () => {
    it("resolves package path to file in src/main/kotlin", () => {
      project = createTempProject({
        "src/main/kotlin/com/example/models/User.kt": "",
      });

      const result = resolveImport(
        "com.example.models.User",
        path.join(project.root, "src/main/kotlin/com/example/App.kt"),
        project.root,
        project.fileSet,
        "kotlin",
      );

      expect(result).toBe("src/main/kotlin/com/example/models/User.kt");
    });

    it("returns null for stdlib imports", () => {
      project = createTempProject({
        "Main.kt": "",
      });

      const result = resolveImport(
        "kotlinx.coroutines.launch",
        path.join(project.root, "Main.kt"),
        project.root,
        project.fileSet,
        "kotlin",
      );

      expect(result).toBeNull();
    });
  });

  // ── Path alias resolution ──────────────────────────────────────────────

  describe("Path alias resolution", () => {
    it("resolves $lib/ alias to src/lib/", () => {
      project = createTempProject({
        "src/lib/Component.svelte": "",
        "src/routes/page.svelte": "",
      });

      const aliases = {
        entries: new Map([["$lib/", ["src/lib/"]]]),
      };

      const result = resolveImport(
        "$lib/Component.svelte",
        path.join(project.root, "src/routes/page.svelte"),
        project.root,
        project.fileSet,
        "svelte",
        aliases,
      );

      expect(result).toBe("src/lib/Component.svelte");
    });

    it("resolves @/ alias to src/", () => {
      project = createTempProject({
        "src/utils/helper.ts": "",
        "src/index.ts": "",
      });

      const aliases = {
        entries: new Map([["@/", ["src/"]]]),
      };

      const result = resolveImport(
        "@/utils/helper",
        path.join(project.root, "src/index.ts"),
        project.root,
        project.fileSet,
        "typescript",
        aliases,
      );

      expect(result).toBe("src/utils/helper.ts");
    });

    it("resolves alias with extensionless import", () => {
      project = createTempProject({
        "src/lib/utils.ts": "",
        "src/app.ts": "",
      });

      const aliases = {
        entries: new Map([["$lib/", ["src/lib/"]]]),
      };

      const result = resolveImport(
        "$lib/utils",
        path.join(project.root, "src/app.ts"),
        project.root,
        project.fileSet,
        "typescript",
        aliases,
      );

      expect(result).toBe("src/lib/utils.ts");
    });

    it("returns null when alias does not match any file", () => {
      project = createTempProject({
        "src/index.ts": "",
      });

      const aliases = {
        entries: new Map([["$lib/", ["src/lib/"]]]),
      };

      const result = resolveImport(
        "$lib/NonExistent",
        path.join(project.root, "src/index.ts"),
        project.root,
        project.fileSet,
        "typescript",
        aliases,
      );

      expect(result).toBeNull();
    });

    it("falls back to null without aliases (backwards compatible)", () => {
      project = createTempProject({
        "src/index.ts": "",
      });

      const result = resolveImport(
        "$lib/Component",
        path.join(project.root, "src/index.ts"),
        project.root,
        project.fileSet,
        "typescript",
      );

      expect(result).toBeNull();
    });

    it("tries multiple alias targets in order (first match wins)", () => {
      project = createTempProject({
        "src/types.ts": "",
        "generated/types.ts": "",
        "src/index.ts": "",
      });

      const aliases = {
        entries: new Map([["@/", ["src", "generated"]]]),
      };

      const result = resolveImport(
        "@/types",
        path.join(project.root, "src/index.ts"),
        project.root,
        project.fileSet,
        "typescript",
        aliases,
      );

      // src/ is listed first, so it should win over generated/
      expect(result).toBe("src/types.ts");
    });

    it("falls back to second alias target when first has no match", () => {
      project = createTempProject({
        "generated/types.ts": "",
        "src/index.ts": "",
      });

      const aliases = {
        entries: new Map([["@/", ["src", "generated"]]]),
      };

      const result = resolveImport(
        "@/types",
        path.join(project.root, "src/index.ts"),
        project.root,
        project.fileSet,
        "typescript",
        aliases,
      );

      expect(result).toBe("generated/types.ts");
    });

    it("resolves CSS alias imports", () => {
      project = createTempProject({
        "src/lib/styles/variables.css": "",
        "src/app.css": "",
      });

      const aliases = {
        entries: new Map([["$lib/", ["src/lib/"]]]),
      };

      const result = resolveImport(
        "$lib/styles/variables.css",
        path.join(project.root, "src/app.css"),
        project.root,
        project.fileSet,
        "css",
        aliases,
      );

      expect(result).toBe("src/lib/styles/variables.css");
    });

    it("resolves extensionless CSS alias import via extension-try loop", () => {
      project = createTempProject({
        "src/lib/styles/variables.scss": "",
        "src/app.css": "",
      });

      const aliases = {
        entries: new Map([["$lib/", ["src/lib"]]]),
      };

      const result = resolveImport(
        "$lib/styles/variables",
        path.join(project.root, "src/app.css"),
        project.root,
        project.fileSet,
        "css",
        aliases,
      );

      expect(result).toBe("src/lib/styles/variables.scss");
    });

    it("resolves CSS relative imports", () => {
      project = createTempProject({
        "src/styles/variables.css": "",
        "src/styles/main.css": "",
      });

      const result = resolveImport(
        "./variables.css",
        path.join(project.root, "src/styles/main.css"),
        project.root,
        project.fileSet,
        "css",
      );

      expect(result).toBe("src/styles/variables.css");
    });

    it("resolves SCSS relative imports (language=scss)", () => {
      project = createTempProject({
        "src/styles/theme.scss": "",
        "src/styles/main.scss": "",
      });

      const result = resolveImport(
        "./theme.scss",
        path.join(project.root, "src/styles/main.scss"),
        project.root,
        project.fileSet,
        "scss",
      );

      expect(result).toBe("src/styles/theme.scss");
    });

    it("resolves SCSS partial with _ prefix", () => {
      project = createTempProject({
        "src/styles/_variables.scss": "",
        "src/styles/main.scss": "",
      });

      const result = resolveImport(
        "./variables",
        path.join(project.root, "src/styles/main.scss"),
        project.root,
        project.fileSet,
        "scss",
      );

      expect(result).toBe("src/styles/_variables.scss");
    });

    it("resolves SCSS partial via alias", () => {
      project = createTempProject({
        "src/lib/styles/_colors.scss": "",
        "src/app.scss": "",
      });

      const aliases = {
        entries: new Map([["$lib/", ["src/lib"]]]),
      };

      const result = resolveImport(
        "$lib/styles/colors",
        path.join(project.root, "src/app.scss"),
        project.root,
        project.fileSet,
        "scss",
        aliases,
      );

      expect(result).toBe("src/lib/styles/_colors.scss");
    });

    it("prefers non-partial over partial when both exist", () => {
      project = createTempProject({
        "src/styles/variables.scss": "",
        "src/styles/_variables.scss": "",
        "src/styles/main.scss": "",
      });

      const result = resolveImport(
        "./variables",
        path.join(project.root, "src/styles/main.scss"),
        project.root,
        project.fileSet,
        "scss",
      );

      // Direct match with extension should win before trying _ prefix
      expect(result).toBe("src/styles/variables.scss");
    });

    it("resolves SCSS partial when import has explicit .scss extension", () => {
      project = createTempProject({
        "src/styles/_variables.scss": "",
        "src/styles/main.scss": "",
      });

      const result = resolveImport(
        "./variables.scss",
        path.join(project.root, "src/styles/main.scss"),
        project.root,
        project.fileSet,
        "scss",
      );

      expect(result).toBe("src/styles/_variables.scss");
    });

    it("resolves Less relative imports (language=less)", () => {
      project = createTempProject({
        "src/styles/theme.less": "",
        "src/styles/main.less": "",
      });

      const result = resolveImport(
        "./theme.less",
        path.join(project.root, "src/styles/main.less"),
        project.root,
        project.fileSet,
        "less",
      );

      expect(result).toBe("src/styles/theme.less");
    });

    it("resolves Sass relative imports (language=sass)", () => {
      project = createTempProject({
        "src/styles/_base.sass": "",
        "src/styles/main.sass": "",
      });

      const result = resolveImport(
        "./base",
        path.join(project.root, "src/styles/main.sass"),
        project.root,
        project.fileSet,
        "sass",
      );

      expect(result).toBe("src/styles/_base.sass");
    });

    it("exact alias pattern only matches exact specifier", () => {
      project = createTempProject({
        "src/index.ts": "",
        "src/utils/helper.ts": "",
      });

      const aliases = {
        entries: new Map([["~", ["src"]]]),
      };

      // "~utils/helper" should NOT match exact alias "~"
      const noMatch = resolveImport(
        "~utils/helper",
        path.join(project.root, "src/index.ts"),
        project.root,
        project.fileSet,
        "typescript",
        aliases,
      );
      expect(noMatch).toBeNull();

      // Exact "~" should resolve to src directory index
      const exactMatch = resolveImport(
        "~",
        path.join(project.root, "src/index.ts"),
        project.root,
        project.fileSet,
        "typescript",
        aliases,
      );
      expect(exactMatch).toBe("src/index.ts");
    });

    it("returns null for bare CSS package specifier", () => {
      project = createTempProject({
        "src/styles/main.css": "",
      });

      const result = resolveImport(
        "normalize.css",
        path.join(project.root, "src/styles/main.css"),
        project.root,
        project.fileSet,
        "css",
      );

      expect(result).toBeNull();
    });
  });

  // ── buildJvmSuffixMap + multi-module resolution ──────────────────────────

  describe("JVM multi-module resolution (buildJvmSuffixMap)", () => {
    it("builds a suffix map keyed by class path after src/main/java", () => {
      project = createTempProject({
        [`module-a${path.sep}sub${path.sep}src${path.sep}main${path.sep}java${path.sep}com${path.sep}example${path.sep}Foo.java`]: "",
        [`module-b${path.sep}src${path.sep}main${path.sep}kotlin${path.sep}com${path.sep}example${path.sep}Bar.kt`]: "",
        [`module-c${path.sep}src${path.sep}main${path.sep}scala${path.sep}com${path.sep}example${path.sep}Baz.scala`]: "",
      });

      const map = buildJvmSuffixMap(project.fileSet);

      expect(map.has(`com${path.sep}example${path.sep}Foo.java`)).toBe(true);
      expect(map.has(`com${path.sep}example${path.sep}Bar.kt`)).toBe(true);
      expect(map.has(`com${path.sep}example${path.sep}Baz.scala`)).toBe(true);
    });

    it("returns empty map when project has no JVM files", () => {
      project = createTempProject({ "index.ts": "", "style.css": "" });
      const map = buildJvmSuffixMap(project.fileSet);
      expect(map.size).toBe(0);
    });

    it("ignores JVM files outside src/main/<lang> (e.g. test sources)", () => {
      project = createTempProject({
        // test source — should be ignored
        [`module-a${path.sep}src${path.sep}test${path.sep}java${path.sep}com${path.sep}example${path.sep}FooTest.java`]: "",
        // main source — should be registered
        [`module-a${path.sep}src${path.sep}main${path.sep}java${path.sep}com${path.sep}example${path.sep}Foo.java`]: "",
      });

      const map = buildJvmSuffixMap(project.fileSet);
      expect(map.has(`com${path.sep}example${path.sep}Foo.java`)).toBe(true);
      expect(map.has(`com${path.sep}example${path.sep}FooTest.java`)).toBe(false);
    });

    it("resolves a Java import in a multi-module Maven project via suffix map", () => {
      // Simulate: module-sso/module-sso-service/src/main/java/cn/sino/sso/UserService.java
      const userServicePath =
        `module-sso${path.sep}module-sso-service${path.sep}src${path.sep}main${path.sep}java${path.sep}cn${path.sep}sino${path.sep}sso${path.sep}UserService.java`;
      const callerPath =
        `module-opt${path.sep}src${path.sep}main${path.sep}java${path.sep}cn${path.sep}sino${path.sep}opt${path.sep}Service.java`;

      project = createTempProject({
        [userServicePath]: "",
        [callerPath]: "",
      });

      const jvmSuffixMap = buildJvmSuffixMap(project.fileSet);

      const result = resolveImport(
        "cn.sino.sso.UserService",
        path.join(project.root, callerPath),
        project.root,
        project.fileSet,
        "java",
        undefined,
        jvmSuffixMap,
      );

      expect(result).toBe(userServicePath);
    });

    it("resolves Kotlin import in multi-module project via suffix map", () => {
      const barPath =
        `module-core${path.sep}src${path.sep}main${path.sep}kotlin${path.sep}com${path.sep}example${path.sep}Bar.kt`;
      const callerPath =
        `module-api${path.sep}src${path.sep}main${path.sep}kotlin${path.sep}com${path.sep}example${path.sep}Caller.kt`;

      project = createTempProject({ [barPath]: "", [callerPath]: "" });

      const jvmSuffixMap = buildJvmSuffixMap(project.fileSet);
      const result = resolveImport(
        "com.example.Bar",
        path.join(project.root, callerPath),
        project.root,
        project.fileSet,
        "kotlin",
        undefined,
        jvmSuffixMap,
      );

      expect(result).toBe(barPath);
    });

    it("returns null when class exists nowhere in the project", () => {
      project = createTempProject({
        [`module-a${path.sep}src${path.sep}main${path.sep}java${path.sep}com${path.sep}example${path.sep}Foo.java`]: "",
      });

      const jvmSuffixMap = buildJvmSuffixMap(project.fileSet);
      const result = resolveImport(
        "com.example.NonExistent",
        path.join(project.root, `module-a${path.sep}src${path.sep}main${path.sep}java${path.sep}com${path.sep}example${path.sep}Foo.java`),
        project.root,
        project.fileSet,
        "java",
        undefined,
        jvmSuffixMap,
      );

      expect(result).toBeNull();
    });

    it("still returns null for java stdlib even with suffix map", () => {
      project = createTempProject({
        [`module-a${path.sep}src${path.sep}main${path.sep}java${path.sep}java${path.sep}util${path.sep}List.java`]: "",
      });

      const jvmSuffixMap = buildJvmSuffixMap(project.fileSet);
      const result = resolveImport(
        "java.util.List",
        path.join(project.root, `module-a${path.sep}src${path.sep}main${path.sep}java${path.sep}Caller.java`),
        project.root,
        project.fileSet,
        "java",
        undefined,
        jvmSuffixMap,
      );

      expect(result).toBeNull();
    });
  });
});
