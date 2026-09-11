# Work split

Five work packages, one per owner. Each is written so that its owner can
start on day one without asking anyone anything. Read `docs/architecture.md`
first for the boundaries; this is the to-do list.

## Rules for everyone

- Your package imports `@meetai/core` and nothing else under `packages/`.
  If you need something from another unit, you need an *interface* in core,
  not an import. Open a PR against `packages/core` with the other owner as
  reviewer.
- Any type that crosses your boundary goes in core as a zod schema. Your
  private types stay in your package.
- `bun run typecheck` stays green. Unused locals and parameters are errors;
  prefix a deliberately unused parameter with `_`.
- Nothing under `apps/proxy/` changes. Ever. Prompts, fixtures and
  transcripts never go there.
- "Done" always includes: the README in your directory is true, and the
  stub you replaced no longer throws.

## Week one, so nobody waits

| Day | Unit 1 | Unit 2 | Unit 3 | Unit 4 | Unit 5 |
| --- | --- | --- | --- | --- | --- |
| 1 | `loadConfig`, `.env.example` | run `bun run eval`, read the audit §10 | `InMemory*` stores | embedding service up | Vite scaffold, fake fixtures validated by core schemas |
| 2–3 | `POST /meetings`, `GET /jobs/:id` against in-memory stores | resolver verification fix | `ProjectMemory.ingest` for commitments | in-process index + cosine | upload + meeting pages |
| 4–5 | `processMeeting` end to end | evidence line indexes | `changes` + `commitments` queries | `HybridSearcher` + retrieval eval set | Q&A page with citations |

By the end of week one the pipeline runs on `Map`s with real extraction,
and every page has a real endpoint or a 501 telling it what is missing.

---

## Unit 1 — Ingestion & deployment (Sahil)

**Owns:** `packages/ingestion/**`, `apps/api/**`, deployment for every
process, the root `package.json` scripts.

**Scope:** upload → job → windows → pipeline → status; the HTTP API; where
everything runs.

**Contract to satisfy:**
- `packages/ingestion`: `windowBySpeakingTime` (already working),
  `processMeeting(deps, jobId)`, `loadConfig()`.
- `apps/api`: every route in `@meetai/core/src/contracts/api.ts`, validating
  bodies with the contract's schemas and returning the contract's shapes;
  `ErrorResponse` on every non-2xx.
- `container.ts` is the only file that imports more than one unit.

**Done looks like:**
- `bun run dev:api`, `POST /projects/:id/meetings` with the kickoff
  transcript returns `{ meeting, job }` immediately; `GET /jobs/:id` walks
  `pending → processing → completed` with `stage` advancing; `GET
  /meetings/:id` returns the propositions.
- A retried job produces no duplicate propositions (stores are idempotent
  per meeting + window; you pass the same `windowIndex`).
- A transcript with a malformed line is rejected with the line number,
  before anything is sent to the proxy.
- `apps/api/README.md` says how to start the proxy on the Nitro and the API
  and embedder on the Mac, and what to check when the demo machine boots.

**Must not touch:** `packages/ai/src/prompts/**` or `tools/**` (unit 2);
anything in `packages/memory` beyond calling its exports (unit 3); the index
(unit 4); `apps/web` (unit 5); `apps/proxy`.

---

## Unit 2 — AI extraction

**Owns:** `packages/ai/**`, `evals/propositions/**`.

**Scope:** the extraction agent, its tools, its prompts, the answering step,
and the eval that measures extraction quality.

**Contract to satisfy:** `Extractor` and `Answerer` from core. The output
schema is `ExtractedProposition`; do not fork it — change it in core by PR.

**First tasks, in order:**
1. **Close the fabrication gap** in `tools/investigate-ambiguity.ts`
   (`docs/audit.md` §10): the resolver must return `{ referent,
   supporting_line }` via `client.extract()` with a JSON schema (that side
   call has no tools, so `response_format` is allowed), and the tool must
   return `resolved: false` when `supporting_line` is not verbatim one of
   the candidates. Gather ±1 neighbour around keyword hits. Run
   `bun run eval` before and after and keep both `out/latest/` dumps.
2. **Emit evidence.** Add `evidenceLines: number[]` to `ExtractedProposition`
   (core PR), render line indexes into the window text the model sees, and
   add a check in `evals/propositions/src/checks.ts` that every cited index
   is inside the window. `Proposition.evidence` is required downstream and
   nothing produces it today.
3. **Use the meeting context.** `ExtractionRequest.meeting` (title,
   participants) is in the request and ignored; the kickoff decided on a
   context header. Measure whether it helps.
4. **Answering.** `createAnswerer`: a prompt over `EvidenceBundle[]` that
   cites only what it was given and labels `basis`. Then an eval for it.

**Done looks like:** `bun run eval` on the kickoff transcript passes your
own verdict on every window; a fabricated referent cannot come back
`resolved: true`; every proposition carries line indexes that point at lines
in its window; `Answerer` no longer throws.

