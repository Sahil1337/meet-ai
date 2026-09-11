/**
 * Query → ranked proposition ids. The kickoff's plan: route structured
 * questions ("who owns X", "what's due Friday") to filters over the claim
 * fields, semantic questions ("why did we choose Postgres") to hybrid
 * search — BM25 + vector, fused with reciprocal rank fusion (reading list
 * B3). Reranking is explicitly deferred until an evaluation set exists.
 *
 * Returns ids and scores only; the API hydrates. Stub.
 */

import type { Embedder, Searcher, SearchHit, SearchQuery } from "@meetai/core";

export class HybridSearcher implements Searcher {
  constructor(_embedder: Embedder) {}

  search(_query: SearchQuery): Promise<SearchHit[]> {
    throw new Error("not implemented: @meetai/retrieval HybridSearcher.search");
  }
}
