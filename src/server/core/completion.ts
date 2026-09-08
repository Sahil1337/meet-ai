import type { Ajv } from 'ajv';
import type { Config } from '../config.js';
import { ProxyError } from './errors.js';
import {
  requestOptions,
  resolveMaxTokens,
  toOllamaMessages,
  type ChatRequest,
  type CompletionFields,
  type Tool,
  type ToolChoice,
} from './mapping.js';
import type { FinishReason, ToolCall, ToolParse } from '../../shared/types.js';
import type { OllamaClient, OllamaMessage } from './ollama.js';
import { requestedMode, type RouteDecision } from './router.js';
import { resolveFormat, validateStructuredOutput } from './structured.js';
import { runTurn, turnRequest, type Delta, type Mode, type TurnInput, type TurnResult } from './thinking.js';
import {
  forcedToolFormat,
  unionFormat,
  parseUnionOutput,
  fromNativeToolCalls,
  isForcedChoice,
  parseForcedOutput,
  parseToolCalls,
  slimTools,
  ToolCallGate,
  toOpenAIToolCalls,
  validateToolCalls,
  type ParseResult,
} from './tools.js';
import { estimateTokens } from '../util/tokens.js';

export interface CompletionDeps {
  client: OllamaClient;
  config: Config;
  ajv: Ajv;
}

export interface StreamDelta extends Delta {
  toolCalls?: ToolCall[];
}

export interface CompletionResult extends CompletionFields {}

const TOOL_RETRY_PROMPT = (errors: string[]) =>
  `Your previous tool call was invalid: ${errors.join('; ')}. Emit a corrected <tool_call>.`;
const STRUCTURED_RETRY_PROMPT = (error: string) =>
  `Your previous response did not match the required JSON schema: ${error}. Respond again with only valid JSON.`;

/** Everything decided about a request before the first upstream call. */
export interface CompletionPlan {
  /** Tools the caller sent (full schemas, used for validation), or undefined when none apply. */
  activeTools: Tool[] | undefined;
  forcedChoice: ToolChoice | undefined;
  modeUsed: Mode;
  /**
   * Streaming must buffer when the whole body has to be seen first: a forced
   * call is decoded into `content`, and structured output can be replaced
   * outright by a validation retry. Tool calls stream fine — the backend
   * hands them over complete, so they are validated and emitted as one delta.
   */
  buffered: boolean;
  /** Tools and `response_format` were both sent, so the grammar is a union of both. */
  union: boolean;
  /** Input for the first turn: what the model actually sees. */
  turn: TurnInput;
}

function planCompletion(req: ChatRequest, config: Config, decision: RouteDecision): CompletionPlan {
  const activeTools: Tool[] | undefined = req.tool_choice === 'none' || !req.tools?.length ? undefined : req.tools;
  const forcedChoice = activeTools && req.tool_choice && isForcedChoice(req.tool_choice) ? req.tool_choice : undefined;
  const structuredFormat = resolveFormat(req.response_format);
  const modeUsed: Mode = forcedChoice ? 'fast' : decision.mode;

  // Tools rendered for the model may be slimmed; validation always uses `activeTools`.
  // Definitions go to the model even when `tool_choice` forces a call: forcing
  // which tool is used should not hide what the tools are for. The grammar is
  // the hard constraint, the definitions are the semantics.
  const modelTools = activeTools ? (config.TOOL_SCHEMA_SLIM ? slimTools(activeTools) : activeTools) : undefined;
  const messages = toOllamaMessages(req.messages);
  // `format` becomes a decoding grammar, not prompt text, so it is never slimmed.
  // `json_object` has no schema to union with, so it keeps the plain path.
  const responseSchema = typeof structuredFormat === 'string' ? undefined : structuredFormat;
  const unionTools = activeTools && !forcedChoice && responseSchema ? activeTools : undefined;
  const format =
    forcedChoice && activeTools
      ? forcedToolFormat(activeTools, forcedChoice)
      : unionTools && responseSchema
        ? unionFormat(unionTools, responseSchema)
        : structuredFormat;

  return {
    activeTools,
    forcedChoice,
    modeUsed,
    union: unionTools !== undefined,
    buffered: forcedChoice !== undefined || structuredFormat !== undefined,
    turn: {
      messages,
      mode: modeUsed,
      maxTokens: resolveMaxTokens(req, config),
      options: requestOptions(req, config),
      ...(modelTools ? { tools: modelTools } : {}),
      ...(format ? { format } : {}),
    },
  };
}

