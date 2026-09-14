/**
 * The Postgres index, exercised with 4-dimensional hand-made vectors and a
 * corpus small enough to score by hand: the point is to check the SQL — the
 * legs, the fusion, the filters — against arithmetic done on paper.
 *
 * It needs a server. There is no embedded driver to fall back to, so these
 * tests skip unless `TEST_DATABASE_URL` (or `DATABASE_URL`) names a Postgres
 * with the `vector` extension available.
 *
 * They are destructive: every table prefixed `retrieval_` in that database is
 * dropped and rebuilt. Point `TEST_DATABASE_URL` at a database you do not mind
 * losing — not the one holding your development index.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { openIndex } from "../src/store/pg.ts";
import type { IndexMetadata, IndexRecord, IndexSearch, VectorIndex } from "../src/store/types.ts";
import type { Vector } from "../src/vectors.ts";

/** A dedicated database, not the development one: these tests drop its tables. */
const URL_ = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const noServer = URL_ === undefined;
/** Non-null once `noServer` has gated the suite. */
const url = (): string => URL_!;

const MODEL = "test-model";
const DIMENSIONS = 4;

const e1: Vector = [1, 0, 0, 0];
const e2: Vector = [0, 1, 0, 0];
const e3: Vector = [0, 0, 1, 0];
const e4: Vector = [0, 0, 0, 1];

/** A unit vector whose cosine with `e1` is exactly `c`. */
function at(c: number): Vector {
  return [c, Math.sqrt(1 - c * c), 0, 0];
}

function rec(id: string, text: string, vector: Vector, meta: Partial<IndexMetadata> = {}): IndexRecord {
  return {
    id,
    text,
    vector,
    metadata: {
      type: "status",
      speaker: "Tejasva",
      meetingId: "m1",
      windowIndex: 0,
      extractedAt: "2026-09-10T10:00:00Z",
      confidence: 0.9,
      ...meta,
    },
  };
}

function query(overrides: Partial<IndexSearch> & Pick<IndexSearch, "mode">): IndexSearch {
  return { vector: e1, text: "", limit: 10, ...overrides };
}

const ids = (hits: { id: string }[]) => hits.map((h) => h.id);

/** BM25 exactly as the SQL is meant to compute it, for the hand checks. */
const K1 = 1.2;
const B = 0.75;
function tfPart(tf: number, docLen: number, avgdl: number): number {
  return (tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * docLen) / avgdl));
}
function idf(df: number, n: number): number {
  return Math.log(1 + (n - df + 0.5) / (df + 0.5));
}

// Cosine is computed by pgvector on float4 storage, so agree to ~1e-6, not 1e-15.
const COSINE_DIGITS = 5;

describe.skipIf(noServer)("openIndex", () => {
  test("a freshly reset index is empty and reports its model and width", async () => {
    const index = await openIndex({ url: url(), model: MODEL, dimensions: DIMENSIONS, reset: true });
    try {
      expect(index.model).toBe(MODEL);
      expect(index.dimensions).toBe(DIMENSIONS);
      expect(await index.count()).toBe(0);
    } finally {
      await index.close();
    }
  });

  test("rejects a width HNSW cannot index", async () => {
    await expect(openIndex({ url: url(), model: MODEL, dimensions: 0 })).rejects.toThrow(/dimensions/);
    await expect(openIndex({ url: url(), model: MODEL, dimensions: 2001 })).rejects.toThrow(/2000/);
    await expect(openIndex({ url: url(), model: MODEL, dimensions: 1.5 })).rejects.toThrow(/dimensions/);
  });

  test(
    "a stored index refuses another model or width until reset",
    async () => {
      const first = await openIndex({ url: url(), model: "m1", dimensions: 4, reset: true });
      await first.upsert([rec("a", "tejasva owns report", e1)]);
      await first.close();

      await expect(openIndex({ url: url(), model: "m2", dimensions: 4 })).rejects.toThrow(/"m1".*"m2".*reset: true/s);
      await expect(openIndex({ url: url(), model: "m1", dimensions: 8 })).rejects.toThrow(/4 dimensions.*8 dimensions/s);

      // The failed opens closed their connections: the same shape opens again, data intact.
      const again = await openIndex({ url: url(), model: "m1", dimensions: 4 });
      expect(await again.count()).toBe(1);
      await again.clear();
      expect(await again.count()).toBe(0);
      await again.close();

      // clear() kept the meta row: the shape is still enforced.
      await expect(openIndex({ url: url(), model: "m2", dimensions: 4 })).rejects.toThrow(/reset: true/);

      const reset = await openIndex({ url: url(), model: "m2", dimensions: 8, reset: true });
      expect(await reset.count()).toBe(0);
      await reset.upsert([rec("b", "budget approved", [1, 0, 0, 0, 0, 0, 0, 0])]);
      expect(await reset.count()).toBe(1);
      await reset.close();

      // And the new shape is what is now enforced.
      await expect(openIndex({ url: url(), model: "m1", dimensions: 4 })).rejects.toThrow(/"m2".*"m1"/s);
    },
    { timeout: 60_000 },
  );

  test("close is idempotent", async () => {
    const index = await openIndex({ url: url(), model: MODEL, dimensions: DIMENSIONS, reset: true });
    await index.close();
    await index.close();
  });
});

