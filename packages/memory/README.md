# @meetai/memory — database, memory & change detection

**Owner:** unit 3, database, memory & change detection.

**Boundary:** everything that persists, and everything that turns claims
into time-aware project state. Propositions come in; entities, states, and
changes come out; the commitment ledger and timeline are read from here.
This package is the only one that will ever know which database was chosen.

## Layout

```
src/
  stores.ts          ProjectStore / MeetingStore / JobStore / PropositionStore — plain persistence
  project-memory.ts  ProjectMemory.ingest(): entity resolution → state derivation → change detection
  queries.ts         MemoryQueries: commitments, timeline, changes, entity history
```

Everything is a stub that throws. The class names say `InMemory*` because
that is the first implementation to write (see below), not because in-memory
is the plan.

## Contracts

- Provides every interface in `@meetai/core/src/contracts/memory.ts`.
- Consumes `Proposition`, `Entity`, `EntityState`, `StateChange`,
  `Commitment`, `TimelineEntry` from `@meetai/core`. The shapes are fixed
  there; propose changes by PR.
- Does not consume the proxy client. If a step needs a model (classifying a
  contradiction as intentional vs. accidental), ask unit 2 for a function
  behind an interface in core — do not write a prompt here.

## The model, in one paragraph

Spine: Source → Claim → Entity → State → Change. A `Proposition` (claim)
mentions `Entity`s. Memory derives `EntityState` records — one per *aspect*
(status, owner, deadline, blocked_by, decided) with `validFrom`/`validTo`,
never overwritten. A new state that differs from the current state of the
same aspect closes the old one and emits a `StateChange` with a kind (new,
delayed, reassigned, contradicted, …) and a classification (intentional,
correction, contradiction, unclear). `Commitment` and `TimelineEntry` are
views over those records.

## What this package must not do

- Choose the database in a way that leaks: no driver types in any export.
- Call the model directly.
- Chunk, extract, embed, or search.

## First tasks

1. Implement the four `InMemory*` stores with Maps. This unblocks the API and
   the pipeline the same week, before any database decision, and becomes the
   reference implementation for the database-backed stores' tests.
2. `ProjectMemory.ingest` for the two aspects that matter for the review
   demo: `commitment` → owner + deadline + status states, and a second
   meeting's `status`/`blocker` propositions producing `delayed` / `blocked`
   changes. Idempotent per meeting.
3. `MemoryQueries.commitments` and `changes` — the two views the frontend
   needs first.
4. Then the database. Postgres is the kickoff's leaning (claims and vectors
   in one place); the interfaces above are what make that a swap, not a
   rewrite. Write the schema only after the in-memory version has run a
   real meeting end to end.
