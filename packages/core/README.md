# @meetai/core

The shared contracts. Owned by no single unit; changed by pull request with
the affected owners as reviewers.

## What belongs here

- **The domain model** as zod schemas with inferred types: `Project`,
  `Meeting`, `TranscriptLine`, `Proposition`, `Entity`, `EntityState`,
  `StateChange`, `Commitment`, `Answer`. `src/index.ts` lists them in spine
  order.
- **The transcript grammar and its one parser** (`src/transcript.ts`). Every
  unit that reads `Speaker [HH:MM YYYY-MM-DD]: text` imports this. Never
  re-implement it.
- **Interfaces between units** (`src/contracts/`): what ingestion hands
  extraction, what memory provides, what retrieval returns, what the API
  serves the frontend.

## What does not belong here

- Anything that imports from an app, a database driver, an HTTP framework, or
  the proxy client. If a type needs one of those, it is not a shared contract.
- Business logic. The parser is the one function here, and it is here because
  it *is* the contract.
- Types used by exactly one unit. Keep those in the unit.

## Conventions

- One `const X = z.object(...)` and one `type X = z.infer<typeof X>` per
  concept, same name. Import the value to validate, `import type` to type.
- `NewX = X.omit({ id, ... })` for the shape a caller supplies before the store
  has assigned ids.
- Ids are opaque strings; dates are ISO strings. No `Date`, no UUID
  assumption. The database is not chosen yet and nothing here may choose it.
- Every enum mirrors a list in `docs/product-spec.md`; the file header says
  which section.
