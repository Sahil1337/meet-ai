# @meetai/evals-retrieval

Measures retrieval instead of eyeballing it: index a set of extracted claims,
run a golden query set, and print `hit@1`, `hit@3`, `recall@k`, `MRR`, and the
out-of-domain rejection rate — once per search mode, so one table shows what
the vector leg, the keyword leg, and their fusion each contribute.

```bash
GEMINI_API_KEY=... bun run eval:retrieval                    # vector, keyword, hybrid
EVAL_MODE=vector GEMINI_API_KEY=... bun run eval:retrieval    # one leg on its own
```

`EVAL_MODE` is `vector`, `keyword`, `hybrid`, or `all` (the default). The
per-query lines are printed for the `hybrid` run (or the single mode asked
for), each hit tagged with the leg that found it — `v`, `k`, or `vk` — and the
comparison table follows. The exit code follows that same mode.

`DATABASE_URL` is required: the index is a Postgres with pgvector, the same one
a local API run uses. There is no embedded fallback — a run that quietly built
its own throwaway index would report numbers nobody else can reproduce. The
index persists, so a re-run costs no embedding calls beyond the queries
themselves. Set `EVAL_REINDEX=1` after changing the claims or the model — the
index refuses to open under a different model or width otherwise. See
`src/env.ts` for the full set of variables.

Nobody has run this against the hybrid index yet. The table in
`packages/retrieval/README.md` is filled in from the first run.

## Why out-of-domain queries are in the golden set

A retriever that always returns its nearest record scores perfectly on
in-domain questions, because every one of them has an answer. The
`out-of-domain` queries pass only when *nothing* clears `EVAL_MIN_SCORE` — they
are what stops a good-looking score from hiding a system that answers
everything, confidently, whether it knows or not. The floor is on cosine in
every mode, keyword included, because it is the only score whose meaning does
not depend on the rest of the result list.

## Fixtures

- `fixtures/claims.json` — 44 propositions from the kickoff transcript. Same
  shape as `evals/propositions`' `out/latest/claims.json`, so that eval's output
  feeds this one: extraction quality and retrieval quality over the same claims.
- `fixtures/golden-queries.json` — 17 queries across `semantic`, `ownership`,
  `deadline`, `risk`, and `out-of-domain`. `expect` holds case-insensitive
  substrings rather than proposition ids, so the set survives re-extraction
  changing the ids.
