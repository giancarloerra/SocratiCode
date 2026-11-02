// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited
import fs from "node:fs";
import path from "node:path";
import { globSync } from "glob";
import ts from "typescript";
import { parseDocument } from "yaml";
import { toForwardSlash } from "../constants.js";
import { type PathAliases, parsePathAliases } from "./graph-aliases.js";
import type { ImportInfo } from "./graph-imports.js";
import type { GraphInputRecorder } from "./graph-inputs.js";
import { resolveImport } from "./graph-resolution.js";

const inside = (root: string, file: string): boolean => {
  const relative = path.relative(root, file);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
};

interface Workspace {
  root: string;
  packages: Map<string, string>;
}

interface ImportContext {
  aliases: PathAliases;
  resolve(imp: ImportInfo): string | null;
}

/** Emit targets and standard-library types do not participate in this resolver. */
function isCompilerOnlyDiagnostic(diagnostic: ts.Diagnostic): boolean {
  if (diagnostic.code !== 6046 || !diagnostic.file || diagnostic.start === undefined) return false;
  const start = diagnostic.start;
  let option: string | undefined;
  const visit = (node: ts.Node): void => {
    if (node.pos > start || node.end <= start) return;
    if (ts.isPropertyAssignment(node) && ts.isStringLiteralLike(node.name)) option = node.name.text;
    ts.forEachChild(node, visit);
  };
  visit(diagnostic.file);
  return option === "target" || option === "lib";
}

/**
 * One build's importer contexts. The compiler owns config inheritance and
 * package resolution; the host supplies declared workspace links without
 * installing packages or changing the indexed tree.
 */
