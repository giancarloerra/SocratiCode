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
  // Anchored, unlike the rest: `venv` and `env` are a virtualenv's names at the
  // root of a project, and ordinary module names anywhere below it. Unanchored
  // they matched at any depth and quietly deleted source — `clap_complete/src/env/`
  // is compiled by cargo and listed in its dep-info, yet was not even a node of
  // the graph, while `pub mod engine;` two lines above it drew its edges; the
  // same for `tracing-subscriber/src/filter/env/`. In a 245-crate registry
  // sample they are the only two, which is the point: the loss is total for the
  // crate it hits and invisible everywhere else.
  //
  // A virtualenv nested deeper stays out by the two routes that already cover
  // it: `.venv`, the common spelling, is still matched at any depth, and a
  // checked-in project lists its own in `.gitignore`, which this filter reads.
  "/venv",
  "/env",
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
 * What `createIgnoreFilter` answers with: one question, on a path relative to
 * the project root and written with forward slashes.
 *
 * Two kinds of rule stand behind it. Patterns — the defaults, `.gitignore`
 * files and `.socraticodeignore` — are gitignore syntax and go to the `ignore`
 * package. The environments the walk *discovers* are not patterns, they are
 * directories that exist, and they are kept as the literal prefixes they are.
 * Writing one as a pattern meant escaping it, and the escape is only as good as
 * the package's reading of it: `\?` is not understood by the installed
 * version, so an environment at `env?/` was scanned despite its marker
 * (review finding), while `\[`, `\*`, `\!`, `\#` and `\\` happened to work.
 * A prefix compare has no syntax to get wrong.
 *
 * The one thing the pattern route allowed that a bare prefix would not: a
 * negation written later — `!tests/fixtures/sample-venv/**` in
 * `.socraticodeignore`, for a checked-in fixture that any tool parsing
 * `pyvenv.cfg` has — re-included the environment. That precedence is kept
 * (review finding): a path an explicit negation claims is not excluded by a
 * discovered prefix either. `unignored` is what the package answers exactly
 * when a negative rule spoke last and no positive one stands over it.
 */
export interface IgnoreFilter {
  /** Whether the path, relative to the project root, is excluded. */
  ignores(relativePath: string): boolean;
  /**
   * Whether the path, with or without its trailing slash, is the root of an
   * environment the walk discovered. The watcher asks this of a directory
   * event, since an environment moved away arrives as one event on the
   * directory and nothing on the marker inside it.
   */
  isEnvironmentRoot(relativePath: string): boolean;
  /**
   * The ignore files this filter read, project-relative and in the order they
   * were applied, each with the bytes it was built from.
   *
   * A filter's answers are read off the tree once, when it is built, so
   * anything caching a walk this filter shaped has to know which files to
   * watch — the code graph records them as build inputs. The content comes
   * with the path rather than being read again by the caller: a second read
   * would both cost a second pass and leave a window in which the file changes
   * between the two, recording a state the walk never actually ran under.
   * Reported from where they are read, so a new source cannot be added without
   * appearing here.
   */
  sources: IgnoreSource[];
  /**
   * The environment roots the walk discovered, each as `dir/` relative to the
   * project root.
   *
   * Reported for the same reason as {@link IgnoreFilter.sources}: they are an
   * input to what this filter answers, and unlike the ignore files they are
   * not files at all — a directory is an environment because of a marker
   * *inside* it, somewhere nothing that reads the tree will ever look again.
   * A caller caching a walk has to watch them, or a `pyvenv.cfg` deleted
   * re-admits a whole subtree with nothing observable having changed.
   */
  environments: string[];
}

/** One ignore file a filter was built from. */
export interface IgnoreSource {
  /** Project-relative, forward-slashed. */
  path: string;
  /** The bytes the filter was built from. */
  content: string;
}

/**
 * Build an ignore filter for a project directory.
 *
 * Combines (in order):
 *   1. Built-in defaults (node_modules, .git, dist, build, lock files, etc.)
 *   2. .gitignore files (root + nested) — unless RESPECT_GITIGNORE=false
 *   3. Python and conda environments found by their markers, as literal prefixes
 *   4. .socraticodeignore — optional project-specific exclusions
 *
 * Set env RESPECT_GITIGNORE=false to skip .gitignore processing entirely.
 *
 * The two status lines below log at debug, not info: context-artifact reads
 * build a filter per artifact on every staleness check, so an info line here
 * would fire once per artifact per context search.
 */
