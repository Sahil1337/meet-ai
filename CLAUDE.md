# CLAUDE.md

Read `README.md` first — it has the layout, the import rules, and the reason
`apps/proxy/` is treated differently from everything else.

Quick reminders:

- `bun run typecheck` must stay clean across every workspace.
- Runtime is [Bun](https://bun.sh), not Node. Internal packages export raw
  TypeScript; there is no build step to keep working.
- `apps/proxy/` is a public mirror. It has its own `AGENTS.md` and its own
  house style (single quotes, 120 columns, NodeNext `.js` specifiers) — follow
  those inside that directory, and the root style outside it.
- Never put MeetIQ prompts, fixtures, or transcripts under `apps/proxy/`.
- Domain types go in `packages/core`, not wherever they were first needed.
