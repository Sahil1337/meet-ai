import { readFileSync } from "node:fs";
import { QwenProxyClient } from "../src/client.ts";
import { CONCISE_PROMPT, CONCISE_SCHEMA, ORIGINAL_PROMPT, ORIGINAL_SCHEMA, TYPES, withDateNote } from "./prompts.ts";
import { runEvaluation } from "./test-helpers.ts";
import type { Fixture } from "./types.ts";

const BASE_URL = "https://ai.sahil1337.com";
const API_KEY: string | undefined = undefined;
const MANUAL = true;
const TRANSCRIPT_FILE: string | undefined = undefined;
const MODE = "thinking" as const;
const DEBUG = false;
const USE_PROMPT: "original" | "concise" = "original";
const DATE_RESOLUTION: "tool" | "local" | "off" = "tool";
const STREAM = false;

const SYSTEM_PROMPT = withDateNote(
  USE_PROMPT === "original" ? ORIGINAL_PROMPT : CONCISE_PROMPT,
  DATE_RESOLUTION,
);
const SCHEMA = USE_PROMPT === "original" ? ORIGINAL_SCHEMA : CONCISE_SCHEMA;

const FIXTURES: Fixture[] = [
  {
    name: "hedged deadline, blocker, pronoun",
    transcript: [
      "Rahul [10:23 2026-09-01]: Honestly, we probably can't finish the payment integration by Friday. The gateway docs still haven't arrived.",
      "Priya [10:24 2026-09-01]: Then let's move it to Wednesday. Rahul, you own that.",
      "Rahul [10:24 2026-09-01]: Fine, Wednesday it is.",
    ].join("\n"),
  },
  {
    name: "joke, commitment, hedge",
    transcript: [
      "Priya [15:40 2026-09-04]: I'll rewrite the whole frontend tonight, haha, just kidding.",
      "Priya [15:41 2026-09-04]: Seriously though, I'll have the login page done by Monday.",
      "Aman [15:41 2026-09-04]: And I'll take a look at the auth API, no promises on timing.",
    ].join("\n"),
  },
];

await runEvaluation({
  client: new QwenProxyClient({
    baseUrl: BASE_URL,
    apiKey: API_KEY,
    timeoutMs: 180_000,
  }),
  label: `${BASE_URL}  ·  prompt=${USE_PROMPT}`,
  fixtures: TRANSCRIPT_FILE
    ? [
        {
          name: TRANSCRIPT_FILE,
          transcript: readFileSync(TRANSCRIPT_FILE, "utf8").trim(),
        },
      ]
    : FIXTURES,
  systemPrompt: SYSTEM_PROMPT,
  schema: SCHEMA,
  types: TYPES,
  mode: MODE,
  dateResolution: DATE_RESOLUTION,
  stream: STREAM,
  manual: MANUAL,
  debug: DEBUG,
});