export function createIgnoreFilter(projectPath: string): IgnoreFilter {
  const ig = ignore();
  const environments: string[] = [];
  const sources: IgnoreSource[] = [];

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
      sources.push({ path: ".gitignore", content });
    }
  } else {
    logger.debug("Skipping .gitignore processing (RESPECT_GITIGNORE=false)");
  }

  // The same walk finds the nested .gitignore files and the virtualenvs, and it
  // runs whether or not .gitignore is respected: a virtualenv is not a project
  // preference, it is a directory of installed libraries that no reading of the
  // tree should call source.
  scanNestedIgnoreSources(projectPath, projectPath, ig, environments, respectGitignore, sources);

  // .socraticodeignore
  const socraticodeignorePath = path.join(projectPath, ".socraticodeignore");

  if (fs.existsSync(socraticodeignorePath)) {
    const content = fs.readFileSync(socraticodeignorePath, "utf-8");
    ig.add(content);
    sources.push({ path: ".socraticodeignore", content });
    logger.debug("Loaded .socraticodeignore rules");
  }

  return {
    ignores: (relativePath) => {
      const byPattern = ig.test(relativePath);
      if (byPattern.unignored) return false;
      return byPattern.ignored || isUnderAnEnvironment(relativePath, environments);
    },
    // Normalised here, as `shouldIgnore` normalises for `ignores`: a caller on
    // Windows hands over `backend\env`, and the roots are kept with `/`
    // (review finding).
    isEnvironmentRoot: (relativePath) => {
      const normalized = relativePath.split(path.sep).join("/");
      return environments.includes(normalized.endsWith("/") ? normalized : `${normalized}/`);
    },
    sources,
    environments,
  };
}

/**
 * Whether a change at this path can change what the filter answers: it is one
 * of the environment markers the walk looks for, or lies inside one.
 *
 * The rules a filter carries are read off the tree once, when it is built, and
 * an environment is recognised by a file or directory that may appear or
 * vanish while the tree is being watched. A watcher that ran every event
 * through its filter first never saw either: a new `pyvenv.cfg` is not an
 * indexable file, and the one being deleted sits under a directory the stale
 * filter still excludes (review finding). The name is enough here — the event
 * only schedules a reconciliation, and the rebuilt filter reads the shape.
 * `conda-meta` is matched as any segment, since the directory's creation
 * arrives with the files inside it.
 */
export function isEnvironmentMarker(relativePath: string): boolean {
  const segments = relativePath.split(path.sep).join("/").split("/");
  return segments[segments.length - 1] === "pyvenv.cfg" || segments.includes("conda-meta");
}

/**
 * Whether the path is one of the discovered environment directories or lies
 * beneath one. `environments` holds each as `dir/` relative to the root, so
 * `env?/lib/dep.py` and the directory itself, asked as `env?/` or `env?`, all
 * answer true, and `env?.d/x.py` does not.
 */
function isUnderAnEnvironment(relativePath: string, environments: string[]): boolean {
  return environments.some(
    (dir) => relativePath.startsWith(dir) || relativePath === dir.slice(0, -1),
  );
}

/**
 * What the path is, or null when the question cannot be answered.
 *
 * The `throwIfNoEntry` option only covers a missing entry; an unreadable parent
 * directory still throws EACCES, and the `existsSync` this replaced threw for
 * nothing at all. A marker we cannot stat is simply not a marker.
 *
 * `lstat`, not `stat`: a symbolic link is answered as a link, never as what it
 * points to. That is the same rule the walk applies one level up — a
 * `readdirSync` entry that is a link is not a directory to it, so a linked
 * `venv/` is never entered — and the two questions should not disagree. A link
 * named `pyvenv.cfg` in a source directory otherwise excluded that whole
 * directory (review finding); and no tool writes its marker as a link, so
 * nothing real is given up.
 */
function statOrNull(candidate: string): fs.Stats | null {
  try {
    return fs.lstatSync(candidate, { throwIfNoEntry: false }) ?? null;
  } catch {
    return null;
  }
}

/** Whether the path is a file, answering false for a directory or nothing. */
function isFile(candidate: string): boolean {
  return statOrNull(candidate)?.isFile() ?? false;
}

/** Whether the path is a directory, answering false for a file or nothing. */
function isDirectory(candidate: string): boolean {
  return statOrNull(candidate)?.isDirectory() ?? false;
}

/**
 * Whether the directory is an environment: it carries a marker, in the shape
 * its tool writes it. Two markers, because two tools build these directories —
 * `pyvenv.cfg` for a PEP 405 virtualenv, `conda-meta/` for a conda
 * environment. Both hold installed libraries and neither is source.
 *
 * The shape matters. Merely existing is not enough: a source directory holding
 * a file named `conda-meta` would otherwise disappear whole, and a discarded
 * source file costs far more than a kept one.
 *
 * Shared with the watcher, which asks it of a directory that has just
 * appeared: an environment moved into place arrives as one event on the
 * directory, and nothing on the marker inside it.
 */
