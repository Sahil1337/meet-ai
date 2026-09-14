# @meetai/ai — AI extraction

**Owner:** unit 2, AI extraction.

**Boundary:** transcript window in, propositions out; retrieved evidence in,
cited answer out. This is the only package that sends prompts to the model.
It talks to the proxy through `@meetai/proxy/client` and to nothing else: no
database, no vector index, no HTTP server, no file system.

## Layout

```
src/
  extraction.ts        extractPropositions(): prompt + window + registry + terminal → ExtractionResult
  answering.ts         createAnswerer(): stub for evidence → Answer
  prompts/             every prompt string, one file each; exported as @meetai/ai/prompts
  tools/
    define.ts          defineTool / defineTerminalTool / toProxyTool (zod → proxy Tool JSON)
    registry.ts        ToolRegistry: proxy definitions + validated handler map
    context.ts         what handlers may reach for
    resolve-date.ts    one tool per file: name, description, zod params, handler
    investigate-ambiguity.ts
    submit-propositions.ts   the terminal tool; its params are the output contract
    index.ts           the list. Adding a tool = new file + one line here.
```

## Contracts

- Provides `Extractor` and `Answerer` (`@meetai/core/contracts`).
- Consumes `ExtractionRequest`, `EvidenceBundle`, and the transcript grammar
  from `@meetai/core`. The output schema the model is constrained to is
  `ExtractedProposition` from core — there is no second copy here.

## What this package must not do

- Chunk or window transcripts (ingestion does that; you receive windows).
- Persist anything, resolve entities across meetings, or detect changes
  (memory does that; you emit claims for one window).
- Embed or search (retrieval does that; you receive evidence to answer from).
- Call the proxy from anywhere but through `ToolContext.client` or the
  extraction/answering entry points, so GPU usage stays traceable.

## First tasks

1. Fix the `investigate_ambiguity` acceptance gap described in
   `docs/audit.md` ("Can investigate_ambiguity fabricate a referent?"): have
   the resolver return `{ referent, supporting_line }` via `client.extract()`
   (that side call has no tools, so `response_format` is allowed) and
   downgrade to `resolved: false` when `supporting_line` is not one of the
   candidates. Re-run `bun run eval` before and after.
2. Emit evidence. `Proposition.evidence.lineIndexes` is required downstream
   and the extractor does not produce it yet. Add `evidenceLines: number[]`
   to `ExtractedProposition` (core, by PR), render line indexes into the
   window text the model sees, and add an eval check that every cited index
   is inside the window.
3. Use `ExtractionRequest.meeting` — the context header (title, participants)
   the kickoff decided on is in the request and currently ignored.

## Running

```bash
bun run eval          # evals/propositions against the live proxy
bun run typecheck
```
