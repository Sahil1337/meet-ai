import { z } from 'zod';
import type { Config } from '../config.js';
import { invalidRequest } from './errors.js';
import type { OllamaMessage, OllamaOptions } from './ollama.js';
import { estimateJsonTokens, estimateTokens } from '../util/tokens.js';
import { isRecord } from '../util/json.js';
import type {
  ChatChunk,
  ChatCompletion,
  ChatRequest as WireChatRequest,
  ChunkDelta,
  FinishReason,
  Mode,
  ProxyMeta,
  ToolCall,
  Usage,
} from '../../shared/types.js';

export type { ChunkDelta };

// ---------------------------------------------------------------------------
// OpenAI request schema (unknown fields are kept so SDK extras never 400)
// ---------------------------------------------------------------------------

const contentPartSchema = z.looseObject({ type: z.string(), text: z.string().optional() });

const messageToolCallSchema = z.object({
  id: z.string().optional(),
  type: z.literal('function').optional(),
  function: z.object({ name: z.string(), arguments: z.string() }),
});

const messageSchema = z.looseObject({
  role: z.enum(['system', 'developer', 'user', 'assistant', 'tool']),
  content: z.union([z.string(), z.array(contentPartSchema), z.null()]).optional(),
  name: z.string().optional(),
  tool_calls: z.array(messageToolCallSchema).optional(),
  tool_call_id: z.string().optional(),
});

const toolSchema = z.object({
  type: z.literal('function'),
  function: z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    parameters: z.record(z.string(), z.unknown()).optional(),
    strict: z.boolean().optional(),
  }),
});

const toolChoiceSchema = z.union([
  z.enum(['none', 'auto', 'required']),
  z.object({ type: z.literal('function'), function: z.object({ name: z.string() }) }),
]);

const responseFormatSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text') }),
  z.object({ type: z.literal('json_object') }),
  z.object({
    type: z.literal('json_schema'),
    json_schema: z.object({
      name: z.string().optional(),
      schema: z.record(z.string(), z.unknown()),
      strict: z.boolean().optional(),
    }),
  }),
]);

const MODES = ['thinking', 'fast', 'adaptive'] as const;

