# @meetai/api — not scaffolded yet

The backend: HTTP surface, auth, persistence, and orchestration of the AI
service layer. Routes stay thin; logic lives in services (`docs/product-spec.md`
§26).

Scaffold it here as a Bun-run Express app so nothing in `packages/` needs a
build step:

```bash
cd apps/api && bun init -y
bun add express zod
bun add -d @types/express
```

Then set `"name": "@meetai/api"`, add `"@meetai/ai": "workspace:*"`,
`"@meetai/core": "workspace:*"`, `"@meetai/tsconfig": "workspace:*"`, a
`tsconfig.json` extending `@meetai/tsconfig/base.json`, and `dev`/`typecheck`
scripts — copy the shape from `packages/ai/package.json`.

Talks to the proxy through `qwen-proxy/client` over the LAN; `PROXY_BASE_URL`
belongs in this app's own `.env`, not a shared root one.
