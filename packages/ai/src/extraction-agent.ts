/**
 * Single-conversation propositions extraction: the model gets resolve_date
 * and submit_propositions as tools, instead of a date pre-pass followed by a
 * separate schema-constrained call. response_format can't be combined with
 * tools on this proxy, so the propositions schema is modeled as one more
 * tool — calling it is the model's way of saying "I'm done, here is the
 * structured result" (the same trick Anthropic uses for forced structured
 * output: the schema is a tool, not a separate decoding mode).
 */

import { INVESTIGATE_AMBIGUITY_TOOL, investigateAmbiguityHandler } from "./ambiguity-tool.ts";
import type { QwenProxyClient } from "qwen-proxy/client";
import { RESOLVE_DATE_TOOL, resolveDateHandler } from "./date-tool.ts";
import type { ChatChunk, ChatCompletion, ChatMessage, Mode, Tool, ToolCall, ToolChoice } from "qwen-proxy/types";

export const SUBMIT_PROPOSITIONS_TOOL_NAME = "submit_propositions";

function submitPropositionsTool(schema: Record<string, unknown>): Tool {
  return {
    type: "function",
    function: {
      name: SUBMIT_PROPOSITIONS_TOOL_NAME,
      description:
        "Submit the final list of extracted propositions. Call this exactly once, after every relative date has been resolved with resolve_date, to end the conversation. An empty array is a valid result when the transcript carries no substantive project information.",
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
    /**
     * Transcript spoken before `transcript`'s window, oldest first —
     * everything fixturesFromMeeting() (test/test-helpers.ts) already
     * chunked away. Not sent to the model up front; investigate_ambiguity
     * searches it on demand so a reference whose antecedent fell in an
     * earlier window can still be resolved instead of just preserved as
     * ambiguous (see the REFERENCES section). Omit for the first window, or when the caller has
     * no earlier transcript to offer.
     */
    precedingTranscript?: string;
    onChunk?: (chunk: ChatChunk) => void;
    onToolCall?: (call: ToolCall, result: unknown) => void;
  } = {},
): Promise<{
  value: T;
  completion: ChatCompletion;
  messages: ChatMessage[];
  hops: number;
  dateCalls: number;
  ambiguityCalls: number;
}> {
  let dateCalls = 0;
  let ambiguityCalls = 0;
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: transcript },
  ];
  // investigate_ambiguity's search space: everything the model could
  // plausibly need to look back through, including the window it's
  // currently extracting from (a reference can point at an earlier line in
  // the same window too, though the model shouldn't need the tool for that).
  const knownTranscript = options.precedingTranscript
    ? `${options.precedingTranscript}\n${transcript}`
    : transcript;

  const result = await client.runToolsUntil<T>(
    messages,
    [RESOLVE_DATE_TOOL, INVESTIGATE_AMBIGUITY_TOOL, submitPropositionsTool(schema)],
    SUBMIT_PROPOSITIONS_TOOL_NAME,
    {
      resolve_date: (args) => {
        dateCalls++;
        return resolveDateHandler(args);
      },
      investigate_ambiguity: (args) => {
        ambiguityCalls++;
        // Its own isolated model call (see ambiguity-tool.ts) — not another
        // hop of this conversation, so it doesn't grow `messages` beyond the
        // compact { resolved, referent } it returns.
        return investigateAmbiguityHandler(args, knownTranscript, client);
      },
    },
    {
      mode: options.mode,
      temperature: 0,
      // investigate_ambiguity now resolves in one hop per reference (the
      // widening happens inside its own isolated call, not as extra hops
      // here), so this mainly needs to cover: one hop per distinct
      // ambiguous reference + one per distinct date expression + submit.
      maxHops: options.maxHops ?? 10,
      stream: options.stream,
      toolChoice: options.toolChoice,
      onChunk: options.onChunk,
      onToolCall: options.onToolCall,
    },
  );

  return { ...result, dateCalls, ambiguityCalls };
}
