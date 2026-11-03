// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildCodeGraph, ensureDynamicLanguages, gdscriptParserAvailable, getDynamicLanguageStatus } from "../../src/services/code-graph.js";
import { decodeGdscriptString, extractGdscriptImportsRegex, extractGodotResourceImports, extractImports, parseTscnSectionHeader } from "../../src/services/graph-imports.js";
import {
  buildClassNameIndex,
  buildGodotProjectIndexes,
  buildGodotUidIndexes,
  findGodotProjectRootForProject,
  findGodotRootForFile,
  resolveImport,
} from "../../src/services/graph-resolution.js";
import { chunkFileContent } from "../../src/services/indexer.js";
import { setGdscriptParserAvailable } from "../../src/services/parser-availability.js";

// Register before test declarations so skipIf observes the final availability state.
ensureDynamicLanguages();

// Track temp dirs for cleanup after all tests
const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  }
});

/** Create a temp Godot project with the given files. Returns { root, files } */
function makeGodotProject(files: Record<string, string>): {
  root: string;
  resolve: (rel: string) => string;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "socraticode-gd-"));
  tempDirs.push(root);
  for (const [relPath, content] of Object.entries(files)) {
    const absPath = path.join(root, relPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content);
  }
  return { root, resolve: (rel) => path.join(root, rel) };
}

