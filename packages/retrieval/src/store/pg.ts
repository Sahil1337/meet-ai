/**
 * The index on Postgres + pgvector.
 *
 * One implementation, one home: the Postgres server at `DATABASE_URL`, reached
 * through `Bun.sql`. Development, the evals and the tests all point at a real
 * server — there is no embedded fallback to drift away from. `sql.ts` is the
 * only file that names the driver.
 *
 * Three tables, all prefixed `retrieval_`:
 *
 * - `retrieval_index_meta` — one row: which model and width the vectors came
 *   from, and the schema version. Opening with a different model or width is
 *   an error; `reset: true` is the way past it (see `OpenIndexOptions`).
 * - `retrieval_propositions` — the records: text, embedding, the filterable
 *   metadata, and `doc_len` for BM25. `extracted_date` is a generated column
 *   equal to `left(extracted_at, 10)::date`, so the date filters mean exactly
 *   what the JSON store's `extractedAt.slice(0, 10)` meant, but are indexable.
 * - `retrieval_postings` — the inverted index: (term, id) → term frequency,
 *   filled from `to_tsvector('english', text)`. Postgres tokenizes and stems
 *   both the documents and the query, so the two sides agree by construction.
 *
 * Search is one statement per call; `searchPlan` explains the legs and the
 * fusion.
 */

import type { SearchFilters } from "@meetai/core";
import type { Vector } from "../vectors.ts";
import { openBunSql, type SqlClient, type SqlExecutor } from "./sql.ts";
import type {
  IndexedRecord,
  IndexHit,
  IndexRecord,
  IndexSearch,
  IndexTarget,
  OpenIndexOptions,
  SearchMode,
  VectorIndex,
} from "./types.ts";

/** Bump when the table shape changes incompatibly; an index at another version must be reset. */
const SCHEMA_VERSION = 1;

/** pgvector's HNSW indexes vectors up to this wide. */
const MAX_DIMENSIONS = 2000;

/** BM25's term-frequency saturation and length-normalization constants, the textbook defaults. */
const BM25_K1 = 1.2;
const BM25_B = 0.75;

/** Reciprocal rank fusion's smoothing constant, from the paper (reading list B3). */
const DEFAULT_RRF_K = 60;

/** Each leg contributes at least this many candidates, whatever the limit. */
const MIN_CANDIDATES = 40;

/**
 * HNSW returns at most `hnsw.ef_search` rows — the classic pgvector gotcha —
 * so it is raised to the candidate count per query. pgvector accepts 1..1000.
 */
const MIN_EF_SEARCH = 40;
const MAX_EF_SEARCH = 1000;

/** The text search configuration that tokenizes and stems both documents and queries. */
const TEXT_SEARCH_CONFIG = "english";

const SEARCH_MODES: ReadonlySet<string> = new Set<SearchMode>(["vector", "keyword", "hybrid"]);

// --- schema -----------------------------------------------------------------

const CREATE_META = `
  CREATE TABLE IF NOT EXISTS retrieval_index_meta (
    id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    schema_version int NOT NULL,
    model text NOT NULL,
    dimensions int NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`;

/** `dimensions` is interpolated: it is a validated integer, and a column type cannot be a parameter. */
function createPropositions(dimensions: number): string {
  return `
  CREATE TABLE IF NOT EXISTS retrieval_propositions (
    id text PRIMARY KEY,
    text text NOT NULL,
    embedding vector(${dimensions}) NOT NULL,
    doc_len int NOT NULL,
    type text NOT NULL,
    speaker text NOT NULL DEFAULT '',
    meeting_id text NOT NULL,
    window_index int NOT NULL,
    extracted_at text NOT NULL,
    -- left(extracted_at, 10)::date, spelled with make_date because a generated
    -- column must be immutable and a text-to-date cast is not (it reads DateStyle).
    extracted_date date GENERATED ALWAYS AS (
      make_date(left(extracted_at, 4)::int, substr(extracted_at, 6, 2)::int, substr(extracted_at, 9, 2)::int)
    ) STORED,
    confidence real NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`;
}

const CREATE_POSTINGS = `
  CREATE TABLE IF NOT EXISTS retrieval_postings (
    id text NOT NULL REFERENCES retrieval_propositions(id) ON DELETE CASCADE,
    term text NOT NULL,
    tf int NOT NULL,
    PRIMARY KEY (term, id)
  )`;

