/**
 * @meetai/retrieval — embeddings, indexing, and search over propositions.
 * Implements `Embedder`, `Indexer`, `Searcher` from @meetai/core. Returns
 * proposition ids; never transcript text, never answers.
 */

export { HttpEmbedder } from "./embedder.ts";
export { GeminiEmbedder, type GeminiEmbedderOptions } from "./embedders/gemini.ts";
export { PropositionIndexer } from "./indexer.ts";
export { HybridSearcher, type HybridSearcherOptions } from "./searcher.ts";
export { openIndex } from "./store/pg.ts";
export type { IndexedRecord, IndexHit, IndexTarget, OpenIndexOptions, SearchMode, VectorIndex } from "./store/types.ts";
export { cosine, dot, norm, normalize, type Vector } from "./vectors.ts";
