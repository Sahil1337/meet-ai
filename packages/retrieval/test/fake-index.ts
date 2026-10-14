/**
 * An in-memory `VectorIndex` for the searcher and indexer tests.
 *
 * Storage is real — a map keyed by id, so `upsert`, `remove`, `getMany`,
 * `count` and `clear` behave — and search is scripted: it records every
 * `IndexSearch` it receives and returns whatever hits the test queued. These
 * tests are about what the searcher and indexer *send* and how they *map*
 * what comes back; ranking is `pg.ts`'s job and has its own test.
 */

import type { IndexedRecord, IndexHit, IndexRecord, IndexSearch, VectorIndex } from "../src/store/types.ts";

export class FakeIndex implements VectorIndex {
  readonly model: string;
  readonly dimensions: number;
  readonly records = new Map<string, IndexRecord & { createdAt: string }>();
  /** Every search request, in order. */
  readonly searches: IndexSearch[] = [];
  /** Every upsert batch, in order, so a test can see how the indexer batched. */
  readonly upserts: IndexRecord[][] = [];
  closed = false;
  #queued: IndexHit[][] = [];

  constructor(model = "fake-embedder", dimensions = 8) {
    this.model = model;
    this.dimensions = dimensions;
  }

  /** Hits for the next search. Each call queues one response; an unqueued search returns nothing. */
  respondWith(hits: IndexHit[]): this {
    this.#queued.push(hits);
    return this;
  }

  async upsert(records: readonly IndexRecord[]): Promise<void> {
    this.upserts.push([...records]);
    const createdAt = new Date().toISOString();
    for (const record of records) this.records.set(record.id, { ...record, createdAt });
  }

  async remove(ids: readonly string[]): Promise<number> {
    let removed = 0;
    for (const id of ids) if (this.records.delete(id)) removed++;
    return removed;
  }

  async getMany(ids: readonly string[]): Promise<IndexedRecord[]> {
    const out: IndexedRecord[] = [];
    for (const id of ids) {
      const record = this.records.get(id);
      if (!record) continue;
      const { vector: _vector, ...rest } = record;
      out.push(rest);
    }
    return out;
  }

  async count(): Promise<number> {
    return this.records.size;
  }

  async clear(): Promise<void> {
    this.records.clear();
  }

  async search(query: IndexSearch): Promise<IndexHit[]> {
    this.searches.push(query);
    return this.#queued.shift() ?? [];
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}