const CREATE_INDEXES = [
  "CREATE INDEX IF NOT EXISTS retrieval_propositions_embedding_idx ON retrieval_propositions USING hnsw (embedding vector_cosine_ops)",
  "CREATE INDEX IF NOT EXISTS retrieval_propositions_meeting_id_idx ON retrieval_propositions (meeting_id)",
  "CREATE INDEX IF NOT EXISTS retrieval_propositions_type_idx ON retrieval_propositions (type)",
  "CREATE INDEX IF NOT EXISTS retrieval_propositions_extracted_date_idx ON retrieval_propositions (extracted_date)",
  // The primary key leads with `term`; deleting or cascading by id needs its own path.
  "CREATE INDEX IF NOT EXISTS retrieval_postings_id_idx ON retrieval_postings (id)",
];

const DROP_ALL = "DROP TABLE IF EXISTS retrieval_postings, retrieval_propositions, retrieval_index_meta CASCADE";

// --- writes -----------------------------------------------------------------

/** `doc_len` is the sum of the postings' `tf`, computed from the same tsvector they come from. */
const UPSERT_PROPOSITION = `
  INSERT INTO retrieval_propositions
    (id, text, embedding, doc_len, type, speaker, meeting_id, window_index, extracted_at, confidence)
  VALUES (
    $1, $2, $3::vector,
    (SELECT coalesce(sum(cardinality(positions)), 0)::int FROM unnest(to_tsvector('${TEXT_SEARCH_CONFIG}', $2))),
    $4, $5, $6, $7::int, $8, $9::real
  )
  ON CONFLICT (id) DO UPDATE SET
    text = EXCLUDED.text,
    embedding = EXCLUDED.embedding,
    doc_len = EXCLUDED.doc_len,
    type = EXCLUDED.type,
    speaker = EXCLUDED.speaker,
    meeting_id = EXCLUDED.meeting_id,
    window_index = EXCLUDED.window_index,
    extracted_at = EXCLUDED.extracted_at,
    confidence = EXCLUDED.confidence,
    created_at = now()`;

/** ON DELETE CASCADE does not fire on UPDATE, so a replaced record's postings go explicitly. */
const DELETE_POSTINGS = "DELETE FROM retrieval_postings WHERE id = $1";

const INSERT_POSTINGS = `
  INSERT INTO retrieval_postings (id, term, tf)
  SELECT $1::text, lexeme, cardinality(positions)
  FROM unnest(to_tsvector('${TEXT_SEARCH_CONFIG}', $2))`;

const DELETE_PROPOSITIONS = "DELETE FROM retrieval_propositions WHERE id = ANY($1::text[]) RETURNING id";

const SELECT_RECORDS = `
  SELECT id, text, type, speaker, meeting_id, window_index, extracted_at, confidence, created_at
  FROM retrieval_propositions
  WHERE id = ANY($1::text[])`;

const COUNT = "SELECT count(*)::int AS n FROM retrieval_propositions";

const CLEAR = "TRUNCATE retrieval_postings, retrieval_propositions";

// --- search -----------------------------------------------------------------

