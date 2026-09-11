# Audit of the meetAI codebase

**As of commit `48312a6` (chore: rename MeetIQ to meetAI), 2026-09-11.**
Every `path:line` below refers to the files at that commit. Several of those
files were restructured or deleted in the same branch as this document; use
`git show 48312a6:<path>` to see the cited lines. `apps/proxy/` was read but
is outside the audit's scope: it is a public mirror and is not modified.

Method: every source file outside `apps/proxy/` was read in full; every
claim of "unused" was checked by grepping the whole workspace for the symbol;
"dead" claims about the evidence field were checked against git history.
Where I could not verify, the finding says so.

Scale: outside the proxy and the 2325-line product spec there were 2,865
lines of TypeScript and config across 39 files. Half of that was two files.

---

## 1. The transcript line grammar was implemented three times

`Speaker [HH:MM YYYY-MM-DD]: text` is the system's input contract. Three
partial parsers existed, and they disagree on malformed input:

| Where | How | On a line that does not match |
| --- | --- | --- |
| `packages/ai/src/ambiguity-tool.ts:103` (`LINE` regex) + `:105-117` (`parseTranscriptLines`) | anchored regex, five capture groups | skipped silently |
| `evals/propositions/src/test-helpers.ts:111-120` (`speakersOf`) | `l.split(" [")[0]` | the whole line becomes a "speaker" |
| `evals/propositions/src/test-helpers.ts:151` (`chunkBySpeakingTime`) | `line.slice(line.indexOf("]: ") + 3)` | `indexOf` is -1, slice starts at 2: the text is silently mangled |

Plus the inverse, hand-rolled: `ambiguity-tool.ts:119-122` (`formatMinute`)
rebuilds `HH:MM YYYY-MM-DD` from epoch ms.

None of them reported a malformed line to a caller, so an upload with one bad
line would have produced wrong windows, a wrong speaker list, and a search
that silently ignored the line — three different wrong behaviours from one
input. **Fix applied:** one grammar and one parser in
`packages/core/src/transcript.ts` (`parseTranscript` returns `rejected` with
line numbers); all three sites now import it.

## 2. `evals/propositions/src/test-helpers.ts` — 584 lines, nine jobs

The brief suspected six. Counting by line range:

1. ANSI styling, `wrap`, `json`, `heading` — `:14-57`
2. TTY spinner — `:59-95`
3. Checks: `normalize`, `isVerbatim`, `speakersOf` — `:97-120`
4. Windowing: `chunkBySpeakingTime`, `fixturesFromMeeting` — `:122-187`
5. Raw-response printing and error description — `:189-237`
6. Outcome construction (`failOutcome`, `finishOutcome`) — `:239-344`, which also interleaves printing with computing warnings (`:277-315`)
7. One-fixture run loop with live streaming display — `:346-445`
8. Disk dump — `:447-481`
9. Whole-run orchestration: header, health check, manual verdict loop, summary table, exit code — `:483-584`

Job 4 is production chunking policy (see §6). **Fix applied:** split into
`render.ts`, `checks.ts`, `runner.ts`, `output.ts`, `fixtures.ts`, `run.ts`,
`types.ts`; windowing moved to `packages/ingestion`.

## 3. `packages/ai/src/ambiguity-tool.ts` — 414 lines, four concerns

- Transcript parsing — `:63-67`, `:102-117` (duplicate of §1)
- A keyword search engine over lines: stopword list `:162-174`, keyword
  extraction `:177-184`, scoring `:198-215`, time-window fallback `:256-279`
