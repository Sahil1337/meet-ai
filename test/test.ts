import { readFileSync } from "node:fs";
import { QwenProxyClient } from "../src/client.ts";
import { AGENT_PROMPT, PROPOSITIONS_SCHEMA, TYPES } from "./prompts.ts";
import { runEvaluation } from "./test-helpers.ts";
import type { Fixture } from "./types.ts";

const BASE_URL = "https://ai.sahil1337.com";
const API_KEY: string | undefined = undefined;
const MANUAL = true;
const TRANSCRIPT_FILE: string | undefined = undefined;
// const MODE = "thinking" as const;
const MODE = "thinking";
const DEBUG = false;
const STREAM = true;
const TOOL_CHOICE: "required" | "auto" = "auto";

const FIXTURES: Fixture[] = [
  {
    name: "architecture rationale, latency tradeoff, action item",
    transcript: [
      "Aisha [14:02 2026-09-08]: Quick one before we move on — why are we going with a queue-based ingestion pipeline instead of just writing straight to the database?",
      "Marcus [14:02 2026-09-08]: Mainly because the transcription service can burst pretty hard right after a call ends, sometimes twenty requests in a couple seconds, and we don't want to hammer Postgres directly.",
      "Marcus [14:02 2026-09-08]: The queue lets us smooth that out and retry failed writes without losing anything.",
      "Aisha [14:02 2026-09-08]: Makes sense. What happens if the worker crashes mid-batch though?",
      "Marcus [14:03 2026-09-08]: Each message only gets acked after the write commits, so a crash just means it gets redelivered. Worst case we double-process, but the insert is idempotent on the transcript id.",
      "Devika [14:03 2026-09-08]: Is that going to add much latency for the propositions to show up though? Sales wants it near real time.",
      "Marcus [14:03 2026-09-08]: A few hundred milliseconds at most under normal load, it's really only the burst scenario where it queues up.",
      "Devika [14:03 2026-09-08]: Okay, that's fine for now. Can you drop a short doc on the retry behavior so support isn't guessing during an incident?",
      "Marcus [14:03 2026-09-08]: Yeah, I'll get that written up by Thursday.",
    ].join("\n"),
  },
  {
    name: "priority deferral, deal-blocking dependency, risk",
    transcript: [
      "Jordan [11:15 2026-09-10]: Before we wrap, I wanted to bring up the multi-language support request again — a few customers in Germany and Japan have asked for it.",
      "Priya [11:15 2026-09-10]: Yeah, I've had that half-scoped for a couple weeks now.",
      "Sam [11:15 2026-09-10]: I hear you, but honestly, that's not a priority for this quarter. We need to get the enterprise SSO integration out first — that's what's blocking the Marlowe deal.",
      "Jordan [11:16 2026-09-10]: Understood, I just don't want it to get lost entirely.",
      "Sam [11:16 2026-09-10]: It won't. Let's revisit it once SSO ships, probably late October.",
      "Priya [11:16 2026-09-10]: Should I still keep the scoping doc updated in the meantime, or shelve it completely?",
      "Sam [11:16 2026-09-10]: Keep it updated, just don't start any implementation work on it.",
      "Jordan [11:16 2026-09-10]: Fair enough. One more thing — is SSO actually going to be ready before Marlowe's renewal date?",
      "Sam [11:16 2026-09-10]: That's the plan, but it's tight. If the SAML library integration slips, we might need to ask them for a two week extension.",
    ].join("\n"),
  },
];

await runEvaluation({
  client: new QwenProxyClient({
    baseUrl: BASE_URL,
    apiKey: API_KEY,
    timeoutMs: 180_000,
  }),
  label: BASE_URL,
  fixtures: TRANSCRIPT_FILE
    ? [
        {
          name: TRANSCRIPT_FILE,
          transcript: readFileSync(TRANSCRIPT_FILE, "utf8").trim(),
        },
      ]
    : FIXTURES,
  systemPrompt: AGENT_PROMPT,
  schema: PROPOSITIONS_SCHEMA,
  types: TYPES,
  mode: MODE,
  stream: STREAM,
  toolChoice: TOOL_CHOICE,
  manual: MANUAL,
  debug: DEBUG,
});
