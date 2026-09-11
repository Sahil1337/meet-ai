# meetAI

Project memory and reasoning over meetings: transcripts become structured
propositions, propositions become memory, memory answers questions about what
was decided, who committed to what, and what changed. Full product context in
[`docs/product-spec.md`](docs/product-spec.md).

## Layout

```
apps/          things that run — each has a process and a deploy target
  proxy/       qwen-proxy: OpenAI-compatible server over Ollama/Qwen3.5
  api/         backend (not scaffolded yet)
  web/         frontend (not scaffolded yet)
packages/      things that get imported — never run standalone
  ai/          the AI service layer: extraction, tools, prompts
  core/        domain types, framework-free and storage-free
  tsconfig/    the base tsconfig everything else extends
evals/         eval suites — not deployed, not imported
  propositions/  extraction quality: fixtures, checks, manual verdict loop
  embedding/     Gemini embeddings API probes
docs/          product spec, reading list, design notes
```

`apps/` vs `packages/` is the only split rule: an app has a port, a package is
an import. Keep it that sharp.

## Working in it

```bash
bun install          # one lockfile at the root covers every workspace
bun run typecheck    # every package, in parallel
bun run eval         # proposition extraction evals against a live proxy
bun run dev:proxy    # the proxy, on the machine with the GPU
```

There is no build step for internal packages: they export TypeScript source
through their `exports` map, and everything runs under Bun. Don't add a build
unless something genuinely needs one.

## Rules that matter

- **Nothing in `packages/` imports from `apps/`.** The one exception is
  `qwen-proxy`, which publishes a client through its `exports` map — that is a
  maintained contract, not an app internal.
- **`apps/web` imports `@meetai/core` type-only** and otherwise talks to
  `apps/api` over HTTP.
- **`apps/proxy/` is public.** It mirrors out to
  [Sahil1337/qwen-proxy](https://github.com/Sahil1337/qwen-proxy) (MIT, forked
  by others) via `bun run mirror:proxy`. Nothing meetAI-private goes in that
  directory — no prompts, no fixtures, no transcripts, no schema.
- **`.env` per app, never one at the root.** The proxy runs on a different
  machine than the API; a shared env file would be a lie.
