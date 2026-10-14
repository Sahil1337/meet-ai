/**
 * Retrieval eval: index a set of extracted claims, run a golden query set
 * against them — once per search mode — and print metrics instead of
 * eyeballing a few searches.
 *
 *   GEMINI_API_KEY=... bun run eval:retrieval               # vector, keyword, hybrid
 *   EVAL_MODE=vector GEMINI_API_KEY=... bun run eval:retrieval
 *
 * This is the eval `docs/architecture.md` gates hybrid search and reranking on.
 * "Hybrid beats vector-only" is a row in the table this prints, not a belief;
 * "the reranker helped" is unfalsifiable without the baseline this produces —
 * and a reranker is exactly the kind of component that feels like it is working.
 *
 * The index is the Postgres at DATABASE_URL, so a second run costs no embedding
 * calls beyond the queries.
 * Set EVAL_REINDEX=1 after changing the claims or the model.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Proposition, SearchHit } from "@meetai/core";
import {
  GeminiEmbedder,
  HybridSearcher,
  openIndex,
  PropositionIndexer,
  type IndexedRecord,
  type SearchMode,
} from "@meetai/retrieval";
import { loadEvalEnv } from "./env.ts";
import { grade, isOutOfDomain, summarize, type GoldenQuery, type GradedQuery, type Summary } from "./metrics.ts";

const env = loadEvalEnv();
const fixtures = join(import.meta.dir, "..", "fixtures");

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

/** One tag per hit on the per-query line: which leg found it. */
const VIA_TAG: Record<SearchHit["via"], string> = { vector: "v", keyword: "k", hybrid: "vk" };

/**
 * The propositions eval writes `out/latest/claims.json` in exactly this shape,
 * so its output is this eval's input — extraction quality and retrieval quality
 * measured over the same claims.
 */
interface ClaimsFile {
  fixture: string;
  propositions: Array<{ text: string; type: string; speaker: string | null; confidence: number }>;
}

/**
 * Fill in the fields a persisted `Proposition` has and a raw extraction does
 * not. The eval never stores these, so synthetic ids are fine — but they are
 * stable across runs (index position), so a cached index still matches.
 */
function asPropositions(file: ClaimsFile[]): Proposition[] {
  const now = new Date().toISOString();
  return file.flatMap((entry, windowIndex) =>
    entry.propositions.map((p, i) => ({
      ...p,
      type: p.type as Proposition["type"],
      id: `eval-${windowIndex}-${i}`,
      meetingId: "eval-meeting",
      windowIndex,
      evidence: { meetingId: "eval-meeting", lineIndexes: [0] },
      extractorVersion: "eval-fixture",
      extractedAt: now,
    })),
  );
}

/** Where the index lives, for the log — never the URL itself, which may carry a password. */
function describeTarget(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  return `Postgres at ${url.host}${url.pathname}`;
}

function printQuery(query: GoldenQuery, result: GradedQuery, via: readonly string[]): void {
  const mark = result.passed ? green("pass") : red("FAIL");
  const rank = isOutOfDomain(query)
    ? `${result.hits.length} above floor`
    : result.firstRelevantRank > 0
      ? `rank ${result.firstRelevantRank}`
      : "not found";
  const tags = via.length > 0 ? ` · via ${via.join(" ")}` : "";
  const top = result.hits[0] ? ` · top ${result.hits[0].score.toFixed(3)}: ${result.hits[0].text.slice(0, 72)}` : "";
  console.log(`  ${mark}  ${dim(`[${query.kind}]`)} ${query.query}`);
  console.log(dim(`        ${rank}${tags}${top}`));
}

const claimsPath = env.EVAL_CLAIMS ?? join(fixtures, "claims.json");
const claims = asPropositions(JSON.parse(readFileSync(claimsPath, "utf8")) as ClaimsFile[]);
const golden = JSON.parse(readFileSync(join(fixtures, "golden-queries.json"), "utf8")) as GoldenQuery[];