- A model call with its own prompt — `RESOLVER_SYSTEM_PROMPT` at `:284-288`,
  `resolveWithModel` at `:290-311`. This is a prompt living outside
  `prompts.ts`, which contradicts `packages/ai/src/index.ts:7-8` ("prompts
  are a separate entrypoint ... the evals swap them per run").
- The tool's JSON definition and handler — `:362-389`, `:400-414`
- A 47-line docblock (`:1-47`) that is reproduced almost verbatim as
  `docs/ambiguity-tool-notes.md`. Two copies of one essay.

**Fix applied:** parsing comes from core; the prompt moved to
`prompts/resolver.ts`; the tool is one `defineTool` in
`tools/investigate-ambiguity.ts`; the notes doc is deleted. The search logic
itself is unchanged — but see §10 for why it needs the extraction owner's
attention.

## 4. `packages/ai/src/prompts.ts` — 354 lines, one constant, and two things that do not belong

- `AGENT_PROMPT` (`:41-332`) is the extraction prompt. Fine as data.
- `TYPES` (`:25-39`) is the closed set of proposition kinds — typed as
  `string[]`, not `as const`, so `Proposition.type` in core
  (`packages/core/src/proposition.ts:11`) is `string`. The enum that defines
  the domain lived in the AI package's prompt file and core did not know it.
- `PROPOSITIONS_SCHEMA` (`:336-354`) is a hand-written JSON Schema of the
  `Proposition` type — a second source of truth for the same shape. They
  already disagreed: core had `evidence?: string` (`proposition.ts:15`), the
  schema had no such property.

**Fix applied:** `PROPOSITION_TYPES` and `ExtractedProposition` are zod in
core; the tool's JSON Schema is derived from them
(`packages/ai/src/tools/define.ts`, `toProxyTool`). I confirmed the derived
schema (draft-7, `io: "input"`) is structurally identical to the hand-written
one — same `type: ["string","null"]` for speaker, same enum, same `required`
— plus `minimum`/`maximum` on confidence and `minLength: 1` on text, which
the contract wants. (Unit 2 should still confirm with one `bun run eval`
that the grammar-constrained path accepts the two extra keywords; I made no
proxy calls.)

## 5. `packages/ai/src/extraction-agent.ts` hardcodes its tools

- The tool list is a literal at `:77`; the handler map at `:80-91`.
- Each tool has a different handler signature: `resolveDateHandler(args)` is
  sync (`date-tool.ts:123`); `investigateAmbiguityHandler(args,
  knownTranscript, client, resolverMode?)` is async with closed-over
  dependencies (`ambiguity-tool.ts:400-405`). The agent has to know each
  tool's dependencies to wire it.
- Calls are counted by hand: `dateCalls`/`ambiguityCalls` at `:61-62`,
  incremented at `:81` and `:85`, returned at `:107`. A third tool means a
  third counter and a wider return type.
- Arguments arrive as `Record<string, unknown>` and are coerced with
  `String(args.x ?? "")` (`date-tool.ts:124-125`,
  `ambiguity-tool.ts:406-407`): a missing argument becomes `""` silently.
  (The proxy validates arguments with ajv before returning a call, so this is
  mostly unreachable — but the handler's type does not know that.)
- Each tool hand-writes its parameter JSON Schema (`date-tool.ts:105-118`,
  `ambiguity-tool.ts:373-387`).
- The signature `extractPropositions<T>(client, systemPrompt, transcript,
  schema, options)` (`:30-60`) takes the prompt and the schema as arguments
  though the package exports exactly one of each, and there is one caller
  (`test-helpers.ts:377`). `T` is unchecked: `value` is `JSON.parse` output
  cast to `T` (`apps/proxy/src/client/index.ts:297`) and never validated.

**Fix applied:** `packages/ai/src/tools/` — `define.ts` (one definition
holds name, description, zod params, handler), `registry.ts` (the loop
consumes a registry; validation and call counting happen there),
`submit-propositions.ts` (the terminal tool, modelled as a distinct type with
no handler). `extraction.ts` names no tool, validates the terminal call with
zod, and is 100 lines including its option type and a `createExtractor`
adapter. The loop itself is still `QwenProxyClient.runToolsUntil`; see
`docs/architecture.md` §5 for why it was not re-implemented.

## 6. Misplaced code

| What | Where | Belongs to |
| --- | --- | --- |
| Windowing policy (`chunkBySpeakingTime`, `fixturesFromMeeting`) — the docblock `:122-137` describes *production* behaviour | `test-helpers.ts:139-187` | ingestion (`packages/ingestion/src/windows.ts`) |
| 121 lines of transcript as a JS string array with escaped quotes | `test.ts:32-154` | a `.txt` fixture (`evals/propositions/fixtures/kickoff-2026-09-07.txt`) — the file-loading branch already existed at `test.ts:178-185`, unreachable because `TRANSCRIPT_FILE` is a hardcoded `undefined` (`:10`) |
| The resolver prompt | `ambiguity-tool.ts:284-288` | `prompts/` |
| The proposition type enum | `prompts.ts:25-39` | core |
| `stream-tools.ts` (86 lines): a `get_weather` tool (`:9-20`) checking that the proxy streams reasoning "as expected post-change" (`:84`) | `evals/propositions/src/` | the proxy repo's `examples/`, or nowhere — it verified a proxy change that has landed. It is not an eval of anything meetAI, and it is the only reason six ANSI helpers were exported from `test-helpers.ts:17-21` |
| `docs/qwen-proxy-build-prompt.md`: the build prompt for the proxy. Describes a layout (`:81-97`: `src/routes/chat.ts`, `src/core/ollama.ts`) and stack (`:12`: Node 20+, vitest, tsx) that the real proxy does not have (`apps/proxy/src/server/...`, Bun) | `docs/` | git history |
| `docs/ambiguity-tool-notes.md`: cites `src/ambiguity-tool.ts`, `test/test-helpers.ts`, `test/prompts.ts`, `test/test.ts` — pre-monorepo paths, all wrong | `docs/` | the tool's own docblock |
| `evals/embedding/` (12 files): probes Google's hosted Gemini API. The kickoff decided local, self-hosted embeddings (`test.ts:60-66`, Sahil 15:14–15:16). Its README still calls the folder `test-embedding/` (`README.md:12`, `lib/env.ts:29`) | `evals/` | deleted; its measured-results table and the task-type/normalization findings are preserved in `packages/retrieval/README.md` |

## 7. Dead code — verified

**7.1 The evidence check has been unable to fire since commit `3f5410b`.**
`Proposition.evidence?: string` (`packages/core/src/proposition.ts:15`) has
no producer: `PROPOSITIONS_SCHEMA` has no `evidence` property and the prompt
never uses the word. `git show 3f5410b` shows `evidence` being removed from
the schema's `properties` and `required` along with `id`. The consumers were
left behind:

- `test-helpers.ts:106-108` `isVerbatim`
- `:272-274` `withEvidence` — always 0
- `:279-280`, `:295-298`, `:313-314`, `:325-328` — evidence printing and warnings
- `:338` `verbatim: withEvidence > 0 ? verbatim : -1` — always -1
- `:558`, `:568` — the "verbatim" summary column — always `-`
- `types.ts:73` `Outcome.verbatim`

About 25 lines of the harness's most important idea (hallucination
detection) that could not run. Removed; the replacement is
`Proposition.evidence: { meetingId, lineIndexes }` in core, required on the
persisted shape, and "emit evidence" is unit 2's second task.

**7.2 `EvalConfig.maxTokens`** (`types.ts:36`) — never read. Grep finds one
other occurrence, the warning *string* at `test-helpers.ts:436`. Nothing
passes `max_tokens` to the proxy.

**7.3 `EvalConfig.debug`** (`types.ts:50`) — set at `test.ts:193`, never read
in `test-helpers.ts`. `extractPropositions` neither accepts nor forwards a
`debug` flag, so `meetiq.upstream_requests` — which `printRaw` prints at
`test-helpers.ts:201-209` — can never be present. Dead config and a dead
printer branch.

**7.4 `test.ts:11`** — `// const MODE = "thinking" as const;` commented out
directly above the live `const MODE = "thinking";` at `:12`.

**7.5 Exports with no consumer** (grep across every workspace):

- `packages/ai/src/index.ts:11-12` re-exports `RESOLVE_DATE_TOOL`,
  `resolveDateHandler`, `INVESTIGATE_AMBIGUITY_TOOL`,
  `investigateAmbiguityHandler`; `:10` re-exports
  `SUBMIT_PROPOSITIONS_TOOL_NAME`. Their only importer is
  `extraction-agent.ts` inside the same package.
- `date-tool.ts:16` `Resolution`, `:38` `resolveDate`;
  `ambiguity-tool.ts:91` `ResolvedAmbiguity`, `:321`
  `investigateAndResolveAmbiguity` — `export`ed, but the package's `exports`
  map (`packages/ai/package.json:6-9`) exposes only `.` and `./prompts`, and
  `index.ts` does not re-export them. Exported to nobody.
- `test-helpers.ts:22` `cyan`, `:24` `wrap`, `:106` `isVerbatim`, `:111`
  `speakersOf`, `:139` `chunkBySpeakingTime` — exported, used only inside the
  file. `bold/dim/green/red/yellow/json` were exported solely for
  `stream-tools.ts:3`.

**7.6 Not dead, but inert under the committed configuration.** `SUPPRESS =
true` (`test.ts:19`) is the default. With it, the spinner (`test-helpers.ts:59-95`,
never started: `:372`), the live THINKING/CONTENT printers (`:384-407`), the
tool-call printer (`:408-422`), `printRaw` (`:191-222`) and the SYSTEM
PROMPT/SCHEMA dump (`:515-524`) never execute — about 120 lines. And `STREAM
= true` (`test.ts:14`) buys nothing visible in that configuration: `onChunk`
returns at `:385` and the proxy client assembles the same `ChatCompletion`
from the stream (`apps/proxy/src/client/index.ts:171-227`). Kept — flipping
`EVAL_SUPPRESS=0` is the debugging mode — but worth knowing that the default
run exercises a third of the harness.

## 8. Config that exists for no current reason

- `EvalConfig.wrapWidth?` (`types.ts:65`) — read at `test-helpers.ts:269,
  356, 486`, never set by any caller; always 100. Removed; `WIDTH` is a
  constant in `render.ts`.
- `packages/tsconfig/base.json:27-29` — "Some stricter flags (disabled by
  default)": `noUnusedLocals: false`, `noUnusedParameters: false`. Explicit
  no-ops. Had they been `true`, findings 7.2–7.5 would have been compiler
  errors. **Fix applied:** both are now `true`; the restructured tree passes.