const chatRequestSchema = z.looseObject({
  model: z.string().optional(),
  messages: z.array(messageSchema).min(1),
  tools: z.array(toolSchema).optional(),
  tool_choice: toolChoiceSchema.optional(),
  response_format: responseFormatSchema.optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  max_tokens: z.number().int().positive().optional(),
  max_completion_tokens: z.number().int().positive().optional(),
  stop: z.union([z.string(), z.array(z.string()).max(4)]).optional(),
  stream: z.boolean().optional(),
  seed: z.number().int().optional(),
  /** Proxy extension. */
  mode: z.enum(MODES).optional(),
  /** OpenAI field, accepted as an alias: 'none' -> fast, anything else -> thinking. */
  reasoning_effort: z.string().optional(),
  /** Proxy extension: include the exact upstream Ollama payloads in `meetiq.upstream_requests`. */
  debug: z.boolean().optional(),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;
export type ChatMessage = z.infer<typeof messageSchema>;
export type Tool = z.infer<typeof toolSchema>;
export type ToolChoice = z.infer<typeof toolChoiceSchema>;
export type ResponseFormat = z.infer<typeof responseFormatSchema>;
export type RequestedMode = Mode;

/**
 * Contract check: every request the shared `ChatRequest` type allows must be
 * accepted by the validator. Fails to compile if the two drift apart.
 */
type Assert<T extends true> = T;
export type RequestContract = Assert<WireChatRequest extends z.input<typeof chatRequestSchema> ? true : false>;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * OpenAI SDKs and gateways (LiteLLM, LangChain) send `null` for optionals the
 * caller left unset — `{"stop": null, "max_tokens": null}`. `null` is not the
 * same as absent to zod, so those would 400 on fields the proxy does support.
 * Dropping them makes `.optional()` apply. Message `content` keeps its `null`,
 * which is meaningful there: an assistant turn that was only tool calls.
 */
function dropNullOptionals(body: unknown): unknown {
  if (!isPlainObject(body)) return body;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (value === null) continue;
    out[key] = key === 'messages' && Array.isArray(value) ? value.map(dropNullMessageFields) : value;
  }
  return out;
}

function dropNullMessageFields(message: unknown): unknown {
  if (!isPlainObject(message)) return message;
  return Object.fromEntries(Object.entries(message).filter(([k, v]) => v !== null || k === 'content'));
}

export function parseChatRequest(body: unknown): ChatRequest {
  const result = chatRequestSchema.safeParse(dropNullOptionals(body));
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`);
    throw invalidRequest(`Invalid request: ${issues.join('; ')}`, issues);
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

function messageText(content: ChatMessage['content']): string {
  if (content === undefined || content === null) return '';
  if (typeof content === 'string') return content;
  return content
    .map((part) => {
      if (part.type !== 'text' || typeof part.text !== 'string') {
        throw invalidRequest(`Unsupported content part type "${part.type}"; only text is supported`);
      }
      return part.text;
    })
    .join('\n');
}

/** OpenAI sends arguments as a JSON string; the template needs a map to iterate. */
function toArgumentMap(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * OpenAI transcript -> Ollama transcript.
 *  - `developer` becomes `system`.
 *  - assistant `tool_calls` are passed through structurally, so the model's
 *    own chat template renders them in whatever dialect it was trained on.
 *  - `tool` results pass through as `role:"tool"`; the template wraps and
 *    groups them. Runs are reordered to match their `tool_call_id`s.
 * Order is preserved so the model sees one consistent history.
 */
/**
 * OpenAI associates a tool result with its call by `tool_call_id`, and clients
 * may send results in any order. The chat template consumes a run of tool
 * messages positionally, so each run is reordered to match the calls it
 * answers. A result whose id matches nothing keeps its relative position.
 */
function orderToolResults(messages: ChatMessage[]): ChatMessage[] {
  const out = [...messages];
  for (let i = 0; i < out.length; i++) {
    const calls = out[i]?.role === 'assistant' ? out[i]?.tool_calls : undefined;
    if (!calls?.length) continue;
    let end = i + 1;
    while (end < out.length && out[end]?.role === 'tool') end++;
    const run = out.slice(i + 1, end);
    if (run.length > 1) {
      const rank = new Map(calls.map((c, index) => [c.id, index]));
      const ordered = run
        .map((m, index) => ({ m, index, rank: rank.get(m.tool_call_id) ?? Number.MAX_SAFE_INTEGER }))
        .sort((a, b) => a.rank - b.rank || a.index - b.index)
        .map((e) => e.m);
      out.splice(i + 1, run.length, ...ordered);
    }
    i = end - 1;
  }
  return out;
}

export function toOllamaMessages(messages: ChatMessage[]): OllamaMessage[] {
  return orderToolResults(messages).map((m): OllamaMessage => {
    const text = messageText(m.content);
    switch (m.role) {
      case 'system':
      case 'developer':
        return { role: 'system', content: text };
      case 'user':
        return { role: 'user', content: text };
      case 'tool':
        // The template wraps these in <tool_response> itself and groups a run
        // of them into one user turn — the shape the model was trained on.
        // Hand-rolling one user message each produced N separate turns.
        return { role: 'tool', content: text };
      case 'assistant': {
        if (!m.tool_calls?.length) return { role: 'assistant', content: text };
        return {
          role: 'assistant',
          content: text,
          tool_calls: m.tool_calls.map((c) => ({
            function: { name: c.function.name, arguments: toArgumentMap(c.function.arguments) },
          })),
        };
      }
    }
  });
}

export function lastUserText(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === 'user') return messageText(m.content);
  }
  return '';
}

export function estimatePromptTokens(req: ChatRequest): number {
  const messageTokens = req.messages.reduce((sum, m) => {
    const callText = m.tool_calls ? JSON.stringify(m.tool_calls) : '';
    return sum + estimateTokens(messageText(m.content) + callText);
  }, 0);
  return messageTokens + estimateJsonTokens(req.tools) + estimateJsonTokens(req.response_format);
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/**
 * Options that must be identical on every call (including the router's
 * classifier), otherwise Ollama reloads the model between requests.
 */
export function baseOptions(config: Config): OllamaOptions {
  return { num_ctx: config.NUM_CTX, ...(config.NUM_GPU >= 0 ? { num_gpu: config.NUM_GPU } : {}) };
}

export function requestOptions(req: ChatRequest, config: Config): OllamaOptions {
  const options: OllamaOptions = baseOptions(config);
  if (req.temperature !== undefined) options.temperature = req.temperature;
  if (req.top_p !== undefined) options.top_p = req.top_p;
  if (req.seed !== undefined) options.seed = req.seed;
  if (req.stop !== undefined) options.stop = Array.isArray(req.stop) ? req.stop : [req.stop];
  return options;
}

export function resolveMaxTokens(req: ChatRequest, config: Config): number {
  return req.max_tokens ?? req.max_completion_tokens ?? config.DEFAULT_MAX_TOKENS;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/** The result of one chat completion, before it is placed in a wire envelope. */
export interface CompletionFields {
  content: string | null;
  reasoning: string | null;
  toolCalls: ToolCall[];
  finishReason: FinishReason;
  usage: Usage;
  meta: ProxyMeta;
}

interface CompletionParts extends CompletionFields {
  id: string;
  created: number;
  model: string;
}

export function buildCompletion(p: CompletionParts): ChatCompletion {
  return {
    id: p.id,
    object: 'chat.completion' as const,
    created: p.created,
    model: p.model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant' as const,
          content: p.content,
          ...(p.reasoning ? { reasoning_content: p.reasoning } : {}),
          ...(p.toolCalls.length ? { tool_calls: p.toolCalls } : {}),
        },
        finish_reason: p.finishReason,
        logprobs: null,
      },
    ],
    usage: p.usage,
    meetiq: p.meta,
  };
}

export function buildChunk(p: {
  id: string;
  created: number;
  model: string;
  delta: ChunkDelta;
  finishReason?: FinishReason | null;
  usage?: Usage;
  meta?: ProxyMeta;
}): ChatChunk {
  return {
    id: p.id,
    object: 'chat.completion.chunk' as const,
    created: p.created,
    model: p.model,
    choices: [{ index: 0, delta: p.delta, finish_reason: p.finishReason ?? null, logprobs: null }],
    ...(p.usage ? { usage: p.usage } : {}),
    ...(p.meta ? { meetiq: p.meta } : {}),
  };
}
