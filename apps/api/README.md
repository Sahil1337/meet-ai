# @meetai/api — the backend process

**Owner:** unit 1, ingestion & deployment (Sahil), together with
`packages/ingestion`.

**Boundary:** the HTTP surface the frontend talks to, and the composition
root where the five units are wired together. Routes are thin; every piece
of logic lives in a package. This is the only place that imports more than
one unit package.

## Layout

```
src/
  index.ts       Bun.serve + error envelope (501 for unimplemented routes)
  routes.ts      one entry per endpoint in @meetai/core/src/contracts/api.ts; thin handlers
  container.ts   createContainer(): chooses implementations, hands them to each other
```

No framework. `Bun.serve` and a 20-line matcher cover nine JSON endpoints.
If a real need for Express appears, add it and say why in
`docs/architecture.md`.

## Endpoints

See `@meetai/core/src/contracts/api.ts` — the request/response schemas are
the contract with `apps/web`, and that file's header lists every route.

## Configuration

`.env` in this directory (never at the repo root — the proxy runs on a
different machine). Keys are defined by `loadConfig` in `@meetai/ingestion`:

```
PORT=3000
PROXY_BASE_URL=https://ai.sahil1337.com
PROXY_API_KEY=
EMBEDDER_BASE_URL=http://127.0.0.1:8100
WINDOW_SECONDS=150
DATABASE_URL=postgres://localhost/meetai
```

The index is Postgres + pgvector, and `DATABASE_URL` is required — a
`postgres://` URL to a server with the `vector` extension. The same one in
development as anywhere else; there is no embedded fallback.

## What this app must not do

- Contain a prompt, a SQL string, an embedding call, or a chunking loop.
- Let the frontend reach the proxy. Everything goes through here.

## First tasks

1. `POST /projects/:id/meetings`: parse with `parseTranscript` (reject with
   line numbers if `rejected` is non-empty), create the meeting and job
   through the stores, start `processMeeting` in the background, return
   `UploadMeetingResponse`.
2. `GET /jobs/:id` and `GET /meetings/:id` — the two the frontend polls.
3. `POST /projects/:id/ask`: `searcher.search` → hydrate hits via
   `propositions.getMany` + `meetings.getLines` → `answerer.answer`.
4. Deployment notes: where each process runs for the demo (proxy on the
   Nitro, API + embedder on the Mac), how to start them, what to check.

## Running

```bash
bun run dev:api       # from the repo root
```
