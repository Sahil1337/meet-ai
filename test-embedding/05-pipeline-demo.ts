// End-to-end: propositions in -> JSON store -> retrieval out.
// Uses its own store file so it never disturbs data/store.json.
import { JsonVectorStore } from './lib/store.ts';
import { statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const path = join(dirname(fileURLToPath(import.meta.url)), 'data', 'demo-store.json');
const store = JsonVectorStore.open(path);
store.clear();

const PROPOSITIONS: Array<[string, string]> = [
  ['The proxy exposes an OpenAI-compatible /v1/chat/completions endpoint.', 'api'],
  ['Ollama serves local GGUF models over HTTP on port 11434.', 'ops'],
  ['NUM_GPU controls how many of the 34 layers are offloaded to the GPU.', 'ops'],
  ['Structured output is validated with Ajv against the supplied JSON schema.', 'api'],
  ['Laptop NVIDIA drivers suspend an idle dGPU, halving generation speed.', 'ops'],
  ['Malformed tool calls are parsed out of the model text and repaired.', 'api'],
  ['Set API_KEY to require a bearer token on every /v1 route.', 'security'],
  ['Logs are written by pino and can be switched to JSON with LOG_FORMAT.', 'ops'],
];

console.log(`indexing ${PROPOSITIONS.length} propositions...`);
const t0 = Date.now();
// One batch call per metadata group — cheaper than one call per proposition.
for (const topic of [...new Set(PROPOSITIONS.map(([, t]) => t))]) {
  const texts = PROPOSITIONS.filter(([, t]) => t === topic).map(([text]) => text);
  await store.addMany(texts, { topic });
}
console.log(`indexed ${store.size} records in ${Date.now() - t0} ms`);
console.log(`store file: ${(statSync(path).size / 1024).toFixed(0)} KB\n`);

const QUERIES = [
  'how do I lock down the server so strangers cannot call it',
  'my tokens per second dropped on battery power',
  'making the model reply in a fixed JSON shape',
];

for (const q of QUERIES) {
  const hits = await store.search(q, { topK: 3 });
  console.log(`? ${q}`);
  for (const [i, h] of hits.entries()) {
    console.log(`  ${i + 1}. ${h.score.toFixed(4)} [${h.metadata.topic}] ${h.text}`);
  }
  console.log();
}

console.log('--- metadata filter: same query, restricted to topic=ops ---\n');
const q = 'how do I control the GPU';
for (const filter of [undefined, { topic: 'ops' }]) {
  const hits = await store.search(q, { topK: 2, ...(filter ? { filter } : {}) });
  console.log(`${filter ? 'topic=ops ' : 'unfiltered'}:`);
  for (const h of hits) console.log(`  ${h.score.toFixed(4)} [${h.metadata.topic}] ${h.text}`);
}

console.log('\n--- minScore: rejecting an out-of-domain question ---\n');
const off = 'what is the best recipe for banana bread';
const strict = await store.search(off, { topK: 3, minScore: 0.6 });
console.log(`? ${off}`);
console.log(strict.length === 0 ? '  correctly returned nothing above 0.60' : '  hits:');
for (const h of strict) console.log(`  ${h.score.toFixed(4)} ${h.text}`);

const loose = await store.search(off, { topK: 1 });
console.log(`  (best raw score was ${loose[0]!.score.toFixed(4)} — why a floor matters)`);
