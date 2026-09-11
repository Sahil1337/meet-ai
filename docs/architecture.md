# meetAI architecture

The target structure for a five-person prototype, and the reasoning behind
it. `docs/work-split.md` says who builds what; this says what the pieces are
and how they may touch.

## 1. The shape

```
                         apps/web  (unit 5)
                             │ HTTP only; imports core type-only
                             ▼
                         apps/api  (unit 1)  ← the composition root
        ┌──────────────┬──────┴───────┬───────────────┐
        ▼              ▼              ▼               ▼
packages/ingestion  packages/ai  packages/memory  packages/retrieval
    (unit 1)         (unit 2)       (unit 3)          (unit 4)
        │              │              │               │
        └──────────────┴──────┬───────┴───────────────┘
                              ▼
                        packages/core            zod only
                (domain model · contracts · transcript grammar)

packages/ai and packages/retrieval may also import qwen-proxy/client
(apps/proxy's published client — a maintained contract, not an app internal).
```

**Imports flow one way: apps → packages → core.** A unit package imports
`@meetai/core` and nothing else under `packages/`. Two units meet in exactly
one file, `apps/api/src/container.ts`. `apps/web` never imports server code.

## 2. Why this shape — the one reason that matters

Five people, fourteen months, and the brief's hard requirement: *each person
must be able to work in their own directory without waiting on or colliding
with the others.*

Every arrangement where unit A imports unit B makes A's owner wait for B's
owner, or fork B's types locally, or both. The only arrangement with no
waiting is a star: every unit depends on one shared, small, stable thing and
on nothing else. That thing is `packages/core`. It holds the shapes that
cross a boundary (as zod, so they are checked at the boundary, not just
typed) and the interfaces each unit promises. Once core is agreed, unit 3 can
build memory against `Proposition` without extraction existing; unit 4 can
build search against `Proposition` without memory existing; unit 5 can build
pages against `contracts/api.ts` with fake JSON validated by the same
schemas. Integration is not a phase; it is one file, written by the person
who also owns deployment.

The cost is that core changes need a PR and a conversation. That is the
right place for the conversation to happen.

## 3. The five units

### Unit 1 — Ingestion & deployment (`packages/ingestion`, `apps/api`)

**Responsible for:** turning an upload into a job, cutting the transcript
into windows, running the pipeline stages in order
(parse → window → extract → persist → memory → index), the HTTP surface,
process configuration, and where every process runs for the demo.

**Must not:** contain a prompt, a SQL string, an embedding call, or knowledge
of which database was chosen. Must not let the frontend reach the proxy.

**Consumes:** `Extractor` (from ai), `MeetingStore`/`JobStore`/
`PropositionStore`/`ProjectMemory`/`MemoryQueries` (from memory),
`Indexer`/`Searcher` (from retrieval), `Answerer` (from ai) — every one as an
interface from core, wired in `container.ts`.

**Provides:** `TranscriptWindow`s and `ExtractionRequest`s to extraction; the
HTTP contract in `core/contracts/api.ts` to the frontend; `ProcessingJob`
status.

Why the parser is not here: the line grammar is the system's *input
contract* — the ambiguity tool, the evals, and evidence lookup all read it.
A contract with its parser in one unit gets re-implemented by the others
(it was, three times). So the grammar and its single parser live in core;
ingestion decides what to do with `rejected` lines.

### Unit 2 — AI extraction (`packages/ai`)

**Responsible for:** everything that talks to the model. Window →
propositions via a tool-using agent; later, evidence → cited answer. Owns
every prompt, every tool, and the eval harness that measures extraction.

**Must not:** window transcripts, persist, resolve entities across meetings,
embed, or search. Must not put a prompt anywhere but `src/prompts/`.

**Consumes:** `ExtractionRequest`, `EvidenceBundle`, the transcript grammar
(core); `qwen-proxy/client`.

**Provides:** `Extractor`, `Answerer`. The output schema the model is
constrained to *is* `ExtractedProposition` from core — derived, not copied.

### Unit 3 — Database, memory & change detection (`packages/memory`)

**Responsible for:** persistence (the four stores), entity resolution,
time-aware state, change and contradiction detection, and the read models
(commitment ledger, timeline). The only unit that will ever know which
database was chosen.

**Must not:** expose a driver type in any export; call the model directly;
chunk, extract, embed or search.

