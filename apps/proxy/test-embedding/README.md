# test-embedding

Scratch scripts for poking at the Google Gemini embeddings API. TypeScript, run
directly — no build step, no SDK. Node 22.18+ strips types natively and Bun runs
`.ts` as-is, so `node 01-basic-embed.ts` just works.

## Setup

```sh
cp .env.example .env      # then paste your key into .env
node 01-basic-embed.ts    # or: bun 01-basic-embed.ts
```

Key comes from `GOOGLE_API_KEY` (or `GEMINI_API_KEY`) in `test-embedding/.env`,
the repo-root `.env`, or the shell environment. `.env` is gitignored — don't put
a real key in `.env.example`, which isn't.

npm scripts: `npm run basic | similarity | search | dims | all | typecheck`.

## Scripts

| Script | What it shows |
| --- | --- |
| `01-basic-embed.ts` | One embedding: dimension count, L2 norm, value range, latency. Takes optional text as CLI args. |
| `02-similarity.ts` | Cosine similarity of a probe against paraphrases, same-topic distractors, an unrelated sentence, and a translation. Uses one batch call. |
| `03-semantic-search.ts` | End-to-end retrieval: index 8 docs as `RETRIEVAL_DOCUMENT`, search with `RETRIEVAL_QUERY`, rank top-3. |
| `04-dimensions-and-tasktypes.ts` | How `outputDimensionality` (128 → 3072) affects separation and storage cost, and how the same text embeds differently per `taskType`. |
| `run-all.ts` | Runs 01–04 in sequence. |

`lib/gemini.ts` holds the client (`embed`, `embedBatch`, `cosine`, `normalize`,
`withRetry`) plus the `TaskType` / `EmbedOptions` / `Vector` types;
`lib/env.ts` is a small `.env` parser.

## Types and typecheck

`tsconfig.json` mirrors the parent repo's strictness (`strict`,
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) and adds:

- `allowImportingTsExtensions` + `noEmit` — nothing is ever compiled, so the
  imports carry explicit `.ts` extensions, which is what Node's type stripping
  requires.
- `erasableSyntaxOnly` — bans `enum`, `namespace`, and parameter properties,
  the TS features Node *cannot* strip. Keeps the code runnable by `node`.
- `verbatimModuleSyntax` — forces `import type` where a type-only import is
  meant, so stripping never leaves a dangling runtime import.

```sh
npm run typecheck    # tsc --noEmit, currently clean
```

`typescript` and `@types/node` are the only devDependencies, and only the
typecheck needs them — the scripts themselves run with zero installed packages.

## Measured results

From an actual run against `gemini-embedding-001`:

- Default output is **3072-d and already unit-length** (L2 norm 1.000000).
- Cross-lingual is strong: the Hindi translation of the probe scored **0.9712**,
  above both English paraphrases (0.9297, 0.9155).
- Retrieval put the right doc at rank 1 on all three queries with a wide margin
  (e.g. 0.8055 vs 0.5754), including one with almost no lexical overlap.
- Dimension sweep — the *gap* is what matters, not the top score:

  | dims | bytes/vec | related | unrelated | gap |
  | --- | --- | --- | --- | --- |
  | 128 | 512 | 0.9051 | 0.8282 | 0.08 |
  | 768 | 3072 | 0.8042 | 0.6874 | 0.12 |
  | 1536 | 6144 | 0.8024 | 0.6856 | 0.12 |
  | 3072 | 12288 | 0.8223 | 0.7124 | 0.11 |

  **768-d is the sweet spot**: a quarter the storage of 3072-d with no loss of
  separation. 128-d nearly collapses the gap — expect false positives.

## Things worth knowing

- **Endpoints.** `POST /v1beta/models/{model}:embedContent` for one text,
  `:batchEmbedContents` for many in a single round trip. Auth is the
  `x-goog-api-key` header.
- **taskType is asymmetric.** Index documents with `RETRIEVAL_DOCUMENT` and
  embed the user's question with `RETRIEVAL_QUERY`. The same sentence under two
  task types only scores ~0.83 against itself, so mixing them costs real recall.
  Use `SEMANTIC_SIMILARITY` for symmetric "are these two alike" comparisons.
- **Truncated vectors need renormalizing.** `gemini-embedding-001` is trained
  with Matryoshka representation learning: the default 3072-d vector comes back
  unit-length, but anything truncated via `outputDimensionality` does not.
  `lib/gemini.ts` normalizes those for you — skip that and cosine scores are wrong.
- **Similarity scores are not comparable across dimensions.** Any threshold you
  hard-code has to be re-tuned if you change `outputDimensionality`.
- **Rate limits.** The free tier returns 429 quickly. Everything goes through
  `withRetry()`, which backs off on 429/5xx.
