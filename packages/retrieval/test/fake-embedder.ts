/**
 * A deterministic `Embedder` for tests: a fixed-width bag of character hashes,
 * unit length, so the same text always gives the same vector and no network
 * or API key is involved. It records every call so a test can assert on
 * batching and on `kind`.
 */

import type { Embedder } from "@meetai/core";
import { normalize, type Vector } from "../src/vectors.ts";

export class FakeEmbedder implements Embedder {
  readonly model: string;
  readonly dimensions: number;
  readonly calls: Array<{ texts: string[]; kind: "document" | "query" }> = [];

  constructor(model = "fake-embedder", dimensions = 8) {
    this.model = model;
    this.dimensions = dimensions;
  }

  async embed(texts: string[], kind: "document" | "query"): Promise<number[][]> {
    this.calls.push({ texts: [...texts], kind });
    return texts.map((text) => this.vectorFor(text));
  }

  vectorFor(text: string): Vector {
    const v: Vector = new Array<number>(this.dimensions).fill(0);
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      const slot = (code + i * 7) % this.dimensions;
      v[slot] = (v[slot] ?? 0) + 1 + (code % 5);
    }
    return normalize(v);
  }
}
