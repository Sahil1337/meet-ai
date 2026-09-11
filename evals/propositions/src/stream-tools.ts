import { QwenProxyClient } from "qwen-proxy/client";
import type { ChatMessage, Tool } from "qwen-proxy/types";
import { bold, dim, green, json, red, yellow } from "./test-helpers.ts";

const BASE_URL = "https://ai.sahil1337.com";
const API_KEY: string | undefined = undefined;
const MODE = "thinking" as const;

const GET_WEATHER_TOOL: Tool = {
  type: "function",
  function: {
    name: "get_weather",
    description: "Get the current weather for a city.",
    parameters: {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
    },
  },
};

const messages: ChatMessage[] = [
  { role: "user", content: "What's the weather in Paris right now? Use the tool." },
];

const client = new QwenProxyClient({ baseUrl: BASE_URL, apiKey: API_KEY, timeoutMs: 180_000 });

console.log(bold(`stream + tools  ·  ${BASE_URL}  ·  mode=${MODE}`));
console.log(dim(json({ messages, tools: [GET_WEATHER_TOOL] })));

let reasoningDeltas = 0;
let contentDeltas = 0;
let toolCallChunks = 0;
let finishReason: string | null = null;
const started = performance.now();
let toolCallAtMs: number | null = null;

try {
  for await (const chunk of client.stream({
    messages,
    tools: [GET_WEATHER_TOOL],
    mode: MODE,
    temperature: 0,
  })) {
    const elapsed = ((performance.now() - started) / 1000).toFixed(2);
    const delta = chunk.choices[0]?.delta ?? {};

    if (delta.reasoning_content) {
      reasoningDeltas++;
      process.stdout.write(dim("."));
    }
    if (delta.content) {
      contentDeltas++;
      console.log(`\n${dim(`t=${elapsed}s`)} content: ${delta.content}`);
    }
    if (delta.tool_calls) {
      toolCallChunks++;
      toolCallAtMs = performance.now() - started;
      console.log(`\n${bold(`t=${elapsed}s`)} tool_calls delta`);
      console.log(json(delta.tool_calls));
    }
    if (chunk.choices[0]?.finish_reason) {
      finishReason = chunk.choices[0].finish_reason;
      console.log(`\n${dim(`t=${elapsed}s`)} finish_reason: ${finishReason}`);
    }
  }
} catch (err) {
  console.log(`\n${red("ERROR")} ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

console.log(`\n${bold("SUMMARY")}`);
console.log(`  reasoning_content deltas: ${reasoningDeltas}`);
console.log(`  content deltas: ${contentDeltas}`);
console.log(
  `  tool_calls chunks: ${toolCallChunks}  ${
    toolCallChunks === 1 ? green("(single complete delta, as expected)") : yellow("(expected exactly 1)")
  }`,
);
console.log(`  finish_reason: ${finishReason}`);
if (toolCallAtMs !== null) console.log(`  tool call arrived at t=${(toolCallAtMs / 1000).toFixed(2)}s`);
console.log(
  reasoningDeltas > 1
    ? green("  reasoning streamed incrementally, as expected post-change")
    : yellow("  only one (or zero) reasoning_content delta — expected many if the model reasoned"),
);