export function isEnvironmentDirectory(dirPath: string): boolean {
  return isFile(path.join(dirPath, "pyvenv.cfg")) || isDirectory(path.join(dirPath, "conda-meta"));
}

/**
 * Walk the subdirectories once, collecting what the tree itself says should be
 * ignored: the rules of every nested .gitignore, and every environment
 * directory holding installed libraries.
 *
 * A virtualenv is recognised by the `pyvenv.cfg` PEP 405 puts at its root, not
 * by its directory's name. The name alone cannot do it: `venv` and `env` are
 * also ordinary module names, and matching them at any depth deleted real
 * source — `clap_complete/src/env/`, which cargo compiles, was not even a node.
 * They are matched at the project root only now, and the proof covers what that
 * anchoring gives up: a virtualenv nested deeper, whatever it is called.
 *
 * The extra cost is up to two `lstat` per directory visited — `pyvenv.cfg`,
 * then `conda-meta` — in a walk that was already making an `existsSync` for
 * `.gitignore`. Measured on a 1,916-directory registry cache: 121 ms for the
 * whole filter against 125 ms on `main`, inside the noise.
 */
function scanNestedIgnoreSources(
  rootPath: string,
  currentPath: string,
  ig: Ignore,
  environments: string[],
  readGitignores: boolean,
  sources: IgnoreSource[],
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(currentPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const dirName = entry.name;
    const dirPath = path.join(currentPath, dirName);

    // Checked before the skip list below, which would otherwise walk past a
    // `venv/` without ever looking inside it. See `isEnvironmentDirectory` for
    // the two markers and why their shape matters.
    if (isEnvironmentDirectory(dirPath)) {
      const relDir = path.relative(rootPath, dirPath).split(path.sep).join("/");
      // Kept as the literal prefix it is, never as a pattern — see
      // `IgnoreFilter`. A prefix is anchored by nature: `toolbox/` here is the
      // directory under the root and nothing else, where the pattern
      // `toolbox/` once matched that name at every depth and deleted
      // `packages/app/toolbox/` too, in any language.
      if (relDir) environments.push(`${relDir}/`);
      continue;
    }

    // Skip directories we know should be ignored.
    //
    // `venv` is not among them by name any more, and that is the same decision
    // as anchoring the default patterns rather than a separate one. Skipping it
    // wherever it stood stopped this walk at any directory so called, so it never reached
    // the marker of a real environment nested under one:
    // `crates/venv/backend/env/` had its installed libraries indexed, because
    // the walk turned back two levels above the `pyvenv.cfg` that would have
    // excluded them, and a nested `.gitignore` below it stopped being read.
    //
    // `.venv` stays: the default patterns ignore that spelling at every depth,
    // so descending into it would look for a marker in a directory already
    // gone. The same argument holds for `venv` and `env` directly under the
    // root, which `/venv` and `/env` above already exclude — a virtualenv old
    // enough to have written no `pyvenv.cfg` would otherwise be walked to its
    // `site-packages` reading `.gitignore` files for nothing. Only at the root:
    // one level down those names are ordinary modules again.
    if (dirName === "node_modules" || dirName === ".git" || dirName === ".svn" ||
        dirName === ".hg" || dirName === "dist" || dirName === "build" ||
        dirName === "__pycache__" || dirName === ".venv" ||
        dirName === "target" || dirName === ".gradle" || dirName === ".next" ||
        (currentPath === rootPath && (dirName === "venv" || dirName === "env"))) {
      continue;
    }

    const gitignorePath = path.join(dirPath, ".gitignore");

    if (readGitignores && fs.existsSync(gitignorePath)) {
      const content = fs.readFileSync(gitignorePath, "utf-8");
      const relDir = path.relative(rootPath, dirPath).split(path.sep).join("/");
      // Recorded on the read, not on the patterns: a file contributing nothing
      // today is still a file whose next line changes what this filter answers.
      sources.push({ path: `${relDir}/.gitignore`, content });

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
    scanNestedIgnoreSources(rootPath, dirPath, ig, environments, readGitignores, sources);
  }
}

/**
 * Check if a relative path should be ignored.
 */
export function shouldIgnore(ig: IgnoreFilter, relativePath: string): boolean {
  const normalized = relativePath.split(path.sep).join("/");
  return ig.ignores(normalized);
}