export function createTypeScriptResolver(
  projectPath: string,
  fileSet: Set<string>,
  recorder: GraphInputRecorder,
): (sourceFile: string) => ImportContext {
  const root = path.resolve(projectPath);
  const reads = new Map<string, string | undefined>();
  const bindings = new Map<string, string | null>();
  const realpath = (file: string): string | null => {
    const absolute = path.resolve(file);
    if (bindings.has(absolute)) return bindings.get(absolute) ?? null;
    let canonical: string | null = null;
    try {
      // Match the native canonicalization used by the async freshness check.
      canonical = fs.realpathSync.native(absolute);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
    }
    recorder.realpath?.(absolute, canonical);
    bindings.set(absolute, canonical);
    return canonical;
  };
  const read = (file: string): string | undefined => {
    const absolute = path.resolve(file);
    if (reads.has(absolute)) return reads.get(absolute);
    let raw: string | undefined;
    try {
      raw = fs.readFileSync(absolute, "utf8");
      recorder.read(absolute, raw);
    } catch (error) {
      recorder.unreadable(absolute);
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
    }
    reads.set(absolute, raw);
    return raw;
  };

  // Only ancestors of graphable files can supply a workspace or a package
  // with a graph target. Ignored trees and node_modules never become members.
  const directories = new Set<string>([root]);
  for (const file of fileSet) {
    let dir = path.dirname(path.resolve(root, file));
    while (inside(root, dir) && !directories.has(dir)) {
      directories.add(dir);
      dir = path.dirname(dir);
    }
  }
  const manifests = new Map<string, Record<string, unknown>>();
  for (const dir of directories) {
    const file = path.join(dir, "package.json");
    const raw = read(file);
    if (raw !== undefined) {
      let manifest: unknown;
      try {
        manifest = JSON.parse(raw);
      } catch (error) {
        throw new Error(`Invalid package manifest ${file}: ${String(error)}`, { cause: error });
      }
      if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
        throw new Error(`Package manifest must contain an object: ${file}`);
      }
      manifests.set(dir, manifest as Record<string, unknown>);
    }
  }
  const workspaces: Workspace[] = [];
  for (const dir of directories) {
    const manifest = manifests.get(dir);
    const declared = manifest?.workspaces;
    let patterns: unknown = Array.isArray(declared) ? declared
      : declared && typeof declared === "object" ? (declared as Record<string, unknown>).packages : undefined;
    const yamlPath = path.join(dir, "pnpm-workspace.yaml");
    const yaml = read(yamlPath);
    if (yaml !== undefined) {
      const document = parseDocument(yaml);
      if (document.errors.length > 0) {
        throw new Error(`Invalid workspace manifest ${yamlPath}: ${document.errors[0].message}`);
      }
      patterns = document.toJS()?.packages ?? [];
    }
    if (patterns === undefined) continue;
    if (!Array.isArray(patterns)) throw new Error(`Workspace packages must be an array of strings: ${dir}`);
    if (!patterns.every((pattern): pattern is string => typeof pattern === "string")) {
      throw new Error(`Workspace packages must be an array of strings: ${dir}`);
    }
    const positive = patterns.filter((pattern) => !pattern.startsWith("!"));
    const negative = patterns.filter((pattern) => pattern.startsWith("!")).map((pattern) => pattern.slice(1));
    const members = new Set([dir, ...globSync(positive, {
      cwd: dir,
      absolute: true,
      ignore: [...negative, "**/node_modules/**", "**/.git/**"],
    }).map((member) => path.resolve(member))]);
    const packages = new Map<string, string>();
    for (const member of members) {
      if (!inside(root, member)) continue;
      const name = manifests.get(member)?.name;
      if (typeof name !== "string") continue;
      if (packages.has(name)) throw new Error(`Duplicate workspace package ${name} in ${dir}`);
      packages.set(name, member);
    }
    workspaces.push({ root: dir, packages });
  }
  workspaces.sort((a, b) => b.root.length - a.root.length);

  const configByDir = new Map<string, string | null>();
  const parsedByConfig = new Map<string, ts.ParsedCommandLine>();
  const configHost: ts.ParseConfigFileHost = {
    useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
    getCurrentDirectory: () => root,
    readDirectory: () => [], // Only compiler options are needed, not its input file list.
    fileExists: (file) => {
      if (file.endsWith(".json")) return read(file) !== undefined;
      return ts.sys.fileExists(file);
    },
    readFile: read,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
    },
  };
  const parsedConfig = (file: string): ts.ParsedCommandLine => {
    let parsed = parsedByConfig.get(file);
    if (!parsed) {
      parsed = ts.getParsedCommandLineOfConfigFile(toForwardSlash(file), undefined, configHost);
      if (!parsed) throw new Error(`Cannot read TypeScript configuration: ${file}`);
      // Empty inputs are immaterial to a graph resolver. All actual config
      // diagnostics retain their compiler-provided cause.
      // The original alias loader ignored compiler options it did not use.
      // Keep known paths usable when a project uses another compiler version's
      // options (5023/5025) or emit/type-library values. Missing extends bases
      // (6053/5083) also retain local aliases, as the original loader did.
      // Syntax, circular inheritance and invalid resolution values still fail.
      const error = parsed.errors.find((diagnostic) =>
        ![18003, 18002, 5023, 5025, 6053, 5083].includes(diagnostic.code) && !isCompilerOnlyDiagnostic(diagnostic));
      if (error) throw new Error(`Invalid TypeScript configuration ${file}: ${ts.flattenDiagnosticMessageText(error.messageText, "\n")}`);
      parsedByConfig.set(file, parsed);
    }
    return parsed;
  };
  const configFor = (dir: string): string | null => {
    if (configByDir.has(dir)) return configByDir.get(dir) ?? null;
    let found: string | null = null;
    for (const name of ["tsconfig.json", "jsconfig.json"]) {
      const file = path.join(dir, name);
      if (read(file) === undefined) continue;
      // Preserve the existing root convention: a tsconfig with no paths
      // permits jsconfig aliases. A nested config remains its own boundary.
      if (dir === root && name === "tsconfig.json" && !parsedConfig(file).options.paths && read(path.join(dir, "jsconfig.json")) !== undefined) continue;
      found = file;
      break;
    }
    if (!found && dir !== root) found = configFor(path.dirname(dir));
    configByDir.set(dir, found);
    return found;
  };

  return (sourceFile) => {
    const config = configFor(path.dirname(sourceFile));
    const options = config ? parsedConfig(config).options : {};
    const effective: ts.CompilerOptions = { ...options };
    if (effective.moduleResolution === undefined && effective.module === undefined) {
      effective.moduleResolution = ts.ModuleResolutionKind.Bundler;
      effective.module = ts.ModuleKind.ESNext;
    }
    const base = options.baseUrl ?? options.pathsBasePath;
    const aliases = parsePathAliases(JSON.stringify({ compilerOptions: {
      paths: options.paths,
      baseUrl: typeof base === "string" ? base : root,
    } }), root);
    const workspace = workspaces.find((candidate) => inside(candidate.root, sourceFile));
    const virtualRoot = workspace && path.join(workspace.root, "node_modules");
    const translate = (file: string): string => {
      const absolute = path.resolve(file);
      if (!workspace || !inside(workspace.root, absolute)) return absolute;
      const parts = toForwardSlash(path.relative(workspace.root, absolute)).split("/");
      const at = parts.lastIndexOf("node_modules");
      if (at < 0) return absolute;
      const rest = parts.slice(at + 1);
      const length = rest[0]?.startsWith("@") ? 2 : 1;
      const member = workspace.packages.get(rest.slice(0, length).join("/"));
      if (!member) return absolute;
      const entry = path.join(workspace.root, ...parts.slice(0, at + 1 + length));
      const installed = realpath(entry);
      // An existing package may be an independent version or npm alias. Only
      // actual workspace links and absent (virtual) entries map to a member.
      if (installed !== null && installed !== realpath(member)) return absolute;
      return path.join(member, ...rest.slice(length));
    };
    const host: ts.ModuleResolutionHost = {
      fileExists: (file) => configHost.fileExists(translate(file)),
      readFile: (file) => read(translate(file)),
      directoryExists: (dir) => {
        const absolute = path.resolve(dir);
        if (workspace && inside(workspace.root, absolute) && (
          path.basename(absolute) === "node_modules"
          || (path.basename(path.dirname(absolute)) === "node_modules" && path.basename(absolute).startsWith("@"))
        )) realpath(absolute);
        if (virtualRoot && path.resolve(dir) === virtualRoot) return true;
        if (virtualRoot && path.dirname(path.resolve(dir)) === virtualRoot && path.basename(dir).startsWith("@")) {
          const scope = `${path.basename(dir)}/`;
          if ([...workspace.packages.keys()].some((name) => name.startsWith(scope))) return true;
        }
        return ts.sys.directoryExists(translate(dir));
      },
      realpath: translate,
      getCurrentDirectory: () => root,
      useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
    };
    return {
      aliases,
      resolve(imp) {
        const mode = imp.isRequire ? ts.ModuleKind.CommonJS
          : imp.isDynamic ? ts.ModuleKind.ESNext
          : ts.getImpliedNodeFormatForFile(sourceFile, undefined, host, effective)
            ?? (effective.module === ts.ModuleKind.CommonJS ? ts.ModuleKind.CommonJS : ts.ModuleKind.ESNext);
        const result = ts.resolveModuleName(imp.moduleSpecifier, sourceFile, effective, host, undefined, undefined, mode).resolvedModule;
        if (result) {
          const relative = toForwardSlash(path.relative(root, translate(result.resolvedFileName)));
          return fileSet.has(relative) ? relative : null;
        }
        // Keep existing aliases to components, styles and other graphable
        // files the compiler does not load. Use only its selected paths
        // pattern, never a broader mapping after a failed match.
        const spec = imp.moduleSpecifier;
        const patterns = Object.keys(options.paths ?? {}).filter((pattern) => {
          const star = pattern.indexOf("*");
          return star < 0 ? pattern === spec
            : spec.startsWith(pattern.slice(0, star)) && spec.endsWith(pattern.slice(star + 1));
        }).sort((a, b) => a === spec ? -1 : b === spec ? 1 : b.indexOf("*") - a.indexOf("*"));
        const selected = patterns[0];
        if (!selected) return null;
        const legacyAliases = parsePathAliases(JSON.stringify({ compilerOptions: {
          baseUrl: typeof base === "string" ? base : root,
          paths: { [selected]: options.paths?.[selected] },
        } }), root);
        return resolveImport(spec, sourceFile, root, fileSet, "typescript", legacyAliases);
      },
    };
  };
}
