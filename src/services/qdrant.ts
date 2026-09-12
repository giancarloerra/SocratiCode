// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giancarlo Erra - Altaire Limited
import { createHash } from "node:crypto";
import { QdrantClient } from "@qdrant/js-client-rest";
import { QDRANT_API_KEY, QDRANT_COLLECTION_PREFIX, QDRANT_HOST, QDRANT_PORT, QDRANT_URL, resolveQdrantPort, SOCRATICODE_VERSION } from "../constants.js";
import type { ArtifactIndexState, CodeGraph, FileChunk, SearchResult } from "../types.js";
import { getEmbeddingConfig } from "./embedding-config.js";
import { generateEmbeddings, generateQueryEmbedding, prepareDocumentText } from "./embeddings.js";
import type { GraphInputRecord } from "./graph-inputs.js";
import {
  documentTextProfile,
  type EffectiveIndexProfile,
  ensureEffectiveEmbeddingReady,
  parseEffectiveIndexProfile,
  queryProfileKey,
  resolveEffectiveIndexProfile,
  withEffectiveEmbedding,
} from "./index-profile.js";
import { logger } from "./logger.js";
import { ensureQdrantClientCompatibility } from "./qdrant-client-compat.js";

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

/** Retry an async operation with exponential backoff */
async function withRetry<T>(
  operation: () => Promise<T>,
  label: string,
  maxRetries = MAX_RETRIES,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        const delay = BASE_DELAY_MS * 2 ** (attempt - 1);
        logger.warn(`${label} failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms`, {
          error: err instanceof Error ? err.message : String(err),
        });
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

/**
 * Render a Qdrant client error including the reason the server actually gave.
 *
 * `@qdrant/js-client-rest` builds an `ApiError` whose `message` is only the HTTP
 * status text — a 400 reads as the bare, useless "Bad Request" — while the
 * server's explanation ("JSON payload (N bytes) is larger than allowed …") sits
 * in `err.data.status.error`. Logging `err.message` alone therefore throws away
 * the one part a user can act on, so every symbol-graph failure looked
 * identical. Appends that reason when present, and looks through a `cause`
 * chain so an error already wrapped by {@link wrapQdrantError} still resolves.
 */
export function describeQdrantError(err: unknown): string {
  const base = err instanceof Error ? err.message : String(err);
  // Walk the cause chain (bounded — these are never deep) looking for the
  // client's `data` envelope, which may sit on the error or on its cause.
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    const reason = (current as { data?: { status?: { error?: unknown } } })?.data?.status?.error;
    if (typeof reason === "string" && reason.length > 0) {
      return base.includes(reason) ? base : `${base}: ${reason}`;
    }
    current = (current as { cause?: unknown })?.cause;
  }
  return base;
}

/**
 * Wrap a Qdrant client error with operation context so callers further up the
 * stack (and ultimately the MCP response) get a useful message instead of a
 * bare "Internal Server Error". Preserves the original error via `cause` and
 * surfaces the HTTP status code if the client attached one.
 *
 * Used at every catch-and-rethrow site whose intent is "let this propagate so
 * callers don't mistake a transient blip for missing data". Wrapping at that
 * boundary turns "Internal Server Error" into something like:
 *   "loadProjectHashes(socraticode_<hash>) failed [status 500]: Internal Server Error"
 */
function wrapQdrantError(
  operation: string,
  context: Record<string, unknown>,
  err: unknown,
): Error {
  const original = err instanceof Error ? err.message : String(err);
  const status =
    (err as { status?: number })?.status ?? (err as { statusCode?: number })?.statusCode;
  const ctxStr = Object.entries(context)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(", ");
  const statusStr = status ? ` [status ${status}]` : "";
  const wrapped = new Error(`${operation}(${ctxStr}) failed${statusStr}: ${original}`);
  (wrapped as Error & { cause?: unknown }).cause = err;
  return wrapped;
}

let client: QdrantClient | null = null;

export function getClient(): QdrantClient {
  if (!client) {
    const qdrantBaseUrl =
      QDRANT_URL ?? `${QDRANT_API_KEY ? "https" : "http"}://${QDRANT_HOST}:${QDRANT_PORT}`;
    ensureQdrantClientCompatibility(qdrantBaseUrl);
    client = new QdrantClient(
      QDRANT_URL
        ? {
            url: QDRANT_URL,
            port: resolveQdrantPort(QDRANT_URL),
            ...(QDRANT_API_KEY ? { apiKey: QDRANT_API_KEY } : {}),
            checkCompatibility: false,
          }
        : {
            host: QDRANT_HOST,
            port: QDRANT_PORT,
            ...(QDRANT_API_KEY ? { apiKey: QDRANT_API_KEY } : {}),
            checkCompatibility: false,
          },
    );
  }
  return client;
}

/** In-flight code-collection initialization, keyed by collection name. */
const collectionEnsureInFlight = new Map<string, Promise<void>>();

/** Create a collection if needed and ensure its required payload indexes. */
async function ensureCollectionOnce(name: string): Promise<void> {
  const qdrant = getClient();
  const collections = await qdrant.getCollections();
  const exists = collections.collections.some((c) => c.name === name);

  if (!exists) {
    const { embeddingDimensions } = getEmbeddingConfig();
    try {
      await qdrant.createCollection(name, {
        vectors: {
          dense: {
            size: embeddingDimensions,
            distance: "Cosine",
          },
        },
        sparse_vectors: {
          bm25: {
            modifier: "idf",
          },
        },
        optimizers_config: {
          default_segment_number: 2,
        },
        on_disk_payload: true,
      });
    } catch (err) {
      // Another process may create the same collection after our membership
      // check. That is the desired end state; every other failure must surface.
      if (!isAlreadyExistsError(err)) throw err;
    }
  }

  // A previous or concurrent attempt may have created the collection without
  // completing all indexes. Ensure every required index on every initialization.
  await Promise.all([
    createPayloadIndexIfMissing(name, "filePath"),
    createPayloadIndexIfMissing(name, "relativePath"),
    createPayloadIndexIfMissing(name, "language"),
    createPayloadIndexIfMissing(name, "contentHash"),
  ]);
}

/**
 * Ensure a code collection is ready, sharing one attempt between concurrent
 * callers in this process. Failed attempts are removed so a later call retries.
 */
export async function ensureCollection(name: string): Promise<void> {
  const current = collectionEnsureInFlight.get(name);
  if (current) return current;

  const attempt = ensureCollectionOnce(name);
  collectionEnsureInFlight.set(name, attempt);
  try {
    await attempt;
  } finally {
    if (collectionEnsureInFlight.get(name) === attempt) {
      collectionEnsureInFlight.delete(name);
    }
  }
}