**Consumes:** `Proposition`, `Entity`, `EntityState`, `StateChange`,
`Commitment`, `TimelineEntry` (core).

**Provides:** every interface in `core/contracts/memory.ts`.

Why stores and memory are separate interfaces: the stores are dumb and the
first implementation is `Map`s. That gets the whole pipeline running before
any database decision and becomes the reference the database-backed stores
are tested against. `ProjectMemory` is the hard part and should not be
blocked on a schema.

### Unit 4 — Retrieval / RAG (`packages/retrieval`)

**Responsible for:** the embedding client, the index, the query path
(structured-vs-semantic routing, BM25 + vector, fusion), and later a
reranker — once an eval set exists to justify it.

**Must not:** return transcript text or generate answers; embed anything but
the proposition text; depend on memory or ai.

**Consumes:** `Proposition` (core) — `id`, `text`, and the filterable fields.

**Provides:** `Embedder`, `Indexer`, `Searcher`. Returns proposition ids and
scores. Ids as the currency are what keep the vector-store decision
deferrable: pgvector, a file, or an in-process array are all invisible to
the API.

### Unit 5 — Frontend (`apps/web`)

**Responsible for:** the pages: upload and meeting view with processing
state, Q&A with expandable citations, the commitment ledger, "what changed".

**Must not:** import anything from `packages/` except `@meetai/core`
type-only; call the proxy; call `fetch` outside `src/api.ts`.

**Consumes:** `core/contracts/api.ts` — the request/response schemas, which
also validate its fake fixtures until the API is live.

**Provides:** nothing to other units.

## 4. `packages/core` — what it is and is not

It is the domain model as zod schemas with inferred types of the same name
(`Meeting`, `Proposition`, `Entity`, `EntityState`, `StateChange`,
`Commitment`, `Answer`), the transcript grammar with its one parser, and the
contracts between units (`contracts/`). Each file's header says which spec
section its enums mirror.

It is not a utilities bin. The rule for admission: *does this cross a unit
boundary?* A four-line `normalize` used by two units for unrelated purposes
does not qualify and is duplicated on purpose.

Decisions embedded in it:

- **Ids are opaque strings, dates are ISO strings.** No `Date`, no UUID
  assumption. This is what lets the database be chosen later.
- **Two proposition shapes.** `ExtractedProposition` is what the model
  emits; `Proposition` is what memory persists (adds id, meeting, window,
  evidence, extractor version). The model-facing JSON Schema is derived
  from the former; nothing hand-writes it.
- **Evidence is line indexes, not quoted text.** `Evidence { meetingId,
  lineIndexes }`; the transcript is fetched when needed. This is the
  kickoff's decision ("the proposition can just store the meeting ID and
  line range") and it is what makes citations exact.
- **The Meeting is the Source.** The spec's Source → Claim → Entity →
  State → Change spine has a Source object; in a prototype with one source
  kind, a separate `Source` record is indirection with one member.
  `Evidence` names the meeting; when Slack arrives, `Evidence` grows a
  `kind` discriminant and nothing else moves.
- **State is per aspect, time-aware, never overwritten.** `EntityState
  { entityId, value: { aspect: status | owner | deadline | blocked_by |
  decided, ... }, validFrom, validTo, supersedes }`. Change detection is a
  diff of same-aspect records, and history is free. This is the Zep-style
  temporal memory from the reading list, reduced to what the change
  detector actually needs.
- **`Commitment` and `TimelineEntry` are read models.** Derived from
  entities, states and changes; whether unit 3 materializes them is its
  call and invisible to callers.

## 5. The tool layer in `packages/ai`

The problem it replaces: the agent named its tools in its own source,
counted their calls by hand, and each tool hand-wrote its JSON Schema and
coerced its own arguments with `String(args.x ?? "")`. Adding a tool meant
editing the loop.

The design:

- **One file per tool, one definition per file.** `defineTool({ name,
  description, parameters: z.object(...), handler(args, ctx) })`. The
  handler's `args` type is inferred from `parameters`; the proxy-facing
  `Tool` JSON is derived from the same schema (`toProxyTool`, zod 4's
  `z.toJSONSchema`). One source of truth per tool.