const embedder = new GeminiEmbedder({
  apiKey: env.GEMINI_API_KEY,
  model: env.EMBED_MODEL,
  dimensions: env.EMBED_DIMENSIONS,
});
const index = await openIndex({
  url: env.DATABASE_URL,
  model: embedder.model,
  dimensions: embedder.dimensions,
  reset: env.EVAL_REINDEX,
});

const modes: SearchMode[] = env.EVAL_MODE === "all" ? ["vector", "keyword", "hybrid"] : [env.EVAL_MODE];
/** The mode the per-query lines and the exit code follow. */
const primary: SearchMode = modes.includes("hybrid") ? "hybrid" : modes[0]!;

console.log(`\n  ${claims.length} claims · ${golden.length} queries · ${embedder.model}/${embedder.dimensions}d`);
console.log(dim(`  top ${env.EVAL_TOP_K}, cosine floor ${env.EVAL_MIN_SCORE}, modes: ${modes.join(", ")}\n`));

const cached = await index.count();
if (env.EVAL_REINDEX || cached !== claims.length) {
  // `reset` already emptied it on EVAL_REINDEX. A count mismatch means the
  // claims changed under a cached index; ids are positional, so clear rather
  // than leave stale records behind the new ones.
  if (cached > 0) await index.clear();
  process.stdout.write(dim(`  indexing ${claims.length} claims… `));
  await new PropositionIndexer(embedder, index).index(claims);
  console.log(dim(`done (${describeTarget(env.DATABASE_URL)})\n`));
} else {
  console.log(dim(`  reusing cached index (${describeTarget(env.DATABASE_URL)})\n`));
}

async function runMode(mode: SearchMode, verbose: boolean): Promise<GradedQuery[]> {
  const searcher = new HybridSearcher(embedder, index, { minScore: env.EVAL_MIN_SCORE, mode });
  const results: GradedQuery[] = [];
  for (const query of golden) {
    const hits = await searcher.search({ projectId: "eval", text: query.query, limit: env.EVAL_TOP_K });
    // Ids are all the searcher returns, by design. The eval hydrates through the
    // index it owns — exactly as the API will hydrate through the proposition
    // store it owns.
    const records: IndexedRecord[] = await index.getMany(hits.map((h) => h.propositionId));
    const text = new Map(records.map((r) => [r.id, r.text] as const));
    const result = grade(
      query,
      hits.map((h) => ({ text: text.get(h.propositionId) ?? "", score: h.score })),
    );
    results.push(result);
    if (verbose) printQuery(query, result, hits.map((h) => VIA_TAG[h.via]));
  }
  return results;
}

const runs = new Map<SearchMode, { results: GradedQuery[]; summary: Summary }>();
for (const mode of modes) {
  const verbose = mode === primary;
  if (verbose) console.log(`  ${mode}`);
  else process.stdout.write(dim(`  ${mode}… `));
  const results = await runMode(mode, verbose);
  if (!verbose) console.log(dim("done"));
  runs.set(mode, { results, summary: summarize(results) });
}

const columns = ["mode", "hit@1", "hit@3", `recall@${env.EVAL_TOP_K}`, "MRR", "out-of-domain rejected", "passed"];
const rows = modes.map((mode) => {
  const { results, summary: s } = runs.get(mode)!;
  const passed = results.filter((r) => r.passed).length;
  return [mode, pct(s.hitAt1), pct(s.hitAt3), pct(s.recallAtK), s.mrr.toFixed(3), pct(s.outOfDomainRejected), `${passed}/${results.length}`];
});
const widths = columns.map((c, i) => Math.max(c.length, ...rows.map((r) => r[i]!.length)));
const line = (cells: readonly string[]) => `  ${cells.map((c, i) => c.padEnd(widths[i]!)).join("   ")}`;

console.log(`\n  ${"─".repeat(Math.max(58, line(columns).length - 2))}`);
console.log(dim(line(columns)));
for (const row of rows) console.log(line(row));

const failed = runs.get(primary)!.results.filter((r) => !r.passed).length;
console.log(dim(`\n  exit code follows ${primary}: ${failed === 0 ? "all passed" : `${failed} failed`}\n`));

await index.close();
process.exit(failed > 0 ? 1 : 0);
