// Measure retrieval quality against a golden query set instead of eyeballing it.
//
//   node eval-retrieval.ts [--store data/claims.json] [--top 5] [--min 0.6]
//
// Metrics:
//   hit@1     fraction of queries whose #1 result is relevant
//   hit@3     fraction with a relevant result in the top 3
//   recall@k  fraction with a relevant result anywhere in the top k
//   MRR       mean of 1/rank of the first relevant result (0 if absent)
//
// Out-of-domain queries expect NOTHING above --min; they measure whether the
// score floor actually rejects questions the corpus cannot answer.
import { readFileSync } from 'node:fs';
import { JsonVectorStore, type SearchHit } from './lib/store.ts';

interface GoldenQuery {
  query: string;
  /** Case-insensitive substrings; a hit matching any of them counts as relevant. */
  expect: string[];
  kind: string;
}

const args = process.argv.slice(2);
function flag(name: string, fallback: string): string {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : (args[i + 1] ?? fallback);
}

const storePath = flag('store', 'data/claims.json');
const topK = Number(flag('top', '5'));
const minScore = Number(flag('min', '0.6'));

const golden = JSON.parse(readFileSync('fixtures/golden-queries.json', 'utf8')) as GoldenQuery[];
const store = JsonVectorStore.open(storePath);

if (store.size === 0) {
  console.error(`store ${storePath} is empty — run: node import-claims.ts fixtures/meetiq-claims.json --store ${storePath}`);
  process.exit(1);
}

function isRelevant(hit: SearchHit, expect: string[]): boolean {
  const text = hit.text.toLowerCase();
  return expect.some((e) => text.includes(e.toLowerCase()));
}

const answerable = golden.filter((g) => g.expect.length > 0);
const outOfDomain = golden.filter((g) => g.expect.length === 0);

console.log(`store: ${storePath}  (${store.size} propositions)`);
console.log(`golden set: ${answerable.length} answerable + ${outOfDomain.length} out-of-domain`);
console.log(`top-k=${topK}  min=${minScore}\n`);

let hit1 = 0;
let hit3 = 0;
let hitK = 0;
let mrr = 0;
const failures: Array<{ q: string; got: SearchHit[] }> = [];
/** Top-1 score per query, used for the threshold-window analysis below. */
const answerableTop: number[] = [];
const outOfDomainTop: number[] = [];

console.log('rank of first relevant result');
console.log('-'.repeat(78));

for (const g of answerable) {
  const hits = await store.search(g.query, { topK });
  const rank = hits.findIndex((h) => isRelevant(h, g.expect)) + 1; // 0 => not found

  if (rank === 1) hit1++;
  if (rank >= 1 && rank <= 3) hit3++;
  if (rank >= 1) {
    hitK++;
    mrr += 1 / rank;
  } else {
    failures.push({ q: g.query, got: hits });
  }

  const mark = rank === 1 ? 'OK ' : rank >= 1 ? `#${rank} ` : 'MISS';
  const top = hits[0];
  if (top) answerableTop.push(top.score);
  const score = top ? top.score.toFixed(3) : '-';
  console.log(`${mark} [${score}] ${g.query}`);
  if (rank !== 1 && top) console.log(`       got: ${top.text.slice(0, 68)}`);
}

const n = answerable.length;
const pct = (x: number): string => `${((x / n) * 100).toFixed(0)}%`;

console.log('-'.repeat(78));
console.log(`hit@1     ${hit1}/${n}  ${pct(hit1)}`);
console.log(`hit@3     ${hit3}/${n}  ${pct(hit3)}`);
console.log(`recall@${topK}  ${hitK}/${n}  ${pct(hitK)}`);
console.log(`MRR       ${(mrr / n).toFixed(3)}`);

console.log(`\nout-of-domain rejection at min=${minScore}`);
console.log('-'.repeat(78));
let rejected = 0;
for (const g of outOfDomain) {
  const kept = await store.search(g.query, { topK, minScore });
  const best = await store.search(g.query, { topK: 1 });
  const bestScore = best[0]?.score ?? 0;
  outOfDomainTop.push(bestScore);
  if (kept.length === 0) rejected++;
  console.log(
    `${kept.length === 0 ? 'OK  ' : 'LEAK'} best=${bestScore.toFixed(3)}  ${g.query}`,
  );
  if (kept.length > 0) console.log(`       leaked: ${kept[0]!.text.slice(0, 66)}`);
}
console.log(`rejected  ${rejected}/${outOfDomain.length}`);

// The threshold that matters is the one separating "the corpus can answer this"
// from "it cannot". Report the actual window rather than trusting --min.
console.log('\nthreshold window');
console.log('-'.repeat(78));
const lowestAnswerable = Math.min(...answerableTop);
const highestOutOfDomain = outOfDomainTop.length > 0 ? Math.max(...outOfDomainTop) : 0;
console.log(`weakest answerable query scored   ${lowestAnswerable.toFixed(3)}`);
console.log(`strongest out-of-domain scored    ${highestOutOfDomain.toFixed(3)}`);
const margin = lowestAnswerable - highestOutOfDomain;
if (margin > 0) {
  const mid = (lowestAnswerable + highestOutOfDomain) / 2;
  console.log(`=> any min in (${highestOutOfDomain.toFixed(3)}, ${lowestAnswerable.toFixed(3)}) separates them; midpoint ${mid.toFixed(3)}`);
  console.log(`=> margin is only ${margin.toFixed(3)} wide — a single new question can close it.`);
} else {
  console.log('=> NO threshold separates them: an out-of-domain query outscores a real one.');
}

if (failures.length > 0) {
  console.log(`\nmisses (nothing relevant in top ${topK})`);
  console.log('-'.repeat(78));
  for (const f of failures) {
    console.log(`? ${f.q}`);
    for (const h of f.got.slice(0, 3)) {
      console.log(`   ${h.score.toFixed(3)} ${h.text.slice(0, 66)}`);
    }
  }
}
