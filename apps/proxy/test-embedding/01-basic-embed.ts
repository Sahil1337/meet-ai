// What a single embedding actually looks like: dimensions, magnitude, latency.
import { embed, withRetry, norm, DEFAULT_MODEL } from './lib/gemini.ts';

const text = process.argv.slice(2).join(' ') || 'The quick brown fox jumps over the lazy dog.';

console.log(`model: ${DEFAULT_MODEL}`);
console.log(`text : ${JSON.stringify(text)}\n`);

const { values, ms } = await withRetry(() => embed(text, { taskType: 'SEMANTIC_SIMILARITY' }));

console.log(`dimensions : ${values.length}`);
console.log(`latency    : ${ms} ms`);
console.log(`L2 norm    : ${norm(values).toFixed(6)}`);
console.log(`min / max  : ${Math.min(...values).toFixed(5)} / ${Math.max(...values).toFixed(5)}`);
console.log(`first 12   : [${values.slice(0, 12).map((v) => v.toFixed(5)).join(', ')} ...]`);
