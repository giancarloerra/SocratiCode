// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited

/**
 * I/O wrapper around the pure {@link detectExtensionlessExtension} detector.
 *
 * Kept as a leaf module (imports only the leaf modules constants + logger) so
 * the indexer, code graph, watcher, and incremental symbol-graph paths can all
 * consult content detection without introducing an import cycle.
 */

import { constants as fsConstants } from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  DETECT_HEAD_BYTES,
  detectExtensionlessExtension,
  indexExtensionlessEnabled,
  SPECIAL_FILES,
} from "../constants.js";
import { logger } from "./logger.js";

/**
 * Read up to `maxBytes` bytes from the start of a file and decode as UTF-8.
 * Reads only the head (not the whole file) so scanning large extensionless
 * binaries/data files stays cheap. Opens non-blocking and throws for a
 * non-regular file (FIFO/socket/device) so a mistyped or swapped path can't
 * block the open; may also throw on open/read errors.
 */
export async function readFileHead(absolutePath: string, maxBytes = DETECT_HEAD_BYTES): Promise<string> {
  // Open non-blocking and reject non-regular fds. Opening a FIFO/device for read
  // can block indefinitely; an lstat-then-open guard upstream only narrows that
  // race (the path can still become a FIFO in between). O_NONBLOCK makes the open
  // return immediately, then fstat drops anything that is not a regular file
  // before we read. O_NONBLOCK has no effect on regular-file reads.
  const fh = await fsp.open(absolutePath, fsConstants.O_RDONLY | fsConstants.O_NONBLOCK);
  try {
    if (!(await fh.stat()).isFile()) {
      throw Object.assign(new Error(`not a regular file: ${absolutePath}`), { code: "ENOTREG" });
    }
    const buf = Buffer.alloc(maxBytes);
    const { bytesRead } = await fh.read(buf, 0, maxBytes, 0);
    return buf.subarray(0, bytesRead).toString("utf-8");
  } finally {
    await fh.close();
  }
}

/**
 * Detect the canonical extension of source text already held in memory, scoring
 * the same window {@link readFileHead} reads from disk: the first
 * {@link DETECT_HEAD_BYTES} **bytes** of UTF-8, not characters.
 *
 * The byte window is load-bearing, not incidental. `detectExtensionlessExtension`
 * counts pattern hits, so a larger window can change its answer; a character
 * slice of a file with multibyte text near the top would cover more content than
 * the disk head and could disagree about identical bytes. Re-encoding keeps the
 * two answers comparable — including at the boundary, where each decodes a
 * character split by the cut to U+FFFD.
 *
 * Content that was lossily decoded — invalid UTF-8 replaced by U+FFFD — re-encodes
 * to at least as many bytes as it came from, three per U+FFFD, so it scores a
 * window no longer than the raw file's. A decoded string cannot recover the bytes
 * it came from, so the in-memory and on-disk sides cannot be made to score the
 * same span of such a file; the disk-side resolver routes through this helper so
 * both settle on the narrower window instead of disagreeing. The window is
 * therefore about {@link DETECT_HEAD_BYTES} / 3 characters for wholly lossy
 * content, and a latin-1 file whose only code markers sit past that point reads as
 * "not code" wherever this window is scored.
 *
 * The leading character slice only bounds the allocation, keeping a whole-file
 * encode off this path: the first N characters always encode to at least N
 * bytes, so slicing to N characters cannot drop anything inside the N-byte
 * window.
 */
export function detectExtensionFromSource(source: string): string | null {
  const head = Buffer.from(source.slice(0, DETECT_HEAD_BYTES), "utf-8")
    .subarray(0, DETECT_HEAD_BYTES)
    .toString("utf-8");
  return detectExtensionlessExtension(head);
}

/**
 * Like {@link resolveExtensionlessExtension} but **throws** on a read/stat
 * failure instead of collapsing it to `null`, so a caller that must not conflate
 * "unreadable" with "not code" can tell them apart — e.g. the incremental
 * symbol-graph purge, which would otherwise drop a still-valid payload on a
 * transient I/O blip. Returns `null` only for a genuine non-match: detection
 * disabled, a {@link SPECIAL_FILES} name, a non-regular file, or content that is
 * not indexable code.
 */
