// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited
import fs from "node:fs";
import path from "node:path";
import ignore, { type Ignore } from "ignore";
import { logger } from "./logger.js";

const DEFAULT_IGNORE_PATTERNS = [
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  "__pycache__",
  "*.pyc",
  ".venv",
  "venv",
  "env",
  ".tox",
  "target",
  "_build",
  "deps",
  "bin/Debug",
  "bin/Release",
  "obj",
  ".gradle",
  ".idea",
  ".vscode",
  ".vs",
  "*.min.js",
  "*.min.css",
  "*.map",
  "*.lock",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "Cargo.lock",
  "Gemfile.lock",
  "poetry.lock",
  "*.log",
  "*.tmp",
  "*.swp",
  "*.swo",
  ".DS_Store",
  "Thumbs.db",
  "coverage",
  ".nyc_output",
  ".cache",
  ".parcel-cache",
  ".turbo",
  "vendor",
  ".dart_tool",
];

/**
 * Build an ignore filter for a project directory.
 *
 * Combines (in order):
 *   1. Built-in defaults (node_modules, .git, dist, build, lock files, etc.)
 *   2. .gitignore files (root + nested) — unless RESPECT_GITIGNORE=false
 *   3. .socraticodeignore — optional project-specific exclusions
 *
 * Set env RESPECT_GITIGNORE=false to skip .gitignore processing entirely.
 */
export function createIgnoreFilter(projectPath: string): Ignore {
  const ig = ignore();

  // Default patterns
  ig.add(DEFAULT_IGNORE_PATTERNS);

  // .gitignore (unless explicitly disabled)
  const respectGitignore = (process.env.RESPECT_GITIGNORE ?? "true").toLowerCase() !== "false";

  if (respectGitignore) {
    // Root .gitignore
    const rootGitignore = path.join(projectPath, ".gitignore");
    if (fs.existsSync(rootGitignore)) {
      const content = fs.readFileSync(rootGitignore, "utf-8");
      ig.add(content);
    }

    // Find and process nested .gitignore files
    findNestedGitignores(projectPath, projectPath, ig);
  } else {
    logger.info("Skipping .gitignore processing (RESPECT_GITIGNORE=false)");
  }

  // .socraticodeignore
  const socraticodeignorePath = path.join(projectPath, ".socraticodeignore");

  if (fs.existsSync(socraticodeignorePath)) {
    const content = fs.readFileSync(socraticodeignorePath, "utf-8");
    ig.add(content);
    logger.info("Loaded .socraticodeignore rules");
  }

  return ig;
}

/**
 * Recursively find .gitignore files in subdirectories and add their rules
 * with proper relative path prefixing.
 */
function findNestedGitignores(rootPath: string, currentPath: string, ig: Ignore): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(currentPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const dirName = entry.name;
    // Skip directories we know should be ignored
    if (dirName === "node_modules" || dirName === ".git" || dirName === ".svn" ||
        dirName === ".hg" || dirName === "dist" || dirName === "build" ||
        dirName === "__pycache__" || dirName === ".venv" || dirName === "venv" ||
        dirName === "target" || dirName === ".gradle" || dirName === ".next") {
      continue;
    }

    const dirPath = path.join(currentPath, dirName);
    const gitignorePath = path.join(dirPath, ".gitignore");

    if (fs.existsSync(gitignorePath)) {
      const content = fs.readFileSync(gitignorePath, "utf-8");
      const relDir = path.relative(rootPath, dirPath).split(path.sep).join("/");

      // Prefix each pattern with the relative directory
      const lines = content.split("\n");
      const prefixedPatterns: string[] = [];
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;

        // Handle negation patterns
        if (trimmed.startsWith("!")) {
          prefixedPatterns.push(`!${relDir}/${trimmed.slice(1)}`);
        } else {
          prefixedPatterns.push(`${relDir}/${trimmed}`);
        }
      }

      if (prefixedPatterns.length > 0) {
        ig.add(prefixedPatterns);
      }
    }

    // Recurse into subdirectory
    findNestedGitignores(rootPath, dirPath, ig);
  }
}

/**
 * Check if a relative path should be ignored.
 */
export function shouldIgnore(ig: Ignore, relativePath: string): boolean {
  const normalized = relativePath.split(path.sep).join("/");
  return ig.ignores(normalized);
}
