// Minimal Gemini embeddings client over the REST API (no SDK, no deps).
// Docs: https://ai.google.dev/gemini-api/docs/embeddings
import { requireApiKey, loadEnv } from './env.ts';

loadEnv();

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const DEFAULT_MODEL: string = process.env.EMBED_MODEL ?? 'gemini-embedding-001';

// taskType tunes the vector for how you'll use it. Query and document sides of
// a search index must use the matching pair, or recall drops noticeably.
export const TASK_TYPES = [
  'RETRIEVAL_QUERY',
  'RETRIEVAL_DOCUMENT',
  'SEMANTIC_SIMILARITY',
  'CLASSIFICATION',
  'CLUSTERING',
  'QUESTION_ANSWERING',
  'FACT_VERIFICATION',
  'CODE_RETRIEVAL_QUERY',
] as const;

export type TaskType = (typeof TASK_TYPES)[number];

/** Dimensions the model supports via Matryoshka truncation. Any int 128..3072 works. */
export type Dimensions = 128 | 256 | 512 | 768 | 1536 | 3072 | (number & {});

export interface EmbedOptions {
  model?: string;
  taskType?: TaskType;
  /** Only meaningful for RETRIEVAL_DOCUMENT. */
  title?: string;
  dimensions?: Dimensions;
}

export type Vector = number[];

interface EmbedRequest {
  model: string;
  content: { parts: Array<{ text: string }> };
  taskType?: TaskType;
  title?: string;
  outputDimensionality?: number;
}

interface EmbedContentResponse {
  embedding: { values: Vector };
}

interface BatchEmbedResponse {
  embeddings: Array<{ values: Vector }>;
}

interface Timed<T> {
  ms: number;
  json: T;
}

const FULL_DIM = 3072;

async function call<T>(path: string, body: unknown): Promise<Timed<T>> {
  const key = requireApiKey();
  const started = Date.now();
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Gemini ${res.status} ${res.statusText}: ${text.slice(0, 600)}`);
  }
  return { json: JSON.parse(text) as T, ms: Date.now() - started };
}

function buildRequest(model: string, text: string, opts: EmbedOptions): EmbedRequest {
  const req: EmbedRequest = { model: `models/${model}`, content: { parts: [{ text }] } };
  if (opts.taskType !== undefined) req.taskType = opts.taskType;
  if (opts.title !== undefined) req.title = opts.title;
  if (opts.dimensions !== undefined) req.outputDimensionality = opts.dimensions;
  return req;
}

/** Embed one string. */
export async function embed(
  text: string,
  opts: EmbedOptions = {},
): Promise<{ values: Vector; ms: number }> {
  const model = opts.model ?? DEFAULT_MODEL;
  const { json, ms } = await call<EmbedContentResponse>(
    `models/${model}:embedContent`,
    buildRequest(model, text, opts),
  );

  let values = json.embedding.values;
  // Truncated MRL outputs come back un-normalized; the 3072-d default does not.
  if (opts.dimensions !== undefined && opts.dimensions !== FULL_DIM) values = normalize(values);
  return { values, ms };
}

/** Embed many strings in one request. */
export async function embedBatch(
  texts: string[],
  opts: EmbedOptions = {},
): Promise<{ vectors: Vector[]; ms: number }> {
  const model = opts.model ?? DEFAULT_MODEL;
  const requests = texts.map((text) => buildRequest(model, text, opts));

  const { json, ms } = await call<BatchEmbedResponse>(`models/${model}:batchEmbedContents`, {
    requests,
  });

  let vectors = json.embeddings.map((e) => e.values);
  if (opts.dimensions !== undefined && opts.dimensions !== FULL_DIM) vectors = vectors.map(normalize);
  return { vectors, ms };
}

export function norm(v: Vector): number {
  let sum = 0;
  for (const x of v) sum += x * x;
  return Math.sqrt(sum);
}

export function normalize(v: Vector): Vector {
  const n = norm(v);
  return n === 0 ? v : v.map((x) => x / n);
}

export function dot(a: Vector, b: Vector): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

export function cosine(a: Vector, b: Vector): number {
  if (a.length !== b.length) throw new Error(`dim mismatch: ${a.length} vs ${b.length}`);
  return dot(a, b) / (norm(a) * norm(b));
}

export interface RetryOptions {
  tries?: number;
  baseMs?: number;
}

/** Retry wrapper for 429/5xx — the free tier rate-limits quickly. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  { tries = 4, baseMs = 1500 }: RetryOptions = {},
): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const message = err instanceof Error ? err.message : String(err);
      const retryable = /\b(429|500|503|504)\b/.test(message);
      if (!retryable || i === tries - 1) throw err;
      const wait = baseMs * 2 ** i;
      console.warn(`  retrying in ${wait}ms (${message.slice(0, 80)})`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw last;
}

export function bar(score: number, width = 28): string {
  const filled = Math.max(0, Math.min(width, Math.round(((score + 1) / 2) * width)));
  return '█'.repeat(filled) + '·'.repeat(width - filled);
}