/** The first payload that would go to Ollama for this request (used by /v1/inspect). */
export function firstUpstreamRequest(req: ChatRequest, config: Config, decision: RouteDecision) {
  const plan = planCompletion(req, config, decision);
  return { plan, request: turnRequest(config, plan.turn, Boolean(req.stream) && !plan.buffered) };
}

/**
 * Runs one chat completion end to end: mode selection is already done by the
 * caller (so it can set headers first); this function handles tool calling,
 * structured output, validation retries and usage accounting.
 *
 * `onDelta` enables streaming. Reasoning and content stream as they arrive;
 * tool calls are held only long enough to validate. Forced calls and
 * structured output are buffered into a single delta at the end.
 */
export async function runChatCompletion(
  deps: CompletionDeps,
  req: ChatRequest,
  decision: RouteDecision,
  signal?: AbortSignal,
  onDelta?: (delta: StreamDelta) => void,
): Promise<CompletionResult> {
  const { client, config, ajv } = deps;
  const {
    activeTools,
    forcedChoice,
    modeUsed,
    union,
    buffered,
    turn: turnInput,
  } = planCompletion(req, config, decision);
  const unionTools = union ? activeTools : undefined;
  const messages = turnInput.messages;
  const streamDelta = buffered ? undefined : onDelta;

  const stats = {
    retries: 0,
    calls: 0,
    ms: 0,
    prompt: 0,
    completion: 0,
    loadMs: 0,
    promptEvalMs: 0,
    evalMs: 0,
    requests: [] as unknown[],
  };
  const track = (turn: TurnResult): TurnResult => {
    stats.calls += turn.upstreamCalls;
    stats.ms += turn.upstreamMs;
    stats.prompt += turn.promptTokens;
    stats.completion += turn.completionTokens;
    stats.loadMs += turn.timing.loadMs;
    stats.promptEvalMs += turn.timing.promptEvalMs;
    stats.evalMs += turn.timing.evalMs;
    stats.requests.push(...turn.requests);
    return turn;
  };

  const turnFor = async (msgs: OllamaMessage[]): Promise<TurnResult> => {
    // A fresh gate per turn: a retry restarts the content stream.
    const gate = streamDelta && activeTools ? new ToolCallGate() : undefined;
    const onTurnDelta: ((d: Delta) => void) | undefined = !streamDelta
      ? undefined
      : gate
        ? (d) => {
            const content = d.content ? gate.push(d.content) : '';
            if (content || d.reasoning) {
              streamDelta({ ...(content ? { content } : {}), ...(d.reasoning ? { reasoning: d.reasoning } : {}) });
            }
          }
        : streamDelta;
    const turn = await runTurn(client, config, { ...turnInput, messages: msgs }, signal, onTurnDelta);
    const tail = gate?.flush();
    if (streamDelta && tail) streamDelta({ content: tail });
    return track(turn);
  };

  let turn = await turnFor(messages);
  let toolParse: ToolParse = 'none';
  let content: string | null = turn.content.trim() || null;
  let toolCalls: ToolCall[] = [];

  if (activeTools) {
    const extract = (t: TurnResult): ParseResult => {
      if (forcedChoice) return parseForcedOutput(t.content);
      if (t.nativeToolCalls.length) return fromNativeToolCalls(t.nativeToolCalls);
      if (unionTools) return parseUnionOutput(t.content, unionTools);
      return parseToolCalls(t.content, activeTools);
    };
    let parsed = extract(turn);
    let errors = [...parsed.errors, ...validateToolCalls(parsed.calls, activeTools, ajv)];
    if (errors.length) {
      stats.retries++;
      turn = await turnFor([
        ...messages,
        assistantTurnMessage(turn),
        { role: 'user', content: TOOL_RETRY_PROMPT(errors) },
      ]);
      parsed = extract(turn);
      errors = [...parsed.errors, ...validateToolCalls(parsed.calls, activeTools, ajv)];
      if (errors.length) {
        throw new ProxyError(
          502,
          'tool_call_invalid',
          `Model produced an invalid tool call after one retry: ${errors.join('; ')}`,
          'upstream_error',
          { raw: turn.content, errors },
        );
      }
    }
    if (parsed.calls.length) {
      toolParse = forcedChoice ? 'forced' : turn.nativeToolCalls.length ? 'native' : unionTools ? 'union' : 'fallback';
      toolCalls = toOpenAIToolCalls(parsed.calls);
      content = parsed.content;
    } else {
      content = turn.content.trim() || null;
    }
  }

  if (req.response_format && req.response_format.type !== 'text' && toolCalls.length === 0) {
    let check = validateStructuredOutput(turn.content, req.response_format, ajv);
    if (!check.ok) {
      stats.retries++;
      turn = await turnFor([
        ...messages,
        { role: 'assistant', content: turn.content },
        { role: 'user', content: STRUCTURED_RETRY_PROMPT(check.error) },
      ]);
      check = validateStructuredOutput(turn.content, req.response_format, ajv);
      if (!check.ok) {
        throw new ProxyError(
          502,
          'structured_output_invalid',
          `Model output did not match response_format after one retry: ${check.error}`,
          'upstream_error',
          { raw: turn.content, error: check.error },
        );
      }
    }
    content = turn.content.trim();
  }

  const reasoning = turn.thinking.trim() || null;
  const finishReason: FinishReason = toolCalls.length ? 'tool_calls' : turn.doneReason === 'length' ? 'length' : 'stop';
  if (onDelta) {
    if (buffered) {
      onDelta({
        ...(reasoning ? { reasoning } : {}),
        ...(content ? { content } : {}),
        ...(toolCalls.length ? { toolCalls } : {}),
      });
    } else if (toolCalls.length) {
      // Reasoning and content already streamed; the calls waited on validation.
      onDelta({ toolCalls });
    }
  }

  return {
    content,
    reasoning,
    toolCalls,
    finishReason,
    usage: {
      prompt_tokens: stats.prompt,
      completion_tokens: stats.completion,
      total_tokens: stats.prompt + stats.completion,
      completion_tokens_details: { reasoning_tokens: reasoning ? estimateTokens(reasoning) : 0 },
    },
    meta: {
      router: decision,
      mode_requested: requestedMode(req) ?? null,
      mode_used: modeUsed,
      tool_parse: toolParse,
      retries: stats.retries,
      upstream_calls: stats.calls,
      upstream_ms: stats.ms,
      timing: {
        load_ms: stats.loadMs,
        prompt_eval_ms: stats.promptEvalMs,
        eval_ms: stats.evalMs,
        eval_tps: stats.evalMs > 0 ? Math.round((stats.completion / stats.evalMs) * 1000 * 10) / 10 : 0,
      },
      ...(req.debug ? { upstream_requests: stats.requests } : {}),
    },
  };
}

/** The turn just produced, replayed to the model as its own message. */
function assistantTurnMessage(turn: TurnResult): OllamaMessage {
  return {
    role: 'assistant',
    content: turn.content.trim(),
    ...(turn.nativeToolCalls.length ? { tool_calls: turn.nativeToolCalls } : {}),
  };
}
