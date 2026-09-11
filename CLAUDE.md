# CLAUDE.md

Read `README.md` first — it has the layout, the import rules, and the reason
`apps/proxy/` is treated differently from everything else. Then
`docs/architecture.md` for the unit boundaries and `docs/work-split.md` for
who owns what.

Quick reminders:

- `bun run typecheck` must stay clean across every workspace.
- Runtime is [Bun](https://bun.sh), not Node. Internal packages export raw
  TypeScript; there is no build step to keep working.
- `apps/proxy/` is a public mirror. Do not edit anything under it. It has its
  own `AGENTS.md` and its own house style; follow those inside that directory,
  and the root style outside it.
- Never put meetAI prompts, fixtures, or transcripts under `apps/proxy/`.
- Domain types and cross-unit interfaces go in `packages/core` as zod
  schemas, not wherever they were first needed.
- Unit packages import `@meetai/core` only. Units are wired together in
  `apps/api/src/container.ts` and nowhere else.
- The transcript line grammar has one parser: `parseTranscript` in
  `@meetai/core`. Do not write another.
