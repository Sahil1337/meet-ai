/**
 * Text → vectors, over HTTP to the embedding service. The service is a
 * separate process (the GPU laptop has no room next to the LLM; the kickoff
 * put it on the Mac), so this is a thin client, not a model host.
 *
 * `kind` is not decorative: embed documents and queries with matching task
 * types or recall drops (see README, "Prior findings").
 *
 * Stub.
 */

import type { Embedder } from "@meetai/core";

export class HttpEmbedder implements Embedder {
  readonly model: string;
  readonly dimensions: number;

  constructor(_baseUrl: string, model: string, dimensions: number) {
    this.model = model;
    this.dimensions = dimensions;
  }

  embed(_texts: string[], _kind: "document" | "query"): Promise<number[][]> {
    throw new Error("not implemented: @meetai/retrieval HttpEmbedder.embed");
  }
}
