/**
 * Entry point: `bun run eval` from the repo root. Configuration is
 * environment variables with the defaults below, so a different proxy,
 * transcript, or mode is a shell prefix, not a source edit.
 *
 *   PROXY_BASE_URL     default https://ai.sahil1337.com
 *   PROXY_API_KEY      default unset
 *   EVAL_TRANSCRIPT    path to a transcript file; default fixtures/kickoff-2026-09-07.txt
 *   EVAL_WINDOW        window target in seconds; default ingestion's (150)
 *   EVAL_MODE          fast | thinking | adaptive; default thinking
 *   EVAL_TOOL_CHOICE   auto | required; default auto
 *   EVAL_STREAM        1/0; default 1
 *   EVAL_MANUAL        1/0; default 1 (pause for a verdict after each window)
 *   EVAL_SUPPRESS      1/0; default 1 (only transcript + propositions per window)
 *   EVAL_SAVE          1/0; default 1 (write out/latest/)
 */

import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { EXTRACTION_PROMPT } from "@meetai/ai/prompts";
import { QwenProxyClient } from "qwen-proxy/client";
import { fixturesFromTranscript } from "./fixtures.ts";
import { runEvaluation } from "./runner.ts";

const env = process.env;
const flag = (name: string, fallback: boolean) => {
  const v = env[name];
  return v === undefined ? fallback : v !== "0" && v.toLowerCase() !== "false";
};
const oneOf = <T extends string>(name: string, allowed: readonly T[], fallback: T): T => {
  const v = env[name];
  if (v === undefined) return fallback;
  if (!(allowed as readonly string[]).includes(v)) throw new Error(`${name} must be one of ${allowed.join(", ")}`);
  return v as T;
};

const baseUrl = env.PROXY_BASE_URL ?? "https://ai.sahil1337.com";
const transcriptPath = env.EVAL_TRANSCRIPT ?? join(import.meta.dir, "..", "fixtures", "kickoff-2026-09-07.txt");
const windowSeconds = env.EVAL_WINDOW ? Number(env.EVAL_WINDOW) : undefined;

const fixtures = fixturesFromTranscript(basename(transcriptPath, ".txt"), readFileSync(transcriptPath, "utf8"), {
  windowSeconds,
});

await runEvaluation({
  client: new QwenProxyClient({ baseUrl, apiKey: env.PROXY_API_KEY, timeoutMs: 180_000 }),
  label: baseUrl,
  fixtures,
  systemPrompt: EXTRACTION_PROMPT,
  mode: oneOf("EVAL_MODE", ["fast", "thinking", "adaptive"] as const, "thinking"),
  toolChoice: oneOf("EVAL_TOOL_CHOICE", ["auto", "required"] as const, "auto"),
  stream: flag("EVAL_STREAM", true),
  manual: flag("EVAL_MANUAL", true),
  suppress: flag("EVAL_SUPPRESS", true),
  saveOutput: flag("EVAL_SAVE", true),
});