/** True when an error means "someone else already created it" — safe to ignore. */
export function isAlreadyExistsError(err: unknown): boolean {
  const status =
    (err as { status?: number })?.status ?? (err as { statusCode?: number })?.statusCode;
  const message = err instanceof Error ? err.message : String(err);
  return status === 409 || /already exists/i.test(message);
}

/** True when a Qdrant resource is absent rather than temporarily unavailable. */
function isNotFoundError(err: unknown): boolean {
  const status =
    (err as { status?: number })?.status ?? (err as { statusCode?: number })?.statusCode;
  const message = err instanceof Error ? err.message : String(err);
  return status === 404 || /not found|doesn't exist/i.test(message);
}

/**
 * Create a payload index, ignoring only the "it is already there" conflict.
 *
 * Every other failure propagates: a 503 leaves the collection without the index,
 * and a caller that swallows it can never tell that it still has work to do.
 */
async function createPayloadIndexIfMissing(collName: string, fieldName: string): Promise<void> {
  const qdrant = getClient();
  try {
    await qdrant.createPayloadIndex(collName, {
      field_name: fieldName,
      field_schema: "keyword",
    });
  } catch (err) {
    if (!isAlreadyExistsError(err)) throw err;
    // Index already exists — that is the end state we wanted.
  }
}

