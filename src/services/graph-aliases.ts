// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited
import fs from "node:fs/promises";
import path from "node:path";
import type { GraphInputRecorder } from "./graph-inputs.js";
import { logger } from "./logger.js";

// ── Path alias resolution ────────────────────────────────────────────────

/** Resolved path aliases from tsconfig/jsconfig */
export interface PathAliases {
  /** Map of alias prefix → target directories (relative to project root) */
  entries: Map<string, string[]>;
}

/** Empty aliases constant for when no config is found */
const EMPTY_ALIASES: PathAliases = { entries: new Map() };

/**
 * Load path aliases from tsconfig.json or jsconfig.json.
 * Parses `compilerOptions.paths` and `compilerOptions.baseUrl` to build
 * a prefix → directory mapping used during import resolution.
 * Follows `extends` chains to find paths in parent configs.
 *
 * Returns empty aliases if no config is found (graceful degradation).
 */
export async function loadPathAliases(
  projectPath: string,
  recorder?: GraphInputRecorder,
): Promise<PathAliases> {
  const configNames = ["tsconfig.json", "jsconfig.json"];

  for (const name of configNames) {
    const configPath = path.join(projectPath, name);
    try {
      const raw = await fs.readFile(configPath, "utf-8");
      recorder?.read(configPath, raw);
      const aliases = parsePathAliases(raw, projectPath);
      if (aliases.entries.size > 0) {
        logger.info("Loaded path aliases", {
          config: name,
          aliases: Array.from(aliases.entries.keys()),
        });
        return aliases;
      }
      // Config exists but has no paths — follow extends chain
      const extended = await followExtendsChain(configPath, projectPath, recorder);
      if (extended.entries.size > 0) {
        logger.info("Loaded path aliases via extends", {
          config: name,
          aliases: Array.from(extended.entries.keys()),
        });
        return extended;
      }
      // No paths in entire chain — try next config file
    } catch {
      // Config not found, or found and unreadable — try next. Either way the
      // build looked here and got nothing, and a config appearing (or becoming
      // readable) changes the aliases, so it is an input. `read` above takes
      // precedence, so this only lands when nothing was read.
      recorder?.unreadable(configPath);
    }
  }

  return EMPTY_ALIASES;
}

/** Maximum depth for tsconfig extends chains to prevent circular references */
const MAX_EXTENDS_DEPTH = 10;

/**
 * Follow the `extends` chain of a tsconfig/jsconfig looking for `compilerOptions.paths`.
 * Resolves relative paths and package references. Caps at MAX_EXTENDS_DEPTH.
 */
async function followExtendsChain(
  configPath: string,
  _projectPath: string,
  recorder?: GraphInputRecorder,
): Promise<PathAliases> {
  const visited = new Set<string>();
  let currentPath = configPath;

  for (let depth = 0; depth < MAX_EXTENDS_DEPTH; depth++) {
    const resolved = path.resolve(currentPath);
    if (visited.has(resolved)) break; // circular
    visited.add(resolved);

    let raw: string;
    try {
      raw = await fs.readFile(resolved, "utf-8");
    } catch {
      recorder?.unreadable(resolved);
      break; // file not found
    }
    // Every config the chain reaches shapes the aliases, including one outside
    // the project — a base config in a parent directory is recorded relative
    // to the root and read back through the same relative path.
    recorder?.read(resolved, raw);

    const config = parseTsconfigJson(raw);
    if (!config) break;

    // Check if this config has paths
    const co = config.compilerOptions as Record<string, unknown> | undefined;
    if (co?.paths) {
      const configDir = path.dirname(resolved);
      return parsePathAliases(raw, configDir);
    }

    // Follow extends
    const extendsValue = config.extends;
    if (!extendsValue || typeof extendsValue !== "string") break;

    const configDir = path.dirname(resolved);
    if (extendsValue.startsWith(".")) {
      // Relative path: "./tsconfig.base.json"
      currentPath = path.resolve(configDir, extendsValue);
      // Add .json if missing
      if (!currentPath.endsWith(".json")) currentPath += ".json";
    } else {
      // Package reference: "@tsconfig/node20/tsconfig.json"
      // Try to resolve from node_modules
      try {
        currentPath = path.resolve(configDir, "node_modules", extendsValue);
        if (!currentPath.endsWith(".json")) currentPath += ".json";
      } catch {
        break;
      }
    }
  }

  return EMPTY_ALIASES;
}

/**
 * Parse tsconfig/jsconfig JSON with comment stripping.
 * Returns null if parsing fails.
 */
export function parseTsconfigJson(jsonContent: string): Record<string, unknown> | null {
  try {
    const stripped = jsonContent.replace(
      /"(?:[^"\\]|\\.)*"|\/\/.*$|\/\*[\s\S]*?\*\//gm,
      (match) => match.startsWith('"') ? match : "",
    );
    return JSON.parse(stripped);
  } catch {
    return null;
  }
}

/**
 * Parse path aliases from tsconfig/jsconfig JSON content.
 * Handles JSON with comments (// and /* ... *\/) which tsconfig allows.
 */
export function parsePathAliases(jsonContent: string, projectPath: string): PathAliases {
  const entries = new Map<string, string[]>();

  try {
    const config = parseTsconfigJson(jsonContent);
    if (!config) return EMPTY_ALIASES;

    const compilerOptions = config.compilerOptions as Record<string, unknown> | undefined;
    if (!compilerOptions?.paths) return EMPTY_ALIASES;

    const baseUrl = (compilerOptions.baseUrl as string) ?? ".";
    const baseDir = path.resolve(projectPath, baseUrl);
    const paths = compilerOptions.paths as Record<string, string[]>;

    for (const [pattern, targets] of Object.entries(paths)) {
      if (!Array.isArray(targets) || targets.length === 0) continue;

      // Convert wildcard pattern: "$lib/*" → prefix "$lib/"
      // Convert exact pattern: "~" → prefix "~"
      const prefix = pattern.endsWith("/*")
        ? pattern.slice(0, -1)  // "$lib/*" → "$lib/"
        : pattern;

      const resolvedTargets: string[] = [];
      for (const target of targets) {
        if (typeof target !== "string") continue;
        // Convert wildcard target: "src/lib/*" → "src/lib/"
        // Convert exact target: "./src" → "src"
        const targetPath = target.endsWith("/*")
          ? target.slice(0, -1)  // "src/lib/*" → "src/lib/"
          : target;

        // Resolve relative to baseUrl, then make relative to project root
        const absolute = path.resolve(baseDir, targetPath);
        const relative = path.relative(projectPath, absolute);
        resolvedTargets.push(relative);
      }

      if (resolvedTargets.length > 0) {
        entries.set(prefix, resolvedTargets);
      }
    }
  } catch (err) {
    logger.warn("Failed to parse path aliases from config", { error: String(err) });
  }

  return { entries };
}
