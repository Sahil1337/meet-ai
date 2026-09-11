# evals/propositions — extraction quality

**Owner:** unit 2, AI extraction (it measures their output). Anyone runs it.

The one piece of the repo that measures whether the model produces useful
claims. It feeds a real meeting transcript through the *production* path —
core's parser, ingestion's windower, `@meetai/ai`'s extractor with its
registered tools — and prints each window's propositions for a human verdict.

```bash
bun run eval                                   # kickoff transcript, thinking mode, pause per window
EVAL_MANUAL=0 EVAL_SUPPRESS=0 bun run eval     # unattended, full trace: live thinking, tool calls, raw response
EVAL_TRANSCRIPT=path/to/meeting.txt bun run eval
```

Every knob is an environment variable; `src/run.ts` lists them. Outputs go
to `out/latest/` (gitignored): `transcript.txt` and `claims.json`, rewritten
after every window so a crash loses at most the window in flight.

## Layout

```
fixtures/   transcripts in the `Speaker [HH:MM YYYY-MM-DD]: text` grammar; one meeting per file
src/
  run.ts        entry: env → config → runEvaluation
  fixtures.ts   transcript file → one Fixture per window (parse + window + preceding lines)
  runner.ts     the loop: extract, stream to the terminal, check, ask for a verdict, summarize
  checks.ts     pure checks: speaker in transcript, duplicates, empty result
  render.ts     colours, wrapping, spinner, the printers
  output.ts     out/latest/ dump
  types.ts      Fixture, EvalConfig, Outcome
```

## What a run tells you

- Per window: the transcript, the propositions, and (with `EVAL_SUPPRESS=0`)
  the model's live reasoning, every tool call and result, the raw completion,
  and a META line — mode used, router rule, tool parse path, hops, calls per
  tool, tokens.
- Warnings from `checks.ts`. Shape violations (bad `type`, confidence out of
  range) are not warnings: the extractor validates the model's submission
  with the zod schema and a violation fails the window with the issues listed.
- Your verdict (`p`/`f`) per window, and PASS/WARN/FAIL in the summary.

## Adding a transcript

Drop a `.txt` in `fixtures/` in the line grammar and point `EVAL_TRANSCRIPT`
at it. Malformed lines are rejected with their line number before anything
is sent to the proxy.

## Not here

- Retrieval evals (unit 4 will add `evals/retrieval`).
- Proxy behaviour probes. Those belong in the proxy repo's `examples/`.
