# meetAI

Project memory and reasoning over meetings: transcripts become structured
propositions, propositions become time-aware memory, memory answers questions
about what was decided, who committed to what, and what changed — with the
transcript lines as evidence. Product context in
[`docs/product-spec.md`](docs/product-spec.md); the target structure and why
in [`docs/architecture.md`](docs/architecture.md); who builds what in
[`docs/work-split.md`](docs/work-split.md).

## Layout

```
apps/            things that run — each has a process and a deploy target
  proxy/         qwen-proxy: OpenAI-compatible server over Ollama/Qwen3.5 (public mirror, do not edit)
  api/           the backend: HTTP surface + composition root        (unit 1)
  web/           the frontend: React, consumes the HTTP API only      (unit 5)
packages/        things that get imported — never run standalone
  core/          the shared contracts: domain model (zod) + interfaces between units + the transcript grammar
  ingestion/     transcript intake, windowing, the processing job     (unit 1)
  ai/            extraction agent, tool layer, prompts, answering     (unit 2)
  memory/        persistence, entity resolution, state, changes      (unit 3)
  retrieval/     embeddings, index, search                            (unit 4)
  tsconfig/      the base tsconfig everything else extends
evals/           eval suites — not deployed, not imported
  propositions/  extraction quality: fixtures, checks, manual verdict loop
docs/            product spec, architecture, audit, work split, reading list
```

`apps/` vs `packages/` is the only split rule: an app has a port, a package is
an import. Each unit's `README.md` states its owner, its boundary, and its
first task.

## Working in it

```bash
bun install          # one lockfile at the root covers every workspace
bun run typecheck    # every package, in parallel — must stay clean
bun run eval         # proposition extraction evals against the live proxy
bun run dev:api      # the backend
bun run dev:proxy    # the proxy, on the machine with the GPU
```

There is no build step for internal packages: they export TypeScript source
through their `exports` map, and everything runs under Bun. Don't add a build
unless something genuinely needs one.

## Rules that matter

- **Imports flow one way: apps → packages → core.** A unit package
  (`ingestion`, `ai`, `memory`, `retrieval`) imports `@meetai/core` and
  nothing else in `packages/`. The only place two units meet is
  `apps/api/src/container.ts`.
- **Any type that crosses a unit boundary lives in `@meetai/core`**, as a zod
  schema. Not in the unit that happened to need it first.
- **`apps/web` imports `@meetai/core` type-only** and otherwise talks to
  `apps/api` over HTTP. It never calls the proxy.
- **Nothing in `packages/` imports from `apps/`.** The one exception is
  `qwen-proxy`, which publishes a client through its `exports` map — that is
  a maintained contract, not an app internal.
- **`apps/proxy/` is public.** It mirrors out to
  [Sahil1337/qwen-proxy](https://github.com/Sahil1337/qwen-proxy) (MIT, forked
  by others) via `bun run mirror:proxy`. Nothing meetAI-private goes in that
  directory — no prompts, no fixtures, no transcripts, no schema — and its
  `LICENSE`, `AGENTS.md` and house style stay as they are.
- **`.env` per app, never one at the root.** The proxy runs on a different
  machine than the API; a shared env file would be a lie.
- **The proxy is a dumb, stateless endpoint.** Retrieval, embeddings, memory
  and state never run there.
