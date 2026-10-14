import { describe, expect, test } from "bun:test";
import type { Embedder, SearchQuery } from "@meetai/core";
import { HybridSearcher } from "../src/searcher.ts";
import type { IndexHit } from "../src/store/types.ts";
import { FakeEmbedder } from "./fake-embedder.ts";
import { FakeIndex } from "./fake-index.ts";

const query = (overrides: Partial<SearchQuery> = {}): SearchQuery => ({
  projectId: "p1",
  text: "why did we pick Postgres?",
  limit: 5,
  ...overrides,
});

const hit = (overrides: Partial<IndexHit> & { id: string }): IndexHit => ({
  score: 0.5,
  cosine: 0.7,
  bm25: null,
  vectorRank: null,
  keywordRank: null,
  ...overrides,
});

describe("HybridSearcher", () => {
  test("embeds the query text as a query, not a document", async () => {
    const embedder = new FakeEmbedder();
    const index = new FakeIndex();
    await new HybridSearcher(embedder, index).search(query({ text: "who owns retrieval?" }));

    expect(embedder.calls).toEqual([{ texts: ["who owns retrieval?"], kind: "query" }]);
    expect(index.searches[0]?.vector).toEqual(embedder.vectorFor("who owns retrieval?"));
  });

  test("defaults to hybrid and sends only what was given", async () => {
    const index = new FakeIndex();
    await new HybridSearcher(new FakeEmbedder(), index).search(query({ text: "q", limit: 3 }));

    const request = index.searches[0]!;
    expect(Object.keys(request).sort()).toEqual(["limit", "mode", "text", "vector"]);
    expect(request.mode).toBe("hybrid");
    expect(request.text).toBe("q");
    expect(request.limit).toBe(3);
  });

  test("forwards every option and the query's filters", async () => {
    const embedder = new FakeEmbedder();
    const index = new FakeIndex();
    const searcher = new HybridSearcher(embedder, index, {
      minScore: 0.65,
      mode: "keyword",
      candidates: 80,
      rrfK: 30,
      weights: { vector: 2, keyword: 1 },
    });
    const filters = { types: ["decision" as const], speakers: ["Sahil"], from: "2026-09-01" };
    await searcher.search(query({ text: "q", limit: 7, filters }));

    expect(index.searches[0]).toEqual({
      vector: embedder.vectorFor("q"),
      text: "q",
      limit: 7,
      mode: "keyword",
      filters,
      minScore: 0.65,
      candidates: 80,
      rrfK: 30,
      weights: { vector: 2, keyword: 1 },
    });
  });

  test("forwards a single-leg mode without touching the other options", async () => {
    const index = new FakeIndex();
    await new HybridSearcher(new FakeEmbedder(), index, { mode: "vector" }).search(query());

    expect(index.searches[0]?.mode).toBe("vector");
    expect(index.searches[0]).not.toHaveProperty("minScore");
    expect(index.searches[0]).not.toHaveProperty("filters");
  });

  test("maps ids, scores and which leg found each hit, in the index's order", async () => {
    const index = new FakeIndex().respondWith([
      hit({ id: "both", score: 0.9, vectorRank: 1, keywordRank: 2 }),
      hit({ id: "vector-only", score: 0.6, vectorRank: 2 }),
      hit({ id: "keyword-only", score: 0.3, keywordRank: 1, bm25: 4.2 }),
    ]);

    const hits = await new HybridSearcher(new FakeEmbedder(), index).search(query());

    expect(hits).toEqual([
      { propositionId: "both", score: 0.9, via: "hybrid" },
      { propositionId: "vector-only", score: 0.6, via: "vector" },
      { propositionId: "keyword-only", score: 0.3, via: "keyword" },
    ]);
  });

  test("returns nothing when the index finds nothing", async () => {
    const hits = await new HybridSearcher(new FakeEmbedder(), new FakeIndex()).search(query());
    expect(hits).toEqual([]);
  });

  test("rejects a hit that no leg ranked", async () => {
    const index = new FakeIndex().respondWith([hit({ id: "ghost" })]);
    const searcher = new HybridSearcher(new FakeEmbedder(), index);

    await expect(searcher.search(query())).rejects.toThrow("ghost");
  });

  test("rejects when the embedder returns no vector", async () => {
    const silent: Embedder = { model: "fake-embedder", dimensions: 8, embed: async () => [] };
    const searcher = new HybridSearcher(silent, new FakeIndex());

    await expect(searcher.search(query())).rejects.toThrow("no vector");
  });

  test("refuses an index built with a different model or width", () => {
    expect(() => new HybridSearcher(new FakeEmbedder("other-model", 8), new FakeIndex())).toThrow("re-index");
    expect(() => new HybridSearcher(new FakeEmbedder("fake-embedder", 16), new FakeIndex())).toThrow("re-index");
  });
});