/** Numbers `$1, $2, …` as values are added, so a statement only carries the parameters it references. */
class Params {
  readonly values: unknown[] = [];

  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

/**
 * The base rows every leg ranks: everything that passes the filters. Filters
 * are applied here, before each leg's LIMIT, so `limit` counts records that
 * qualify. NOT MATERIALIZED keeps it a subquery the planner inlines into both
 * legs, which is what lets the vector leg reach the HNSW index.
 */
function filteredCte(filters: SearchFilters | undefined, params: Params): string {
  const clauses: string[] = [];
  if (filters?.types?.length) clauses.push(`type = ANY(${params.add([...filters.types])}::text[])`);
  // A proposition without a speaker was stored as '', so `speakers: [""]` finds those.
  if (filters?.speakers?.length) clauses.push(`speaker = ANY(${params.add([...filters.speakers])}::text[])`);
  if (filters?.meetingIds?.length) clauses.push(`meeting_id = ANY(${params.add([...filters.meetingIds])}::text[])`);
  if (filters?.from) clauses.push(`extracted_date >= ${params.add(filters.from)}::date`);
  if (filters?.to) clauses.push(`extracted_date <= ${params.add(filters.to)}::date`);
  const where = clauses.length > 0 ? `\n  WHERE ${clauses.join("\n    AND ")}` : "";
  return `filtered AS NOT MATERIALIZED (
  SELECT id, embedding, doc_len
  FROM retrieval_propositions${where}
)`;
}

/**
 * Vector leg: the `candidates` nearest by cosine. `ORDER BY embedding <=> q
 * LIMIT n` is the exact shape the HNSW index serves; the rank is assigned in
 * a second step because relaxed iterative scans may hand rows back slightly
 * out of order.
 */
function vectorLeg(q: string, candidates: string): string {
  return `vec_top AS (
  SELECT id, embedding <=> ${q} AS distance
  FROM filtered
  ORDER BY embedding <=> ${q}
  LIMIT ${candidates}
),
vec AS (
  SELECT id, row_number() OVER (ORDER BY distance, id) AS rank
  FROM vec_top
)`;
}

/**
 * Keyword leg: BM25 (k1 = 1.2, b = 0.75) over the postings.
 *
 * The query is tokenized and stemmed by the same configuration as the
 * documents, so its terms are looked up directly. Corpus statistics (`n`,
 * `avgdl`, each term's `df`) are over the whole table, not the filtered rows:
 * a term's rarity is a property of the corpus. Score per document is the sum
 * over the query terms it contains of
 *
 *   ln(1 + (n - df + 0.5) / (df + 0.5)) * tf * (k1 + 1) / (tf + k1 * (1 - b + b * doc_len / avgdl))
 *
 * A query with no lexemes (all stop words) has no terms and the leg is
 * empty. `avgdl` is only zero when no document has a term, and then there is
 * no posting to divide for; the `nullif` is belt and braces.
 *
 * `stats` and `term_df` are MATERIALIZED: one row and a handful of rows,
 * each computed once. Inlined, the planner re-ran the table-wide aggregate
 * for every matched posting.
 */
function keywordLeg(text: string, candidates: string): string {
  const k1 = `${BM25_K1}::float8`;
  const b = `${BM25_B}::float8`;
  return `terms AS (
  SELECT DISTINCT lexeme AS term
  FROM unnest(to_tsvector('${TEXT_SEARCH_CONFIG}', ${text}))
),
stats AS MATERIALIZED (
  SELECT count(*)::float8 AS n, avg(doc_len)::float8 AS avgdl
  FROM retrieval_propositions
),
term_df AS MATERIALIZED (
  SELECT term, (SELECT count(*) FROM retrieval_postings p WHERE p.term = terms.term)::float8 AS df
  FROM terms
),
kw_top AS (
  SELECT f.id,
    sum(
      ln(1 + (s.n - d.df + 0.5) / (d.df + 0.5))
      * (p.tf * (${k1} + 1)) / (p.tf + ${k1} * (1 - ${b} + ${b} * f.doc_len / nullif(s.avgdl, 0)))
    )::float8 AS bm25
  FROM term_df d
  JOIN retrieval_postings p ON p.term = d.term
  JOIN filtered f ON f.id = p.id
  CROSS JOIN stats s
  GROUP BY f.id
  ORDER BY bm25 DESC, f.id
  LIMIT ${candidates}
),
kw AS (
  SELECT id, bm25, row_number() OVER (ORDER BY bm25 DESC, id) AS rank
  FROM kw_top
)`;
}

/**
 * Fusion: which legs feed the result, and how their ranks combine.
 *
 * - vector:  the vector leg alone; score = cosine.
 * - keyword: the keyword leg alone; score = bm25.
 * - hybrid:  a full outer join of both; score = w_v / (k + vector_rank) +
 *            w_k / (k + keyword_rank), a leg that did not rank the record
 *            contributing 0 (reciprocal rank fusion).
 *
 * Every candidate is joined back to its row for a cosine, so a keyword-only
 * hit carries one too; that is what `minScore` floors, in every mode.
 */
function fusionCte(mode: SearchMode): string {
  switch (mode) {
    case "vector":
      return `fused AS (
  SELECT id, rank AS vector_rank, NULL::bigint AS keyword_rank, NULL::float8 AS bm25
  FROM vec
)`;
    case "keyword":
      return `fused AS (
  SELECT id, NULL::bigint AS vector_rank, rank AS keyword_rank, bm25
  FROM kw
)`;
    case "hybrid":
      return `fused AS (
  SELECT coalesce(v.id, k.id) AS id, v.rank AS vector_rank, k.rank AS keyword_rank, k.bm25
  FROM vec v
  FULL OUTER JOIN kw k ON k.id = v.id
)`;
  }
}

function scoreExpression(
  mode: SearchMode,
  q: string,
  params: Params,
  rrfK: number,
  weights: { vector: number; keyword: number },
): string {
  switch (mode) {
    case "vector":
      return `1 - (p.embedding <=> ${q})`;
    case "keyword":
      return "f.bm25";
    case "hybrid": {
      const k = `${params.add(rrfK)}::float8`;
      const wVector = `${params.add(weights.vector)}::float8`;
      const wKeyword = `${params.add(weights.keyword)}::float8`;
      return `coalesce(${wVector} / (${k} + f.vector_rank), 0) + coalesce(${wKeyword} / (${k} + f.keyword_rank), 0)`;
    }
  }
}

interface SearchPlan {
  text: string;
  params: unknown[];
  efSearch: number;
}

/** Validates the query and builds the one statement that answers it. */
function searchPlan(query: IndexSearch, dimensions: number): SearchPlan {
  const { mode, limit } = query;
  if (!SEARCH_MODES.has(mode)) throw new Error(`unknown search mode ${JSON.stringify(mode)}`);
  if (!isPositiveInt(limit)) throw new Error(`limit must be a positive integer, got ${limit}`);
  const candidates = query.candidates ?? Math.max(4 * limit, MIN_CANDIDATES);
  if (!isPositiveInt(candidates)) throw new Error(`candidates must be a positive integer, got ${candidates}`);
  const rrfK = query.rrfK ?? DEFAULT_RRF_K;
  if (!Number.isFinite(rrfK) || rrfK < 0) throw new Error(`rrfK must be a non-negative number, got ${rrfK}`);
  const weights = query.weights ?? { vector: 1, keyword: 1 };
  if (!Number.isFinite(weights.vector) || !Number.isFinite(weights.keyword)) {
    throw new Error(`weights must be finite numbers, got ${JSON.stringify(weights)}`);
  }
  if (query.minScore !== undefined && !Number.isFinite(query.minScore)) {
    throw new Error(`minScore must be a finite number, got ${query.minScore}`);
  }
  checkVector(query.vector, dimensions, "the query");

  const params = new Params();
  const q = `${params.add(vectorLiteral(query.vector))}::vector`;
  const candidatesP = `${params.add(candidates)}::int`;

  const ctes = [filteredCte(query.filters, params)];
  if (mode !== "keyword") ctes.push(vectorLeg(q, candidatesP));
  if (mode !== "vector") ctes.push(keywordLeg(params.add(query.text), candidatesP));
  ctes.push(fusionCte(mode));

  const score = scoreExpression(mode, q, params, rrfK, weights);
  const floor = query.minScore !== undefined ? `\nWHERE cosine >= ${params.add(query.minScore)}::float8` : "";

  const text = `WITH
${ctes.join(",\n")},
scored AS (
  SELECT f.id, 1 - (p.embedding <=> ${q}) AS cosine, f.bm25, f.vector_rank, f.keyword_rank,
    (${score})::float8 AS score
  FROM fused f
  JOIN retrieval_propositions p ON p.id = f.id
)
SELECT id, score, cosine, bm25, vector_rank, keyword_rank
FROM scored${floor}
ORDER BY score DESC, cosine DESC, id ASC
LIMIT ${params.add(limit)}::int`;

  return {
    text,
    params: params.values,
    efSearch: Math.min(Math.max(candidates, MIN_EF_SEARCH), MAX_EF_SEARCH),
  };
}

// --- values crossing the driver boundary -------------------------------------

/** pgvector's text form. `JSON.stringify` of a number array is exactly it. */
function vectorLiteral(vector: Vector): string {
  return JSON.stringify(vector);
}

function isPositiveInt(n: number): boolean {
  return Number.isInteger(n) && n > 0;
}

function checkVector(vector: Vector, dimensions: number, what: string): void {
  if (vector.length !== dimensions) {
    throw new Error(`${what} has a ${vector.length}-dimensional vector; the index is ${dimensions}-dimensional`);
  }
  for (const x of vector) {
    if (!Number.isFinite(x)) throw new Error(`${what} has a non-finite vector component`);
  }
}

function checkExtractedAt(id: string, extractedAt: string): void {
  if (!/^\d{4}-\d{2}-\d{2}/.test(extractedAt)) {
    throw new Error(`record ${id}: extractedAt must be an ISO 8601 timestamp, got ${JSON.stringify(extractedAt)}`);
  }
}

/** Drivers hand back numbers, or strings for wide numeric types. */
function num(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

function nullableNum(value: unknown): number | null {
  return value === null || value === undefined ? null : num(value);
}

/** Drivers hand back `Date` for timestamps; the contract says ISO strings. */
function isoTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const text = String(value);
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? text : new Date(parsed).toISOString();
}

interface MetaRow {
  schema_version: unknown;
  model: unknown;
  dimensions: unknown;
}

interface RecordRow {
  id: unknown;
  text: unknown;
  type: unknown;
  speaker: unknown;
  meeting_id: unknown;
  window_index: unknown;
  extracted_at: unknown;
  confidence: unknown;
  created_at: unknown;
}

interface HitRow {
  id: unknown;
  score: unknown;
  cosine: unknown;
  bm25: unknown;
  vector_rank: unknown;
  keyword_rank: unknown;
}

function toRecord(row: RecordRow): IndexedRecord {
  return {
    id: String(row.id),
    text: String(row.text),
    metadata: {
      type: String(row.type),
      speaker: String(row.speaker ?? ""),
      meetingId: String(row.meeting_id),
      windowIndex: num(row.window_index),
      extractedAt: String(row.extracted_at),
      confidence: num(row.confidence),
    },
    createdAt: isoTimestamp(row.created_at),
  };
}

function toHit(row: HitRow): IndexHit {
  return {
    id: String(row.id),
    score: num(row.score),
    cosine: num(row.cosine),
    bm25: nullableNum(row.bm25),
    vectorRank: nullableNum(row.vector_rank),
    keywordRank: nullableNum(row.keyword_rank),
  };
}

// --- open -------------------------------------------------------------------

/** For error messages. A URL's credentials stay out of them. */
function describeTarget(target: IndexTarget): string {
  try {
    const url = new URL(target.url);
    return `at ${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return "at the given url";
  }
}

function describeShape(model: string, dimensions: number, schemaVersion: number): string {
  return `model ${JSON.stringify(model)}, ${dimensions} dimensions, schema v${schemaVersion}`;
}

interface SchemaOptions {
  model: string;
  dimensions: number;
  reset: boolean;
  target: string;
}

/**
 * Creates what is missing, verifies what is there. Runs in one transaction,
 * so a failed check leaves nothing half-built.
 */
async function prepareSchema(tx: SqlExecutor, { model, dimensions, reset, target }: SchemaOptions): Promise<void> {
  await tx.query("CREATE EXTENSION IF NOT EXISTS vector");
  if (reset) await tx.query(DROP_ALL);
  await tx.query(CREATE_META);

  const [meta] = await tx.query<MetaRow>("SELECT schema_version, model, dimensions FROM retrieval_index_meta WHERE id = 1");
  if (!meta) {
    await tx.query("INSERT INTO retrieval_index_meta (id, schema_version, model, dimensions) VALUES (1, $1::int, $2, $3::int)", [
      SCHEMA_VERSION,
      model,
      dimensions,
    ]);
  } else {
    const held = { model: String(meta.model), dimensions: num(meta.dimensions), schemaVersion: num(meta.schema_version) };
    if (held.model !== model || held.dimensions !== dimensions || held.schemaVersion !== SCHEMA_VERSION) {
      // A store queried with the wrong model returns confident nonsense, so
      // this is an error, not a warning.
      throw new Error(
        `retrieval index ${target} holds ${describeShape(held.model, held.dimensions, held.schemaVersion)} ` +
          `but this run uses ${describeShape(model, dimensions, SCHEMA_VERSION)}. ` +
          "Open it with reset: true (for the eval, EVAL_REINDEX=1) and re-index.",
      );
    }
  }

  await tx.query(createPropositions(dimensions));
  await tx.query(CREATE_POSTINGS);
  for (const statement of CREATE_INDEXES) await tx.query(statement);
}

/** `hnsw.iterative_scan` arrived in pgvector 0.8; setting it on an older server is an error. */
async function supportsIterativeScan(sql: SqlClient): Promise<boolean> {
  const [row] = await sql.query<{ extversion: unknown }>("SELECT extversion FROM pg_extension WHERE extname = 'vector'");
  const [major = 0, minor = 0] = String(row?.extversion ?? "0.0").split(".").map(Number);
  return major > 0 || minor >= 8;
}

/**
 * Open (creating if needed) the index behind `options`. Throws, with the
 * database closed again, when the target holds vectors from another model or
 * width and `reset` is not set.
 */
export async function openIndex(options: OpenIndexOptions): Promise<VectorIndex> {
  const { model, dimensions, reset = false } = options;
  if (typeof model !== "string" || model.length === 0) throw new Error("model must be a non-empty string");
  if (!isPositiveInt(dimensions) || dimensions > MAX_DIMENSIONS) {
    throw new Error(`dimensions must be an integer from 1 to ${MAX_DIMENSIONS} (pgvector's HNSW limit), got ${dimensions}`);
  }

  if (typeof options.url !== "string" || options.url.length === 0) throw new Error("url must be a postgres:// connection string");
  const sql = openBunSql(options.url);
  try {
    await sql.transaction((tx) => prepareSchema(tx, { model, dimensions, reset, target: describeTarget(options) }));
    const relaxedOrder = await supportsIterativeScan(sql);
    return new PgVectorIndex(sql, model, dimensions, relaxedOrder);
  } catch (error) {
    await sql.close();
    throw error;
  }
}

class PgVectorIndex implements VectorIndex {
  readonly model: string;
  readonly dimensions: number;
  readonly #sql: SqlClient;
  readonly #relaxedOrder: boolean;
  #closed = false;

  constructor(sql: SqlClient, model: string, dimensions: number, relaxedOrder: boolean) {
    this.#sql = sql;
    this.model = model;
    this.dimensions = dimensions;
    this.#relaxedOrder = relaxedOrder;
  }

  async upsert(records: readonly IndexRecord[]): Promise<void> {
    if (records.length === 0) return;
    // Every record is checked before any is written: a bad batch is rejected whole.
    for (const record of records) {
      checkVector(record.vector, this.dimensions, `record ${record.id}`);
      checkExtractedAt(record.id, record.metadata.extractedAt);
    }

    await this.#sql.transaction(async (tx) => {
      for (const { id, text, vector, metadata } of records) {
        await tx.query(UPSERT_PROPOSITION, [
          id,
          text,
          vectorLiteral(vector),
          metadata.type,
          metadata.speaker,
          metadata.meetingId,
          metadata.windowIndex,
          metadata.extractedAt,
          metadata.confidence,
        ]);
        await tx.query(DELETE_POSTINGS, [id]);
        await tx.query(INSERT_POSTINGS, [id, text]);
      }
    });
  }