- `packages/tsconfig/base.json:9-10` — `jsx: react-jsx`, `allowJs: true`
  with no `.tsx` or `.js` anywhere. Harmless; `apps/web` will need `jsx`.
  Left alone.
- `package.json:15` `"packageManager": "bun@1.1.38"` while the machine runs
  1.3.14 (`apps/proxy/package.json:20` pins the same). Informational; a
  human should decide whether to bump it.
- `evals/embedding/tsconfig.json` — the one workspace with its own
  toolchain: `module: NodeNext`, `types: ["node"]`,
  `exactOptionalPropertyTypes`, `erasableSyntaxOnly`; scripts run `node`
  (`package.json:6-11`); separate `@types/node` and `typescript ^5.9.2`
  devDependencies. Every other workspace extends
  `@meetai/tsconfig/base.json`. Deleted with the folder (§6).
- `BASE_URL = "https://ai.sahil1337.com"` hardcoded twice (`test.ts:7`,
  `stream-tools.ts:5`), `API_KEY: string | undefined = undefined` twice
  (`test.ts:8`, `stream-tools.ts:6`): configuration by source edit.
  Replaced by environment variables with defaults in `run.ts`.

## 9. Smaller things

- `date-tool.ts:66` — the note the model receives says "month arithmetic
  clamps to the same day-of-month". `Date.UTC(y, m + n, d)` does not clamp;
  it overflows (Jan 31 + 1 month = Mar 3). The behaviour is unchanged in the
  moved file; the note now says what actually happens.