**Must not touch:** windowing (unit 1 — the eval calls
`windowBySpeakingTime`, it does not own it); stores or memory (unit 3);
the index (unit 4); `apps/proxy`. Adding a tool is a file in `src/tools/`
plus one line in `src/tools/index.ts` — never an edit to `extraction.ts`.

---

## Unit 3 — Database, memory & change detection

**Owns:** `packages/memory/**`, and the database when there is one
(schema, migrations, connection) — all inside that package.

**Scope:** the stores, entity resolution, state derivation, change and
contradiction detection, the commitment ledger and timeline.

**Contract to satisfy:** every interface in
`@meetai/core/src/contracts/memory.ts`.

**First tasks, in order:**
1. **`InMemory*` stores with `Map`s** — `ProjectStore`, `MeetingStore`,
   `JobStore`, `PropositionStore`. `saveMany` idempotent on
   `(meetingId, windowIndex, text)`. This unblocks unit 1 the same week.
2. **`ProjectMemory.ingest` for commitments.** A `commitment` proposition →
   resolve the speaker to a person entity and the work to a task entity →
   `owner`, `deadline`, `status: open` states, `validFrom` = the meeting
   date. A second meeting's `status` / `blocker` proposition on the same
   task → close the old state, write the new, emit a `StateChange` of kind
   `delayed` / `blocked`. Idempotent per meeting.
3. **`MemoryQueries.commitments` and `changes`** — the two views the
   frontend needs first.
4. **Contradictions.** Two `decided` states on the same decision entity with
   different statements → `contradicted`, classification `unclear`,
   `needsReview: true`. Do not resolve it; flag it.
5. **Then the database.** After the in-memory version has run a real
   meeting end to end. Postgres is the kickoff's leaning. The stores are the
   swap point; nothing outside this package changes.

**Done looks like:** processing the kickoff transcript yields a commitment
ledger with Yash's "schema fields by Friday" (owner Yash, deadline
2026-09-11, status open); processing a second transcript that says it
slipped yields a `deadline_changed` change with both states linked and the
old one's `validTo` set; a retry of either meeting changes nothing.

**Must not touch:** prompts (unit 2 — if you need the model to classify a
contradiction, ask for an interface in core); windowing or routes (unit 1);
the index (unit 4).

---

## Unit 4 — Retrieval / RAG

**Owns:** `packages/retrieval/**`, the embedding service, and a new
`evals/retrieval/` when you create it.

**Scope:** embeddings, the index, routing, hybrid search, fusion; the
reranker only after an eval set exists.

**Contract to satisfy:** `Embedder`, `Indexer`, `Searcher` from core.
Return ids and scores; never text.

**First tasks, in order:**
1. **Embedding service + `HttpEmbedder`.** Pick one local model from the
   MTEB Retrieval column; expose `POST /embed { texts, kind }`; store the
   model name with every vector. Matched task types for documents vs.
   queries (see the README's prior findings).
2. **In-process index** behind `PropositionIndexer` / `HybridSearcher`:
   array + cosine plus a trivial BM25, RRF fusion. Enough for
   `POST /ask` to work end to end.
3. **Retrieval eval set:** 20 questions over the kickoff transcript's
   propositions with expected proposition ids. Precision@5 for
   vector-only vs. hybrid. This is the set the kickoff said must exist
   before the reranker question is reopened.
4. **Query routing:** structured questions ("who owns X") → `SearchFilters`
   on `type`/`speaker`; semantic → hybrid. A small classification call is
   allowed; put its prompt in your package and keep it under ten lines.
5. Then pgvector (or whatever unit 3 chose) behind the same interfaces.

**Done looks like:** `searcher.search({ projectId, text: "why did we choose
Postgres?" })` returns the pgvector-decision proposition in the top 3;
hybrid beats vector-only on your eval set, with numbers in the README.

**Must not touch:** stores or memory (unit 3 — you receive `Proposition`s
and return ids); prompts in `packages/ai` (unit 2); routes (unit 1).

---

## Unit 5 — Frontend

**Owns:** `apps/web/**`.

**Scope:** React + Vite + Tailwind + TanStack Query. Pages: upload and
meeting list, transcript view with processing state, Q&A with expandable
citations, commitment ledger, "what changed" per meeting.

**Contract to satisfy:** `@meetai/core/src/contracts/api.ts`. All backend
calls go through `src/api.ts`, one function per endpoint.

**First tasks, in order:**
1. Scaffold in place (`bun create vite apps/web --template react-ts`, keep
   the `package.json` name and the `@meetai/core` dependency). Add Tailwind
   and TanStack Query.
2. Fake fixtures for every response shape, validated with the core schemas
   (`AskResponse.parse(fixture)`) so drift shows up immediately.
3. Upload → poll `getJob` → meeting page with the transcript and the
   propositions.
4. Q&A page: question → answer → the claims used → expand a claim to its
   transcript lines (`AskResponse.evidence` already carries them; no second
   call).
5. Commitment ledger and "what changed".

**Done looks like:** every page works against the fake fixtures and, once
unit 1 lands each route, against the real API with no code change beyond
`VITE_API_URL`.

**Must not touch:** anything under `packages/` (open a core PR if a page
needs a field); `apps/api`; the proxy — never call it from the browser.
