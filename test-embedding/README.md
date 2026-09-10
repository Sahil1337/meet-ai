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
| `05-pipeline-demo.ts` | The full store-and-retrieve loop: index 8 propositions with metadata, run queries, show metadata filtering and a `minScore` floor rejecting an off-topic question. |
| `run-all.ts` | Runs 01–05 in sequence. |
| `import-claims.ts` | Load extraction-model output (propositions + metadata) into a store. |
| `eval-retrieval.ts` | Score retrieval against a golden query set: hit@1, hit@3, recall@k, MRR, out-of-domain rejection, threshold window. |

`lib/gemini.ts` holds the API client (`embed`, `embedBatch`, `cosine`,
`normalize`, `withRetry`) plus the `TaskType` / `EmbedOptions` / `Vector` types.
`lib/store.ts` holds `JsonVectorStore`. `lib/env.ts` is a small `.env` parser.

## The retrieval pipeline

`rag.ts` is a CLI over `lib/store.ts`, a vector store that is just a JSON file
(`data/store.json`, gitignored). No server, no pgvector, no native deps.

```sh
node rag.ts add "Ollama serves local models on port 11434." --meta topic=ops
node rag.ts add-file notes.txt --meta source=notes     # one proposition per line
node rag.ts query "which port does it listen on" --top 3
node rag.ts query "gpu problems" --filter topic=ops --min 0.6
node rag.ts list | stats | remove <id> | clear
```

Or `npm run rag -- query "..."`. Add `--store other.json` to keep separate sets.

**How it works.** `add` embeds each proposition with `RETRIEVAL_DOCUMENT` and
appends `{id, text, vector, metadata, createdAt}` to the JSON file. `query`
embeds your question with `RETRIEVAL_QUERY`, cosine-scores it against every
stored vector in a linear scan, and returns the top-k. That asymmetry is
deliberate — see the taskType note below.

Details worth knowing:

- **ids are content hashes**, so re-adding the same text updates in place rather
  than duplicating it.
- **`addMany` / `add-file` embed in one batch call**, which is much faster than
  one request per line — 8 propositions indexed in ~2.9 s.
- **Writes are atomic** (temp file + rename), so an interrupted run can't
  truncate the store.
- **Vectors are rounded to 6 decimals and stored compactly.** Both matter more
  than they sound: pretty-printing one float per line doubled the file, and full
  float64 text is ~3x wider than needed. Together that took a record from
  ~14.4 KB to ~7.2 KB, with cosine scores unchanged.
- **`--min` is your out-of-domain guard.** In the demo, "what is the best recipe
  for banana bread" against a corpus about a proxy server still returns a
  best match at 0.5069 — cosine never says "nothing matches", so a floor around
  0.6 is what turns retrieval into an honest "I don't know".
- **The store records its model, dimensions and taskType** in the file header.
  Change any of them and you must re-index; vectors from different settings are
  not comparable.

### When this stops being enough

A linear scan over a JSON file is genuinely fine into the low thousands of
records — 768 floats is ~7 KB on disk, and scoring a few thousand vectors takes
single-digit milliseconds, far less than the ~1 s the embedding API call itself
costs. It breaks down when the file no longer fits comfortably in memory (it is
read whole on every command), or past roughly 10k records where the scan starts
to dominate. At that point move to sqlite-vec (still one file, no server) or
pgvector — the `JsonVectorStore` interface (`add`/`addMany`/`search`) is small
enough to swap out behind.

## MeetIQ claims: indexing and evaluation

`fixtures/meetiq-claims.json` is real output from the extraction model — 7
chunks, 44 propositions, each with `speaker`, `type` and `confidence`.

```sh
npm run import    # 44 propositions -> data/claims.json
npm run eval      # retrieval quality against fixtures/golden-queries.json
npm run dupes     # near-duplicate claims (local math, no API calls)
```

`import-claims.ts` flattens the extractor output and stores `speaker`, `type`,
`confidence`, `chunk` and `source` as metadata, so `--filter type=ownership`
gives you the "structured" tier of the two-tier retrieval design without SQL.
Unattributed claims (`"speaker": null`) become `speaker: "unattributed"`, since
JSON metadata has no null to filter on.

### Measured retrieval quality

15 answerable + 2 out-of-domain golden queries, `gemini-embedding-001` at 768d:

| metric | result |
| --- | --- |
| hit@1 | 13/15 (87%) |
| hit@3 | 15/15 (100%) |
| recall@5 | 15/15 (100%) |
| MRR | 0.933 |

Both non-#1 results are arguably mislabeled rather than retrieval failures:
"who is building the citations UI?" returned Rishita's citations-UI *commitment*
above her *ownership* claim, and "what is blocking the reranker?" returned
"a reranker is deferred" above "golden evaluation set required". Judge the
golden set before you judge the retriever.

### The threshold is the fragile part

`npm run eval` prints a threshold window, and this is the finding that matters:

```
weakest answerable query scored   0.676   ("what frontend framework are we using?")
strongest out-of-domain scored    0.630   ("which cloud provider are we deploying to?")
=> any min in (0.630, 0.676) separates them; midpoint 0.653
=> margin is only 0.046 wide
```

At the obvious `min=0.6`, *both* out-of-domain questions leak — "what is the
team's plan for the christmas party?" matches "Yash will send the schema fields
by Friday" at 0.626. At `min=0.7`, three legitimate questions return nothing.
The whole usable band is 0.05 wide, on 17 queries. That is not a threshold you
can ship: it is an argument for the reranker, or for an LLM check on the top hit
before answering.

### Duplicate claims are real

`npm run dupes` finds 7 pairs above 0.85 in 44 propositions, including:

- 0.9221 — "Yash will send the final claim schema field list by Friday, 2026-09-11"
  (chunk 6) vs "Yash will send the schema fields by Friday." (chunk 7)
- 0.9231 — "Frontend should show processing status ... too long to be synchronous"
  vs "Implement background job for extraction instead of synchronous processing"
  (both chunk 3)
- 0.9192 — two different phrasings of the reranker/eval-set dependency (chunk 5)

Content-hash ids only collapse byte-identical text, so these all survive as
separate records. Adjacent chunks restating the same commitment is inherent to
chunked extraction — dedupe by cosine at ingest, or the same fact gets retrieved
three times and crowds out the rest of the top-k.

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
