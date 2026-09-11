// A whole tiny RAG retrieval loop: embed a corpus once as DOCUMENTs,
// embed queries as QUERYs, rank by cosine. Note the asymmetric taskTypes.
import { embedBatch, embed, cosine, withRetry } from './lib/gemini.ts';

const DOCS: string[] = [
  'Ollama serves local GGUF models over an HTTP API on port 11434.',
  'The proxy exposes an OpenAI-compatible /v1/chat/completions endpoint.',
  'Set NUM_GPU to control how many transformer layers are offloaded to the GPU.',
  'Structured output is validated with Ajv against the supplied JSON schema.',
  'Laptop NVIDIA drivers suspend an idle dGPU, which halves generation speed.',
  'Tool calls are parsed out of the model text and repaired when malformed.',
  'Bun runs the TypeScript server directly without a build step.',
  'Rate limits on the free tier return HTTP 429 with a retry delay.',
];

const QUERIES: string[] = [
  'why is my generation slow on a laptop',
  'how do I make the model return valid JSON',
  'which port does the local model server listen on',
];

const TOP_K = 3;

interface Hit {
  doc: string;
  score: number;
}

console.log(`indexing ${DOCS.length} documents...`);
const { vectors: docVecs, ms } = await withRetry(() =>
  embedBatch(DOCS, { taskType: 'RETRIEVAL_DOCUMENT', dimensions: 768 }),
);
console.log(`indexed in ${ms} ms (${docVecs[0]!.length}d)\n`);

for (const q of QUERIES) {
  const { values: qv } = await withRetry(() =>
    embed(q, { taskType: 'RETRIEVAL_QUERY', dimensions: 768 }),
  );
  const hits: Hit[] = DOCS.map((doc, i) => ({ doc, score: cosine(qv, docVecs[i]!) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K);

  console.log(`? ${q}`);
  hits.forEach((h, i) => console.log(`  ${i + 1}. [${h.score.toFixed(4)}] ${h.doc}`));
  console.log();
}
