/**
 * Contracts provided by the retrieval unit (`@meetai/retrieval`).
 *
 * Retrieval takes propositions in and gives ranked proposition *ids* out. It
 * never returns transcript text or answers: the API hydrates hits through
 * `PropositionStore` / `MeetingStore`, and answering (`@meetai/ai`) writes
 * the prose. Keeping ids as the currency means retrieval can keep its own
 * index (pgvector, a file, an in-process array) without the rest of the
 * system knowing — the vector store decision stays deferred.
 */

import { z } from "zod";
import { Id, IsoDate } from "../primitives.ts";
import { Proposition, PropositionType } from "../proposition.ts";

/**
 * Turns text into vectors. Kept as a contract (not a retrieval internal)
 * because the model runs as its own service — on Sahil's Mac in the
 * prototype, not on the GPU laptop — so deploying it is ingestion's job and
 * calling it is retrieval's. `kind` matters: query and document embeddings
 * must use matching task types or recall drops (see `@meetai/retrieval` README).
 */
export interface Embedder {
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[], kind: "document" | "query"): Promise<number[][]>;
}

export const SearchFilters = z.object({
  types: z.array(PropositionType).optional(),
  speakers: z.array(z.string()).optional(),
  meetingIds: z.array(Id).optional(),
  from: IsoDate.optional(),
  to: IsoDate.optional(),
});
export type SearchFilters = z.infer<typeof SearchFilters>;

export const SearchQuery = z.object({
  projectId: Id,
  text: z.string().min(1),
  limit: z.number().int().positive().max(100).default(10),
  filters: SearchFilters.optional(),
});
export type SearchQuery = z.infer<typeof SearchQuery>;

export const SearchHit = z.object({
  propositionId: Id,
  /** Higher is better; comparable only within one result list. */
  score: z.number(),
  /** Which path found it, for evals and for the reranker discussion. */
  via: z.enum(["vector", "keyword", "hybrid"]),
});
export type SearchHit = z.infer<typeof SearchHit>;

export interface Indexer {
  /** Idempotent: indexing the same proposition id twice replaces, never duplicates. */
  index(propositions: Proposition[]): Promise<void>;
  remove(propositionIds: Id[]): Promise<void>;
}

export interface Searcher {
  search(query: SearchQuery): Promise<SearchHit[]>;
}
