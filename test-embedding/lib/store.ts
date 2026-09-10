// A vector "database" that is just a JSON file on disk.
//
// Fine for a few thousand short records: the whole file is read into memory and
// every query is a linear scan. No index, no server, no native deps — which is
// exactly the point for testing. See README -> "When this stops being enough".
import { readFileSync, writeFileSync, existsSync, renameSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  embed,
  embedBatch,
  cosine,
  withRetry,
  DEFAULT_MODEL,
  type TaskType,
  type Vector,
} from './gemini.ts';

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_STORE_PATH = join(here, '..', 'data', 'store.json');

/** Bump when the on-disk shape changes incompatibly. */
const STORE_VERSION = 1;

/** Decimal places kept per component when serializing vectors. */
const VECTOR_PRECISION = 6;

/** Query and document sides must match — see README. */
export const DOC_TASK: TaskType = 'RETRIEVAL_DOCUMENT';
export const QUERY_TASK: TaskType = 'RETRIEVAL_QUERY';
export const DEFAULT_DIMENSIONS = 768;

export interface StoredRecord {
  id: string;
  text: string;
  vector: Vector;
  metadata: Metadata;
  createdAt: string;
}

export type Metadata = Record<string, string | number | boolean>;

export interface StoreFile {
  version: number;
  /** Everything in `records` was embedded with exactly these settings. */
  model: string;
  dimensions: number;
  taskType: TaskType;
  createdAt: string;
  records: StoredRecord[];
}

export interface SearchHit {
  id: string;
  text: string;
  score: number;
  metadata: Metadata;
}

export interface SearchOptions {
  topK?: number;
  /** Drop hits below this cosine score. */
  minScore?: number;
  /** Only consider records whose metadata matches every key here. */
  filter?: Metadata;
}

/** Stable id so re-adding the same text updates in place instead of duplicating. */
export function idFor(text: string): string {
  return createHash('sha256').update(text.trim()).digest('hex').slice(0, 12);
}

export class JsonVectorStore {
  readonly path: string;
  private data: StoreFile;

  private constructor(path: string, data: StoreFile) {
    this.path = path;
    this.data = data;
  }

  static open(path: string = DEFAULT_STORE_PATH): JsonVectorStore {
    if (existsSync(path)) {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as StoreFile;
      if (parsed.version !== STORE_VERSION) {
        throw new Error(
          `store at ${path} is version ${parsed.version}, expected ${STORE_VERSION}. Delete it and re-index.`,
        );
      }
      return new JsonVectorStore(path, parsed);
    }
    return new JsonVectorStore(path, {
      version: STORE_VERSION,
      model: DEFAULT_MODEL,
      dimensions: DEFAULT_DIMENSIONS,
      taskType: DOC_TASK,
      createdAt: new Date().toISOString(),
      records: [],
    });
  }

  /** Size of the store file on disk, in bytes (0 if never saved). */
  get bytesOnDisk(): number {
    return existsSync(this.path) ? statSync(this.path).size : 0;
  }

  get size(): number {
    return this.data.records.length;
  }

  get info(): Omit<StoreFile, 'records'> {
    const { records: _records, ...rest } = this.data;
    return rest;
  }

  all(): readonly StoredRecord[] {
    return this.data.records;
  }

  get(id: string): StoredRecord | undefined {
    return this.data.records.find((r) => r.id === id);
  }

  /** Embed and store one proposition. Re-adding the same text overwrites it. */
  async add(text: string, metadata: Metadata = {}): Promise<StoredRecord> {
    const [record] = await this.addMany([text], metadata);
    return record!;
  }

  /**
   * Embed many propositions in a single API call, each with its own metadata.
   * Prefer this over repeated addMany() calls: one request for 44 records takes
   * about as long as one request for 1, so grouping by metadata is a big loss.
   */
  async addItems(items: Array<{ text: string; metadata?: Metadata }>): Promise<StoredRecord[]> {
    const clean = items
      .map((it) => ({ text: it.text.trim(), metadata: it.metadata ?? {} }))
      .filter((it) => it.text.length > 0);
    if (clean.length === 0) return [];

    const { vectors } = await withRetry(() =>
      embedBatch(
        clean.map((it) => it.text),
        {
          model: this.data.model,
          taskType: this.data.taskType,
          dimensions: this.data.dimensions,
        },
      ),
    );

    const now = new Date().toISOString();
    const added: StoredRecord[] = clean.map((it, i) => ({
      id: idFor(it.text),
      text: it.text,
      vector: vectors[i]!,
      metadata: it.metadata,
      createdAt: now,
    }));

    this.upsert(added);
    this.save();
    return added;
  }

