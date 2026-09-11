# @meetiq/web — not scaffolded yet

The frontend: dashboard, meetings, timeline, commitments, AI chat
(`docs/product-spec.md` §25).

```bash
bun create vite apps/web --template react-ts
```

Then set `"name": "@meetiq/web"`, add Tailwind + TanStack Query, and depend on
`@meetiq/core` for domain types — **type-only**. The web app talks to
`@meetiq/api` over HTTP and never imports server code; importing a service
function directly is how a monorepo turns into a distributed monolith.
