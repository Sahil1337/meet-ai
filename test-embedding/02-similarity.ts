// Cosine similarity between a probe sentence and a set of others.
// Expect: paraphrases high, same-topic middling, unrelated low.
import { embedBatch, cosine, withRetry, bar, type Vector } from './lib/gemini.ts';

const probe = 'How do I reset my password?';
const candidates: string[] = [
  'I forgot my login credentials, how can I recover access?', // paraphrase
  'What are the steps to change my account password?', // paraphrase
  'Where do I update my billing address?', // same domain, different intent
  'Our support team replies within 24 hours.', // same domain, unrelated intent
  'The mitochondria is the powerhouse of the cell.', // unrelated
  'मैं अपना पासवर्ड कैसे रीसेट करूँ?', // same meaning, other language
];

const texts = [probe, ...candidates];
const { vectors, ms } = await withRetry(() =>
  embedBatch(texts, { taskType: 'SEMANTIC_SIMILARITY', dimensions: 768 }),
);

const probeVec: Vector = vectors[0]!;

console.log(`probe: ${probe}`);
console.log(`(${texts.length} texts in one batch call, ${probeVec.length}d, ${ms} ms)\n`);

candidates
  .map((text, i) => ({ text, score: cosine(probeVec, vectors[i + 1]!) }))
  .sort((a, b) => b.score - a.score)
  .forEach(({ text, score }) => {
    console.log(`${score.toFixed(4)}  ${bar(score)}  ${text}`);
  });