  private upsert(records: StoredRecord[]): void {
    for (const record of records) {
      const existing = this.data.records.findIndex((r) => r.id === record.id);
      if (existing === -1) this.data.records.push(record);
      else this.data.records[existing] = record;
    }
  }

  /** Embed many propositions that share one metadata object. */
  async addMany(texts: string[], metadata: Metadata = {}): Promise<StoredRecord[]> {
    const clean = texts.map((t) => t.trim()).filter((t) => t.length > 0);
    if (clean.length === 0) return [];

    const { vectors } = await withRetry(() =>
      embedBatch(clean, {
        model: this.data.model,
        taskType: this.data.taskType,
        dimensions: this.data.dimensions,
      }),
    );

    const now = new Date().toISOString();
    const added: StoredRecord[] = clean.map((text, i) => ({
      id: idFor(text),
      text,
      vector: vectors[i]!,
      metadata,
      createdAt: now,
    }));

    this.upsert(added);
    this.save();
    return added;
  }

  /** Embed the query, then rank every stored vector against it. */
  async search(query: string, opts: SearchOptions = {}): Promise<SearchHit[]> {
    const { topK = 5, minScore, filter } = opts;
    if (this.data.records.length === 0) return [];

    const { values } = await withRetry(() =>
      embed(query, {
        model: this.data.model,
        taskType: QUERY_TASK, // asymmetric on purpose — docs were RETRIEVAL_DOCUMENT
        dimensions: this.data.dimensions,
      }),
    );

    const candidates = filter
      ? this.data.records.filter((r) =>
          Object.entries(filter).every(([k, v]) => r.metadata[k] === v),
        )
      : this.data.records;

    let hits: SearchHit[] = candidates.map((r) => ({
      id: r.id,
      text: r.text,
      score: cosine(values, r.vector),
      metadata: r.metadata,
    }));

    hits.sort((a, b) => b.score - a.score);
    if (minScore !== undefined) hits = hits.filter((h) => h.score >= minScore);
    return hits.slice(0, topK);
  }

  /**
   * Find near-duplicate records by pairwise cosine. Content-hash ids only catch
   * byte-identical text; overlapping transcript chunks produce claims that are
   * reworded but mean the same thing, and those need a similarity check.
   * Pure local math — no API calls.
   */
  findDuplicates(threshold = 0.9): Array<{ a: StoredRecord; b: StoredRecord; score: number }> {
    const out: Array<{ a: StoredRecord; b: StoredRecord; score: number }> = [];
    const rs = this.data.records;
    for (let i = 0; i < rs.length; i++) {
      for (let j = i + 1; j < rs.length; j++) {
        const score = cosine(rs[i]!.vector, rs[j]!.vector);
        if (score >= threshold) out.push({ a: rs[i]!, b: rs[j]!, score });
      }
    }
    return out.sort((x, y) => y.score - x.score);
  }

  remove(id: string): boolean {
    const i = this.data.records.findIndex((r) => r.id === id);
    if (i === -1) return false;
    this.data.records.splice(i, 1);
    this.save();
    return true;
  }

  clear(): void {
    this.data.records = [];
    this.save();
  }

  /** Write via a temp file + rename so an interrupted write can't truncate the store. */
  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    // Full float64 text is ~3x larger than needed; 6 decimals sits far below the
    // noise floor of the embedding itself and leaves cosine scores unchanged.
    const serializable: StoreFile = {
      ...this.data,
      records: this.data.records.map((r) => ({
        ...r,
        vector: r.vector.map((v) => Number(v.toFixed(VECTOR_PRECISION))),
      })),
    };
    // Compact, not pretty-printed: indenting one float per line doubles the
    // file for zero benefit. Use `rag.ts list` to read the contents.
    writeFileSync(tmp, JSON.stringify(serializable), 'utf8');
    renameSync(tmp, this.path);
  }
}
