/**
 * Transcript window → propositions, as one tool-using conversation.
 *
 * The loop itself is `QwenProxyClient.runToolsUntil` (a maintained contract
 * of the proxy): it asks the model, runs each tool call through the handler
 * map, appends the result as a `role: "tool"` message, and stops when the
 * terminal tool is called. This file only assembles the pieces — prompt,
 * window, registry, terminal — and validates what comes back. It names no
 * tool.
 */

import {
  formatTranscript,
  type ExtractionRequest,
  type ExtractionResult,
  type Extractor,
} from "@meetai/core";
import type { QwenProxyClient } from "@meetai/proxy/client";
import type { ChatChunk, ChatCompletion, ChatMessage, Mode, ToolCall, ToolChoice } from "@meetai/proxy/types";
import { EXTRACTION_PROMPT } from "./prompts/extraction.ts";
import { toProxyTool } from "./tools/define.ts";
import { extractionTools, submitPropositionsTool } from "./tools/index.ts";
import type { ToolRegistry } from "./tools/registry.ts";

/** Bump when the prompt, the tool set, or the model changes in a way that alters output. Persisted on every proposition. */
export const EXTRACTOR_VERSION = "qwen3.5-4b/extraction-v2/2026-09";

export type ExtractOptions = {
  /** Defaults to EXTRACTION_PROMPT; evals swap prompts per run. */
  systemPrompt?: string;
  /** Defaults to `extractionTools`; evals may A/B a tool set. */
  tools?: ToolRegistry;
  mode?: Mode;
  /** Mode for tools' own side calls (reference resolution). Default `fast`. */
  resolverMode?: Mode;
  stream?: boolean;
  /**
   * `required` forces a grammar-constrained tool call every turn but the proxy
   * disables thinking on that path; `auto` lets `mode` reason but the model
   * may answer in prose, which `runToolsUntil` reports as `no_tool_call`.
   */
  toolChoice?: ToolChoice;
  /** One hop per distinct reference + one per distinct date expression + submit. */
  maxHops?: number;
  onChunk?: (chunk: ChatChunk) => void;
  onToolCall?: (call: ToolCall, result: unknown) => void;
};

/** `ExtractionResult` plus the raw conversation, for evals and debugging. */
export type ExtractionTrace = ExtractionResult & { completion: ChatCompletion; messages: ChatMessage[] };

export async function extractPropositions(
  client: QwenProxyClient,
  request: ExtractionRequest,
  options: ExtractOptions = {},
): Promise<ExtractionTrace> {
  const tools = options.tools ?? extractionTools;
  const terminal = submitPropositionsTool;
  const toolCalls: Record<string, number> = {};
  const started = performance.now();

  const messages: ChatMessage[] = [
    { role: "system", content: options.systemPrompt ?? EXTRACTION_PROMPT },
    { role: "user", content: formatTranscript(request.window.lines) },
  ];
  const handlers = tools.handlers(
    { client, transcript: [...request.preceding, ...request.window.lines], resolverMode: options.resolverMode ?? "fast" },
    (name) => void (toolCalls[name] = (toolCalls[name] ?? 0) + 1),
  );

  const { value, completion, messages: transcript, hops } = await client.runToolsUntil<unknown>(
    messages,
    [...tools.proxyTools(), toProxyTool(terminal)],
    terminal.name,
    handlers,
    {
      mode: options.mode,
      temperature: 0,
      maxHops: options.maxHops ?? 10,
      stream: options.stream,
      toolChoice: options.toolChoice,
      onChunk: options.onChunk,
      onToolCall: options.onToolCall,
    },
  );

  const { propositions } = terminal.parameters.parse(value);
  const usage = completion.usage;
  return {
    propositions,
    usage: {
      hops,
      toolCalls,
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      reasoningTokens: usage.completion_tokens_details.reasoning_tokens,
      ms: Math.round(performance.now() - started),
    },
    completion,
    messages: transcript,
  };
}

/** The core `Extractor` contract, for the API's composition root. */
export function createExtractor(client: QwenProxyClient, options: ExtractOptions = {}): Extractor {
  return {
    version: EXTRACTOR_VERSION,
    async extract(request) {
      const { propositions, usage } = await extractPropositions(client, request, options);
      return { propositions, usage };
    },
  };
}