- **A registry the loop consumes.** `ToolRegistry` takes the definitions,
  hands out `proxyTools()` and a `handlers(ctx, onDispatch)` map. Validation
  happens in the map: a call that fails its schema is returned to the model
  as an error result (so it can retry), never thrown. Call counting happens
  there too, generically. `extraction.ts` names no tool.
- **The terminal tool is a distinct type.** `defineTerminalTool` has no
  handler. `submit_propositions` is a tool only because this proxy cannot
  combine `response_format` with `tools`; it is the loop's exit condition
  and its arguments are the output. Its `parameters` are
  `z.object({ propositions: z.array(ExtractedProposition) })` and the loop
  validates the model's final call against it — the model's submission
  cannot reach the rest of the system unvalidated.
- **The loop is `QwenProxyClient.runToolsUntil`, not our own.** It already
  does the one job the brief wanted in one place — append each result as a
  `role: "tool"` message and re-ask — and it handles the streaming and
  non-streaming paths uniformly. Re-implementing it would mean duplicating
  its private stream collector (~50 lines) for one gain: a "nudge" when the
  model answers in prose under `tool_choice: "auto"` instead of the current
  `no_tool_call` failure. That gain is real but is a behaviour decision
  (an extra hop on a slow GPU) for the extraction owner, and it can be
  added later without changing any tool. Preferring the maintained
  contract over a copy is the brief's own rule.

Result: adding a tool is a new file under `src/tools/` and one entry in
`src/tools/index.ts`.

## 6. The proxy

`apps/proxy` is a dumb, stateless endpoint on a 4 GB GPU with an 8192-token
window. That is a constraint the whole design bends around:

- Extraction works on windows sized by speaking time, not whole meetings.
- Reference resolution runs as an isolated side call that returns a
  compact answer, so the main conversation never grows by raw transcript.
- Retrieval, embeddings, memory and state never run there. The embedding
  model runs as its own service on a different machine.
- Units 2 and 4 may call it through `qwen-proxy/client` (a dependency-free
  client published through the proxy's `exports` map). Unit 3 has no
  reason to; unit 1 reaches it only through `Extractor`/`Answerer`; unit 5
  never.

Nothing under `apps/proxy/` is modified by meetAI. It keeps its own
`LICENSE`, `AGENTS.md`, style and tsconfig because it is a separate
published repository that happens to be mirrored in.

## 7. Dependencies

One runtime dependency was added: **zod** (`packages/core`, `packages/ai`).
It is the mechanism by which core is a contract rather than a suggestion —
schemas validate request bodies, tool arguments, and the model's
submissions at the boundaries — and it is the source the tool JSON Schemas
are derived from. It was already in the lockfile via the proxy.

Considered and not added:

- **Express** (the old `apps/api/README.md` suggested it). Nine JSON
  endpoints do not need a framework; `Bun.serve` plus a 20-line matcher is
  the skeleton. Add it if middleware needs appear, and say why here.
- **An ORM / a database driver.** The database is not chosen. Stores are
  interfaces; the first implementation is `Map`s.
- **BullMQ / Redis.** One API process and a GPU that serves two requests
  at a time do not need a distributed queue. An in-process queue is the
  prototype; the job record is the contract, so a real queue can replace it
  later.
- **A Gemini SDK.** The scratch embedding scripts called a hosted API the
  kickoff decided against; deleted (findings kept).

## 8. Where things run for the demo

```
Nitro 5 (Debian, RTX 3050 4 GB)     apps/proxy  →  Ollama / Qwen3.5-4B
Mac (M5, 16 GB)                     apps/api, the embedding service, the database when chosen
Browser                             apps/web (Vite dev server or a static build)
```

Each app has its own `.env`. There is no root `.env`.

## 9. Open decisions (need a human)

1. **Database and vector store.** Deferred by design. The kickoff leaned
   Postgres + pgvector; unit 3 decides after the in-memory version has run a
   real meeting.
2. **Embedding model.** Unit 4 picks from the MTEB Retrieval column; the
   prior Gemini findings say 768-d and matched task types.
3. **Who owns answer generation.** This document puts it in unit 2 (it owns
   every prompt) with retrieval returning ids only. If the team would rather
   unit 4 own the whole RAG path including the answer prompt, move
   `Answerer` to `packages/retrieval` — the contract does not change.
4. **`packageManager` pin.** `bun@1.1.38` in root and proxy `package.json`;
   the team runs 1.3.x.
