# @meetai/ingestion — transcript intake and the processing job

**Owner:** unit 1, ingestion & deployment (Sahil). The same owner has
`apps/api` (the HTTP surface and composition root) and deployment.

**Boundary:** a raw transcript comes in; a job runs the pipeline in order;
progress is visible through the job record. This package decides *how
transcripts are cut* and *in what order the other units run*. It does not
decide what a proposition is, how entities are resolved, or how search works.

## Layout

```
src/
  windows.ts     windowBySpeakingTime(): lines → TranscriptWindow[]   (working code, moved from the eval harness)
  pipeline.ts    processMeeting(): parse → window → extract → persist → memory → index   (stub)
  config.ts      loadConfig(): the API process's env                                    (stub)
```

Transcript *parsing* is not here: `parseTranscript` lives in `@meetai/core`
because the line grammar is the system's input contract and every unit reads
it. Ingestion calls it, and uses `rejected` to refuse a malformed upload with
line numbers.

## Contracts

- Consumes `Extractor` (from `@meetai/ai`), `MeetingStore` / `JobStore` /
  `PropositionStore` / `ProjectMemory` (from `@meetai/memory`), `Indexer`
  (from `@meetai/retrieval`) — all as interfaces from `@meetai/core`, injected
  through `PipelineDeps`. Never import those packages here; the API's
  composition root wires them.
- Provides `TranscriptWindow`s to extraction and the `ExtractionRequest`
  (window + preceding lines + meeting context).

## What this package must not do

- Call the proxy. Extraction is behind the `Extractor` interface.
- Know the database. Stores are interfaces; the API passes implementations.
- Contain a prompt.

## First tasks

1. `processMeeting`: implement the stage loop against the interfaces with
   in-memory stores from `@meetai/memory`, so the whole flow runs end to end
   before any database exists. Idempotency per meeting is part of "done".
2. `loadConfig` with zod; `apps/api/.env.example` documenting every key.
3. Decide the job runner. For the prototype an in-process queue (one meeting
   at a time — the GPU serves two requests concurrently at most) is enough;
   BullMQ/Redis only if a second API instance ever exists.
4. Deployment: the proxy already runs on the Nitro; the API + embedding
   service run on the Mac for the demo. Write it down in `apps/api/README.md`.