  async remove(ids: readonly string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const rows = await this.#sql.query<{ id: unknown }>(DELETE_PROPOSITIONS, [[...ids]]);
    return rows.length;
  }

  async getMany(ids: readonly string[]): Promise<IndexedRecord[]> {
    if (ids.length === 0) return [];
    const rows = await this.#sql.query<RecordRow>(SELECT_RECORDS, [[...ids]]);
    return rows.map(toRecord);
  }

  async count(): Promise<number> {
    const [row] = await this.#sql.query<{ n: unknown }>(COUNT);
    return num(row?.n ?? 0);
  }

  /** Empties the records; the meta row — model, width, version — stays. */
  async clear(): Promise<void> {
    await this.#sql.query(CLEAR);
  }

  async search(query: IndexSearch): Promise<IndexHit[]> {
    const plan = searchPlan(query, this.dimensions);
    const rows = await this.#sql.transaction(async (tx) => {
      // Literals, not parameters: SET takes no parameters, and both values
      // are integers or constants checked above.
      await tx.query(`SET LOCAL hnsw.ef_search = ${plan.efSearch}`);
      // Keep scanning when a filter discards most of the nearest neighbours,
      // instead of returning a silently short list.
      if (this.#relaxedOrder) await tx.query("SET LOCAL hnsw.iterative_scan = 'relaxed_order'");
      return tx.query<HitRow>(plan.text, plan.params);
    });
    return rows.map(toHit);
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.#sql.close();
  }
}
