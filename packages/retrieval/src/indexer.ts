/**
 * Puts propositions into the index: embed the claim text (only the text —
 * not the meeting header, or every claim from one meeting drifts together
 * for the wrong reason), store the vector and the keyword-searchable text
 * keyed by proposition id. Idempotent on id.
 *
 * Where the vectors live is this package's choice and nobody else's. An
 * in-process array is a fine first index; pgvector is the kickoff's leaning
 * once the database exists.
 *
 * Stub.
 */

import type { Embedder, Id, Indexer, Proposition } from "@meetai/core";

export class PropositionIndexer implements Indexer {
  constructor(_embedder: Embedder) {}

  index(_propositions: Proposition[]): Promise<void> {
    throw new Error("not implemented: @meetai/retrieval PropositionIndexer.index");
  }

  remove(_propositionIds: Id[]): Promise<void> {
    throw new Error("not implemented: @meetai/retrieval PropositionIndexer.remove");
  }
}
