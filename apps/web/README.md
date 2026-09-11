# @meetai/web — the frontend

**Owner:** unit 5, frontend.

**Boundary:** a React app that consumes the HTTP API and nothing else. It
imports `@meetai/core` **type-only** for the request/response shapes and never
imports server code — importing a service function directly is how a monorepo
turns into a distributed monolith.

## Layout today

```
src/
  api.ts    one typed function per endpoint (stubs)
```

Scaffold the app in place when you start:

```bash
bun create vite apps/web --template react-ts   # keep package.json's name and the @meetai/core dep
```

then add Tailwind and TanStack Query. Keep `src/api.ts` as the single module
that talks to the backend; pages call it, never `fetch` directly.

## Contracts

- Consumes `@meetai/core/src/contracts/api.ts`. That file is the whole
  agreement with the backend; if a page needs a field that is not there, the
  change goes to core by PR, not to a local type.
- Ids and dates are strings. Render, do not parse, unless a component needs
  a `Date`.

## Pages for the review demo (kickoff, Sep 2026)

1. Upload + meeting list + transcript view + processing state (poll
   `getJob` until `completed`/`failed`).
2. Q&A: ask, show the answer, list the claims it used, expand each claim to
   the transcript lines underneath (`AskResponse.evidence` has them; no
   second call).
3. Commitments ledger and "what changed" per meeting.

## What this app must not do

- Call the model proxy directly. Everything goes through `apps/api`.
- Import from any `packages/*` other than `@meetai/core` (types only).

## First task

Until the API serves real data, build against fake JSON shaped by the
contract schemas — `Project`, `Meeting`, `AskResponse` etc. are zod schemas,
so `Schema.parse(fixture)` tells you immediately if the fake data drifts.
