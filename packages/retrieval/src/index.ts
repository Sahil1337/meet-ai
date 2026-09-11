/**
 * @meetai/retrieval — embeddings, indexing, and search over propositions.
 * Implements `Embedder`, `Indexer`, `Searcher` from @meetai/core. Returns
 * proposition ids; never transcript text, never answers.
 */

export { HttpEmbedder } from "./embedder.ts";
export { PropositionIndexer } from "./indexer.ts";
export { HybridSearcher } from "./searcher.ts";
