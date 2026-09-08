import { QwenProxyClient } from "../src/client.ts";
import { extractPropositions } from "../src/extraction-agent.ts";
import { AGENT_PROMPT, ORIGINAL_SCHEMA } from "./prompts.ts";
import { bold, dim, green, json, red } from "./test-helpers.ts";

const BASE_URL = "https://ai.sahil1337.com";
const API_KEY: string | undefined = undefined;
const MODE = "thinking" as const;

const TRANSCRIPT = [
  "Rahul [10:23 2026-09-01]: Honestly, we probably can't finish the payment integration by Friday. The gateway docs still haven't arrived.",
  "Priya [10:24 2026-09-01]: Then let's move it to Wednesday. Rahul, you own that.",
  "Rahul [10:24 2026-09-01]: Fine, Wednesday it is.",
].join("\n");

const client = new QwenProxyClient({ baseUrl: BASE_URL, apiKey: API_KEY, timeoutMs: 180_000 });

console.log(bold(`agent extraction  ·  ${BASE_URL}  ·  mode=${MODE}`));
console.log(dim(wrapLine(TRANSCRIPT)));

let hop = 0;

try {
  const { value, completion, hops, dateCalls } = await extractPropositions<{
    propositions: unknown[];
  }>(client, AGENT_PROMPT, TRANSCRIPT, ORIGINAL_SCHEMA, {
    mode: MODE,
    stream: true,
    onChunk: (chunk) => {
      const delta = chunk.choices[0]?.delta;
      if (delta?.reasoning_content) process.stdout.write(dim("."));
      if (delta?.content) process.stdout.write(dim("+"));
    },
    onToolCall: (call, result) => {
      hop++;
      console.log(`\n\n${bold(`hop ${hop}`)} ${call.function.name}(${call.function.arguments})`);
      console.log(dim(json(result)));
    },
  });

  console.log(`\n\n${bold("SUBMITTED PROPOSITIONS")}`);
  console.log(json(value));

  console.log(`\n${bold("SUMMARY")}`);
  console.log(`  hops: ${hops}`);
  console.log(`  resolve_date calls: ${dateCalls}`);
  console.log(`  finish_reason: ${completion.choices[0]?.finish_reason}`);
  console.log(
    `  tokens in=${completion.usage.prompt_tokens} out=${completion.usage.completion_tokens} reasoning=${completion.usage.completion_tokens_details.reasoning_tokens}`,
  );
  console.log(green("  agent loop completed"));
} catch (err) {
  console.log(`\n${red("ERROR")} ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

function wrapLine(text: string): string {
  return text
    .split("\n")
    .map((l) => `    ${l}`)
    .join("\n");
}
