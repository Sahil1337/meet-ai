/**
 * Single-conversation propositions extraction: the model gets resolve_date
 * and submit_propositions as tools, instead of a date pre-pass followed by a
 * separate schema-constrained call. response_format can't be combined with
 * tools on this proxy, so the propositions schema is modeled as one more
 * tool — calling it is the model's way of saying "I'm done, here is the
 * structured result" (the same trick Anthropic uses for forced structured
 * output: the schema is a tool, not a separate decoding mode).
 */

import type { QwenProxyClient } from "./client.ts";
import { RESOLVE_DATE_TOOL, resolveDateHandler } from "./date-tool.ts";
import type { ChatChunk, ChatCompletion, ChatMessage, Mode, Tool, ToolCall, ToolChoice } from "./shared/types.ts";

export const SUBMIT_PROPOSITIONS_TOOL_NAME = "submit_propositions";

function submitPropositionsTool(schema: Record<string, unknown>): Tool {
  return {
    type: "function",
    function: {
      name: SUBMIT_PROPOSITIONS_TOOL_NAME,
      description:
        "Submit the final list of extracted propositions. Call this exactly once, after every relative date has been resolved with resolve_date, to end the conversation.",
      parameters: schema,
    },
  };
}

export async function extractPropositions<T = { propositions: unknown[] }>(
  client: QwenProxyClient,
  systemPrompt: string,
  transcript: string,
  schema: Record<string, unknown>,
  options: {
    mode?: Mode;
    stream?: boolean;
    maxHops?: number;
    toolChoice?: ToolChoice;
    onChunk?: (chunk: ChatChunk) => void;
    onToolCall?: (call: ToolCall, result: unknown) => void;
  } = {},
): Promise<{
  value: T;
  completion: ChatCompletion;
  messages: ChatMessage[];
  hops: number;
  dateCalls: number;
}> {
  let dateCalls = 0;
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: transcript },
  ];

  const result = await client.runToolsUntil<T>(
    messages,
    [RESOLVE_DATE_TOOL, submitPropositionsTool(schema)],
    SUBMIT_PROPOSITIONS_TOOL_NAME,
    {
      resolve_date: (args) => {
        dateCalls++;
        return resolveDateHandler(args);
      },
    },
    {
      mode: options.mode,
      temperature: 0,
      maxHops: options.maxHops ?? 8,
      stream: options.stream,
      toolChoice: options.toolChoice,
      onChunk: options.onChunk,
      onToolCall: options.onToolCall,
    },
  );

  return { ...result, dateCalls };
}