- `date-tool.ts:83` — a bare weekday ("by Friday") said *on* a Friday
  resolves to the following Friday (`((wd - dow) + 7) % 7 || 7`), and "next
  Monday" said on a Sunday is eight days out (`:77`). Deliberate conventions,
  previously undocumented; now stated in the tool's header.
- `test-helpers.ts:552` and `:579` — `saveRunOutput` runs after every fixture
  *and* once more after the loop; the second write is identical to the last
  in-loop write. Kept the per-fixture write; the final call now only reports
  the path.
- `test-helpers.ts:51-57` says `heading()` is "the one place" that formats a
  section header; `:359-361` prints one by hand.
- `extraction-agent.ts:42`, `ambiguity-tool.ts:5, :10, :18`,
  `date-tool.ts:7-8`, `types.ts:19` — comments citing `test/test-helpers.ts`,
  `test/prompts.ts`, `test/test.ts`, `src/ambiguity-tool.ts`: pre-monorepo
  paths. `ambiguity-tool.ts:10` and `date-tool.ts:7` cite "rule 1" and "rule
  6" of a system prompt that has sections, not numbered rules (`prompts.ts:41-332`).
  `test-helpers.ts:132` cites `files/temp.md`, which is not in the repo.
- `normalize` is byte-identical in `ambiguity-tool.ts:96-100` and
  `test-helpers.ts:99-103`. Still two copies after the restructure (one in
  the tool for anchor matching, one in the eval for duplicate detection).
  Accepted: a four-line helper with two unrelated purposes is not worth a
  shared export, and core is not a utilities bin.