export async function resolveExtensionlessExtensionStrict(absolutePath: string): Promise<string | null> {
  return (await resolveExtensionlessDetectionStrict(absolutePath)).extension;
}

/** What a head-read decided, together with the bytes it decided on. */
export interface ExtensionlessDetection {
  /** The canonical extension detected, or null for a genuine non-match. */
  extension: string | null;
  /**
   * The head the answer was scored on, or null when nothing was read at all —
   * detection disabled, a {@link SPECIAL_FILES} name, or a non-regular file.
   *
   * A caller that records what the build consumed needs this: the answer was
   * derived from these bytes and from nothing else, so they are the thing to
   * watch. Watching the file's size instead would miss a same-length edit that
   * flips the answer (`# hello!!` becoming `#!/bin/sh`), and watching its whole
   * content would hash bytes the decision never saw.
   */
  head: string | null;
  /**
   * Whether the head-read was attempted and threw, as opposed to never being
   * attempted. A caller recording what the build consumed needs the two apart:
   * a file it could not open may start being code the moment it can be read,
   * while one it never opened (detection off, a {@link SPECIAL_FILES} name, a
   * FIFO) is not an input at all.
   */
  unreadable: boolean;
}

/**
 * Like {@link resolveExtensionlessExtensionStrict}, but also reports the head
 * the detection ran on. Throws on a read/stat failure for the same reason the
 * strict variant does.
 */
export async function resolveExtensionlessDetectionStrict(
  absolutePath: string,
): Promise<ExtensionlessDetection> {
  const nothingRead: ExtensionlessDetection = { extension: null, head: null, unreadable: false };
  if (!indexExtensionlessEnabled()) return nothingRead;
  // SPECIAL_FILES (Makefile, Dockerfile, …) are extensionless but handled by
  // name; never route them through content detection, so the graph paths stay
  // consistent with the index (getIndexableFiles filters them via isIndexableFile)
  // and a shell-recipe Makefile is not mis-graphed as a shell node.
  if (SPECIAL_FILES.has(path.basename(absolutePath))) return nothingRead;
  // Only a regular file can be head-read. glob({nodir:true}) still yields
  // FIFOs/sockets/devices, and opening a FIFO for read blocks until a writer
  // appears — which would wedge the whole scan. lstat and drop non-regular
  // files (the watcher's isIndexableFile guards the same way).
  const stats = await fsp.lstat(absolutePath);
  if (!stats.isFile()) return nothingRead;
  const head = await readFileHead(absolutePath);
  return { extension: detectExtensionFromSource(head), head, unreadable: false };
}

/**
 * Detect the canonical extension of an extensionless file by head content, or
 * `null` when detection is disabled, the name is a {@link SPECIAL_FILES} entry,
 * the file is unreadable, or the content is not indexable code. Callers that
 * need graph-eligibility (grammar-bearing only) additionally check
 * `getAstGrepLang(result) !== null`.
 */
export async function resolveExtensionlessExtension(absolutePath: string): Promise<string | null> {
  return (await resolveExtensionlessDetection(absolutePath)).extension;
}

/**
 * {@link resolveExtensionlessExtension}, reporting the head the answer was
 * scored on so a caller can record what it consumed. A failure reads as
 * "nothing was read", which is what it was.
 */
export async function resolveExtensionlessDetection(
  absolutePath: string,
): Promise<ExtensionlessDetection> {
  try {
    return await resolveExtensionlessDetectionStrict(absolutePath);
  } catch (err) {
    // ENOENT (file deleted/renamed between scan and read) is an expected skip.
    // A non-ENOENT fault (EACCES, EIO) means a possibly-code file we could not
    // read — surface it at debug so it is not silently confused with "not code".
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
      logger.debug("Could not read extensionless file head (skipping)", {
        absolutePath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return { extension: null, head: null, unreadable: true };
  }
}
