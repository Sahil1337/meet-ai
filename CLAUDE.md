# CLAUDE.md

Read `README.md` first — it has the layout, the import rules, and the reason
`apps/proxy/` is treated differently from everything else. Then
`docs/architecture.md` for the unit boundaries and `docs/work-split.md` for
who owns what.

Quick reminders:

- `bun run typecheck` must stay clean across every workspace.
- Runtime is [Bun](https://bun.sh), not Node. Internal packages export raw
  TypeScript; there is no build step to keep working.
- `apps/proxy/` was its own repository before this one was renamed around it.
  It has its own `AGENTS.md`, its own MIT `LICENSE` and its own house style;
  follow those inside that directory and the root style outside it.
- Keep the proxy general. It is a dumb, stateless LLM endpoint — meetAI
  prompts, fixtures, transcripts and schemas do not belong under it.
- Domain types and cross-unit interfaces go in `packages/core` as zod
  schemas, not wherever they were first needed.
- Unit packages import `@meetai/core` only. Units are wired together in
  `apps/api/src/container.ts` and nowhere else.
- The transcript line grammar has one parser: `parseTranscript` in
  `@meetai/core`. Do not write another.