- `runToolsUntil` throws `no_tool_call` when the model answers in prose
  (`apps/proxy/src/client/index.ts:282-288`). The eval runs with
  `TOOL_CHOICE = "auto"` (`test.ts:15`), whose documented cost is exactly that
  "the model may reply without calling any tool" (`types.ts:43-44`). So any
  window where the 4B model narrates instead of calling a tool fails the
  fixture. Not a bug; a trade the eval config opts into. A "nudge" retry would
  need our own loop — see `docs/architecture.md` §5.

## 10. Can `investigate_ambiguity` fabricate a referent?

**Yes.** The code permits it and the gather step makes it likely for a
specific class of reference. The gather half was *executed*, not just read:
running `investigateAndResolveAmbiguity` on the kickoff transcript with the
anchor and reference below, and a stub client in place of the proxy, hands
the resolver exactly one candidate line — the wrong-sense one — and a stub
reply of "the fields in the database" comes back as `resolved: true`. What I
did not do is run the real model (this audit made no proxy calls), so
"the model *would* say that" is an argument, not an observation.

### The mechanism

1. `resolveWithModel` (`ambiguity-tool.ts:290-311`) sends the candidate lines
   and asks for "ONLY the resolved referent, stated as a short standalone
   phrase" (`:284-288`), in `mode: "fast"` — no reasoning — with
   `max_tokens: 80`.
2. Its reply is accepted as the referent if it is non-empty and not the
   literal word `UNRESOLVED` (`:309-310`). Nothing checks that the phrase
   occurs in, or is supported by, the candidates. Nothing checks it is not
   just the reference paraphrased back. A model told to answer in a short
   phrase is biased toward producing one.
3. The keyword gather (`findKeywordMatches`, `:198-215`) returns the bare
   lines that contain a content word of the reference — no neighbouring
   lines, ranked by how many keywords match, and deliberately unbounded in
   time (`:190-196`: "there's no reason to require it to be recent"). A line
   that uses the word in a *different sense* is presented with no
   surrounding conversation to reveal the sense.
4. Nothing prefers the current window over earlier ones: the search space is
   `precedingTranscript + transcript` flat (`extraction-agent.ts:71-73`).
5. The result carries no evidence — `ResolvedAmbiguity` (`:91-94`) is
   `{ resolved, referent, match_type, lines_considered }` — so nothing
   downstream can check. The extraction prompt then instructs the main model
   to use the referent (`prompts.ts:245`), and the proposition inherits it as
   fact with whatever `confidence` the main model assigns.

### A concrete case from the kickoff transcript (`evals/propositions/src/test.ts`)

Anchor line (`test.ts:124`):

> `Tejasva [15:35 2026-09-07]: Yeah, that's the annoying dependency. I can't really finalize the database table while the fields are still changing.`

