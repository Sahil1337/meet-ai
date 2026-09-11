// Two knobs worth understanding before you commit to a vector store:
//   1. outputDimensionality — MRL truncation. Smaller = cheaper storage.
//   2. taskType — the same text yields different vectors per task.
import { embed, cosine, withRetry, type TaskType, type Vector } from './lib/gemini.ts';

const A = 'The server crashed after the latest deploy.';
const B = 'Production went down following the most recent release.';
const C = 'I baked sourdough bread this weekend.';

console.log('--- outputDimensionality: does truncation preserve the ranking? ---\n');
for (const d of [128, 768, 1536, 3072] as const) {
  const [a, b, c] = await Promise.all(
    [A, B, C].map((t) =>
      withRetry(() => embed(t, { taskType: 'SEMANTIC_SIMILARITY', dimensions: d })),
    ),
  );
  const bytes = d * 4;
  console.log(
    `${String(d).padStart(4)}d (${String(bytes).padStart(5)} B/vec float32)  ` +
      `related=${cosine(a!.values, b!.values).toFixed(4)}  ` +
      `unrelated=${cosine(a!.values, c!.values).toFixed(4)}`,
  );
}

console.log('\n--- taskType: same text, different vectors ---\n');
const tasks: TaskType[] = [
  'SEMANTIC_SIMILARITY',
  'RETRIEVAL_DOCUMENT',
  'CLASSIFICATION',
  'CLUSTERING',
];
const byTask = new Map<TaskType, Vector>();
for (const t of tasks) {
  byTask.set(t, (await withRetry(() => embed(A, { taskType: t, dimensions: 768 }))).values);
}
for (const t of tasks) {
  const row = tasks.map((u) => cosine(byTask.get(t)!, byTask.get(u)!).toFixed(3)).join('  ');
  console.log(`${t.padEnd(20)} ${row}`);
}
console.log(`${' '.repeat(20)} ${tasks.map((t) => t.slice(0, 5).padEnd(5)).join('  ')}`);
console.log('\nOff-diagonal < 1.0 => query and document sides must use the matching pair.');
