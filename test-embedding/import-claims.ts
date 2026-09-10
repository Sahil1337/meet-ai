// Load extractor output (the JSON your extraction model emits) into the store.
//
//   node import-claims.ts fixtures/meetiq-claims.json [--store data/claims.json]
//
// Each proposition becomes one record; `speaker`, `type`, `confidence` and the
// source chunk ride along as metadata so retrieval can filter on them later.
import { readFileSync } from 'node:fs';
import { JsonVectorStore, type Metadata } from './lib/store.ts';

export interface ExtractedProposition {
  text: string;
  speaker: string | null;
  type: string;
  confidence: number;
}

export interface ExtractionChunk {
  fixture: string;
  propositions: ExtractedProposition[];
  /** Present in real extractor output; ignored here. */
  transcript?: string;
  status?: string;
  warnings?: string[];
  ms?: number;
}

export function flatten(chunks: ExtractionChunk[]): Array<{ text: string; metadata: Metadata }> {
  return chunks.flatMap((chunk, chunkIndex) =>
    chunk.propositions.map((p) => ({
      text: p.text,
      metadata: {
        // `speaker` is nullable in the extractor output; JSON metadata has no
        // null, so unattributed claims get an explicit sentinel you can filter on.
        speaker: p.speaker ?? 'unattributed',
        type: p.type,
        confidence: p.confidence,
        chunk: chunkIndex + 1,
        source: chunk.fixture,
      },
    })),
  );
}

const args = process.argv.slice(2);
const path = args.find((a) => !a.startsWith('--'));
const storeFlag = args.indexOf('--store');
const storePath = storeFlag === -1 ? undefined : args[storeFlag + 1];

if (!path) {
  console.error('usage: node import-claims.ts <extraction.json> [--store data/claims.json]');
  process.exit(1);
}

const chunks = JSON.parse(readFileSync(path, 'utf8')) as ExtractionChunk[];
const items = flatten(chunks);
console.log(`${chunks.length} chunk(s) -> ${items.length} propositions`);

const store = JsonVectorStore.open(storePath);
store.clear();

// One batch call per chunk. Batching is the whole game: 44 propositions in 7
// calls takes a few seconds, the same 44 in ~40 calls takes half a minute.
const t0 = Date.now();
for (const [i] of chunks.entries()) {
  const forChunk = items.filter((it) => it.metadata.chunk === i + 1);
  await store.addItems(forChunk);
  process.stdout.write(`  chunk ${i + 1}/${chunks.length} indexed (${store.size} total)\r`);
}

console.log(`\nindexed ${store.size} propositions in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`store: ${store.path}  (${(store.bytesOnDisk / 1024).toFixed(0)} KB)`);

const dropped = items.length - store.size;
if (dropped > 0) {
  console.log(`\nNOTE: ${dropped} proposition(s) collapsed as exact duplicates (ids are content hashes).`);
}