/** Create a payload index on a collection (best effort — never throws) */
export async function ensurePayloadIndex(collName: string, fieldName: string): Promise<void> {
  try {
    await createPayloadIndexIfMissing(collName, fieldName);
  } catch (err) {
    // Callers of this helper index their payload opportunistically: a missing
    // index costs filter performance but does not make their write incorrect.
    logger.debug("ensurePayloadIndex failed (ignored)", {
      collection: collName,
      field: fieldName,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Delete a collection */
export async function deleteCollection(name: string): Promise<void> {
  const qdrant = getClient();
  try {
    logger.warn("Deleting Qdrant collection", { collection: name });
    await qdrant.deleteCollection(name);
    logger.info("Deleted Qdrant collection", { collection: name });
  } catch (err) {
    // collection may not exist
    logger.info("deleteCollection: collection may not exist (ignored)", {
      collection: name,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Scroll one payload field across an entire collection.
 *
 * Enumeration has to be complete, because callers use it to decide what exists.
 * So this follows the cursor rather than taking the first page, retries a
 * transient failure instead of returning a short answer, and stops if the
 * cursor ever fails to advance — an unbounded cursor loop cannot be caught,
 * since an infinite loop never throws.
 *
 * Only `field` is fetched. A point can carry a large payload — a project's
 * entire path-to-hash map, in the metadata collection — so an unprojected read
 * scales with the stored data rather than with the number of points.
 */
async function scrollPayloadField(
  collName: string,
  field: string,
  label: string,
  pageSize: number,
  visit: (value: unknown) => void,
): Promise<void> {
  const qdrant = getClient();
  let offset: string | number | Record<string, unknown> | undefined | null;

  do {
    const page = await withRetry(
      () =>
        qdrant.scroll(collName, {
          limit: pageSize,
          with_payload: { include: [field] },
          with_vector: false,
          ...(offset === undefined || offset === null ? {} : { offset }),
        }),
      label,
    );
    for (const point of page.points) visit(point.payload?.[field]);

    const next = page.next_page_offset;
    if (next !== undefined && next !== null && JSON.stringify(next) === JSON.stringify(offset)) {
      logger.warn(`${label}: cursor did not advance, stopping`, { collName });
      break;
    }
    offset = next;
  } while (offset !== undefined && offset !== null);
}

/** List all codebase, codegraph, and context artifact entries.
 * Codebase and context entries are actual collections; codegraph entries come from metadata.
 *
 * The collection-name filters honour `QDRANT_COLLECTION_PREFIX` so when
 * sharing a Qdrant server with other applications or other SocratiCode
 * instances, only this instance's collections are listed. */
export async function listCodebaseCollections(): Promise<string[]> {
  const qdrant = getClient();
  const collections = await qdrant.getCollections();
  const p = QDRANT_COLLECTION_PREFIX;
  const result = collections.collections
    .map((c) => c.name)
    .filter(
      (n) =>
        n.startsWith(`${p}codebase_`) ||
        n.startsWith(`${p}codegraph_`) ||
        n.startsWith(`${p}context_`),
    );

  // Also check metadata for graph and context entries (stored as metadata points, not real collections).
  // Listing is read-only: an absent metadata collection means there are no metadata-only entries yet.
  if (collections.collections.some((collection) => collection.name === METADATA_COLLECTION)) {
    try {
      // This list must be complete: the manage tools present it as the set of
      // indexed projects, and startup reads it to decide what to resume. The
      // previous single unpaginated request silently dropped everything past
      // the hundredth point, and fetched every project's whole hash map to
      // read one string per point.
      const seen = new Set(result);
      await scrollPayloadField(
        METADATA_COLLECTION,
        "collectionName",
        "listCodebaseCollections(metadata)",
        1000,
        (value) => {
          // Narrow rather than cast: optional chaining guards null and
          // undefined, so a non-string here would have reached `.startsWith`
          // and thrown, taking out a read-only listing over one bad point.
          if (typeof value !== "string") return;
          if (
            (value.startsWith(`${p}codegraph_`) || value.startsWith(`${p}context_`)) &&
            !seen.has(value)
          ) {
            seen.add(value);
            result.push(value);
          }
        },
      );
    } catch (err) {
      // Non-fatal: this is a read-only listing and the collections found above
      // stand. Warned rather than logged at info because paging made a partial
      // result more reachable, not less — a failure can now land on page three
      // of five and return a list that looks complete.
      logger.warn("listCodebaseCollections: metadata scroll failed, list may be incomplete", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

/** Upsert chunks into a collection */
export async function upsertChunks(
  collectionName: string,
  chunks: FileChunk[],
  contentHash: string,
  profile: EffectiveIndexProfile,
): Promise<void> {
  if (chunks.length === 0) return;

  const qdrant = getClient();
  const texts = chunks.map((c) =>
    prepareDocumentText(c.content, c.relativePath, documentTextProfile(profile)),
  );
  const embeddings = await withEffectiveEmbedding(profile, () => generateEmbeddings(texts));

  const points = chunks.map((chunk, i) => ({
    id: chunk.id,
    vector: {
      dense: embeddings[i],
      bm25: {
        text: texts[i],
        model: "qdrant/bm25",
      },
    },
    payload: {
      filePath: chunk.filePath,
      relativePath: chunk.relativePath,
      content: chunk.content,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      language: chunk.language,
      type: chunk.type,
      contentHash,
    },
  }));

  // Upsert in batches of 100
  for (let i = 0; i < points.length; i += 100) {
    const batch = points.slice(i, i + 100);
    await withRetry(
      () => qdrant.upsert(collectionName, { points: batch }),
      `Qdrant upsert batch ${Math.floor(i / 100) + 1}`,
    );
  }
}

/** Maximum text length (in characters) sent to Qdrant's server-side BM25 tokenizer.
 * Oversized texts are truncated — the dense vector still captures full semantics,
 * and the stored content payload remains full-length for display. */
const MAX_BM25_TEXT_CHARS = 32_000; // ~32KB

/** Upsert pre-embedded points into a collection (no embedding generation).
 * bm25Text is forwarded to Qdrant's server-side BM25 inference (truncated if too long).
 *
 * A failing batch is retried point by point to isolate the bad point(s). If any
 * point still fails, this throws: a partial write must fail the whole indexing
 * operation.
 *
 * Callers must not treat a partial write as success. A re-indexed file has its
 * previous chunks deleted before this call, so recording it as indexed after a
 * partial failure strands it at zero chunks with a content hash that suppresses
 * every future re-index. Throwing leaves stored hashes and earlier checkpoints
 * untouched, so the next index or update retries the file naturally. */
export async function upsertPreEmbeddedChunks(
  collectionName: string,
  points: Array<{
    id: string;
    vector: number[];
    bm25Text: string;
    payload: Record<string, unknown>;
  }>,
): Promise<void> {
  if (points.length === 0) return;

  const qdrant = getClient();
  const namedPoints = points.map((p) => ({
    id: p.id,
    vector: {
      dense: p.vector,
      bm25: {
        text: p.bm25Text.length > MAX_BM25_TEXT_CHARS
          ? p.bm25Text.slice(0, MAX_BM25_TEXT_CHARS)
          : p.bm25Text,
        model: "qdrant/bm25",
      },
    },
    payload: p.payload,
  }));

  let totalSkipped = 0;
  const skippedPaths = new Set<string>();

  // Upsert in batches of 100, with per-point fallback on failure
  for (let i = 0; i < namedPoints.length; i += 100) {
    const batch = namedPoints.slice(i, i + 100);
    const batchLabel = `Qdrant upsert batch ${Math.floor(i / 100) + 1}`;
    try {
      await withRetry(
        () => qdrant.upsert(collectionName, { points: batch }),
        batchLabel,
      );
    } catch (batchErr) {
      // Batch failed after retries — fall back to one-by-one to isolate the bad point(s)
      logger.warn(`${batchLabel} failed, falling back to per-point upsert to isolate failures`, {
        error: batchErr instanceof Error ? batchErr.message : String(batchErr),
        pointCount: batch.length,
      });
      let skipped = 0;
      for (const point of batch) {
        try {
          await qdrant.upsert(collectionName, { points: [point] });
        } catch (pointErr) {
          skipped++;
          const filePath = point.payload?.relativePath ?? point.payload?.filePath ?? point.id;
          // Record the owning file so the caller can leave its hash untouched
          // and re-index it on the next pass.
          if (typeof point.payload?.relativePath === "string") {
            skippedPaths.add(point.payload.relativePath);
          }
          logger.warn(`Skipping point that failed upsert`, {
            pointId: point.id,
            filePath: String(filePath),
            error: pointErr instanceof Error ? pointErr.message : String(pointErr),
          });
        }
      }
      if (skipped > 0) {
        logger.warn(`${batchLabel}: ${skipped}/${batch.length} points skipped due to errors`);
      }
      totalSkipped += skipped;
    }
  }

  if (totalSkipped > 0) {
    const affected = [...skippedPaths].sort();
    const shown = affected.slice(0, 10).join(", ");
    const more = affected.length > 10 ? `, and ${affected.length - 10} more` : "";
    throw new Error(
      `Qdrant upsert incomplete for collection=${collectionName}: ` +
      `${totalSkipped}/${points.length} point(s) failed after per-point retry. ` +
      `Affected files: ${shown}${more}. ` +
      `Nothing has been recorded as indexed; re-run the index once Qdrant is healthy.`,
    );
  }
}

/** Delete all chunks for a specific file (matched by relativePath) */
export async function deleteFileChunks(collectionName: string, relativePath: string): Promise<void> {
  const qdrant = getClient();
  logger.info("Deleting file chunks", { collection: collectionName, relativePath });
  await withRetry(
    () => qdrant.delete(collectionName, {
      filter: {
        must: [{ key: "relativePath", match: { value: relativePath } }],
      },
    }),
    "Qdrant delete chunks",
  );
}

/** Hybrid search: combines dense semantic search with BM25 lexical search via RRF fusion.
 * Dense vector is generated client-side; BM25 inference runs server-side in Qdrant (requires v1.15.2+). */
export async function searchChunks(
  collectionName: string,
  query: string,
  limit: number = 10,
  fileFilter?: string,
  languageFilter?: string,
): Promise<SearchResult[]> {
  const profile = await loadEffectiveIndexProfileForCollection(collectionName);
  const queryVector = await queryVectorForProfile(query, profile);
  return searchChunksWithVector(collectionName, query, queryVector, limit, fileFilter, languageFilter);
}

function collectionProfileKind(collectionName: string): "code" | "context" {
  return collectionName.startsWith(`${QDRANT_COLLECTION_PREFIX}context_`)
    ? "context"
    : "code";
}

export async function loadEffectiveIndexProfileForCollection(
  collectionName: string,
): Promise<EffectiveIndexProfile> {
  const info = await getCollectionInfo(collectionName);
  const kind = collectionProfileKind(collectionName);
  const stored = info === null
    ? null
    : kind === "context"
      ? await loadContextEffectiveProfile(collectionName)
      : await loadProjectEffectiveProfile(collectionName);
  const profile = resolveEffectiveIndexProfile(
    kind,
    stored,
    (info?.pointsCount ?? 0) > 0,
    info?.denseVectorSize,
  );
  return profile;
}

function queryVectorForProfile(
  query: string,
  profile: EffectiveIndexProfile,
): Promise<number[]> {
  return withEffectiveEmbedding(profile, async () => {
    if (profile.embedding.provider === "ollama") {
      await ensureEffectiveEmbeddingReady(profile);
    }
    return generateQueryEmbedding(query, profile.queryPrefix);
  });
}

/** Internal: hybrid search using a pre-computed dense embedding vector.
 * Avoids recomputing the same embedding when querying multiple collections. */
async function searchChunksWithVector(
  collectionName: string,
  query: string,
  queryVector: number[],
  limit: number,
  fileFilter?: string,
  languageFilter?: string,
  /**
   * Also return each hit's cosine similarity against `queryVector` as
   * `denseScore`. Costs one extra field per point on the wire (the dense vector,
   * fetched by name so the sparse BM25 vector stays behind) and is only needed
   * when results from different collections have to be ordered against each
   * other. Off by default, so single-collection search is unchanged.
   */
  includeDenseScore = false,
): Promise<SearchResult[]> {
  const qdrant = getClient();

  const filter: { must: Array<{ key: string; match: { value: string } }> } = { must: [] };
  if (fileFilter) {
    filter.must.push({ key: "relativePath", match: { value: fileFilter } });
  }
  if (languageFilter) {
    filter.must.push({ key: "language", match: { value: languageFilter } });
  }

  // Fetch more candidates per sub-query so RRF has enough to re-rank
  const prefetchLimit = Math.max(limit * 3, 30);
  const activeFilter = filter.must.length > 0 ? filter : undefined;

  const queryPayload = {
    prefetch: [
      { query: queryVector, using: "dense", limit: prefetchLimit, filter: activeFilter },
      {
        query: { text: query, model: "qdrant/bm25" },
        using: "bm25",
        limit: prefetchLimit,
        filter: activeFilter,
      },
    ],
    query: { fusion: "rrf" },
    limit,
    with_payload: true,
    filter: activeFilter,
    // Ask for the dense vector by name: `true` would also drag back the sparse
    // BM25 vector, which is bigger and useless for cosine.
    ...(includeDenseScore ? { with_vector: ["dense"] } : {}),
  };
  const results = await withRetry(
    () => qdrant.query(collectionName, queryPayload),
    "Qdrant hybrid search",
  );

  return results.points.map((r) => {
    const result: SearchResult = {
      filePath: r.payload?.filePath as string,
      relativePath: r.payload?.relativePath as string,
      content: r.payload?.content as string,
      startLine: r.payload?.startLine as number,
      endLine: r.payload?.endLine as number,
      language: r.payload?.language as string,
      score: r.score,
    };
    if (includeDenseScore) {
      const dense = extractDenseVector(r.vector);
      // A point can legitimately come back without a usable vector (a BM25-only
      // match under some configurations), and cosine is undefined against a
      // vector of another dimensionality. Leaving denseScore unset marks the
      // whole batch as unrankable by cosine, which the merge step detects and
      // falls back on, rather than inventing a number that would mis-rank.
      const cosine = dense ? cosineSimilarity(dense, queryVector) : null;
      if (cosine === null) {
        logger.warn("Cross-project ranking: no usable dense vector, falling back to rank fusion", {
          collection: collectionName,
          relativePath: result.relativePath,
          pointDim: dense?.length ?? 0,
          queryDim: queryVector.length,
        });
      } else {
        result.denseScore = cosine;
      }
    }
    return result;
  });
}

/** Pull the dense vector out of a point, whichever shape the client returns. */
function extractDenseVector(vector: unknown): number[] | null {
  if (Array.isArray(vector) && typeof vector[0] === "number") return vector as number[];
  const named = (vector as { dense?: unknown } | null | undefined)?.dense;
  if (Array.isArray(named) && typeof named[0] === "number") return named as number[];
  return null;
}

/**
 * Cosine similarity between two vectors, or `null` when it is not defined for
 * them: differing dimensionality, or either having no magnitude.
 *
 * Null rather than a number on purpose. Comparing only the overlapping prefix of
 * mismatched vectors would return a plausible figure computed from two different
 * embedding spaces — the signature of a collection indexed with another model —
 * and mis-rank silently, which is the failure this whole change is about. A null
 * leaves `denseScore` unset, which the merge step reads as "cannot rank by
 * cosine" and answers by falling back to rank fusion for the whole query.
 */
function cosineSimilarity(a: number[], b: number[]): number | null {
  if (a.length !== b.length) return null;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return null;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/** Merge results from multiple collection queries using client-side Reciprocal Rank Fusion.
 * Deduplicates by `label::relativePath` so that files with the same relative path
 * in different projects are kept as separate hits. Within a single project,
 * the first (higher-priority) occurrence wins on conflict.
 * Exported for unit testing. */
export function mergeMultiCollectionResults(
  collectionResults: Array<{ label: string; results: SearchResult[] }>,
  limit: number,
): SearchResult[] {
  // Prefer cosine when every hit carries one. Rank-based fusion cannot order
  // results from different collections: a rank is only meaningful inside the
  // list it came from, so the top hit of a tiny project always outranks the
  // second hit of a large one however weak it is (issue #94). It also caps every
  // cross-project score at 1/(60+0+1) = 0.0164, six times below the documented
  // SEARCH_MIN_SCORE default of 0.10, so the threshold silently discarded every
  // cross-project result. Cosine is comparable across collections and lands on
  // the same scale as ordinary scores, which fixes both.
  //
  // The requirement is deliberately all-or-nothing: mixing a cosine with an RRF
  // value would compare two different quantities. When any hit lacks one — an
  // older caller, or a point that came back without a vector — the original
  // fusion below runs unchanged, so this function's contract for existing
  // callers is exactly what it was.
  const everyHitHasCosine =
    collectionResults.some(({ results }) => results.length > 0) &&
    collectionResults.every(({ results }) => results.every((r) => typeof r.denseScore === "number"));

  if (everyHitHasCosine) {
    const byKey = new Map<string, SearchResult>();
    for (const { label, results } of collectionResults) {
      for (const r of results) {
        // Same key as the fusion path: identical relative paths in different
        // projects are different files and both survive (see this docstring).
        const key = `${label}::${r.relativePath}`;
        const candidate: SearchResult = { ...r, project: label, score: r.denseScore as number };
        delete candidate.denseScore;
        const existing = byKey.get(key);
        // Within one project a file can match as several chunks; keep its best.
        if (!existing || candidate.score > existing.score) byKey.set(key, candidate);
      }
    }
    return Array.from(byKey.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  const RRF_K = 60;
  const scored = new Map<string, SearchResult & { rrfScore: number }>();

  for (const { label, results } of collectionResults) {
    for (let rank = 0; rank < results.length; rank++) {
      const r = results[rank];
      const key = `${label}::${r.relativePath}`;
      const rrfContribution = 1 / (RRF_K + rank + 1);

      const existing = scored.get(key);
      if (existing) {
        existing.rrfScore += rrfContribution;
        // Keep the version from the higher-priority (earlier) collection
      } else {
        scored.set(key, { ...r, project: label, rrfScore: rrfContribution });
      }
    }
  }

  return Array.from(scored.values())
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, limit)
    .map(({ rrfScore, ...result }) => ({
      ...result,
      score: rrfScore,
    }));
}

/** Search across multiple collections in parallel with client-side RRF fusion and deduplication.
 * Each collection's results are queried independently, then merged using Reciprocal Rank Fusion.
 * When the same relativePath appears in multiple collections, the result from the
 * earlier (higher-priority) collection wins.
 *
 * @param collections - Array of { name, label } where label identifies the source project
 *   in results. Order defines priority for deduplication (first wins).
 * @param query - Natural language search query.
 * @param limit - Maximum total results to return after merge.
 * @param fileFilter - Optional relativePath filter applied to every collection.
 * @param languageFilter - Optional language filter applied to every collection.
 */
export async function searchMultipleCollections(
  collections: Array<{ name: string; label: string }>,
  query: string,
  limit: number = 10,
  fileFilter?: string,
  languageFilter?: string,
): Promise<SearchResult[]> {
  if (collections.length === 0) return [];
  if (collections.length === 1) {
    const results = await searchChunks(collections[0].name, query, limit, fileFilter, languageFilter);
    return results.map((r) => ({ ...r, project: collections[0].label }));
  }

  // Reuse a query vector only where the persisted query-side identity is
  // compatible. Unverified legacy profiles receive collection-specific keys.
  // Promises are cached before they are awaited so concurrent collections with
  // the same verified profile share exactly one embedding request.
  const queryVectors = new Map<string, Promise<number[]>>();

  // Query all collections in parallel, requesting extra candidates for RRF re-ranking
  const perCollectionLimit = Math.max(limit * 2, 20);
  const collectionResults: Array<{ label: string; results: SearchResult[] }> = [];

  const allResults = await Promise.all(
    collections.map(async ({ name, label }) => {
      try {
        const profile = await loadEffectiveIndexProfileForCollection(name);
        const key = queryProfileKey(profile, name);
        let queryVectorPromise = queryVectors.get(key);
        if (!queryVectorPromise) {
          queryVectorPromise = queryVectorForProfile(query, profile);
          queryVectors.set(key, queryVectorPromise);
        }
        const queryVector = await queryVectorPromise;

        // includeDenseScore: results from different collections are about to be
        // ordered against each other, which their per-collection RRF scores
        // cannot support.
        const results = await searchChunksWithVector(name, query, queryVector, perCollectionLimit, fileFilter, languageFilter, true);
        return { label, results };
      } catch (err) {
        logger.warn("searchMultipleCollections: collection query failed, skipping", {
          collection: name,
          error: err instanceof Error ? err.message : String(err),
        });
        return { label, results: [] as SearchResult[] };
      }
    }),
  );

  collectionResults.push(...allResults);

  return mergeMultiCollectionResults(collectionResults, limit);
}

/** Hybrid search with arbitrary payload filters.
 * Used by context artifacts to filter by artifactName. */
export async function searchChunksWithFilter(
  collectionName: string,
  query: string,
  limit: number,
  filters: Array<{ key: string; value: string }>,
): Promise<SearchResult[]> {
  const qdrant = getClient();
  const profile = await loadEffectiveIndexProfileForCollection(collectionName);
  const queryVector = await queryVectorForProfile(query, profile);

  const filter = filters.length > 0
    ? { must: filters.map((f) => ({ key: f.key, match: { value: f.value } })) }
    : undefined;

  const prefetchLimit = Math.max(limit * 3, 30);

  const results = await withRetry(
    () => qdrant.query(collectionName, {
      prefetch: [
        { query: queryVector, using: "dense", limit: prefetchLimit, filter },
        {
          query: { text: query, model: "qdrant/bm25" },
          using: "bm25",
          limit: prefetchLimit,
          filter,
        },
      ],
      query: { fusion: "rrf" },
      limit,
      with_payload: true,
      filter,
    }),
    "Qdrant hybrid search (filtered)",
  );

  return results.points.map((r) => ({
    filePath: r.payload?.filePath as string,
    relativePath: r.payload?.relativePath as string,
    content: r.payload?.content as string,
    startLine: r.payload?.startLine as number,
    endLine: r.payload?.endLine as number,
    language: r.payload?.language as string,
    score: r.score,
  }));
}

/**
 * Every `relativePath` that currently has at least one point in the collection.
 *
 * Exists so a caller can tell "this file is unchanged, skip it" apart from "this
 * file's chunks are gone". The stored hash map cannot make that distinction on
 * its own: it records what was hashed, not what survived.
 *
 * Pages through with `scroll` rather than `facet` deliberately — facet takes a
 * limit and offers no cursor, so it cannot enumerate a repository's worth of
 * paths reliably. Payload is narrowed to the one field and vectors are excluded,
 * so the cost is one small round trip per `pageSize` points.
 */
export async function listIndexedFilePaths(
  collName: string,
  pageSize = 1000,
): Promise<Set<string>> {
  const paths = new Set<string>();
  await scrollPayloadField(
    collName,
    "relativePath",
    `listIndexedFilePaths(${collName})`,
    pageSize,
    (value) => {
      if (typeof value === "string") paths.add(value);
    },
  );
  return paths;
}

/** Get collection info.
 * Returns the collection info if it exists, null if the collection does not exist,
 * or throws an error if the request fails for any other reason (network, timeout, etc.).
 * This distinction is critical: callers must NOT treat transient errors as "collection missing". */
export interface CollectionInfo {
  pointsCount: number;
  status: string;
  /** Stored dense-vector width, when Qdrant exposes a supported vector config. */
  denseVectorSize?: number;
}

function denseVectorSizeFromInfo(info: unknown): number | undefined {
  const vectors = (info as {
    config?: { params?: { vectors?: unknown } };
  }).config?.params?.vectors;
  if (typeof vectors !== "object" || vectors === null || Array.isArray(vectors)) {
    return undefined;
  }
  const vectorConfig = vectors as Record<string, unknown>;
  const dense = vectorConfig.dense;
  const size =
    typeof dense === "object" && dense !== null && !Array.isArray(dense)
      ? (dense as Record<string, unknown>).size
      : vectorConfig.size;
  return Number.isInteger(size) && (size as number) > 0
    ? size as number
    : undefined;
}

export async function getCollectionInfo(name: string): Promise<CollectionInfo | null> {
  const qdrant = getClient();
  try {
    const info = await qdrant.getCollection(name);
    const denseVectorSize = denseVectorSizeFromInfo(info);
    return {
      pointsCount: info.points_count ?? 0,
      status: info.status,
      ...(denseVectorSize !== undefined ? { denseVectorSize } : {}),
    };
  } catch (err: unknown) {
    // Only return null for "not found" — propagate all other errors
    const message = err instanceof Error ? err.message : String(err);
    const status =
      (err as { status?: number })?.status ?? (err as { statusCode?: number })?.statusCode;
    if (isNotFoundError(err)) {
      return null;
    }
    logger.warn("getCollectionInfo failed with unexpected error (propagating)", { collection: name, error: message, status });
    throw wrapQdrantError("getCollectionInfo", { collection: name }, err);
  }
}

// ── Project metadata collection ──────────────────────────────────────────

/**
 * Global per-instance metadata collection. Stores cross-project state such
 * as graph metadata pointers and context-artifact metadata. Honours
 * `QDRANT_COLLECTION_PREFIX` so two SocratiCode instances sharing one
 * Qdrant server keep their metadata isolated as well as their per-project
 * code/graph/context collections.
 */
const METADATA_COLLECTION = `${QDRANT_COLLECTION_PREFIX}socraticode_metadata`;

/** Cached flag: once the metadata collection is confirmed to exist, skip re-checking */
let metadataCollectionReady = false;

/**
 * In-flight creation shared by concurrent callers.
 *
 * `ensureMetadataCollection` is awaited from more than ten call sites, several of
 * which run concurrently at startup (readiness checks, hash loading, graph
 * loading). The readiness flag is only set *after* creation finishes, so without
 * this every concurrent caller sees "does not exist" and races to create the
 * collection — all but the first then fail with a 409 Conflict, which surfaces as
 * `loadProjectHashes(...) failed [status 409]: Conflict` and aborts indexing.
 */
let metadataCollectionInFlight: Promise<void> | null = null;

/** Reset the metadata collection readiness cache (for testing only) */
export function resetMetadataCollectionCache(): void {
  metadataCollectionReady = false;
  metadataCollectionInFlight = null;
}

/** Ensure the metadata collection exists (idempotent, cached, concurrency-safe) */
async function ensureMetadataCollection(): Promise<void> {
  if (metadataCollectionReady) return;
  // Join the in-flight creation instead of starting a second one.
  if (metadataCollectionInFlight) return metadataCollectionInFlight;

  const attempt = (async () => {
    const qdrant = getClient();
    const collections = await qdrant.getCollections();
    const exists = collections.collections.some((c) => c.name === METADATA_COLLECTION);
    if (!exists) {
      try {
        // Metadata collection uses a dummy 1-dim vector since Qdrant requires vectors
        await qdrant.createCollection(METADATA_COLLECTION, {
          vectors: { size: 1, distance: "Cosine" },
          on_disk_payload: true,
        });
        logger.info("Created metadata collection");
      } catch (err) {
        // Another process (a second MCP instance on the same Qdrant) may have won
        // the race. That is the desired end state, so treat it as success.
        if (!isAlreadyExistsError(err)) throw err;
        logger.info("Metadata collection already created by another process");
      }
    }

    // Outside the `!exists` branch on purpose: if an earlier attempt created the
    // collection but failed before indexing, every later attempt sees the
    // collection and would otherwise skip indexing forever. Creating the index
    // is idempotent, so calling it unconditionally is safe.
    //
    // A failure here has to propagate. The metadata collection is queried by
    // `collectionName`, so without the index it is not usable, and swallowing
    // the failure would mark the collection ready and never retry the index in
    // this process.
    await createPayloadIndexIfMissing(METADATA_COLLECTION, "collectionName");
  })();
  metadataCollectionInFlight = attempt;

  try {
    await attempt;
    // Only the attempt that is still the current one may publish readiness, so a
    // cache reset that lands mid-attempt is not undone by it.
    if (metadataCollectionInFlight === attempt) metadataCollectionReady = true;
  } finally {
    // Clear on failure too, so a transient Qdrant blip can be retried. Guarded by
    // identity so a later caller's in-flight promise is never dropped — the cache
    // may have been reset while this attempt was running.
    if (metadataCollectionInFlight === attempt) metadataCollectionInFlight = null;
  }
}

/** Generate a stable UUID from a collection name (for Qdrant point ID).
 *  Uses SHA-256 to avoid collision risk inherent in simpler hashes (e.g. djb2). */
function metadataPointId(collName: string): string {
  const hash = createHash("sha256").update(collName).digest("hex").slice(0, 32);
  // Format as UUID: 8-4-4-4-12
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

/**
 * Retrieve one metadata payload without provisioning or modifying Qdrant.
 * A missing metadata collection or point is normal before the first metadata write.
 */
async function loadMetadataPayloadReadOnly(
  collName: string,
): Promise<Record<string, unknown> | null> {
  try {
    const points = await getClient().retrieve(METADATA_COLLECTION, {
      ids: [metadataPointId(collName)],
      with_payload: true,
    });
    if (points.length === 0) return null;
    return (points[0].payload as Record<string, unknown> | null | undefined) ?? null;
  } catch (err) {
    if (isNotFoundError(err)) return null;
    throw err;
  }
}

/** Indexing status persisted in Qdrant metadata */
export type IndexingStatus = "in-progress" | "completed";

export interface ProjectMetadata {
  projectPath: string;
  lastIndexedAt: string;
  filesTotal: number;
  filesIndexed: number;
  indexingStatus: IndexingStatus;
  effectiveProfile: EffectiveIndexProfile | null;
}

function profileFromPayload(
  payload: Record<string, unknown> | null | undefined,
  kind: "code" | "context",
): EffectiveIndexProfile | null {
  const serialized = payload?.effectiveIndexProfile;
  if (serialized === undefined || serialized === null) return null;
  const parsed = typeof serialized === "string" ? JSON.parse(serialized) : serialized;
  return parseEffectiveIndexProfile(parsed, kind);
}

/** Save project metadata and file hashes to Qdrant */
export async function saveProjectMetadata(
  collName: string,
  projectPath: string,
  filesTotal: number,
  filesIndexed: number,
  fileHashes: Map<string, string>,
  indexingStatus: IndexingStatus,
  effectiveProfile: EffectiveIndexProfile,
): Promise<void> {
  await ensureMetadataCollection();
  const qdrant = getClient();
  const id = metadataPointId(collName);

  const hashObj: Record<string, string> = {};
  for (const [k, v] of fileHashes) {
    hashObj[k] = v;
  }

  await qdrant.upsert(METADATA_COLLECTION, {
    points: [
      {
        id,
        vector: [0],
        payload: {
          collectionName: collName,
          projectPath,
          lastIndexedAt: new Date().toISOString(),
          filesTotal,
          filesIndexed,
          fileHashes: JSON.stringify(hashObj),
          indexingStatus,
          effectiveIndexProfile: JSON.stringify(effectiveProfile),
        },
      },
    ],
  });

  logger.info("Saved project metadata", { collName, projectPath, filesTotal, filesIndexed, indexingStatus });
}

/** Load only the stored code-index profile. Missing profile means legacy metadata. */
export async function loadProjectEffectiveProfile(
  collName: string,
): Promise<EffectiveIndexProfile | null> {
  try {
    return profileFromPayload(await loadMetadataPayloadReadOnly(collName), "code");
  } catch (err) {
    throw wrapQdrantError("loadProjectEffectiveProfile", { collName }, err);
  }
}

/** Load file hashes for a project from Qdrant.
 * Returns the hash map if found, null if the metadata point doesn't exist,
 * or throws on transient/unexpected errors so callers can distinguish
 * "no metadata" from "Qdrant unreachable". */
export async function loadProjectHashes(collName: string): Promise<Map<string, string> | null> {
  try {
    await ensureMetadataCollection();
    const qdrant = getClient();
    const id = metadataPointId(collName);

    const points = await qdrant.retrieve(METADATA_COLLECTION, {
      ids: [id],
      with_payload: true,
    });

    if (points.length === 0) return null;

    const payload = points[0].payload;
    if (!payload?.fileHashes) return null;

    const hashObj = JSON.parse(payload.fileHashes as string) as Record<string, string>;
    return new Map(Object.entries(hashObj));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status =
      (err as { status?: number })?.status ?? (err as { statusCode?: number })?.statusCode;
    logger.warn("loadProjectHashes failed (propagating)", { collName, error: message, status });
    throw wrapQdrantError("loadProjectHashes", { collName }, err);
  }
}

/** Get project metadata (for list display).
 * Returns null if metadata doesn't exist or on any error (logged as warning). */
export async function getProjectMetadata(collName: string): Promise<ProjectMetadata | null> {
  try {
    const payload = await loadMetadataPayloadReadOnly(collName);
    if (payload === null) return null;
    return {
      projectPath: payload?.projectPath as string,
      lastIndexedAt: payload?.lastIndexedAt as string,
      filesTotal: (payload?.filesTotal as number) ?? (payload?.filesIndexed as number) ?? 0,
      filesIndexed: (payload?.filesIndexed as number) ?? 0,
      indexingStatus: (payload?.indexingStatus as IndexingStatus) ?? "completed",
      effectiveProfile: profileFromPayload(
        payload as Record<string, unknown> | undefined,
        "code",
      ),
    };
  } catch (err) {
    logger.warn("getProjectMetadata failed (returning null)", {
      collName,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Persisted indexing status, without the best-effort swallowing.
 *
 * `getProjectMetadata()` is display-oriented: it catches every read error and
 * answers `null`, which is right for showing a status line and wrong for
 * deciding one. A caller that asks "was the last run interrupted?" and takes
 * `null` for "no" will, on a transient metadata read failure, skip the recovery
 * that failure should have triggered — and then persist the still-damaged index
 * as `completed`, which is worse than not having run at all.
 *
 * Returns `null` only when there is genuinely no metadata for the collection.
 * Transport, parsing and validation failures propagate, so the caller aborts
 * rather than guessing.
 */
export async function loadIndexingStatus(collName: string): Promise<IndexingStatus | null> {
  const payload = await loadMetadataPayloadReadOnly(collName);
  if (payload === null) return null;

  const status = payload.indexingStatus;
  // Absent on records written before the field existed; those were complete.
  if (status === undefined || status === null) return "completed";
  if (status === "in-progress" || status === "completed") return status;

  throw new Error(
    `Unrecognised indexingStatus ${JSON.stringify(status)} in metadata for ${collName}. ` +
      "Refusing to guess whether the last run completed.",
  );
}

/** Delete project metadata.
 * Errors are logged but not propagated (best-effort deletion). */
export async function deleteProjectMetadata(collName: string): Promise<void> {
  try {
    await ensureMetadataCollection();
    const qdrant = getClient();
    const id = metadataPointId(collName);
    logger.warn("Deleting project metadata", { collName });
    await qdrant.delete(METADATA_COLLECTION, { points: [id] });
  } catch (err) {
    logger.warn("deleteProjectMetadata failed (ignored)", {
      collName,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ── Code graph persistence ──────────────────────────────────────────────

/** Save a code graph to Qdrant as a single metadata point */
export async function saveGraphData(
  graphCollName: string,
  projectPath: string,
  graph: CodeGraph,
  graphInputs: GraphInputRecord,
): Promise<void> {
  await ensureMetadataCollection();
  const qdrant = getClient();
  const id = metadataPointId(graphCollName);

  // Total import specifiers captured across all files, resolved or not. Stored
  // alongside edgeCount so status can report the share that resolved without
  // loading and walking the whole graph: a graph that resolved almost nothing
  // is otherwise indistinguishable from a healthy one (issue #107). Graphs
  // persisted before this field existed simply omit it.
  const importCount = graph.nodes.reduce((sum, node) => sum + node.imports.length, 0);

  await qdrant.upsert(METADATA_COLLECTION, {
    points: [
      {
        id,
        vector: [0],
        payload: {
          collectionName: graphCollName,
          projectPath,
          lastBuiltAt: new Date().toISOString(),
          // Which build produced this graph, as opposed to which one is
          // serving it. A persisted graph is served unchanged across upgrades,
          // so a graph cut before a resolver shipped keeps answering as if that
          // resolver did not exist — while `codebase_about` truthfully reports
          // the new version and status reports READY. Without this field the
          // two are indistinguishable, and a stale artifact reads as a live
          // resolver defect (issue #120). Graphs persisted before this field
          // existed simply omit it.
          builtByVersion: SOCRATICODE_VERSION,
          nodeCount: graph.nodes.length,
          edgeCount: graph.edges.length,
          importCount,
          // What this build read, for the next incremental update to check a
          // change against before paying for a rebuild. Required rather than
          // optional: a graph saved without it reads as a graph nobody knows
          // the inputs of, which costs the next update a full rebuild.
          //
          // `?? null` is not dead: `tsconfig.json` compiles `src/**/*` only, so
          // a caller in `tests/` can omit the argument without the type system
          // noticing, and `JSON.stringify(undefined)` returns `undefined` — a
          // payload value the point would either reject or silently drop. Null
          // reads back as "no record", which costs one rebuild instead.
          graphInputs: JSON.stringify(graphInputs ?? null),
          graphData: JSON.stringify(graph),
        },
      },
    ],
  });

  logger.info("Saved code graph", { graphCollName, projectPath, nodes: graph.nodes.length, edges: graph.edges.length });
}

/** Load a code graph from Qdrant.
 * Returns null if no graph exists or on any error (logged as warning). */
export async function loadGraphData(graphCollName: string): Promise<CodeGraph | null> {
  try {
    const payload = await loadMetadataPayloadReadOnly(graphCollName);
    if (payload === null) return null;
    if (!payload?.graphData) return null;

    return JSON.parse(payload.graphData as string) as CodeGraph;
  } catch (err) {
    logger.warn("loadGraphData failed (returning null)", {
      graphCollName,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Get graph metadata (for list/status display).
 * Returns null if no graph exists or on any error (logged as warning). */
export async function getGraphMetadata(graphCollName: string): Promise<{
  projectPath: string;
  lastBuiltAt: string;
  nodeCount: number;
  edgeCount: number;
  /** Absent on graphs persisted before this field was recorded. */
  importCount?: number;
  /** SocratiCode version that built this graph. Absent on graphs persisted
   * before this field was recorded. */
  builtByVersion?: string;
} | null> {
  try {
    const payload = await loadMetadataPayloadReadOnly(graphCollName);
    if (payload === null) return null;
    return {
      projectPath: payload?.projectPath as string,
      lastBuiltAt: payload?.lastBuiltAt as string,
      nodeCount: payload?.nodeCount as number,
      edgeCount: payload?.edgeCount as number,
      importCount: payload?.importCount as number | undefined,
      builtByVersion: payload?.builtByVersion as string | undefined,
    };
  } catch (err) {
    logger.warn("getGraphMetadata failed (returning null)", {
      graphCollName,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * What is stored about the graph's inputs, and whether anything is stored at
 * all — three outcomes the caller must not confuse.
 */
export type GraphInputsLoad =
  /** No metadata point: this project has no persisted graph. */
  | { status: "absent" }
  /** A graph is there. `value` is its record, or undefined on one built before records existed. */
  | { status: "stored"; value: unknown }
  /** The read itself failed. Nothing is known, least of all that there is no record. */
  | { status: "failed"; error: string };

/**
 * The record of what the graph was built from, without the graph.
 *
 * Projected to that one field deliberately. The same point carries
 * `graphData`, the whole serialized graph — megabytes on a large repository —
 * and every incremental update asks this question. Pulling the graph across to
 * answer it would cost more than the rebuild the answer is meant to avoid —
 * the same amplification that made `listCodebaseCollections` project its
 * scroll rather than read whole payloads.
 *
 * A missing point and a failed read are reported apart, and neither is
 * reported as "no record". A graph with no record must rebuild once and write
 * one however quiet the update was; a graph that could not be read tells us
 * nothing and must be treated as the most conservative of the three; and only
 * a genuinely absent point means there is no graph here to refresh.
 */
export async function loadGraphInputs(graphCollName: string): Promise<GraphInputsLoad> {
  try {
    const points = await getClient().retrieve(METADATA_COLLECTION, {
      ids: [metadataPointId(graphCollName)],
      with_payload: { include: ["graphInputs"] },
      with_vector: false,
    });
    if (points.length === 0) return { status: "absent" };
    const payload = points[0].payload as Record<string, unknown> | null | undefined;
    return { status: "stored", value: payload?.graphInputs };
  } catch (err) {
    // A missing collection is a missing graph. Anything else is a failure to
    // find out, which is not the same answer and must not read like one.
    if (isNotFoundError(err)) return { status: "absent" };
    const error = err instanceof Error ? err.message : String(err);
    logger.warn("loadGraphInputs failed", { graphCollName, error });
    return { status: "failed", error };
  }
}

/** Delete graph data from metadata.
 * Errors are logged but not propagated (best-effort deletion). */
export async function deleteGraphData(graphCollName: string): Promise<void> {
  try {
    await ensureMetadataCollection();
    const qdrant = getClient();
    const id = metadataPointId(graphCollName);
    logger.warn("Deleting graph data", { graphCollName });
    await qdrant.delete(METADATA_COLLECTION, { points: [id] });
  } catch (err) {
    logger.warn("deleteGraphData failed (ignored)", {
      graphCollName,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ── Context artifact metadata ────────────────────────────────────────────

/** Save context artifact metadata to Qdrant */
export async function saveContextMetadata(
  contextCollName: string,
  projectPath: string,
  artifacts: ArtifactIndexState[],
  effectiveProfile: EffectiveIndexProfile,
): Promise<void> {
  await ensureMetadataCollection();
  const qdrant = getClient();
  const id = metadataPointId(contextCollName);

  await qdrant.upsert(METADATA_COLLECTION, {
    points: [
      {
        id,
        vector: [0],
        payload: {
          collectionName: contextCollName,
          projectPath,
          lastIndexedAt: new Date().toISOString(),
          artifactCount: artifacts.length,
          artifacts: JSON.stringify(artifacts),
          effectiveIndexProfile: JSON.stringify(effectiveProfile),
        },
      },
    ],
  });

  logger.info("Saved context artifact metadata", { contextCollName, projectPath, artifactCount: artifacts.length });
}

export interface ContextIndexMetadata {
  artifacts: ArtifactIndexState[];
  effectiveProfile: EffectiveIndexProfile | null;
}

/**
 * Load context states and profile for mutation paths. Missing metadata returns
 * null; transport, JSON, and profile validation failures propagate.
 */
export async function loadContextIndexMetadata(
  contextCollName: string,
): Promise<ContextIndexMetadata | null> {
  try {
    const payload = await loadMetadataPayloadReadOnly(contextCollName);
    if (payload === null) return null;
    const artifacts = payload?.artifacts
      ? JSON.parse(payload.artifacts as string) as ArtifactIndexState[]
      : [];
    return {
      artifacts,
      effectiveProfile: profileFromPayload(payload, "context"),
    };
  } catch (err) {
    throw wrapQdrantError("loadContextIndexMetadata", { contextCollName }, err);
  }
}

/** Load only the stored context-index profile. Missing profile means legacy metadata. */
export async function loadContextEffectiveProfile(
  contextCollName: string,
): Promise<EffectiveIndexProfile | null> {
  return (await loadContextIndexMetadata(contextCollName))?.effectiveProfile ?? null;
}

/** Load context artifact metadata from Qdrant.
 * Returns null if no metadata exists or on any error (logged as warning). */
export async function loadContextMetadata(contextCollName: string): Promise<ArtifactIndexState[] | null> {
  try {
    return (await loadContextIndexMetadata(contextCollName))?.artifacts ?? null;
  } catch (err) {
    logger.warn("loadContextMetadata failed (returning null)", {
      contextCollName,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Get context collection metadata (for list/status display).
 * Returns null if no metadata exists or on any error (logged as warning). */
export async function getContextMetadata(contextCollName: string): Promise<{
  projectPath: string;
  lastIndexedAt: string;
  artifactCount: number;
  effectiveProfile: EffectiveIndexProfile | null;
} | null> {
  try {
    const payload = await loadMetadataPayloadReadOnly(contextCollName);
    if (payload === null) return null;
    return {
      projectPath: payload?.projectPath as string,
      lastIndexedAt: payload?.lastIndexedAt as string,
      artifactCount: (payload?.artifactCount as number) ?? 0,
      effectiveProfile: profileFromPayload(
        payload as Record<string, unknown> | undefined,
        "context",
      ),
    };
  } catch (err) {
    logger.warn("getContextMetadata failed (returning null)", {
      contextCollName,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Delete context artifact metadata.
 * Errors are logged but not propagated (best-effort deletion). */
export async function deleteContextMetadata(contextCollName: string): Promise<void> {
  try {
    await ensureMetadataCollection();
    const qdrant = getClient();
    const id = metadataPointId(contextCollName);
    logger.warn("Deleting context metadata", { contextCollName });
    await qdrant.delete(METADATA_COLLECTION, { points: [id] });
  } catch (err) {
    logger.warn("deleteContextMetadata failed (ignored)", {
      contextCollName,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Delete all chunks for a specific artifact within a collection */
export async function deleteArtifactChunks(collectionName: string, artifactName: string): Promise<void> {
  const qdrant = getClient();
  logger.info("Deleting artifact chunks", { collection: collectionName, artifactName });
  await withRetry(
    () => qdrant.delete(collectionName, {
      filter: {
        must: [{ key: "artifactName", match: { value: artifactName } }],
      },
    }),
    "Qdrant delete artifact chunks",
  );
}
