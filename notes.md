## Ambiguity tool

Whenever the model hits a reference it can't resolve from the current transcript window — a pronoun ("he", "it", "that"), a bare noun phrase ("that feature", "the deadline"), or an implicit subject ("I'll work on that") — it shouldn't just give up. It should be able to investigate the transcript spoken before it until the reference resolves or there's genuinely nothing earlier to check.

**Status: implemented.** `investigate_ambiguity` in `src/ambiguity-tool.ts`, wired into `src/extraction-agent.ts` alongside `resolve_date`.

How it actually works — gather, then resolve in an isolated call:

- **Gather** (`gatherContext`, internal, pure JS): tries a keyword match first — pulls content words out of `reference` (stripping pronouns/articles/stopwords) and scans the *entire* known transcript for lines mentioning one, ranked by how many keywords match, however long ago they were said. Falls back to a plain 20-minute time-window lookback before `anchor_line` only when `reference` is a bare pronoun with nothing to search on, or nothing matched. Both are free in-memory scans, no model call.
- **Resolve** (`investigateAndResolveAmbiguity`): if the gather step found anything, it fires ONE model call in its own throwaway `messages` array — never appended to the main extraction conversation's transcript — asking only "what does this reference mean, given these candidate lines?" Only the compact answer (`{ resolved, referent }`) crosses back into the main conversation as the tool result; the raw candidate lines never do.

Why the split: an earlier version returned raw candidate lines straight into the main extraction conversation and let the model interpret them itself, widening the lookback across more hops (more tool calls) if the first pass wasn't enough. That worked, but every line returned stayed in the conversation for every subsequent hop including the final `submit_propositions` call — a transcript with several ambiguous references could add real token weight against the proxy's 8192-token context, and each widening round was a full extra hop through the main model. Splitting gather from resolve means the main conversation's context never grows by raw retrieved transcript at all — one call to `investigate_ambiguity` per reference, one small JSON object back, regardless of how much transcript had to be scanned to answer it. The cost: one extra model inference per ambiguous reference (real GPU time on a 4 GB 3050), traded for a flat, small main-conversation footprint. The resolver call defaults to `mode: "fast"` since it's a narrow, bounded lookup task, not something that needs deep reasoning; a resolver failure (proxy hiccup, timeout) degrades to `resolved: false` instead of throwing, so it can't take down an extraction that already made progress.

Windows are minutes, not seconds — this codebase's transcript lines are only timestamped to the minute (`Speaker [HH:MM YYYY-MM-DD]: ...`), so a literal 30-second window isn't a distinction the data can make.

The chunking problem this fixes: `fixturesFromMeeting()` (test/test-helpers.ts) splits a long meeting into independent ~150s windows for extraction, and until now each window had zero visibility into earlier ones — a reference whose antecedent fell in a previous window was unresolvable by construction, not just in practice. `extractPropositions()` now takes an optional `precedingTranscript` (everything spoken before the current window); it isn't sent to the model up front, only searched on demand inside `investigate_ambiguity`.

Falls back exactly the way rule 1 in the system prompt already said: if `investigate_ambiguity` comes back `resolved: false`, preserve the ambiguity rather than invent a referent.

Also updated: the system prompt (`test/prompts.ts`, rule 1 + Phase 2 + the TOOLS section) documents the one-call, already-resolved behavior, and the eval harness (`test/test-helpers.ts`) prints `ambiguity_calls` in each run's meta line.
