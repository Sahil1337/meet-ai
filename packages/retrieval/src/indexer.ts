/**
 * Puts propositions into the index: embed the claim text — only the text, not
 * the meeting header, or every claim from one meeting drifts together for the
 * wrong reason — and store the vector keyed by proposition id.
 *
 * Idempotent on id: indexing the same proposition twice replaces, never
 * duplicates. Where the vectors live is this package's choice and nobody
 * else's: the indexer sees `VectorIndex` and nothing behind it. Today that is
 * Postgres + pgvector (see `store/types.ts`), and the text goes in beside the
 * vector because the keyword leg of search is computed there too.
 */

import type { Embedder, Id, Indexer, Proposition } from "@meetai/core";
import type { IndexMetadata, VectorIndex } from "./store/types.ts";

/** One request for 44 records costs about what one request for 1 does, so batch. */
const BATCH_SIZE = 100;

/** Only the fields a filter can match on. Everything else is hydrated from the proposition store by id. */
function metadataFor(p: Proposition): IndexMetadata {
  return {
    type: p.type,
    speaker: p.speaker ?? "",
    meetingId: p.meetingId,
    windowIndex: p.windowIndex,
    extractedAt: p.extractedAt,
    confidence: p.confidence,
  };
}

export class PropositionIndexer implements Indexer {
  readonly #embedder: Embedder;
  readonly #index: VectorIndex;

  constructor(embedder: Embedder, index: VectorIndex) {
    // An index written with one model and queried with another returns
    // confident nonsense, so the two must agree before a single vector goes in.
    if (embedder.model !== index.model || embedder.dimensions !== index.dimensions) {
      throw new Error(
        `embedder is ${embedder.model}/${embedder.dimensions}d but the index holds ${index.model}/${index.dimensions}d vectors; re-index`,
      );
    }
    this.#embedder = embedder;
    this.#index = index;
  }

  async index(propositions: Proposition[]): Promise<void> {
    const usable = propositions.filter((p) => p.text.trim().length > 0);
    if (usable.length === 0) return;

    for (let i = 0; i < usable.length; i += BATCH_SIZE) {
      const batch = usable.slice(i, i + BATCH_SIZE);
      const texts = batch.map((p) => p.text.trim());
      const vectors = await this.#embedder.embed(texts, "document");
      if (vectors.length !== batch.length) {
        throw new Error(`embedder returned ${vectors.length} vectors for ${batch.length} texts`);
      }
      // Keyed by proposition id, not by a hash of the text: two windows can
      // legitimately produce the same sentence, and they are still two claims
      // with two pieces of evidence.
      await this.#index.upsert(
        batch.map((p, j) => ({
          id: p.id,
          text: texts[j]!,
          vector: vectors[j]!,
          metadata: metadataFor(p),
        })),
      );
    }
  }

  async remove(propositionIds: Id[]): Promise<void> {
    await this.#index.remove(propositionIds);
  }
}