describe("GDScript support", () => {
  // ── Import extraction ──────────────────────────────────────────────────

  describe("extractImports", () => {
    it("extracts preload() calls with res:// paths", () => {
      const source = `extends Node2D

func _ready():
    var fighter = preload("res://scripts/Fighter.gd")
    var config = preload("res://data/config.tres")
`;
      const imports = extractImports(source, "gdscript", ".gd");
      const specs = imports.map((i) => i.moduleSpecifier);

      expect(specs).toContain("res://scripts/Fighter.gd");
      expect(specs).toContain("res://data/config.tres");
    });

    it("extracts load() calls as dynamic imports", () => {
      const source = `extends Node2D

func _ready():
    var scene = load("res://scenes/Main.tscn")
`;
      const imports = extractImports(source, "gdscript", ".gd");
      const loadImports = imports.filter((i) => i.isDynamic);

      expect(loadImports.length).toBeGreaterThanOrEqual(1);
      expect(
        loadImports.some((i) => i.moduleSpecifier === "res://scenes/Main.tscn"),
      ).toBe(true);
      expect(loadImports.find((i) => i.moduleSpecifier === "res://scenes/Main.tscn")?.godotImportKind).toBe("load");
    });

    it("extracts extends ClassName as class: prefixed references", () => {
      const source = `extends BaseFighter

func _ready():
    pass
`;
      const imports = extractImports(source, "gdscript", ".gd");
      const extendsImports = imports.filter((i) =>
        i.moduleSpecifier.startsWith("class:"),
      );

      expect(extendsImports.length).toBe(1);
      expect(extendsImports[0].moduleSpecifier).toBe("class:BaseFighter");
    });

    it("extracts extends with res:// string path", () => {
      const source = `extends "res://scripts/BaseFighter.gd"

func _ready():
    pass
`;
      const imports = extractImports(source, "gdscript", ".gd");
      const specs = imports.map((i) => i.moduleSpecifier);

      expect(specs).toContain("res://scripts/BaseFighter.gd");
    });

    it("extracts extends from class_name + extends on one line", () => {
      const source = `class_name Foo extends Bar

func _ready():
    pass
`;
      const imports = extractImports(source, "gdscript", ".gd");
      const extendsImports = imports.filter((i) =>
        i.moduleSpecifier.startsWith("class:"),
      );

      expect(extendsImports.length).toBe(1);
      expect(extendsImports[0].moduleSpecifier).toBe("class:Bar");
    });

    it("extracts extends with dotted type path (takes first segment)", () => {
      const source = `extends Node2D.SubClass

func _ready():
    pass
`;
      const imports = extractImports(source, "gdscript", ".gd");
      const extendsImports = imports.filter((i) =>
        i.moduleSpecifier.startsWith("class:"),
      );

      expect(extendsImports.length).toBe(1);
      expect(extendsImports[0].moduleSpecifier).toBe("class:Node2D");
    });

    it("does not extract non-preload/load function calls", () => {
      const source = `extends Node2D

func _ready():
    var x = get_node("Sprite")
    var y = print("hello")
`;
      const imports = extractImports(source, "gdscript", ".gd");
      const specs = imports.map((i) => i.moduleSpecifier);

      // Only the extends Node2D (class:Node2D) should be present
      expect(specs.every((s) => s.startsWith("class:"))).toBe(true);
      expect(specs).not.toContain("Sprite");
      expect(specs).not.toContain("hello");
    });

    it("handles multiple preload and load calls in one file", () => {
      const source = `extends Node

func setup():
    var a = preload("res://scripts/A.gd")
    var b = preload("res://scripts/B.gd")
    var c = load("res://resources/C.tres")
    var d = load("res://scenes/D.tscn")
`;
      const imports = extractImports(source, "gdscript", ".gd");
      const specs = imports.map((i) => i.moduleSpecifier);

      expect(specs).toContain("res://scripts/A.gd");
      expect(specs).toContain("res://scripts/B.gd");
      expect(specs).toContain("res://resources/C.tres");
      expect(specs).toContain("res://scenes/D.tscn");
    });
  });

  // ── Regex fallback (platforms without tree-sitter-gdscript prebuild) ───

  describe("extractGdscriptImportsRegex", () => {
    it("extracts preload() calls with res:// paths", () => {
      const source = `extends Node2D

func _ready():
    var fighter = preload("res://scripts/Fighter.gd")
    var config = preload("res://data/config.tres")
`;
      const imports = extractGdscriptImportsRegex(source);
      const specs = imports.map((i) => i.moduleSpecifier);

      expect(specs).toContain("res://scripts/Fighter.gd");
      expect(specs).toContain("res://data/config.tres");
    });

    it("extracts load() calls as dynamic imports", () => {
      const source = `extends Node2D

func _ready():
    var scene = load("res://scenes/Main.tscn")
`;
      const imports = extractGdscriptImportsRegex(source);
      const loadImports = imports.filter((i) => i.isDynamic);

      expect(loadImports.length).toBeGreaterThanOrEqual(1);
      expect(
        loadImports.some((i) => i.moduleSpecifier === "res://scenes/Main.tscn"),
      ).toBe(true);
    });

    it("extracts extends ClassName as class: prefixed references", () => {
      const source = `extends BaseFighter

func _ready():
    pass
`;
      const imports = extractGdscriptImportsRegex(source);
      const extendsImports = imports.filter((i) =>
        i.moduleSpecifier.startsWith("class:"),
      );

      expect(extendsImports.length).toBe(1);
      expect(extendsImports[0].moduleSpecifier).toBe("class:BaseFighter");
    });

    it("extracts extends with res:// string path", () => {
      const source = `extends "res://scripts/BaseFighter.gd"

func _ready():
    pass
`;
      const imports = extractGdscriptImportsRegex(source);
      const specs = imports.map((i) => i.moduleSpecifier);

      expect(specs).toContain("res://scripts/BaseFighter.gd");
    });

    it("extracts extends from class_name + extends on one line", () => {
      const source = `class_name Foo extends Bar

func _ready():
    pass
`;
      const imports = extractGdscriptImportsRegex(source);
      const extendsImports = imports.filter((i) =>
        i.moduleSpecifier.startsWith("class:"),
      );

      expect(extendsImports.length).toBe(1);
      expect(extendsImports[0].moduleSpecifier).toBe("class:Bar");
    });

    it("extracts extends with dotted type path (takes first segment)", () => {
      const source = `extends Node2D.SubClass

func _ready():
    pass
`;
      const imports = extractGdscriptImportsRegex(source);
      const extendsImports = imports.filter((i) =>
        i.moduleSpecifier.startsWith("class:"),
      );

      expect(extendsImports.length).toBe(1);
      expect(extendsImports[0].moduleSpecifier).toBe("class:Node2D");
    });

    it("does not extract non-preload/load function calls", () => {
      const source = `extends Node2D

func _ready():
    var x = get_node("Sprite")
    var y = print("hello")
`;
      const imports = extractGdscriptImportsRegex(source);
      const specs = imports.map((i) => i.moduleSpecifier);

      expect(specs.every((s) => s.startsWith("class:"))).toBe(true);
      expect(specs).not.toContain("Sprite");
      expect(specs).not.toContain("hello");
    });

    it("handles multiple preload and load calls in one file", () => {
      const source = `extends Node

func setup():
    var a = preload("res://scripts/A.gd")
    var b = preload("res://scripts/B.gd")
    var c = load("res://resources/C.tres")
    var d = load("res://scenes/D.tscn")
`;
      const imports = extractGdscriptImportsRegex(source);
      const specs = imports.map((i) => i.moduleSpecifier);

      expect(specs).toContain("res://scripts/A.gd");
      expect(specs).toContain("res://scripts/B.gd");
      expect(specs).toContain("res://resources/C.tres");
      expect(specs).toContain("res://scenes/D.tscn");
    });
  });

  // ── Godot resource files (.tscn/.tres) ─────────────────────────────────

  describe("extractGodotResourceImports (via extractImports)", () => {
    it("extracts [ext_resource] paths from a .tscn scene file", () => {
      const source = [
        '[gd_scene load_steps=3 format=3]',
        '',
        '[ext_resource type="Script" path="res://scripts/Player.gd" id="1"]',
        '[ext_resource type="Texture2D" path="res://assets/sprite.png" id="2"]',
        '',
        '[node name="Player" type="CharacterBody2D"]',
        'script = ExtResource("1")',
      ].join('\n');

      const imports = extractImports(source, "godot-resource", ".tscn");
      const specs = imports.map((i) => i.moduleSpecifier);

      expect(specs).toContain("res://scripts/Player.gd");
      // .png is extracted as an import edge even though it won't resolve
      // to an indexed file — the resolver handles that.
      expect(specs).toContain("res://assets/sprite.png");
      expect(imports.every((i) => !i.isDynamic)).toBe(true);
    });

    it("extracts scene-to-scene composition via PackedScene ext_resource", () => {
      // Scene composition in Godot is represented by [ext_resource] entries
      // with type="PackedScene", not a separate [instance] section. The
      // `instance` keyword is an attribute of a [node] declaration, not a
      // section heading. See TSCN documentation.
      const source = [
        '[gd_scene load_steps=2 format=3]',
        '',
        '[ext_resource type="Script" path="res://scripts/Enemy.gd" id="1"]',
        '',
        '[ext_resource type="PackedScene" path="res://scenes/EnemyBody.tscn" id="2"]',
        '',
        '[node name="Wave" type="Node2D"]',
        '',
        '[node name="Enemy1" parent="." instance=ExtResource("2")]',
      ].join('\n');

      const imports = extractImports(source, "godot-resource", ".tscn");
      const specs = imports.map((i) => i.moduleSpecifier);

      expect(specs).toContain("res://scripts/Enemy.gd");
      expect(specs).toContain("res://scenes/EnemyBody.tscn");
    });

    it("extracts [ext_resource] paths from a .tres resource file", () => {
      const source = [
        '[gd_resource type="Resource" load_steps=2 format=3]',
        '',
        '[ext_resource type="Script" path="res://scripts/Inventory.gd" id="1"]',
        '',
        '[resource]',
        'script = ExtResource("1")',
      ].join('\n');

      const imports = extractImports(source, "godot-resource", ".tres");
      const specs = imports.map((i) => i.moduleSpecifier);

      expect(specs).toContain("res://scripts/Inventory.gd");
    });

    it("returns empty array for a .tscn file with no dependencies", () => {
      const source = [
        '[gd_scene load_steps=1 format=3]',
        '',
        '[node name="Empty" type="Node"]',
      ].join('\n');

      const imports = extractImports(source, "godot-resource", ".tscn");
      expect(imports).toHaveLength(0);
    });

    it("end-to-end: extracts [ext_resource] from a real .tscn file and resolves it", () => {
      const { root, resolve } = makeGodotProject({
        "project.godot": "[application]\n",
        "scripts/Player.gd":
          "class_name Player\nextends CharacterBody2D\n\nfunc _ready(): pass\n",
        "scenes/Player.tscn": [
          '[gd_scene load_steps=2 format=3]',
          '',
          '[ext_resource type="Script" path="res://scripts/Player.gd" id="1"]',
          '',
          '[node name="Player" type="CharacterBody2D"]',
          'script = ExtResource("1")',
        ].join('\n'),
      });

      const fileSet = new Set<string>([
        "project.godot",
        "scripts/Player.gd",
        "scenes/Player.tscn",
      ]);

      const sourceFile = resolve("scenes/Player.tscn");
      const sourceContent = fs.readFileSync(sourceFile, "utf-8");
      const imports = extractImports(sourceContent, "godot-resource", ".tscn");

      const extResource = imports.find((i) =>
        i.moduleSpecifier === "res://scripts/Player.gd",
      );
      expect(extResource).toBeDefined();

      const resolved = extResource
        ? resolveImport(
            extResource.moduleSpecifier,
            sourceFile,
            root,
            fileSet,
            "godot-resource",
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            root,
          )
        : null;
      expect(resolved).toBe("scripts/Player.gd");
    });
  });

  // ── Path resolution ────────────────────────────────────────────────────

  describe("resolveImport", () => {
    it("resolves res:// paths relative to Godot project root", () => {
      const { root, resolve } = makeGodotProject({
        "project.godot": "",
        "scripts/Fighter.gd": "extends Node\n",
        "scripts/CombatManager.gd": "extends Node\n",
      });
      const fileSet = new Set<string>([
        "project.godot",
        "scripts/Fighter.gd",
        "scripts/CombatManager.gd",
      ]);

      const sourceFile = resolve("scripts/CombatManager.gd");
      const resolved = resolveImport(
        "res://scripts/Fighter.gd",
        sourceFile,
        root,
        fileSet,
        "gdscript",
      );

      expect(resolved).toBe("scripts/Fighter.gd");
    });

    it("resolves res:// paths using pre-resolved godotProjectRoot", () => {
      const projectPath = "/tmp/godot-test-res-cached";
      const fileSet = new Set<string>([
        "project.godot",
        "scripts/Fighter.gd",
        "scripts/CombatManager.gd",
      ]);

      const sourceFile = `${projectPath}/scripts/CombatManager.gd`;
      const resolved = resolveImport(
        "res://scripts/Fighter.gd",
        sourceFile,
        projectPath,
        fileSet,
        "gdscript",
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        projectPath, // pre-resolved root = projectPath
      );

      expect(resolved).toBe("scripts/Fighter.gd");
    });

    it("does NOT resolve class_name references by filename convention alone", () => {
      // A file named BaseFighter.gd exists but does NOT declare class_name
      // BaseFighter (no files on disk declare it). Godot resolves bare class
      // references through the class_name registry, not the filename, so this
      // must return null — a file named after a class without declaring it
      // does not define that class.
      const projectPath = "/tmp/godot-test-class";
      const fileSet = new Set<string>([
        "project.godot",
        "scripts/BaseFighter.gd",
        "scripts/MyFighter.gd",
      ]);

      const sourceFile = `${projectPath}/scripts/MyFighter.gd`;
      const resolved = resolveImport(
        "class:BaseFighter",
        sourceFile,
        projectPath,
        fileSet,
        "gdscript",
      );

      expect(resolved).toBeNull();
    });

    it("resolves class_name references by scanning class_name declarations", () => {
      const { root, resolve } = makeGodotProject({
        "scripts/custom.gd":
          "class_name CustomClass\nextends Node\n\nfunc foo(): pass\n",
        "scripts/user.gd":
          "extends CustomClass\n\nfunc bar(): pass\n",
      });

      const fileSet = new Set<string>([
        "scripts/custom.gd",
        "scripts/user.gd",
      ]);

      const resolved = resolveImport(
        "class:CustomClass",
        resolve("scripts/user.gd"),
        root,
        fileSet,
        "gdscript",
      );

      expect(resolved).toBe("scripts/custom.gd");
    });

    it("returns null for Godot built-in types in extends", () => {
      const projectPath = "/tmp/godot-test-builtin";
      const fileSet = new Set<string>([
        "project.godot",
        "scripts/MyNode.gd",
      ]);

      const sourceFile = `${projectPath}/scripts/MyNode.gd`;
      const resolved = resolveImport(
        "class:Node2D",
        sourceFile,
        projectPath,
        fileSet,
        "gdscript",
      );

      expect(resolved).toBeNull();
    });

    it("returns null for non-res://, non-class: specifiers", () => {
      const projectPath = "/tmp/godot-test-external";
      const fileSet = new Set<string>(["project.godot"]);

      const resolved = resolveImport(
        "some_random_specifier",
        `${projectPath}/scripts/test.gd`,
        projectPath,
        fileSet,
        "gdscript",
      );

      expect(resolved).toBeNull();
    });

    it("uses classNameIndex for O(1) lookup when provided", () => {
      const projectPath = "/tmp/godot-test-index";
      const fileSet = new Set<string>([
        "project.godot",
        "scripts/BaseFighter.gd",
        "scripts/MyFighter.gd",
      ]);

      const classNameIndex = new Map<string, string>([
        ["BaseFighter", "scripts/BaseFighter.gd"],
      ]);

      const sourceFile = `${projectPath}/scripts/MyFighter.gd`;
      const resolved = resolveImport(
        "class:BaseFighter",
        sourceFile,
        projectPath,
        fileSet,
        "gdscript",
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        classNameIndex,
      );

      expect(resolved).toBe("scripts/BaseFighter.gd");
    });

    it("prefers classNameIndex over filename matching when they disagree", () => {
      // Fighter.gd exists but does NOT declare class_name Fighter.
      // custom.gd declares class_name Fighter. Godot class identity comes
      // from class_name, so the index (custom.gd) must win over the
      // filename convention (Fighter.gd).
      const projectPath = "/tmp/godot-test-index-priority";
      const fileSet = new Set<string>([
        "project.godot",
        "scripts/Fighter.gd",
        "scripts/custom.gd",
        "scripts/user.gd",
      ]);

      const classNameIndex = new Map<string, string>([
        ["Fighter", "scripts/custom.gd"],
      ]);

      const sourceFile = `${projectPath}/scripts/user.gd`;
      const resolved = resolveImport(
        "class:Fighter",
        sourceFile,
        projectPath,
        fileSet,
        "gdscript",
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        classNameIndex,
      );

      expect(resolved).toBe("scripts/custom.gd");
    });

    it("regression: Foo.gd declaring a different class does not shadow the real class_name Foo", () => {
      // Foo.gd exists and declares class_name Bar (NOT Foo).
      // real_foo.gd declares class_name Foo.
      // extends Foo must resolve to real_foo.gd (the file that actually
      // declares class_name Foo), NOT to Foo.gd (which is named Foo but
      // declares a different class). Filename must never substitute for a
      // class_name declaration.
      const { root, resolve } = makeGodotProject({
        "scripts/Foo.gd":
          "class_name Bar\nextends Node\n\nfunc bar(): pass\n",
        "scripts/real_foo.gd":
          "class_name Foo\nextends Node\n\nfunc foo(): pass\n",
        "scripts/user.gd":
          "extends Foo\n\nfunc use(): pass\n",
      });

      const fileSet = new Set<string>([
        "scripts/Foo.gd",
        "scripts/real_foo.gd",
        "scripts/user.gd",
      ]);

      const classNameIndex = buildClassNameIndex(root, fileSet);
      expect(classNameIndex.get("Foo")).toBe("scripts/real_foo.gd");
      expect(classNameIndex.get("Bar")).toBe("scripts/Foo.gd");

      const sourceFile = resolve("scripts/user.gd");
      const resolved = resolveImport(
        "class:Foo",
        sourceFile,
        root,
        fileSet,
        "gdscript",
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        classNameIndex,
        root,
      );

      expect(resolved).toBe("scripts/real_foo.gd");
    });

    it("regression: a file named after a Godot built-in type without class_name does not resolve", () => {
      // Node2D.gd exists but does NOT declare class_name Node2D.
      // No file in the project declares class_name Node2D (it's a Godot
      // built-in). extends Node2D must return null — the file named
      // Node2D.gd must not be mistaken for the built-in type.
      const { root, resolve } = makeGodotProject({
        "scripts/Node2D.gd":
          "extends Node\n\nfunc custom(): pass\n",
        "scripts/user.gd":
          "extends Node2D\n\nfunc use(): pass\n",
      });

      const fileSet = new Set<string>([
        "scripts/Node2D.gd",
        "scripts/user.gd",
      ]);

      const classNameIndex = buildClassNameIndex(root, fileSet);
      expect(classNameIndex.has("Node2D")).toBe(false);

      const sourceFile = resolve("scripts/user.gd");
      const resolved = resolveImport(
        "class:Node2D",
        sourceFile,
        root,
        fileSet,
        "gdscript",
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        classNameIndex,
        root,
      );

      expect(resolved).toBeNull();
    });

    it("returns null from index lookup when class is not in index", () => {
      const projectPath = "/tmp/godot-test-index-miss";
      const fileSet = new Set<string>([
        "project.godot",
        "scripts/MyFighter.gd",
      ]);

      const classNameIndex = new Map<string, string>();

      const sourceFile = `${projectPath}/scripts/MyFighter.gd`;
      const resolved = resolveImport(
        "class:NonExistent",
        sourceFile,
        projectPath,
        fileSet,
        "gdscript",
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        classNameIndex,
      );

      expect(resolved).toBeNull();
    });

    it("does not resolve res:// paths to files not in the project (no phantom nodes)", () => {
      const projectPath = "/tmp/godot-test-no-phantom";
      const fileSet = new Set<string>([
        "project.godot",
        "scripts/Fighter.gd",
        // Note: resources/Config.tres is NOT in fileSet — it's not indexed
      ]);

      const sourceFile = `${projectPath}/scripts/Fighter.gd`;
      const resolved = resolveImport(
        "res://resources/Config.tres",
        sourceFile,
        projectPath,
        fileSet,
        "gdscript",
      );

      // Config.tres is not in fileSet (not indexed), so this should not resolve
      expect(resolved).toBeNull();
    });

    it("does not resolve res:// paths with unindexed extensions to indexed files (no false edges)", () => {
      // Regression: res://assets/player.png must not resolve to assets/player.tscn
      // even though .tscn is an indexed extension. res:// paths are explicit;
      // extension fallback would create false edges to unrelated files.
      const projectPath = "/tmp/godot-test-no-false-edge";
      const fileSet = new Set<string>([
        "project.godot",
        "scripts/Player.gd",
        "scenes/Player.tscn",
        "assets/player.tscn",
      ]);

      const sourceFile = `${projectPath}/scenes/Player.tscn`;

      // .png is not indexed — must not fall back to .tscn
      const resolvedPng = resolveImport(
        "res://assets/player.png",
        sourceFile,
        projectPath,
        fileSet,
        "godot-resource",
      );
      expect(resolvedPng).toBeNull();

      // Same check from a .gd file
      const sourceGd = `${projectPath}/scripts/Player.gd`;
      const resolvedPngFromGd = resolveImport(
        "res://assets/player.png",
        sourceGd,
        projectPath,
        fileSet,
        "gdscript",
      );
      expect(resolvedPngFromGd).toBeNull();
    });

    it("resolves res:// paths to .tscn and .tres files in the project", () => {
      const { root, resolve } = makeGodotProject({
        "project.godot": "",
        "scripts/Player.gd": "extends Node\n",
        "scenes/Player.tscn": "[gd_scene]\n",
        "resources/Stats.tres": "[gd_resource]\n",
      });
      const fileSet = new Set<string>([
        "project.godot",
        "scripts/Player.gd",
        "scenes/Player.tscn",
        "resources/Stats.tres",
      ]);

      const sourceFile = resolve("scripts/Player.gd");

      // .tscn scene file
      const resolvedScene = resolveImport(
        "res://scenes/Player.tscn",
        sourceFile,
        root,
        fileSet,
        "gdscript",
      );
      expect(resolvedScene).toBe("scenes/Player.tscn");

      // .tres resource file
      const resolvedResource = resolveImport(
        "res://resources/Stats.tres",
        sourceFile,
        root,
        fileSet,
        "gdscript",
      );
      expect(resolvedResource).toBe("resources/Stats.tres");
    });

    it("resolves res:// paths from godot-resource files (.tscn/.tres)", () => {
      const { root, resolve } = makeGodotProject({
        "project.godot": "",
        "scripts/Player.gd": "extends Node\n",
        "scenes/Player.tscn": "[gd_scene]\n",
        "scenes/Enemy.tscn": "[gd_scene]\n",
        "resources/Stats.tres": "[gd_resource]\n",
      });
      const fileSet = new Set<string>([
        "project.godot",
        "scripts/Player.gd",
        "scenes/Player.tscn",
        "scenes/Enemy.tscn",
        "resources/Stats.tres",
      ]);

      // A .tscn file referencing a script via [ext_resource]
      const sourceFile = resolve("scenes/Player.tscn");
      const resolved = resolveImport(
        "res://scripts/Player.gd",
        sourceFile,
        root,
        fileSet,
        "godot-resource",
      );
      expect(resolved).toBe("scripts/Player.gd");

      // A .tscn file referencing another scene via PackedScene ext_resource
      const resolvedScene = resolveImport(
        "res://scenes/Enemy.tscn",
        sourceFile,
        root,
        fileSet,
        "godot-resource",
      );
      expect(resolvedScene).toBe("scenes/Enemy.tscn");

      // A .tres file referencing a script
      const sourceTres = resolve("resources/Stats.tres");
      const resolvedFromTres = resolveImport(
        "res://scripts/Player.gd",
        sourceTres,
        root,
        fileSet,
        "godot-resource",
      );
      expect(resolvedFromTres).toBe("scripts/Player.gd");
    });
  });

  // ── buildClassNameIndex ────────────────────────────────────────────────

  describe("buildClassNameIndex", () => {
    it("scans .gd files and maps class_name to paths", () => {
      const { root } = makeGodotProject({
        "scripts/fighter.gd":
          "class_name Fighter\nextends Node2D\n\nfunc punch(): pass\n",
        "scripts/enemy.gd":
          "class_name Enemy\nextends Fighter\n\nfunc ai(): pass\n",
        "scripts/no_class.gd":
          "extends Node\n\nfunc ready(): pass\n",
      });

      const fileSet = new Set<string>([
        "scripts/fighter.gd",
        "scripts/enemy.gd",
        "scripts/no_class.gd",
      ]);

      const index = buildClassNameIndex(root, fileSet);

      expect(index.size).toBe(2);
      expect(index.get("Fighter")).toBe("scripts/fighter.gd");
      expect(index.get("Enemy")).toBe("scripts/enemy.gd");
      expect(index.has("Node")).toBe(false);
    });

    it("returns empty map when no .gd files have class_name", () => {
      const { root } = makeGodotProject({
        "scripts/no_class.gd":
          "extends Node\n\nfunc ready(): pass\n",
      });

      const fileSet = new Set<string>(["scripts/no_class.gd"]);
      const index = buildClassNameIndex(root, fileSet);

      expect(index.size).toBe(0);
    });
  });

  // ── findGodotProjectRootForProject ─────────────────────────────────────

  describe("findGodotProjectRootForProject", () => {
    it("finds project.godot at the project root", () => {
      const { root } = makeGodotProject({
        "project.godot": "[application]\n",
        "scripts/test.gd": "extends Node\n",
      });

      const found = findGodotProjectRootForProject(root);
      expect(found).toBe(root);
    });

    it("finds project.godot in a parent directory", () => {
      const { root } = makeGodotProject({
        "project.godot": "[application]\n",
        "subdir/scripts/test.gd": "extends Node\n",
      });

      // Search from a subdirectory — should walk up and find project.godot at root
      const found = findGodotProjectRootForProject(
        path.join(root, "subdir", "scripts"),
      );
      expect(found).toBe(root);
    });

    it("returns null when project.godot is not found", () => {
      const { root } = makeGodotProject({
        "scripts/test.gd": "extends Node\n",
      });

      const found = findGodotProjectRootForProject(root);
      expect(found).toBeNull();
    });
  });

  // ── Integration: extraction + resolution together ─────────────────────

  describe("end-to-end import extraction and resolution", () => {
    it("extracts preload from a real .gd file and resolves it", () => {
      const { root, resolve } = makeGodotProject({
        "project.godot": "[application]\n",
        "scripts/Target.gd":
          "class_name Target\nextends Node\n\nfunc ready(): pass\n",
        "scripts/Source.gd":
          'extends Node\n\nfunc _ready():\n    var t = preload("res://scripts/Target.gd")\n',
      });

      const fileSet = new Set<string>([
        "project.godot",
        "scripts/Target.gd",
        "scripts/Source.gd",
      ]);

      const sourceFile = resolve("scripts/Source.gd");
      const sourceContent = fs.readFileSync(sourceFile, "utf-8");
      const imports = extractImports(sourceContent, "gdscript", ".gd");
      const preloadImport = imports.find((i) =>
        i.moduleSpecifier.startsWith("res://"),
      );
      expect(preloadImport).toBeDefined();

      const resolved = preloadImport
        ? resolveImport(
            preloadImport.moduleSpecifier,
            sourceFile,
            root,
            fileSet,
            "gdscript",
          )
        : null;
      expect(resolved).toBe("scripts/Target.gd");
    });

    it("extracts extends ClassName and resolves via classNameIndex", () => {
      const { root, resolve } = makeGodotProject({
        "project.godot": "[application]\n",
        "scripts/BaseFighter.gd":
          "class_name BaseFighter\nextends Node2D\n\nfunc punch(): pass\n",
        "scripts/MyFighter.gd":
          "extends BaseFighter\n\nfunc uppercut(): pass\n",
      });

      const fileSet = new Set<string>([
        "project.godot",
        "scripts/BaseFighter.gd",
        "scripts/MyFighter.gd",
      ]);

      // Build index the same way buildCodeGraph does
      const classNameIndex = buildClassNameIndex(root, fileSet);
      expect(classNameIndex.get("BaseFighter")).toBe("scripts/BaseFighter.gd");

      const sourceFile = resolve("scripts/MyFighter.gd");
      const sourceContent = fs.readFileSync(sourceFile, "utf-8");
      const imports = extractImports(sourceContent, "gdscript", ".gd");
      const extendsImport = imports.find((i) =>
        i.moduleSpecifier.startsWith("class:"),
      );
      expect(extendsImport).toBeDefined();

      const resolved = extendsImport
        ? resolveImport(
            extendsImport.moduleSpecifier,
            sourceFile,
            root,
            fileSet,
            "gdscript",
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            classNameIndex,
            root, // pre-resolved godot root
          )
        : null;
      expect(resolved).toBe("scripts/BaseFighter.gd");
    });

    it("extracts extends with res:// string path and resolves it", () => {
      const { root, resolve } = makeGodotProject({
        "project.godot": "[application]\n",
        "scripts/BaseRunner.gd":
          "extends Node\n\nfunc run(): pass\n",
        "scripts/MyRunner.gd":
          'extends "res://scripts/BaseRunner.gd"\n\nfunc sprint(): pass\n',
      });

      const fileSet = new Set<string>([
        "project.godot",
        "scripts/BaseRunner.gd",
        "scripts/MyRunner.gd",
      ]);

      const sourceFile = resolve("scripts/MyRunner.gd");
      const sourceContent = fs.readFileSync(sourceFile, "utf-8");
      const imports = extractImports(sourceContent, "gdscript", ".gd");

      // Should extract the res:// path from the extends string
      const resImport = imports.find((i) =>
        i.moduleSpecifier === "res://scripts/BaseRunner.gd",
      );
      expect(resImport).toBeDefined();

      const resolved = resImport
        ? resolveImport(
            resImport.moduleSpecifier,
            sourceFile,
            root,
            fileSet,
            "gdscript",
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            root,
          )
        : null;
      expect(resolved).toBe("scripts/BaseRunner.gd");
    });
  });

  // ── Native loader tests (Blocker 1) ────────────────────────────────────

  describe("native GDScript loader", () => {
    it.skipIf(!gdscriptParserAvailable)("gdscriptParserAvailable is true when native binary loads", () => {
      // In this environment (linux-x64 with prebuild), the parser should load
      expect(gdscriptParserAvailable).toBe(true);
    });

    it.skipIf(!gdscriptParserAvailable)("gdscript appears in loaded languages after successful registration", () => {
      const status = getDynamicLanguageStatus();
      expect(status.loaded).toContain("gdscript");
    });

    it.skipIf(!gdscriptParserAvailable)("gdscript does NOT appear in failed languages", () => {
      const status = getDynamicLanguageStatus();
      const failed = status.failed.find((f) => f.name === "gdscript");
      expect(failed).toBeUndefined();
    });

    it("other dynamic languages are not affected by GDScript registration", () => {
      // GDScript registration must not wipe out other dynamic languages.
      // registerDynamicLanguage replaces all languages on each call, so
      // GDScript must be in the same batch, not a separate one.
      const status = getDynamicLanguageStatus();
      const loaded = new Set(status.loaded);
      // At least a few core dynamic languages should still be loaded
      expect(loaded.has("python")).toBe(true);
      expect(loaded.has("go")).toBe(true);
      expect(loaded.has("java")).toBe(true);
    });

    it("uses AST boundaries when available and line chunks otherwise", () => {
      const lines = [
        "extends Node",
        "",
        "func first():",
        ...Array.from({ length: 57 }, (_, index) => `    var a${index} = ${index}`),
        "",
        "func second():",
        ...Array.from({ length: 57 }, (_, index) => `    var b${index} = ${index}`),
      ];
      // Keep this line/AST-boundary fixture below the independently enforced
      // character cap so that cap splitting cannot change these expectations.
      const maxChunkChars = 2000;
      expect(lines.slice(0, 100).join("\n").length).toBeLessThanOrEqual(maxChunkChars);
      const chunks = chunkFileContent("/tmp/main.gd", "main.gd", lines.join("\n"), { maxChunkChars });

      expect(chunks.every((chunk) => chunk.language === "gdscript")).toBe(true);
      expect(chunks.map((chunk) => chunk.startLine)).toEqual(
        gdscriptParserAvailable ? [1, 2, 61] : [1, 91],
      );
      const available = gdscriptParserAvailable;
      try {
        setGdscriptParserAvailable(false);
        const fallback = chunkFileContent("/tmp/main.gd", "main.gd", lines.join("\n"), { maxChunkChars });
        expect(fallback.map((chunk) => chunk.startLine)).toEqual([1, 91]);
      } finally {
        setGdscriptParserAvailable(available);
      }
    });

    it.skipIf(!gdscriptParserAvailable)("AST-based import extraction works when parser is available", () => {
      // This test verifies that the AST path is actually used (not just regex
      // fallback). The AST path correctly skips comments and strings.
      const source = [
        '# preload("res://comment.gd")',
        'extends "res://scripts/Real.gd"',
        '',
        'func _ready():',
        '    preload("res://scripts/Weapon.gd")',
      ].join('\n');

      const imports = extractImports(source, "gdscript", ".gd");
      const specs = imports.map((i) => i.moduleSpecifier);

      // The comment preload must NOT be extracted (AST-based, not regex)
      expect(specs).not.toContain("res://comment.gd");
      // The real preload and extends must be extracted
      expect(specs).toContain("res://scripts/Weapon.gd");
      expect(specs).toContain("res://scripts/Real.gd");
    });

    it("parser-independent fallback extracts preload/load and extends", () => {
      const source = [
        'extends "res://scripts/Base.gd"',
        '',
        'func _ready():',
        '    preload("res://scripts/Helper.gd")',
      ].join('\n');

      const imports = extractGdscriptImportsRegex(source);
      const specs = imports.map((i) => i.moduleSpecifier);
      expect(specs).toContain("res://scripts/Base.gd");
      expect(specs).toContain("res://scripts/Helper.gd");
    });

  });

  // ── Regex fallback tests (when native parser is unavailable) ───────────

  describe("GDScript regex fallback", () => {
    it("extractGdscriptImportsRegex extracts preload and extends", () => {
      const source = [
        'extends "res://scripts/Real.gd"',
        '',
        'func _ready():',
        '    preload("res://scripts/Weapon.gd")',
      ].join('\n');

      const imports = extractGdscriptImportsRegex(source);
      const specs = imports.map((i) => i.moduleSpecifier);

      expect(specs).toContain("res://scripts/Real.gd");
      expect(specs).toContain("res://scripts/Weapon.gd");
    });

    it("extractGdscriptImportsRegex extracts extends with class name", () => {
      const source = 'extends Node';
      const imports = extractGdscriptImportsRegex(source);
      const specs = imports.map((i) => i.moduleSpecifier);
      expect(specs).toContain("class:Node");
    });

    it("extractGdscriptImportsRegex skips comment-only preload lines", () => {
      const source = [
        '# preload("res://comment.gd")',
        '# extends "res://ignored.gd"',
        'extends "res://scripts/Real.gd"',
      ].join('\n');

      const imports = extractGdscriptImportsRegex(source);
      const specs = imports.map((i) => i.moduleSpecifier);

      // Comment lines should be skipped
      expect(specs).not.toContain("res://comment.gd");
      expect(specs).not.toContain("res://ignored.gd");
      // Real extends should be extracted
      expect(specs).toContain("res://scripts/Real.gd");
    });

    it("extractImports uses regex fallback when native parser is unavailable", () => {
      const source = [
        '# preload("res://comment.gd")',
        'extends "res://scripts/Base.gd"',
        'preload("res://scripts/Helper.gd")',
      ].join("\n");
      const originalAvailability = gdscriptParserAvailable;

      setGdscriptParserAvailable(false);
      try {
        const imports = extractImports(source, "gdscript", ".gd");
        expect(imports.map((item) => item.moduleSpecifier)).toEqual([
          "res://scripts/Base.gd",
          "res://scripts/Helper.gd",
        ]);
      } finally {
        setGdscriptParserAvailable(originalAvailability);
      }
    });
  });

  // ── Native loader preflight tests ──────────────────────────────────────
  //
  // These tests exercise the preflight child-process validation directly,
  // since ensureDynamicLanguages is a one-shot function that has already
  // run during module setup. The preflight script validates the native addon in
  // isolation: N-API load, export check, and ast-grep parse.

  describe("GDScript preflight validation", () => {
    const { execFileSync } = require("node:child_process");
    const preflightScript = path.join(
      __dirname,
      "..",
      "..",
      "src",
      "services",
      "gdscript-preflight.cjs",
    );

    /** Run the preflight with a given package.json path. Returns { exitCode, stdout, stderr }. */
    function runPreflight(pkgPath: string): { exitCode: number; stdout: string; stderr: string } {
      try {
        const stdout = execFileSync(process.execPath, [preflightScript, pkgPath], {
          timeout: 10_000,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        });
        return { exitCode: 0, stdout: stdout.trim(), stderr: "" };
      } catch (err: unknown) {
        const e = err as { stdout?: string; stderr?: string; status?: number };
        return {
          exitCode: e.status ?? 1,
          stdout: (e.stdout ?? "").trim(),
          stderr: (e.stderr ?? "").trim(),
        };
      }
    }

    /** Copy node-gyp-build into a fake package to exercise package-local resolution. */
    function installNodeGypBuild(fakeRoot: string): void {
      const sourceRoot = path.dirname(require.resolve("node-gyp-build/package.json"));
      const targetRoot = path.join(fakeRoot, "node_modules", "node-gyp-build");
      fs.mkdirSync(path.dirname(targetRoot), { recursive: true });
      fs.cpSync(sourceRoot, targetRoot, { recursive: true });
    }

    /** Find a loadable non-GDScript addon for the missing-export regression. */
    function findNativeAddon(root: string): string | null {
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        const entryPath = path.join(root, entry.name);
        if (entry.isDirectory()) {
          const nested = findNativeAddon(entryPath);
          if (nested) return nested;
        } else if (entry.name.endsWith(".node")) {
          return entryPath;
        }
      }
      return null;
    }

    /** Resolve ast-grep's installed platform package without assuming npm hoisting. */
    function findAstGrepNativeAddon(): string | null {
      const napiPackage = require.resolve("@ast-grep/napi/package.json");
      const napiRequire = createRequire(napiPackage);
      const manifest = JSON.parse(fs.readFileSync(napiPackage, "utf-8")) as {
        optionalDependencies?: Record<string, string>;
      };
      for (const packageName of Object.keys(manifest.optionalDependencies ?? {})) {
        try {
          const platformPackage = napiRequire.resolve(`${packageName}/package.json`);
          const addon = findNativeAddon(path.dirname(platformPackage));
          if (addon) return addon;
        } catch {
          // This optional platform package is not installed on the current host.
        }
      }
      return null;
    }

    it.skipIf(!gdscriptParserAvailable)("passes for the packaged prebuild in the current environment", () => {
      // This is the normal path: tree-sitter-gdscript is installed with
      // a prebuild matching the current platform.
      const pkgPath = require.resolve("tree-sitter-gdscript/package.json");
      const result = runPreflight(pkgPath);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/^PREFLIGHT: OK /);
    });

    it("fails when tree-sitter-gdscript is not installed (omitted dependency)", () => {
      // Pass a non-existent package.json path — the preflight should
      // fail gracefully, not crash.
      const result = runPreflight("/nonexistent/path/to/package.json");
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("PREFLIGHT:");
    });

    it("fails for a corrupt native addon (wrong content)", () => {
      // Create a fake tree-sitter-gdscript package with a corrupt .node file
      const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "socraticode-corrupt-"));
      tempDirs.push(fakeRoot);

      // Minimal package.json
      fs.writeFileSync(
        path.join(fakeRoot, "package.json"),
        JSON.stringify({
          name: "tree-sitter-gdscript",
          version: "0.0.0",
          dependencies: { "node-gyp-build": "^4.8.4" },
        }),
      );
      installNodeGypBuild(fakeRoot);

      // Create prebuilds dir with a corrupt .node file (just text)
      const prebuildDir = path.join(fakeRoot, "prebuilds", `${process.platform}-${process.arch}`);
      fs.mkdirSync(prebuildDir, { recursive: true });
      fs.writeFileSync(
        path.join(prebuildDir, "tree-sitter-gdscript.node"),
        "this is not a native addon",
      );

      const result = runPreflight(path.join(fakeRoot, "package.json"));
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("PREFLIGHT: require() of native addon failed:");
    });

    it("fails when a loadable native addon lacks the language export", () => {
      const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "socraticode-no-prebuild-"));
      tempDirs.push(fakeRoot);

      fs.writeFileSync(
        path.join(fakeRoot, "package.json"),
        JSON.stringify({
          name: "tree-sitter-gdscript",
          version: "0.0.0",
          dependencies: { "node-gyp-build": "^4.8.4" },
        }),
      );
      installNodeGypBuild(fakeRoot);

      const unrelatedAddon = findAstGrepNativeAddon();
      expect(unrelatedAddon).not.toBeNull();
      const prebuildDir = path.join(fakeRoot, "prebuilds", `${process.platform}-${process.arch}`);
      fs.mkdirSync(prebuildDir, { recursive: true });
      fs.copyFileSync(unrelatedAddon as string, path.join(prebuildDir, "unrelated.node"));

      const result = runPreflight(path.join(fakeRoot, "package.json"));
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("PREFLIGHT: native addon does not export a language object");
    });

    it.skipIf(!gdscriptParserAvailable)("accepts a source-built artifact under build/Release", () => {
      const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "socraticode-source-build-"));
      tempDirs.push(fakeRoot);
      fs.writeFileSync(
        path.join(fakeRoot, "package.json"),
        JSON.stringify({
          name: "tree-sitter-gdscript",
          version: "0.0.0",
          dependencies: { "node-gyp-build": "^4.8.4" },
        }),
      );
      installNodeGypBuild(fakeRoot);

      const realPackage = require.resolve("tree-sitter-gdscript/package.json");
      const gdscriptRequire = createRequire(realPackage);
      const nodeGypBuild = gdscriptRequire("node-gyp-build") as { path(root: string): string };
      const realAddon = nodeGypBuild.path(path.dirname(realPackage));
      const releaseDir = path.join(fakeRoot, "build", "Release");
      fs.mkdirSync(releaseDir, { recursive: true });
      fs.copyFileSync(realAddon, path.join(releaseDir, "tree-sitter-gdscript.node"));

      const result = runPreflight(path.join(fakeRoot, "package.json"));
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/^PREFLIGHT: OK /);
    });

    it("unrelated grammars remain loaded when GDScript preflight fails", () => {
      // This is verified by the existing ensureDynamicLanguages call:
      // even if GDScript had failed, the other @ast-grep/lang-* grammars
      // should still be in the loaded set. We verify this by checking
      // that the loaded set contains non-GDScript grammars.
      const status = getDynamicLanguageStatus();
      const loaded = new Set(status.loaded);
      // Core grammars that should always be available
      expect(loaded.has("python")).toBe(true);
      expect(loaded.has("go")).toBe(true);
      expect(loaded.has("java")).toBe(true);
      // If GDScript failed, it should be in failed, not loaded.
      // If it succeeded, it should be in loaded, not failed.
      // Either way, the other grammars must be present.
      const gdscriptLoaded = loaded.has("gdscript");
      const gdscriptFailed = status.failed.some((f) => f.name === "gdscript");
      expect(gdscriptLoaded !== gdscriptFailed).toBe(true); // XOR
    });

    it("status reports accurate loaded/failed partition", () => {
      // Every dynamic language should be in exactly one of loaded or failed,
      // not both, not neither (assuming ensureDynamicLanguages ran).
      const status = getDynamicLanguageStatus();
      const loadedSet = new Set(status.loaded);
      const failedSet = new Set(status.failed.map((f) => f.name));

      // No overlap
      for (const name of loadedSet) {
        expect(failedSet.has(name)).toBe(false);
      }

      // Core grammars should be loaded in this environment
      expect(loadedSet.has("python")).toBe(true);
      expect(loadedSet.has("rust")).toBe(true);
    });
  });

  // ── Per-file Godot project root tests (Blocker 2) ──────────────────────

  describe("per-file Godot project roots", () => {
    it("buildGodotProjectIndexes builds separate indexes per project.godot", () => {
      const { root } = makeGodotProject({
        "game-a/project.godot": "",
        "game-a/scripts/A.gd": "class_name Fighter\nextends Node\n",
        "game-b/project.godot": "",
        "game-b/scripts/A.gd": "class_name Fighter\nextends Node\n",
      });

      const fileSet = new Set<string>([
        "game-a/project.godot",
        "game-a/scripts/A.gd",
        "game-b/project.godot",
        "game-b/scripts/A.gd",
      ]);

      const indexes = buildGodotProjectIndexes(root, fileSet);
      expect(indexes.size).toBe(2); // Two separate Godot projects

      // Each project has its own class_name index
      for (const [, index] of indexes) {
        expect(index.has("Fighter")).toBe(true);
        expect(index.get("Fighter")).toMatch(/scripts\/A\.gd$/);
      }
    });

    it("findGodotRootForFile resolves to nearest project.godot ancestor", () => {
      const { root, resolve } = makeGodotProject({
        "game-a/project.godot": "",
        "game-a/scripts/deep/nested/A.gd": "extends Node\n",
        "game-b/project.godot": "",
        "game-b/scripts/B.gd": "extends Node\n",
      });

      const fileSet = new Set<string>([
        "game-a/project.godot",
        "game-a/scripts/deep/nested/A.gd",
        "game-b/project.godot",
        "game-b/scripts/B.gd",
      ]);

      const indexes = buildGodotProjectIndexes(root, fileSet);

      const fileA = resolve("game-a/scripts/deep/nested/A.gd");
      const rootA = findGodotRootForFile(fileA, indexes);
      expect(rootA).toBe(path.join(root, "game-a"));

      const fileB = resolve("game-b/scripts/B.gd");
      const rootB = findGodotRootForFile(fileB, indexes);
      expect(rootB).toBe(path.join(root, "game-b"));
    });

    it("class_name in one project does not resolve extends in another", () => {
      const { root, resolve } = makeGodotProject({
        "game-a/project.godot": "",
        "game-a/scripts/Fighter.gd": "class_name Fighter\nextends Node\n",
        "game-a/scripts/user.gd": "extends Fighter\n",
        "game-b/project.godot": "",
        "game-b/scripts/other.gd": "extends Fighter\n",
      });

      const fileSet = new Set<string>([
        "game-a/project.godot",
        "game-a/scripts/Fighter.gd",
        "game-a/scripts/user.gd",
        "game-b/project.godot",
        "game-b/scripts/other.gd",
      ]);

      const indexes = buildGodotProjectIndexes(root, fileSet);

      // game-a/scripts/user.gd should resolve "extends Fighter" via game-a's index
      const userFile = resolve("game-a/scripts/user.gd");
      const userRoot = findGodotRootForFile(userFile, indexes);
      const userIndex = userRoot ? indexes.get(userRoot) : undefined;
      expect(userIndex).toBeDefined();
      expect(userIndex?.get("Fighter")).toBe("game-a/scripts/Fighter.gd");

      // game-b/scripts/other.gd should NOT find Fighter in its index
      const otherFile = resolve("game-b/scripts/other.gd");
      const otherRoot = findGodotRootForFile(otherFile, indexes);
      const otherIndex = otherRoot ? indexes.get(otherRoot) : undefined;
      expect(otherIndex).toBeDefined();
      expect(otherIndex?.has("Fighter")).toBe(false);
    });

    it("res:// paths do not resolve when no project.godot exists", () => {
      // A repo with .gd files but no project.godot — res:// must not fall
      // back to the arbitrary SocratiCode indexing root.
      const { root, resolve } = makeGodotProject({
        "scripts/Player.gd": "extends Node\n",
        "scripts/Weapon.gd": "extends Node\n",
      });

      const fileSet = new Set<string>([
        "scripts/Player.gd",
        "scripts/Weapon.gd",
      ]);

      const sourceFile = resolve("scripts/Player.gd");
      const resolved = resolveImport(
        "res://scripts/Weapon.gd",
        sourceFile,
        root,
        fileSet,
        "gdscript",
      );

      // No project.godot → res:// must not resolve
      expect(resolved).toBeNull();
    });

    it("class_name references do not resolve without project.godot", () => {
      // Without a project.godot, there is no Godot project context.
      // class_name resolution must be skipped — the global classNameIndex
      // is not used as a fallback when per-project indexes are available
      // but the file has no project root.
      const { root, resolve } = makeGodotProject({
        "scripts/Fighter.gd": "class_name Fighter\nextends Node\n",
        "scripts/user.gd": "extends Fighter\n",
      });

      const fileSet = new Set<string>([
        "scripts/Fighter.gd",
        "scripts/user.gd",
      ]);

      // Build per-project indexes (will be empty — no project.godot)
      const indexes = buildGodotProjectIndexes(root, fileSet);
      expect(indexes.size).toBe(0);

      // The global index is built but must not be used as fallback
      const globalIndex = buildClassNameIndex(root, fileSet);
      expect(globalIndex.get("Fighter")).toBe("scripts/Fighter.gd");

      const sourceFile = resolve("scripts/user.gd");
      const godotRoot = findGodotRootForFile(sourceFile, indexes);
      expect(godotRoot).toBeNull();

      // resolveImport with explicit null godotProjectRoot must not resolve
      const resolved = resolveImport(
        "class:Fighter",
        sourceFile,
        root,
        fileSet,
        "gdscript",
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        null, // explicit null — no Godot project root
      );
      expect(resolved).toBeNull();
    });
  });

  // ── Relative .tscn path tests (Blocker 3) ──────────────────────────────

  describe("relative .tscn/.tres resource paths", () => {
    it("extracts relative paths from [ext_resource]", () => {
      const source = [
        '[gd_scene load_steps=2 format=3]',
        '',
        '[ext_resource type="Material" path="material.tres" id="1"]',
      ].join('\n');

      const imports = extractImports(source, "godot-resource", ".tscn");
      const specs = imports.map((i) => i.moduleSpecifier);

      expect(specs).toContain("material.tres");
    });

    it("resolves relative paths from the .tscn file's directory", () => {
      const { root, resolve } = makeGodotProject({
        "project.godot": "",
        "scenes/Player.tscn": '[gd_scene]\n[ext_resource path="material.tres"]\n',
        "scenes/material.tres": '[gd_resource]\n',
      });

      const fileSet = new Set<string>([
        "project.godot",
        "scenes/Player.tscn",
        "scenes/material.tres",
      ]);

      const sourceFile = resolve("scenes/Player.tscn");
      const resolved = resolveImport(
        "material.tres",
        sourceFile,
        root,
        fileSet,
        "godot-resource",
      );

      expect(resolved).toBe("scenes/material.tres");
    });

    it("resolves relative paths from a .tres file's directory", () => {
      const { root, resolve } = makeGodotProject({
        "project.godot": "",
        "resources/Stats.tres": '[gd_resource]\n[ext_resource path="script.gd"]\n',
        "resources/script.gd": "extends Node\n",
      });

      const fileSet = new Set<string>([
        "project.godot",
        "resources/Stats.tres",
        "resources/script.gd",
      ]);

      const sourceFile = resolve("resources/Stats.tres");
      const resolved = resolveImport(
        "script.gd",
        sourceFile,
        root,
        fileSet,
        "godot-resource",
      );

      expect(resolved).toBe("resources/script.gd");
    });

    it("does not extract [instance] as a section (it is a node attribute)", () => {
      // The [instance] section does not exist in the TSCN format.
      // `instance` is an attribute of a [node] declaration.
      // Scene composition is via [ext_resource type="PackedScene"].
      const source = [
        '[gd_scene load_steps=2 format=3]',
        '',
        '[ext_resource type="PackedScene" path="res://scenes/Enemy.tscn" id="1"]',
        '',
        '[node name="Enemy1" parent="." instance=ExtResource("1")]',
      ].join('\n');

      const imports = extractImports(source, "godot-resource", ".tscn");
      const specs = imports.map((i) => i.moduleSpecifier);

      // Only the ext_resource should be extracted, not any [instance] section
      expect(specs).toContain("res://scenes/Enemy.tscn");
      expect(specs.length).toBe(1);
    });
  });

  // ── buildCodeGraph integration tests ───────────────────────────────────

  describe("buildCodeGraph: Godot project integration", () => {
    it("nested Godot projects get separate class_name indexes", async () => {
      const { root } = makeGodotProject({
        "project.godot": "[application]\n",
        "outer.gd": "class_name Outer\nextends Node\n",
        "game/project.godot": "[application]\n",
        "game/scripts/Fighter.gd": "class_name Fighter\nextends Node\n",
        "game/scripts/user.gd": "extends Fighter\n",
      });

      const graph = await buildCodeGraph(root);
      const nodes = graph.nodes.map((n) => n.relativePath);

      // Both projects' files should be in the graph
      expect(nodes).toContain("outer.gd");
      expect(nodes).toContain("game/scripts/Fighter.gd");
      expect(nodes).toContain("game/scripts/user.gd");

      // game/scripts/user.gd extends Fighter — should resolve to
      // game/scripts/Fighter.gd (same project), NOT outer.gd
      const userNode = graph.nodes.find((n) => n.relativePath === "game/scripts/user.gd");
      expect(userNode).toBeDefined();
      expect(userNode?.dependencies).toContain("game/scripts/Fighter.gd");
    });

    it("sibling projects with duplicate class names resolve independently", async () => {
      const { root } = makeGodotProject({
        "game-a/project.godot": "[application]\n",
        "game-a/scripts/Fighter.gd": "class_name Fighter\nextends Node\n",
        "game-a/scripts/user.gd": "extends Fighter\n",
        "game-b/project.godot": "[application]\n",
        "game-b/scripts/Fighter.gd": "class_name Fighter\nextends Node\n",
        "game-b/scripts/user.gd": "extends Fighter\n",
      });

      const graph = await buildCodeGraph(root);

      // game-a user.gd should resolve to game-a's Fighter.gd
      const userA = graph.nodes.find((n) => n.relativePath === "game-a/scripts/user.gd");
      expect(userA?.dependencies).toContain("game-a/scripts/Fighter.gd");
      expect(userA?.dependencies).not.toContain("game-b/scripts/Fighter.gd");

      // game-b user.gd should resolve to game-b's Fighter.gd
      const userB = graph.nodes.find((n) => n.relativePath === "game-b/scripts/user.gd");
      expect(userB?.dependencies).toContain("game-b/scripts/Fighter.gd");
      expect(userB?.dependencies).not.toContain("game-a/scripts/Fighter.gd");
    });

    it("resource-only nested project resolves res:// to inner project root", async () => {
      // This is the key regression test: a .tscn file in an inner project
      // must resolve res:// paths relative to the inner project.godot,
      // not the outer one.
      const { root } = makeGodotProject({
        "project.godot": "[application]\n",
        "outer.gd": "extends Node\n",
        "game/project.godot": "[application]\n",
        "game/scene.tscn": [
          '[gd_scene load_steps=2 format=3]',
          '',
          '[ext_resource type="Script" path="res://script.gd" id="1"]',
          '',
          '[node name="Player" type="Node"]',
        ].join('\n'),
        "game/script.gd": "extends Node\n",
        // Also add a file in the outer project with the same name to
        // prove it doesn't cross-resolve
        "script.gd": "extends Node\n",
      });

      const graph = await buildCodeGraph(root);

      // game/scene.tscn should depend on game/script.gd (inner project),
      // NOT script.gd (outer project)
      const sceneNode = graph.nodes.find((n) => n.relativePath === "game/scene.tscn");
      expect(sceneNode).toBeDefined();
      expect(sceneNode?.dependencies).toContain("game/script.gd");
      expect(sceneNode?.dependencies).not.toContain("script.gd");
    });

    it("files without project.godot do not resolve res:// paths", async () => {
      const { root } = makeGodotProject({
        "scripts/Player.gd": "extends Node\n",
        "scripts/Weapon.gd": 'extends Node\n\nfunc _ready():\n    var w = preload("res://scripts/Weapon.gd")\n',
      });

      const graph = await buildCodeGraph(root);

      // No project.godot → res:// must not resolve
      const weaponNode = graph.nodes.find((n) => n.relativePath === "scripts/Weapon.gd");
      expect(weaponNode).toBeDefined();
      // The preload("res://scripts/Weapon.gd") must not resolve without project.godot
      expect(weaponNode?.dependencies.length).toBe(0);
    });
  });

  // ── GDScript string literal decoding ───────────────────────────────────

  describe("decodeGdscriptString", () => {
    it("decodes double-quoted strings", () => {
      expect(decodeGdscriptString('"res://scripts/Player.gd"')).toBe("res://scripts/Player.gd");
    });

    it("decodes single-quoted strings", () => {
      expect(decodeGdscriptString("'res://scripts/Player.gd'")).toBe("res://scripts/Player.gd");
    });

    it("decodes raw strings without processing escapes", () => {
      expect(decodeGdscriptString('r"res://x.gd"')).toBe("res://x.gd");
      expect(decodeGdscriptString("r'helper.gd'")).toBe("helper.gd");
    });

    it("decodes triple-quoted strings", () => {
      expect(decodeGdscriptString('"""res://x.gd"""')).toBe("res://x.gd");
      expect(decodeGdscriptString("'''helper.gd'''")).toBe("helper.gd");
    });

    it("decodes escape sequences in non-raw strings", () => {
      expect(decodeGdscriptString('"path\\\\to\\\\file.gd"')).toBe("path\\to\\file.gd");
      expect(decodeGdscriptString('"say \\"hi\\""')).toBe('say "hi"');
    });

    it("does not process escapes in raw strings", () => {
      expect(decodeGdscriptString('r"path\\to\\file.gd"')).toBe("path\\to\\file.gd");
    });

    it("returns null for non-string input", () => {
      expect(decodeGdscriptString("not a string")).toBeNull();
      expect(decodeGdscriptString("")).toBeNull();
    });
  });

  // ── TSCN section header tokenizer ──────────────────────────────────────

  describe("parseTscnSectionHeader", () => {
    it("parses basic ext_resource with path", () => {
      const result = parseTscnSectionHeader('[ext_resource type="Script" path="res://scripts/Player.gd" id="1"]');
      expect(result).not.toBeNull();
      expect(result?.type).toBe("ext_resource");
      expect(result?.attrs.get("path")).toBe("res://scripts/Player.gd");
      expect(result?.attrs.get("type")).toBe("Script");
      expect(result?.attrs.get("id")).toBe("1");
    });

    it("handles leading whitespace", () => {
      const result = parseTscnSectionHeader('  [ext_resource path="material.tres" id="2"]');
      expect(result).not.toBeNull();
      expect(result?.type).toBe("ext_resource");
      expect(result?.attrs.get("path")).toBe("material.tres");
    });

    it("handles spaces around =", () => {
      const result = parseTscnSectionHeader('[ext_resource path = "res://x.gd" id = "1"]');
      expect(result).not.toBeNull();
      expect(result?.attrs.get("path")).toBe("res://x.gd");
    });

    it("handles arbitrary attribute order", () => {
      const result = parseTscnSectionHeader('[ext_resource id="1" type="Script" path="res://x.gd"]');
      expect(result).not.toBeNull();
      expect(result?.attrs.get("path")).toBe("res://x.gd");
      expect(result?.attrs.get("type")).toBe("Script");
    });

    it("handles uid and path together", () => {
      const result = parseTscnSectionHeader('[ext_resource type="Script" uid="uid://abc123" path="res://x.gd" id="1"]');
      expect(result).not.toBeNull();
      expect(result?.attrs.get("uid")).toBe("uid://abc123");
      expect(result?.attrs.get("path")).toBe("res://x.gd");
    });

    it("handles escaped quotes in values", () => {
      const result = parseTscnSectionHeader('[ext_resource path="res://x\\"file.gd"]');
      expect(result).not.toBeNull();
      expect(result?.attrs.get("path")).toBe('res://x"file.gd');
    });

    it("returns null for non-section lines", () => {
      expect(parseTscnSectionHeader("script = ExtResource(\"1\")")).toBeNull();
      expect(parseTscnSectionHeader("[node name=\"Player\" type=\"Node\"]")).not.toBeNull();
      expect(parseTscnSectionHeader("")).toBeNull();
    });
  });

  // ── TSCN extractor with whitespace and UID ─────────────────────────────

  describe("extractGodotResourceImports: whitespace and UID", () => {
    it("handles leading whitespace before [", () => {
      const source = '  [ext_resource path="res://x.gd" id="1"]';
      const imports = extractGodotResourceImports(source);
      expect(imports.map((i) => i.moduleSpecifier)).toContain("res://x.gd");
    });

    it("handles spaces around = in path attribute", () => {
      const source = '[ext_resource path = "res://x.gd" id = "1"]';
      const imports = extractGodotResourceImports(source);
      expect(imports.map((i) => i.moduleSpecifier)).toContain("res://x.gd");
    });

    it("handles arbitrary attribute order", () => {
      const source = '[ext_resource id="1" type="Script" path="res://x.gd"]';
      const imports = extractGodotResourceImports(source);
      expect(imports.map((i) => i.moduleSpecifier)).toContain("res://x.gd");
    });

    it("emits uid as primary specifier with path as fallback when both are present", () => {
      const source = '[ext_resource type="Script" uid="uid://abc123" path="res://x.gd" id="1"]';
      const imports = extractGodotResourceImports(source);
      expect(imports).toHaveLength(1);
      expect(imports[0].moduleSpecifier).toBe("uid://abc123");
      expect(imports[0].fallbackSpecifier).toBe("res://x.gd");
    });

    it("extracts uid-only ext_resource", () => {
      const source = '[ext_resource type="Script" uid="uid://abc123" id="1"]';
      const imports = extractGodotResourceImports(source);
      expect(imports.map((i) => i.moduleSpecifier)).toContain("uid://abc123");
    });
  });

  // ── AST import extraction: raw strings, nested calls, relative paths ───

  describe("AST import extraction edge cases", () => {
    it("handles raw string preload", () => {
      const source = 'extends Node\n\nfunc _ready():\n    var x = preload(r"res://scripts/Player.gd")\n';
      const imports = extractImports(source, "gdscript", ".gd");
      const specs = imports.map((i) => i.moduleSpecifier);
      expect(specs).toContain("res://scripts/Player.gd");
    });

    it("does not extract nested string from dynamic load expression", () => {
      // load(resolve_path("res://fake.gd")) — the string is nested inside
      // another call, not a direct argument to load. Must NOT extract.
      const source = 'extends Node\n\nfunc _ready():\n    var x = load(resolve_path("res://fake.gd"))\n';
      const imports = extractImports(source, "gdscript", ".gd");
      const specs = imports.map((i) => i.moduleSpecifier);
      expect(specs).not.toContain("res://fake.gd");
    });

    it("extracts relative extends path", () => {
      const source = 'extends "base.gd"\n\nfunc _ready(): pass\n';
      const imports = extractImports(source, "gdscript", ".gd");
      const specs = imports.map((i) => i.moduleSpecifier);
      expect(specs).toContain("base.gd");
    });

    it("extracts relative preload path", () => {
      const source = 'extends Node\n\nfunc _ready():\n    var x = preload("helper.gd")\n';
      const imports = extractImports(source, "gdscript", ".gd");
      const specs = imports.map((i) => i.moduleSpecifier);
      expect(specs).toContain("helper.gd");
    });

    it("does not extract preload from comments (AST path)", () => {
      const source = [
        '# preload("res://comment.gd")',
        'extends Node',
        '',
        'func _ready():',
        '    pass',
      ].join('\n');
      const imports = extractImports(source, "gdscript", ".gd");
      const specs = imports.map((i) => i.moduleSpecifier);
      expect(specs).not.toContain("res://comment.gd");
    });
  });

  // ── Regex fallback: raw strings, comments, lowercase extends ───────────

  describe("extractGdscriptImportsRegex edge cases", () => {
    it("handles raw string preload", () => {
      const source = 'extends Node\n\nfunc _ready():\n    var x = preload(r"res://scripts/Player.gd")\n';
      const imports = extractGdscriptImportsRegex(source);
      const specs = imports.map((i) => i.moduleSpecifier);
      expect(specs).toContain("res://scripts/Player.gd");
    });

    it("keeps escaped matching quotes inside raw strings", () => {
      const source = 'var text = r"quote: \\" still raw"; var real = preload("res://real.gd")';
      const specs = extractGdscriptImportsRegex(source).map((item) => item.moduleSpecifier);

      expect(specs).toEqual(["res://real.gd"]);
    });

    it("does not extract preload from comments", () => {
      const source = [
        '# preload("res://comment.gd")',
        'extends Node',
        '',
        'func _ready():',
        '    preload("res://scripts/Real.gd")',
      ].join('\n');
      const imports = extractGdscriptImportsRegex(source);
      const specs = imports.map((i) => i.moduleSpecifier);
      expect(specs).not.toContain("res://comment.gd");
      expect(specs).toContain("res://scripts/Real.gd");
    });

    it("ignores inline comments, ordinary strings, member calls, and nested arguments", () => {
      const source = [
        'extends Node # preload("res://inline-comment.gd")',
        'var text = "load(\\"res://quoted.gd\\")"',
        'var member = ResourceLoader.load("res://member.gd")',
        'var nested = load(resolve_path("res://nested.gd"))',
        'var real = preload("res://real.gd")',
      ].join("\n");
      const specs = extractGdscriptImportsRegex(source).map((item) => item.moduleSpecifier);

      expect(specs).toContain("res://real.gd");
      expect(specs).not.toContain("res://inline-comment.gd");
      expect(specs).not.toContain("res://quoted.gd");
      expect(specs).not.toContain("res://member.gd");
      expect(specs).not.toContain("res://nested.gd");
    });

    it("records the construct that controls relative-path resolution", () => {
      const imports = extractGdscriptImportsRegex([
        'extends "base.gd"',
        'var eager = preload("helper.gd")',
        'var runtime = load("resource.tres")',
      ].join("\n"));

      expect(imports.find((item) => item.moduleSpecifier === "base.gd")?.godotImportKind).toBe("extends");
      expect(imports.find((item) => item.moduleSpecifier === "helper.gd")?.godotImportKind).toBe("preload");
      expect(imports.find((item) => item.moduleSpecifier === "resource.tres")?.godotImportKind).toBe("load");
    });

    it("accepts lowercase class names in extends", () => {
      const source = 'extends myClass\n\nfunc _ready(): pass\n';
      const imports = extractGdscriptImportsRegex(source);
      const extendsImports = imports.filter((i) => i.moduleSpecifier.startsWith("class:"));
      expect(extendsImports.length).toBe(1);
      expect(extendsImports[0].moduleSpecifier).toBe("class:myClass");
    });

    it("extracts relative extends path", () => {
      const source = 'extends "base.gd"\n\nfunc _ready(): pass\n';
      const imports = extractGdscriptImportsRegex(source);
      const specs = imports.map((i) => i.moduleSpecifier);
      expect(specs).toContain("base.gd");
    });

    it("does not extract class_name from triple-quoted strings", () => {
      // The class_name extraction is tested via buildClassNameIndex below,
      // but verify the regex fallback doesn't match extends inside strings.
      const source = [
        'extends Node',
        '',
        '"""',
        'class_name Phantom',
        'extends Phantom',
        '"""',
        '',
        'func _ready(): pass',
      ].join('\n');
      const imports = extractGdscriptImportsRegex(source);
      const specs = imports.map((i) => i.moduleSpecifier);
      // extends Phantom inside the triple-quoted string should NOT be extracted
      expect(specs).not.toContain("class:Phantom");
    });
  });

  // ── class_name extraction: annotations, strings, Unicode ───────────────

  describe("buildClassNameIndex: syntax-aware extraction", () => {
    it("handles same-line annotation before class_name", () => {
      const { root } = makeGodotProject({
        "scripts/annotated.gd": "@tool\nclass_name MyClass\nextends Node\n",
      });
      const fileSet = new Set<string>(["scripts/annotated.gd"]);
      const index = buildClassNameIndex(root, fileSet);
      expect(index.get("MyClass")).toBe("scripts/annotated.gd");
    });

    it("handles class_name with annotation on same line", () => {
      const { root } = makeGodotProject({
        "scripts/annotated.gd": "@abstract class_name AbstractClass\nextends Node\n",
      });
      const fileSet = new Set<string>(["scripts/annotated.gd"]);
      const index = buildClassNameIndex(root, fileSet);
      expect(index.get("AbstractClass")).toBe("scripts/annotated.gd");
    });

    it("does not register class_name inside triple-quoted strings", () => {
      const { root } = makeGodotProject({
        "scripts/fake.gd": 'extends Node\n\n"""\nclass_name Phantom\n"""\n',
      });
      const fileSet = new Set<string>(["scripts/fake.gd"]);
      const index = buildClassNameIndex(root, fileSet);
      expect(index.has("Phantom")).toBe(false);
    });

    it("handles lowercase class names", () => {
      const { root } = makeGodotProject({
        "scripts/lower.gd": "class_name myClass\nextends Node\n",
      });
      const fileSet = new Set<string>(["scripts/lower.gd"]);
      const index = buildClassNameIndex(root, fileSet);
      expect(index.get("myClass")).toBe("scripts/lower.gd");
    });

    it("ignores class_name text inside ordinary strings and after inline comments", () => {
      const { root } = makeGodotProject({
        "scripts/real.gd": [
          'var text = "class_name Phantom"',
          'var hash = "# class_name AlsoPhantom"',
          'var value = 1 # class_name CommentedOut',
          "class_name RealClass",
        ].join("\n"),
      });
      const index = buildClassNameIndex(root, new Set(["scripts/real.gd"]));

      expect(index.get("RealClass")).toBe("scripts/real.gd");
      expect(index.has("Phantom")).toBe(false);
      expect(index.has("AlsoPhantom")).toBe(false);
      expect(index.has("CommentedOut")).toBe(false);
    });

    it("recognizes Unicode identifiers in the parser-independent class index", () => {
      const { root } = makeGodotProject({
        "scripts/unicode.gd": "class_name Éclaireur\nextends Node\n",
      });
      const index = buildClassNameIndex(root, new Set(["scripts/unicode.gd"]));
      expect(index.get("Éclaireur")).toBe("scripts/unicode.gd");
    });
  });

  // ── UID resolution ─────────────────────────────────────────────────────

  describe("UID resolution", () => {
    it("buildGodotUidIndexes builds index from .uid sidecar files", () => {
      const { root } = makeGodotProject({
        "project.godot": "",
        "scripts/Player.gd": "extends Node\n",
        "scripts/Player.gd.uid": "uid://abc123\n",
      });
      const fileSet = new Set<string>(["project.godot", "scripts/Player.gd", "scripts/Player.gd.uid"]);
      const indexes = buildGodotUidIndexes(root, fileSet);
      expect(indexes.size).toBe(1);
      for (const [, index] of indexes) {
        expect(index.get("uid://abc123")).toBe("scripts/Player.gd");
      }
    });

    it("uses .uid metadata without creating a graph node for the sidecar", async () => {
      const { root } = makeGodotProject({
        "project.godot": "[application]\n",
        "scripts/Player.gd": "extends Node\n",
        "scripts/Player.gd.uid": "uid://abc123\n",
        "scripts/User.gd": [
          "extends Node",
          'var player = preload("uid://abc123")',
          'var metadata = preload("res://scripts/Player.gd.uid")',
        ].join("\n"),
      });

      const graph = await buildCodeGraph(root);
      const userNode = graph.nodes.find((node) => node.relativePath === "scripts/User.gd");

      expect(userNode?.dependencies).toContain("scripts/Player.gd");
      expect(userNode?.dependencies).not.toContain("scripts/Player.gd.uid");
      expect(graph.nodes.some((node) => node.relativePath.endsWith(".uid"))).toBe(false);
    });

    it("does not create a phantom target from a stale .uid sidecar", async () => {
      const { root } = makeGodotProject({
        "project.godot": "[application]\n",
        "scripts/Missing.gd.uid": "uid://stale123\n",
        "scripts/User.gd": 'extends Node\nvar missing = preload("uid://stale123")\n',
      });

      const graph = await buildCodeGraph(root);
      const userNode = graph.nodes.find((node) => node.relativePath === "scripts/User.gd");

      expect(userNode?.dependencies).not.toContain("scripts/Missing.gd");
      expect(graph.nodes.some((node) => node.relativePath === "scripts/Missing.gd")).toBe(false);
    });

    it("buildGodotUidIndexes builds index from .tscn file headers", () => {
      const { root } = makeGodotProject({
        "project.godot": "",
        "scenes/Player.tscn": '[gd_scene load_steps=1 format=3 uid="uid://scene123"]\n',
      });
      const fileSet = new Set<string>(["project.godot", "scenes/Player.tscn"]);
      const indexes = buildGodotUidIndexes(root, fileSet);
      expect(indexes.size).toBe(1);
      for (const [, index] of indexes) {
        expect(index.get("uid://scene123")).toBe("scenes/Player.tscn");
      }
    });

    it("resolves uid:// paths via UID index", () => {
      const { root, resolve } = makeGodotProject({
        "project.godot": "",
        "scripts/Player.gd": "extends Node\n",
        "scripts/Player.gd.uid": "uid://abc123\n",
        "scripts/User.gd": 'extends Node\n\nfunc _ready():\n    var p = preload("uid://abc123")\n',
      });
      const fileSet = new Set<string>([
        "project.godot",
        "scripts/Player.gd",
        "scripts/Player.gd.uid",
        "scripts/User.gd",
      ]);
      const uidIndexes = buildGodotUidIndexes(root, fileSet);
      const uidIndex = [...uidIndexes.values()][0];

      const sourceFile = resolve("scripts/User.gd");
      const resolved = resolveImport(
        "uid://abc123",
        sourceFile,
        root,
        fileSet,
        "gdscript",
        undefined, // aliases
        undefined, // jvmSuffixMap
        undefined, // csNamespaceMap
        undefined, // goModuleInfo
        undefined, // phpPsr4Map
        undefined, // dartPackageMap
        undefined, // pythonImportRoots
        undefined, // elixirModuleMap
        undefined, // phpFqcnMap
        undefined, // rustCrates
        undefined, // rustDeclaredMods
        undefined, // rustIsDeclaration
        undefined, // classNameIndex
        root,      // godotProjectRoot
        uidIndex,  // godotUidIndex
      );
      expect(resolved).toBe("scripts/Player.gd");
    });

    it("returns null for unknown uid:// paths", () => {
      const { root, resolve } = makeGodotProject({
        "project.godot": "",
        "scripts/Player.gd": "extends Node\n",
      });
      const fileSet = new Set<string>(["project.godot", "scripts/Player.gd"]);
      const uidIndex = new Map<string, string>();

      const sourceFile = resolve("scripts/Player.gd");
      const resolved = resolveImport(
        "uid://nonexistent",
        sourceFile,
        root,
        fileSet,
        "gdscript",
        undefined, // aliases
        undefined, // jvmSuffixMap
        undefined, // csNamespaceMap
        undefined, // goModuleInfo
        undefined, // phpPsr4Map
        undefined, // dartPackageMap
        undefined, // pythonImportRoots
        undefined, // elixirModuleMap
        undefined, // phpFqcnMap
        undefined, // rustCrates
        undefined, // rustDeclaredMods
        undefined, // rustIsDeclaration
        undefined, // classNameIndex
        root,      // godotProjectRoot
        uidIndex,  // godotUidIndex
      );
      expect(resolved).toBeNull();
    });
  });

  // ── Relative path resolution ───────────────────────────────────────────

  describe("relative path resolution", () => {
    it("uses script-relative paths for preload and project-relative paths for load", async () => {
      const { root } = makeGodotProject({
        "project.godot": "[application]\n",
        "helper.gd": "extends Node\n",
        "scripts/helper.gd": "extends Node\n",
        "scripts/main.gd": [
          "extends Node",
          'var eager = preload("helper.gd")',
          'var runtime = load("helper.gd")',
        ].join("\n"),
      });

      const graph = await buildCodeGraph(root);
      const mainNode = graph.nodes.find((node) => node.relativePath === "scripts/main.gd");

      expect(mainNode?.dependencies).toContain("scripts/helper.gd");
      expect(mainNode?.dependencies).toContain("helper.gd");
    });

    it("resolves relative extends path from script directory", () => {
      const { root, resolve } = makeGodotProject({
        "project.godot": "",
        "scripts/base.gd": "extends Node\n",
        "scripts/derived.gd": 'extends "base.gd"\n\nfunc _ready(): pass\n',
      });
      const fileSet = new Set<string>(["project.godot", "scripts/base.gd", "scripts/derived.gd"]);

      const sourceFile = resolve("scripts/derived.gd");
      const resolved = resolveImport(
        "base.gd",
        sourceFile,
        root,
        fileSet,
        "gdscript",
      );
      expect(resolved).toBe("scripts/base.gd");
    });

    it("resolves relative preload path from script directory", () => {
      const { root, resolve } = makeGodotProject({
        "project.godot": "",
        "scripts/helper.gd": "extends Node\n",
        "scripts/main.gd": 'extends Node\n\nfunc _ready():\n    var h = preload("helper.gd")\n',
      });
      const fileSet = new Set<string>(["project.godot", "scripts/helper.gd", "scripts/main.gd"]);

      const sourceFile = resolve("scripts/main.gd");
      const resolved = resolveImport(
        "helper.gd",
        sourceFile,
        root,
        fileSet,
        "gdscript",
      );
      expect(resolved).toBe("scripts/helper.gd");
    });

    it("resolves ../ relative paths", () => {
      const { root, resolve } = makeGodotProject({
        "project.godot": "",
        "scripts/base.gd": "extends Node\n",
        "scripts/sub/derived.gd": 'extends "../base.gd"\n\nfunc _ready(): pass\n',
      });
      const fileSet = new Set<string>(["project.godot", "scripts/base.gd", "scripts/sub/derived.gd"]);

      const sourceFile = resolve("scripts/sub/derived.gd");
      const resolved = resolveImport(
        "../base.gd",
        sourceFile,
        root,
        fileSet,
        "gdscript",
      );
      expect(resolved).toBe("scripts/base.gd");
    });
  });
});
