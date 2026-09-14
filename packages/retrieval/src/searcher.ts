/**
 * Query → ranked proposition ids.
 *
 * Two legs, one list. The vector leg embeds the question — `kind: "query"`,
 * because the task type is asymmetric and mixing them costs real recall (see
 * the README's prior findings) — and takes cosine nearest neighbours. The
 * keyword leg runs BM25 over the same text, tokenized by Postgres exactly as
 * the documents were, so an exact name or a date that no embedding would
 * place still matches. Each leg yields a ranked candidate list; reciprocal
 * rank fusion (reading list B3) merges them: a record's fused score is
 * Σ weight / (k + rank) over the legs that ranked it, so something near the
 * top of both lists beats something at the top of one, and neither leg's raw
 * score has to be made comparable to the other's. All of it runs inside the
 * database. This class embeds, asks, and maps.
 *
 * `mode` chooses the legs: `hybrid` (the default) fuses both; `vector` and
 * `keyword` run one alone. The single-leg modes exist for the eval, so it can
 * show what each leg contributes instead of asserting that fusion helps.
 *
 * The score floor (`minScore`) is on cosine in every mode, `keyword`
 * included. Cosine is the only score here with a stable meaning across
 * corpora — BM25 and RRF are relative to the result list and mean nothing on
 * their own — and a floor is what makes "the corpus cannot answer that"
 * possible: without one the nearest record always wins, however unrelated.
 * Tune it against the out-of-domain queries in `evals/retrieval`.
 *
 * Filters are applied inside the index, before ranking in every leg, so
 * `limit` counts records that qualify rather than records that scored well
 * and were then thrown away.
 *
 * Returns ids and scores only. The API hydrates them; answering writes prose.
 *
 * Scope note: `SearchQuery.projectId` is accepted but not enforced, because
 * `Proposition` carries no project link — only `meetingId`. One index holds one
 * project's claims by construction. Enforcing it needs a meeting→project map
 * that lives in `@meetai/memory`, which this package must not import.
 */

import type { Embedder, Searcher, SearchHit, SearchQuery } from "@meetai/core";
import type { IndexHit, IndexSearch, SearchMode, VectorIndex } from "./store/types.ts";

export interface HybridSearcherOptions {
  /** Cosine floor. Hits below it are dropped in every mode; see the header for why cosine. */
  minScore?: number;
  /** Which legs run. Default `hybrid`. */
  mode?: SearchMode;
  /** Candidates each leg contributes before fusion. The index defaults to max(4 × limit, 40). */
  candidates?: number;
  /** RRF's smoothing constant. The index defaults to 60, the value from the paper. */
  rrfK?: number;
  /** Per-leg weights on the RRF terms. The index defaults to 1 and 1. */
  weights?: { vector: number; keyword: number };
}

/** Which leg found the hit. A hit no leg ranked cannot exist; if the index sends one, that is its bug, not a label. */
function viaFor(hit: IndexHit): SearchHit["via"] {
  const inVector = hit.vectorRank !== null;
  const inKeyword = hit.keywordRank !== null;
  if (inVector && inKeyword) return "hybrid";
  if (inVector) return "vector";
  if (inKeyword) return "keyword";
  throw new Error(`index returned hit ${hit.id} with no rank in either leg`);
}

export class HybridSearcher implements Searcher {
  readonly #embedder: Embedder;
  readonly #index: VectorIndex;
  readonly #options: HybridSearcherOptions;

  constructor(embedder: Embedder, index: VectorIndex, options: HybridSearcherOptions = {}) {
    if (embedder.model !== index.model || embedder.dimensions !== index.dimensions) {
      throw new Error(
        `embedder is ${embedder.model}/${embedder.dimensions}d but the index holds ${index.model}/${index.dimensions}d vectors; re-index`,
      );
    }
    this.#embedder = embedder;
    this.#index = index;
    this.#options = options;
  }

  async search(query: SearchQuery): Promise<SearchHit[]> {
    const [vector] = await this.#embedder.embed([query.text], "query");
    if (!vector) throw new Error("embedder returned no vector for the query");

    // Absent options stay absent, so the index applies its own defaults rather
    // than reading an explicit `undefined` as "no floor" or "no weights".
    const { minScore, mode = "hybrid", candidates, rrfK, weights } = this.#options;
    const request: IndexSearch = {
      vector,
      text: query.text,
      limit: query.limit,
      mode,
      ...(query.filters !== undefined ? { filters: query.filters } : {}),
      ...(minScore !== undefined ? { minScore } : {}),
      ...(candidates !== undefined ? { candidates } : {}),
      ...(rrfK !== undefined ? { rrfK } : {}),
      ...(weights !== undefined ? { weights } : {}),
    };

    const hits = await this.#index.search(request);
    return hits.map((h) => ({ propositionId: h.id, score: h.score, via: viaFor(h) }));
  }
}
