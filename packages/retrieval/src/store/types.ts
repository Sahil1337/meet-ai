/**
 * The index, as the rest of this package sees it.
 *
 * `PropositionIndexer` writes through it and `HybridSearcher` reads through
 * it; neither knows what is behind it. Today that is Postgres + pgvector on
 * the server at `DATABASE_URL`, reached through `Bun.sql` — the same one in
 * development, in the evals and in the tests. See `pg.ts`.
 *
 * Everything here is package-private. The public contract is still
 * `Indexer` / `Searcher` from `@meetai/core`: proposition ids in, ranked ids
 * out. Nothing outside this package should need these types.
 */

import type { SearchFilters } from "@meetai/core";
import type { Vector } from "../vectors.ts";

/** Only the fields a `SearchFilters` can match on. Everything else is hydrated by id from the proposition store. */
export interface IndexMetadata {
  type: string;
  /** "" when the proposition has no speaker. */
  speaker: string;
  meetingId: string;
  windowIndex: number;
  /** ISO 8601. Filters `from`/`to` compare against its date part; see `HybridSearcher`. */
  extractedAt: string;
  confidence: number;
}

/** What the indexer hands the index. `vector` must be unit length if cosine is to mean cosine. */
export interface IndexRecord {
  id: string;
  text: string;
  vector: Vector;
  metadata: IndexMetadata;
}

/** What comes back from `getMany`. No vector: nobody downstream needs it, and it is the expensive part. */
export interface IndexedRecord {
  id: string;
  text: string;
  metadata: IndexMetadata;
  createdAt: string;
}

/**
 * How candidates are found and ranked.
 *
 * - `vector`: cosine nearest neighbours; `score` is the cosine.
 * - `keyword`: BM25 over the stemmed text; `score` is the BM25 score.
 * - `hybrid`: both legs, fused with reciprocal rank fusion; `score` is the
 *   fused score. This is the default in production; the other two exist so
 *   the eval can show what each leg contributes.
 */
export type SearchMode = "vector" | "keyword" | "hybrid";

export interface IndexSearch {
  /** The already-embedded query (`kind: "query"`). Same dimensions as the index. */
  vector: Vector;
  /** The raw query text, for the keyword leg. Tokenized by Postgres exactly as the documents were. */
  text: string;
  limit: number;
  mode: SearchMode;
  /** Applied *before* ranking in every leg, so `limit` counts records that qualify. */
  filters?: SearchFilters;
  /**
   * Cosine floor, applied in every mode — including `keyword`, which is why
   * every hit carries a cosine. Cosine is the only score here with a stable
   * meaning across corpora; BM25 and RRF are relative to the result list.
   * This is what makes "the corpus cannot answer that" possible.
   */
  minScore?: number;
  /** Candidates each leg contributes before fusion. Default: max(4 × limit, 40). */
  candidates?: number;
  /** RRF's smoothing constant. Default 60, the value from the paper (reading list B3). */
  rrfK?: number;
  /** Per-leg weights on the RRF terms. Default 1 and 1. */
  weights?: { vector: number; keyword: number };
}

export interface IndexHit {
  id: string;
  /** Depends on `mode`; see `SearchMode`. Higher is better; comparable only within one result list. */
  score: number;
  /** Always present, whichever leg found the record. */
  cosine: number;
  /** null when the keyword leg did not match this record. */
  bm25: number | null;
  /** 1-based rank in the vector leg's candidate list; null if it was not in it. */
  vectorRank: number | null;
  /** 1-based rank in the keyword leg's candidate list; null if it was not in it. */
  keywordRank: number | null;
}

export interface VectorIndex {
  /** Everything in the index was embedded with exactly this model and width. */
  readonly model: string;
  readonly dimensions: number;

  /** Insert or replace by id, atomically for the whole batch. Same id in, one record out. */
  upsert(records: readonly IndexRecord[]): Promise<void>;
  /** Returns how many records were actually removed. */
  remove(ids: readonly string[]): Promise<number>;
  /** Missing ids are simply absent from the result; order is not guaranteed. */
  getMany(ids: readonly string[]): Promise<IndexedRecord[]>;
  count(): Promise<number>;
  clear(): Promise<void>;
  search(query: IndexSearch): Promise<IndexHit[]>;
  /** Release the connection or the embedded database. Idempotent. */
  close(): Promise<void>;
}

/** Where the index lives. There is one kind of home, and it is a real server. */
export interface IndexTarget {
  /** A Postgres connection string, e.g. `postgres://localhost/meetai`. Needs the `vector` extension available. */
  url: string;
}

export interface OpenIndexOptions extends IndexTarget {
  model: string;
  /** HNSW in pgvector indexes up to 2000 dimensions; wider than that is an error at open. */
  dimensions: number;
  /**
   * Drop everything and start empty, whatever the index holds. Opening an
   * index built with a different model or width is an error otherwise — a
   * store queried with the wrong model returns confident nonsense — and this
   * is the way past it: re-index.
   */
  reset?: boolean;
}
