import { describe, expect, test } from "bun:test";
import type { Embedder, Proposition } from "@meetai/core";
import { PropositionIndexer } from "../src/indexer.ts";
import { FakeEmbedder } from "./fake-embedder.ts";
import { FakeIndex } from "./fake-index.ts";

const proposition = (overrides: Partial<Proposition> & { id: string }): Proposition => ({
  text: "Tejasva owns database and retrieval",
  type: "ownership",
  speaker: "Sahil",
  confidence: 0.9,
  meetingId: "m1",
  windowIndex: 0,
  evidence: { meetingId: "m1", lineIndexes: [0] },
  extractorVersion: "test",
  extractedAt: "2026-09-13T10:00:00Z",
  ...overrides,
});

describe("PropositionIndexer", () => {
  test("embeds trimmed text as documents and stores it under the proposition id", async () => {
    const embedder = new FakeEmbedder();
    const index = new FakeIndex();
    await new PropositionIndexer(embedder, index).index([proposition({ id: "p1", text: "  padded claim \n" })]);

    expect(embedder.calls).toEqual([{ texts: ["padded claim"], kind: "document" }]);
    expect(index.upserts).toEqual([
      [
        {
          id: "p1",
          text: "padded claim",
          vector: embedder.vectorFor("padded claim"),
          metadata: {
            type: "ownership",
            speaker: "Sahil",
            meetingId: "m1",
            windowIndex: 0,
            extractedAt: "2026-09-13T10:00:00Z",
            confidence: 0.9,
          },
        },
      ],
    ]);
  });

  test("stores a missing speaker as the empty string", async () => {
    const index = new FakeIndex();
    await new PropositionIndexer(new FakeEmbedder(), index).index([proposition({ id: "p1", speaker: null })]);

    expect(index.upserts[0]?.[0]?.metadata.speaker).toBe("");
  });

  test("skips blank texts, and calls nothing when every text is blank", async () => {
    const embedder = new FakeEmbedder();
    const index = new FakeIndex();
    const indexer = new PropositionIndexer(embedder, index);

    await indexer.index([proposition({ id: "blank", text: "   " }), proposition({ id: "kept" })]);
    expect(embedder.calls[0]?.texts).toEqual(["Tejasva owns database and retrieval"]);
    expect([...index.records.keys()]).toEqual(["kept"]);

    await indexer.index([proposition({ id: "only-blank", text: "\n\t" })]);
    expect(embedder.calls).toHaveLength(1);
    expect(index.upserts).toHaveLength(1);
  });

  test("batches embedding calls and upserts at 100", async () => {
    const embedder = new FakeEmbedder();
    const index = new FakeIndex();
    const many = Array.from({ length: 250 }, (_, i) => proposition({ id: `p${i}`, text: `claim number ${i}` }));

    await new PropositionIndexer(embedder, index).index(many);

    expect(embedder.calls.map((c) => c.texts.length)).toEqual([100, 100, 50]);
    expect(embedder.calls.every((c) => c.kind === "document")).toBe(true);
    expect(index.upserts.map((b) => b.length)).toEqual([100, 100, 50]);
    expect(await index.count()).toBe(250);
    expect(index.upserts[2]?.[49]?.id).toBe("p249");
  });

  test("indexing the same id twice replaces, never duplicates", async () => {
    const index = new FakeIndex();
    const indexer = new PropositionIndexer(new FakeEmbedder(), index);

    await indexer.index([proposition({ id: "p1", text: "first wording" })]);
    await indexer.index([proposition({ id: "p1", text: "second wording" })]);

    expect(await index.count()).toBe(1);
    expect((await index.getMany(["p1"]))[0]?.text).toBe("second wording");
  });

  test("throws, without writing, when the embedder returns the wrong number of vectors", async () => {
    const short: Embedder = { model: "fake-embedder", dimensions: 8, embed: async () => [] };
    const index = new FakeIndex();

    await expect(new PropositionIndexer(short, index).index([proposition({ id: "p1" })])).rejects.toThrow(
      "embedder returned 0 vectors for 1 texts",
    );
    expect(index.upserts).toHaveLength(0);
  });

  test("remove delegates to the index", async () => {
    const index = new FakeIndex();
    const indexer = new PropositionIndexer(new FakeEmbedder(), index);
    await indexer.index([proposition({ id: "p1" }), proposition({ id: "p2" })]);

    await indexer.remove(["p1", "missing"]);

    expect([...index.records.keys()]).toEqual(["p2"]);
  });

  test("refuses an index built with a different model or width", () => {
    expect(() => new PropositionIndexer(new FakeEmbedder("other-model", 8), new FakeIndex())).toThrow("re-index");
    expect(() => new PropositionIndexer(new FakeEmbedder("fake-embedder", 4), new FakeIndex())).toThrow("re-index");
  });
});