Reference: `"the fields"`. What the speaker means: the fields of the claim
schema Yash owns (`test.ts:121`, `:123`, and Yash's reply at `:125`: "I'll
send you the final field list by Friday").

What the tool does:

- `extractKeywords("the fields")` → `["fields"]` (`:177-184`; "the" is a stopword).
- Scan lines *before* the anchor for `\bfields\b`. Exactly one matches
  (verified by grep): `test.ts:86` —
  > `Tejasva [15:23 2026-09-07]: Retrieval is the other thing I'm worried about. ... If someone asks "who owns the payment API?" or "what's due Friday?", that's not really a semantic question. We already have those fields in the database.`

  That line is about *query* fields (owner, due date) — the wrong sense. The
  lines that explain the reference ("You need the claim schema first
  though", `:123`; "Prompt, proposition schema", `:121`) do not contain the
  word "fields" and are not gathered. Yash's "final field list" (`:125`)
  is after the anchor and excluded by design (`:201`).
- The resolver sees one candidate about database fields and is asked for a
  short phrase. "The fields in the database" or "the database fields" is the
  natural reply. It is not `UNRESOLVED`, so `resolved: true`.
- The main model writes something like *"Tejasva cannot finalize the database
  table while the database fields are still changing"* — wrong, confident,
  and indistinguishable downstream from a correctly resolved claim.

Would the main model call the tool for this reference? The disambiguating
lines are in the same 150 s window, so possibly not. That is luck, not
design: the failure is generic to any reference whose content word appeared
earlier in a different sense, and the tool's own description promises it
"resolves the reference itself".

### Fixes, cheapest first (for the extraction owner)

1. **Verify before accepting.** Have the resolver return
   `{ referent, supporting_line }` using `client.extract()` with a JSON
   schema — that side call has no tools, so `response_format` is allowed
   there — and downgrade to `resolved: false` when `supporting_line` is not
   verbatim one of the candidates. This closes the acceptance gap at `:309-310`.
2. **Gather context, not hits.** Include the line before and after each
   keyword hit so the sense is visible.
3. **Search the window first.** Try the current window's lines before the
   preceding transcript; only widen on a miss.
4. **Return evidence.** Put the supporting line's timestamp in the tool
   result so a proposition built on it can cite it.

All four are local to `packages/ai/src/tools/investigate-ambiguity.ts` and
`prompts/resolver.ts`; none changes the tool's interface to the agent.

---

## DELETE list

Applied in this branch unless marked otherwise. Each line: what, and the one
reason.

**Files**

- `packages/ai/src/extraction-agent.ts` — hardcoded tool wiring; replaced by `src/extraction.ts` + the registry.
- `packages/ai/src/date-tool.ts` — moved to `src/tools/resolve-date.ts` as one `defineTool`; arithmetic byte-identical.
- `packages/ai/src/ambiguity-tool.ts` — moved to `src/tools/investigate-ambiguity.ts`; parsing now from core; prompt now in `prompts/`.
- `packages/ai/src/prompts.ts` — prompt moved verbatim to `src/prompts/extraction.ts`; `TYPES` and `PROPOSITIONS_SCHEMA` replaced by core's zod schema and derivation.
- `evals/propositions/src/test-helpers.ts` — nine jobs in one file; split by job.
- `evals/propositions/src/test.ts` — became `src/run.ts` (env-configured) + `fixtures/kickoff-2026-09-07.txt`.
- `evals/propositions/src/stream-tools.ts` — a proxy streaming smoke test in the propositions eval; verified a proxy change that has landed.
- `evals/embedding/` (12 files) — probes a hosted API the team decided against, on a divergent toolchain; findings preserved in `packages/retrieval/README.md`, code in git history.
- `docs/ambiguity-tool-notes.md` — duplicate of the tool's docblock, with stale paths.
- `docs/qwen-proxy-build-prompt.md` — build prompt for a finished repo; its layout and stack no longer match the proxy.

**Exports and fields**

- `Proposition.evidence?: string` (core) — no producer since `3f5410b`; replaced by `Evidence { meetingId, lineIndexes }`, required on the persisted `Proposition`.
- `EvalConfig.maxTokens`, `EvalConfig.debug`, `EvalConfig.wrapWidth`, `Outcome.verbatim` — never read, never set, or always `-1`.
- `@meetai/ai` re-exports `RESOLVE_DATE_TOOL`, `resolveDateHandler`, `INVESTIGATE_AMBIGUITY_TOOL`, `investigateAmbiguityHandler`, `SUBMIT_PROPOSITIONS_TOOL_NAME` — no consumer outside the package; replaced by tool definitions + `ToolRegistry`.
- `Resolution`, `resolveDate`, `ResolvedAmbiguity`, `investigateAndResolveAmbiguity` as *package-level* exports — unreachable through the `exports` map. (`resolveDate` and `investigateAndResolveAmbiguity` stay exported from their tool files for unit tests; they are still not on the package surface.)
- `TYPES` (prompts) — now `PROPOSITION_TYPES` in core.
- `PROPOSITIONS_SCHEMA` (prompts) — derived from `ExtractedProposition` at the terminal tool.
- `isVerbatim`, `speakersOf`, `chunkBySpeakingTime`, `fixturesFromMeeting`, `cyan`, `wrap` as harness exports — `speakersOf` is core's; windowing is ingestion's; the rest are internal to `render.ts`.
- `packages/tsconfig/base.json` `noUnusedLocals: false`, `noUnusedParameters: false` — now `true`.

**Recommended, not applied (needs a human)**

- `package.json` `"packageManager": "bun@1.1.38"` — bump to the version the team actually runs, or drop the field. Also pinned in `apps/proxy/package.json`, which this branch does not touch.