describe.skipIf(noServer)("PgVectorIndex", () => {
  let index: VectorIndex;

  // The previous describe leaves the database on whatever shape its last test
  // set, so this one resets rather than inheriting it.
  beforeAll(async () => {
    index = await openIndex({ url: url(), model: MODEL, dimensions: DIMENSIONS, reset: true });
  });

  beforeEach(async () => {
    await index.clear();
  });

  afterAll(async () => {
    await index.close();
  });

  describe("upsert", () => {
    test("is idempotent by id: text and postings are replaced, nothing is left behind", async () => {
      await index.upsert([rec("a", "tejasva owns report", e1)]);
      await index.upsert([rec("a", "budget approved", e2, { speaker: "Priya" })]);
      expect(await index.count()).toBe(1);

      const [record] = await index.getMany(["a"]);
      expect(record?.text).toBe("budget approved");
      expect(record?.metadata.speaker).toBe("Priya");

      // The old text's terms are gone from the postings; the new ones are there.
      expect(ids(await index.search(query({ mode: "keyword", text: "tejasva report" })))).toEqual([]);
      expect(ids(await index.search(query({ mode: "keyword", text: "budget" })))).toEqual(["a"]);
    });

    test("the same id twice in one batch leaves one record, the last one", async () => {
      await index.upsert([rec("a", "first", e1), rec("a", "second", e2)]);
      expect(await index.count()).toBe(1);
      expect((await index.getMany(["a"]))[0]?.text).toBe("second");
    });

    test("rejects a vector of the wrong width before writing anything", async () => {
      await expect(index.upsert([rec("ok", "fine", e1), rec("bad", "short", [1, 0, 0])])).rejects.toThrow(
        /record bad has a 3-dimensional vector; the index is 4-dimensional/,
      );
      expect(await index.count()).toBe(0);
    });

    test("rejects an extractedAt that is not an ISO timestamp", async () => {
      await expect(index.upsert([rec("a", "fine", e1, { extractedAt: "yesterday" })])).rejects.toThrow(/extractedAt/);
      expect(await index.count()).toBe(0);
    });
  });

  describe("remove and getMany", () => {
    test("remove returns how many were removed and drops their postings", async () => {
      await index.upsert([rec("a", "tejasva owns report", e1), rec("b", "deadline friday", e2), rec("c", "budget approved", e3)]);
      expect(await index.remove(["a", "b", "never-existed"])).toBe(2);
      expect(await index.count()).toBe(1);
      expect(await index.remove([])).toBe(0);

      expect(ids(await index.search(query({ mode: "keyword", text: "tejasva deadline" })))).toEqual([]);
      expect(ids(await index.search(query({ mode: "keyword", text: "budget" })))).toEqual(["c"]);
    });

    test("getMany ignores unknown ids and returns plain values with ISO timestamps", async () => {
      await index.upsert([
        rec("a", "tejasva owns report", e1, { type: "commitment", windowIndex: 3, confidence: 0.75 }),
        rec("b", "deadline friday", e2, { speaker: "" }),
      ]);
      const records = await index.getMany(["b", "never-existed", "a"]);
      expect(ids(records).sort()).toEqual(["a", "b"]);

      const a = records.find((r) => r.id === "a")!;
      expect(a.text).toBe("tejasva owns report");
      expect(a.metadata).toEqual({
        type: "commitment",
        speaker: "Tejasva",
        meetingId: "m1",
        windowIndex: 3,
        extractedAt: "2026-09-10T10:00:00Z",
        confidence: expect.closeTo(0.75, 6),
      });
      expect(typeof a.createdAt).toBe("string");
      expect(a.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(Math.abs(Date.parse(a.createdAt) - Date.now())).toBeLessThan(60_000);

      expect(records.find((r) => r.id === "b")?.metadata.speaker).toBe("");
      expect(await index.getMany([])).toEqual([]);
    });
  });

  describe("vector mode", () => {
    test("orders by cosine, score is the cosine, no keyword fields", async () => {
      await index.upsert([
        rec("far", "x", e2),
        rec("mid", "x", at(0.8)),
        rec("near", "x", at(0.95)),
        rec("exact", "x", e1),
      ]);
      const hits = await index.search(query({ mode: "vector", limit: 3 }));
      expect(ids(hits)).toEqual(["exact", "near", "mid"]);
      expect(hits.map((h) => h.vectorRank)).toEqual([1, 2, 3]);
      for (const [i, expected] of [1, 0.95, 0.8].entries()) {
        expect(hits[i]!.cosine).toBeCloseTo(expected, COSINE_DIGITS);
        expect(hits[i]!.score).toBe(hits[i]!.cosine);
        expect(hits[i]!.bm25).toBeNull();
        expect(hits[i]!.keywordRank).toBeNull();
      }
    });

    test("candidates caps the leg", async () => {
      await index.upsert([rec("a", "x", e1), rec("b", "x", at(0.9)), rec("c", "x", at(0.8))]);
      expect(ids(await index.search(query({ mode: "vector", candidates: 2 })))).toEqual(["a", "b"]);
    });
  });

  describe("keyword mode", () => {
    // Eight documents. "deadline" is common (six of them) and one document
    // repeats it six times; "tejasva" appears once. Without IDF the repeated
    // common term wins on term frequency alone; with IDF the rare term wins.
    const corpus = [
      rec("k1", "tejasva owns report", e1), // doc_len 3
      rec("k2", "deadline deadline deadline deadline deadline deadline", e2), // doc_len 6, tf 6
      rec("k3", "deadline friday", e3),
      rec("k4", "deadline moved", e4),
      rec("k5", "deadline slipped", at(0.5)),
      rec("k6", "deadline confirmed", at(0.6)),
      rec("k7", "deadline tuesday", at(0.7)),
      rec("k8", "budget approved", at(0.8)),
    ];
    const n = 8;
    const avgdl = (3 + 6 + 2 * 5 + 2) / n;

    test("scores BM25 with a real IDF: a rare term beats a repeated common one", async () => {
      // The counterfactual the corpus is built for: on term frequency alone k2 would win.
      expect(tfPart(6, 6, avgdl)).toBeGreaterThan(tfPart(1, 3, avgdl));

      await index.upsert(corpus);
      const hits = await index.search(query({ mode: "keyword", text: "tejasva deadline" }));

      // k3..k7 tie on bm25. The keyword rank is the leg's own order, ties by
      // id; the result order breaks the same tie on cosine (k7 = 0.7, k6 = 0.6,
      // k5 = 0.5, then k3 and k4 at 0, by id). k8 matches nothing.
      expect(ids(hits)).toEqual(["k1", "k2", "k7", "k6", "k5", "k3", "k4"]);
      expect(hits.map((h) => h.keywordRank)).toEqual([1, 2, 7, 6, 5, 3, 4]);

      const k1 = hits[0]!;
      const k2 = hits[1]!;
      expect(k1.bm25).toBeCloseTo(idf(1, n) * tfPart(1, 3, avgdl), 6);
      expect(k2.bm25).toBeCloseTo(idf(6, n) * tfPart(6, 6, avgdl), 6);
      expect(k1.score).toBe(k1.bm25!);
      // The other five all share one "deadline" in a two-token document.
      for (const hit of hits.slice(2)) expect(hit.bm25).toBeCloseTo(idf(6, n) * tfPart(1, 2, avgdl), 6);

      // Every hit carries a cosine even here, and no vector rank.
      expect(k1.cosine).toBeCloseTo(1, COSINE_DIGITS);
      expect(k2.cosine).toBeCloseTo(0, COSINE_DIGITS);
      for (const hit of hits) expect(hit.vectorRank).toBeNull();
    });

    test("stems the query the way it stemmed the documents", async () => {
      await index.upsert(corpus);
      // k4 has both stems, k2 has "deadlin" six times, the rest tie and fall back to cosine order.
      expect(ids(await index.search(query({ mode: "keyword", text: "Deadlines moving" })))).toEqual(["k4", "k2", "k7", "k6", "k5", "k3"]);
    });

    test("a query of only stop words is an empty leg, not an error", async () => {
      await index.upsert(corpus);
      expect(await index.search(query({ mode: "keyword", text: "the of and" }))).toEqual([]);
      expect(await index.search(query({ mode: "keyword", text: "" }))).toEqual([]);
    });

    test("an empty index answers with nothing", async () => {
      expect(await index.search(query({ mode: "keyword", text: "deadline" }))).toEqual([]);
      expect(await index.search(query({ mode: "hybrid", text: "deadline" }))).toEqual([]);
    });
  });

  describe("hybrid mode", () => {
    // Vector leg (candidates 2): h1 (cosine 1) then h2 (0.9).
    // Keyword leg for "tejasva": h3 (one token, so the shorter document) then h1.
    // h4 is in neither.
    const corpus = [
      rec("h1", "tejasva report", e1),
      rec("h2", "budget approved", at(0.9)),
      rec("h3", "tejasva", e4),
      rec("h4", "quarterly numbers", e3),
    ];

    test("fuses the legs with reciprocal rank fusion, k = 60", async () => {
      await index.upsert(corpus);
      const hits = await index.search(query({ mode: "hybrid", text: "tejasva", candidates: 2 }));
      expect(ids(hits)).toEqual(["h1", "h3", "h2"]);

      const [h1, h3, h2] = hits as [typeof hits[0], typeof hits[0], typeof hits[0]];
      expect(h1.vectorRank).toBe(1);
      expect(h1.keywordRank).toBe(2);
      expect(h1.score).toBeCloseTo(1 / 61 + 1 / 62, 12);
      expect(h1.bm25).not.toBeNull();
      expect(h1.cosine).toBeCloseTo(1, COSINE_DIGITS);

      expect(h3.vectorRank).toBeNull();
      expect(h3.keywordRank).toBe(1);
      expect(h3.score).toBeCloseTo(1 / 61, 12);
      expect(h3.bm25).toBeGreaterThan(h1.bm25!);
      expect(h3.cosine).toBeCloseTo(0, COSINE_DIGITS); // keyword-only hits carry a cosine too

      expect(h2.vectorRank).toBe(2);
      expect(h2.keywordRank).toBeNull();
      expect(h2.bm25).toBeNull();
      expect(h2.score).toBeCloseTo(1 / 62, 12);
      expect(h2.cosine).toBeCloseTo(0.9, COSINE_DIGITS);

      // Found by both legs beats found by one.
      expect(h1.score).toBeGreaterThan(h3.score);
      expect(h1.score).toBeGreaterThan(h2.score);
    });

    test("honours the weights and rrfK", async () => {
      await index.upsert(corpus);
      const weighted = await index.search(
        query({ mode: "hybrid", text: "tejasva", candidates: 2, weights: { vector: 2, keyword: 1 } }),
      );
      expect(ids(weighted)).toEqual(["h1", "h2", "h3"]);
      expect(weighted[0]!.score).toBeCloseTo(2 / 61 + 1 / 62, 12);
      expect(weighted[1]!.score).toBeCloseTo(2 / 62, 12);
      expect(weighted[2]!.score).toBeCloseTo(1 / 61, 12);

      const smoothed = await index.search(query({ mode: "hybrid", text: "tejasva", candidates: 2, rrfK: 10 }));
      expect(smoothed[0]!.score).toBeCloseTo(1 / 11 + 1 / 12, 12);
    });

    test("degrades to the vector leg when the query has no lexemes", async () => {
      await index.upsert(corpus);
      const hits = await index.search(query({ mode: "hybrid", text: "the of and" }));
      expect(ids(hits)).toEqual(["h1", "h2", "h3", "h4"]);
      expect(ids(hits)).toEqual(ids(await index.search(query({ mode: "vector" }))));
      for (const [i, hit] of hits.entries()) {
        expect(hit.vectorRank).toBe(i + 1);
        expect(hit.keywordRank).toBeNull();
        expect(hit.bm25).toBeNull();
        expect(hit.score).toBeCloseTo(1 / (60 + i + 1), 12);
      }
    });
  });

  describe("filters", () => {
    // `best` scores highest on every leg and sits outside every filter below,
    // so a filter that is applied after ranking would let it through and a
    // limit that counts the wrong rows would come up short.
    const corpus = [
      rec("best", "deadline deadline deadline", e1, { type: "decision", speaker: "Priya", meetingId: "m2", extractedAt: "2026-09-01T09:00:00Z" }),
      rec("y1", "deadline friday", at(0.9), { type: "action_item", extractedAt: "2026-09-10T09:00:00Z" }),
      rec("y2", "deadline moved", at(0.8), { type: "action_item", extractedAt: "2026-09-11T09:00:00Z" }),
      rec("y3", "deadline slipped", at(0.7), { type: "action_item", extractedAt: "2026-09-12T09:00:00Z" }),
      rec("late", "deadline confirmed", at(0.6), { type: "action_item", extractedAt: "2026-09-20T09:00:00Z" }),
      rec("anon", "deadline tuesday", at(0.5), { type: "action_item", speaker: "" }),
    ];

    beforeEach(() => index.upsert(corpus));

    const vec = (filters: IndexSearch["filters"]) => index.search(query({ mode: "vector", limit: 3, filters }));

    test("no filter, and empty filter arrays, leave everything in", async () => {
      expect(ids(await vec(undefined))).toEqual(["best", "y1", "y2"]);
      expect(ids(await vec({ types: [], speakers: [], meetingIds: [] }))).toEqual(["best", "y1", "y2"]);
    });

    test("types, and limit is filled from qualifying records", async () => {
      expect(ids(await vec({ types: ["action_item"] }))).toEqual(["y1", "y2", "y3"]);
      expect(ids(await vec({ types: ["decision"] }))).toEqual(["best"]);
      expect(ids(await vec({ types: ["decision", "action_item"] }))).toEqual(["best", "y1", "y2"]);
    });

    test("speakers, with '' matching records that have none", async () => {
      expect(ids(await vec({ speakers: ["Tejasva"] }))).toEqual(["y1", "y2", "y3"]);
      expect(ids(await vec({ speakers: [""] }))).toEqual(["anon"]);
      expect(ids(await vec({ speakers: ["Nobody"] }))).toEqual([]);
    });

    test("meetingIds", async () => {
      expect(ids(await vec({ meetingIds: ["m1"] }))).toEqual(["y1", "y2", "y3"]);
      expect(ids(await vec({ meetingIds: ["m2"] }))).toEqual(["best"]);
    });

    test("from and to compare the date part of extractedAt, inclusive", async () => {
      expect(ids(await vec({ from: "2026-09-10" }))).toEqual(["y1", "y2", "y3"]);
      expect(ids(await vec({ to: "2026-09-11" }))).toEqual(["best", "y1", "y2"]);
      expect(ids(await vec({ from: "2026-09-11", to: "2026-09-12" }))).toEqual(["y2", "y3"]);
      expect(ids(await vec({ from: "2026-09-13", to: "2026-09-19" }))).toEqual([]);
    });

    test("apply inside the keyword and hybrid legs too", async () => {
      const kw = await index.search(query({ mode: "keyword", text: "deadline", limit: 3, filters: { types: ["action_item"] } }));
      // Five action records tie on bm25 and take leg ranks by id (anon, late,
      // y1, y2, y3); the result then orders them by cosine. Had the filter run
      // after ranking, `best` would hold rank 1 and these would be 4, 5, 6.
      expect(ids(kw)).toEqual(["y1", "y2", "y3"]);
      expect(kw.map((h) => h.keywordRank)).toEqual([3, 4, 5]);

      const hy = await index.search(query({ mode: "hybrid", text: "deadline", limit: 3, filters: { meetingIds: ["m1"] } }));
      expect(ids(hy)).not.toContain("best");
      expect(hy).toHaveLength(3);
      // Had the filter come after the legs, `best` would hold rank 1 in both
      // and y1 would be vector rank 2 and keyword rank 4 (behind anon and late).
      const y1 = hy.find((h) => h.id === "y1")!;
      expect(y1.vectorRank).toBe(1);
      expect(y1.keywordRank).toBe(3);
    });
  });

  describe("minScore", () => {
    // `low` would top the keyword leg (two mentions in a short document) and
    // the hybrid list, but its cosine is 0.5.
    const corpus = [rec("exact", "tejasva", e1), rec("near", "tejasva", at(0.9)), rec("low", "tejasva tejasva", at(0.5))];

    beforeEach(() => index.upsert(corpus));

    test("floors the cosine in every mode, including keyword", async () => {
      expect(ids(await index.search(query({ mode: "vector", minScore: 0.8 })))).toEqual(["exact", "near"]);

      const kw = await index.search(query({ mode: "keyword", text: "tejasva", minScore: 0.8 }));
      expect(ids(kw).sort()).toEqual(["exact", "near"]);
      // The floor is on cosine, not on bm25: without it `low` ranks first.
      const unfloored = await index.search(query({ mode: "keyword", text: "tejasva" }));
      expect(ids(unfloored)[0]).toBe("low");

      const hy = await index.search(query({ mode: "hybrid", text: "tejasva", minScore: 0.8 }));
      expect(ids(hy).sort()).toEqual(["exact", "near"]);
      expect(ids(await index.search(query({ mode: "hybrid", text: "tejasva", minScore: 1.5 })))).toEqual([]);
    });
  });

  describe("ordering", () => {
    test("ties break on id, deterministically, in every mode", async () => {
      await index.upsert([rec("c", "deadline", e1), rec("a", "deadline", e1), rec("b", "deadline", e1)]);
      for (const mode of ["vector", "keyword", "hybrid"] as const) {
        const once = await index.search(query({ mode, text: "deadline" }));
        const twice = await index.search(query({ mode, text: "deadline" }));
        expect(ids(once)).toEqual(["a", "b", "c"]);
        expect(twice).toEqual(once);
      }
    });

    test("limit bounds the result", async () => {
      await index.upsert([rec("a", "deadline", e1), rec("b", "deadline", at(0.9)), rec("c", "deadline", at(0.8))]);
      expect(await index.search(query({ mode: "hybrid", text: "deadline", limit: 2 }))).toHaveLength(2);
    });
  });

  describe("query validation", () => {
    test("rejects a query vector of the wrong width", async () => {
      await expect(index.search(query({ mode: "vector", vector: [1, 0] }))).rejects.toThrow(/2-dimensional/);
    });

    test("rejects a limit that is not a positive integer", async () => {
      await expect(index.search(query({ mode: "vector", limit: 0 }))).rejects.toThrow(/limit/);
      await expect(index.search(query({ mode: "vector", limit: 2.5 }))).rejects.toThrow(/limit/);
    });
  });
});

describe.skipIf(noServer)("round trip", () => {
  test(
    "upserts, searches and removes against a fresh index of its own",
    async () => {
      const index = await openIndex({ url: url(), model: "smoke-test", dimensions: 4, reset: true });
      try {
        expect(await index.count()).toBe(0);
        await index.upsert([rec("a", "tejasva owns report", e1), rec("b", "deadline friday", at(0.9))]);
        expect(await index.count()).toBe(2);

        const hits = await index.search(query({ mode: "hybrid", text: "tejasva" }));
        expect(ids(hits)).toEqual(["a", "b"]);
        expect(hits[0]).toMatchObject({ vectorRank: 1, keywordRank: 1 });
        expect(hits[0]!.score).toBeCloseTo(1 / 61 + 1 / 61, 12);
        expect(hits[1]).toMatchObject({ vectorRank: 2, keywordRank: null, bm25: null });

        const [record] = await index.getMany(["a"]);
        expect(record?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(await index.remove(["a", "b"])).toBe(2);
      } finally {
        await index.close();
      }
    },
    { timeout: 30_000 },
  );
});
