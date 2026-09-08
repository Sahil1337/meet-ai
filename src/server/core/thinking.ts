import type { Config } from '../config.js';
import type {
  OllamaChatChunk,
  OllamaChatRequest,
  OllamaClient,
  OllamaFormat,
  OllamaMessage,
  OllamaOptions,
  OllamaToolCall,
} from './ollama.js';

const OPEN = '<think>';
const CLOSE = '</think>';

/** Length of the longest prefix of `tag` that `text` ends with (0 if none). */
function partialTagSuffix(text: string, tag: string): number {
  for (let k = Math.min(tag.length - 1, text.length); k > 0; k--) {
    if (text.endsWith(tag.slice(0, k))) return k;
  }
  return 0;
}

/**
 * Incremental splitter that routes `<think>...</think>` spans to `thinking`
 * and everything else to `content`. Safe to feed one token at a time: a tag
 * split across chunks is held back until it resolves.
 */
export class ThinkSplitter {
  private buffer = '';
  private inside = false;

  push(chunk: string): { content: string; thinking: string } {
    this.buffer += chunk;
    let content = '';
    let thinking = '';
    for (;;) {
      const tag = this.inside ? CLOSE : OPEN;
      const at = this.buffer.indexOf(tag);
      if (at >= 0) {
        const before = this.buffer.slice(0, at);
        if (this.inside) thinking += before;
        else content += before;
        this.buffer = this.buffer.slice(at + tag.length);
        this.inside = !this.inside;
        continue;
      }
      const hold = partialTagSuffix(this.buffer, tag);
      const emit = this.buffer.slice(0, this.buffer.length - hold);
      this.buffer = this.buffer.slice(this.buffer.length - hold);
      if (this.inside) thinking += emit;
      else content += emit;
      return { content, thinking };
    }
  }

  flush(): { content: string; thinking: string } {
    const rest = this.buffer;
    this.buffer = '';
    return this.inside ? { content: '', thinking: rest } : { content: rest, thinking: '' };
  }
}

export function splitThink(text: string): { content: string; thinking: string } {
  const splitter = new ThinkSplitter();
  const a = splitter.push(text);
  const b = splitter.flush();
  return { content: a.content + b.content, thinking: a.thinking + b.thinking };
}

export const stripThink = (text: string): string => splitThink(text).content;

// ---------------------------------------------------------------------------
// One model turn with thinking handling
// ---------------------------------------------------------------------------

export type Mode = 'fast' | 'thinking';

export interface TurnInput {
  messages: OllamaMessage[];
  mode: Mode;
  maxTokens: number;
  options: OllamaOptions;
  tools?: unknown[];
  format?: OllamaFormat;
}

export interface Delta {
  content?: string;
  reasoning?: string;
}

export interface UpstreamTiming {
  /** Model (re)load time, ms. Non-zero means Ollama reloaded the model for this call. */
  loadMs: number;
  promptEvalMs: number;
  evalMs: number;
}

export interface TurnResult {
  content: string;
  thinking: string;
  nativeToolCalls: OllamaToolCall[];
  doneReason: string | undefined;
  promptTokens: number;
  completionTokens: number;
  upstreamCalls: number;
  upstreamMs: number;
  timing: UpstreamTiming;
  /** Exact payloads sent to Ollama, in order. */
  requests: OllamaChatRequest[];
}

/** The exact Ollama payload for a turn. Reasoning and answer share `maxTokens`. */
export function turnRequest(config: Config, input: TurnInput, stream: boolean): OllamaChatRequest {
  return {
    model: config.MODEL,
    messages: input.messages,
    stream,
    think: input.mode === 'thinking',
    options: { ...input.options, num_predict: input.maxTokens },
    ...(input.tools ? { tools: input.tools } : {}),
    ...(input.format ? { format: input.format } : {}),
  };
}

/**
 * Runs one turn in `fast` (think:false) or `thinking` (think:true) mode.
 * In thinking mode reasoning and answer share `maxTokens`, so a long think
 * leaves less room for the answer and can end the turn on `length`.
 */
export async function runTurn(
  client: OllamaClient,
  config: Config,
  input: TurnInput,
  signal?: AbortSignal,
  onDelta?: (delta: Delta) => void,
): Promise<TurnResult> {
  const req = turnRequest(config, input, Boolean(onDelta));
  const started = Date.now();
  const splitter = new ThinkSplitter();
  const result: TurnResult = {
    content: '',
    thinking: '',
    nativeToolCalls: [],
    doneReason: undefined,
    promptTokens: 0,
    completionTokens: 0,
    upstreamCalls: 1,
    upstreamMs: 0,
    timing: { loadMs: 0, promptEvalMs: 0, evalMs: 0 },
    requests: [req],
  };
  const ms = (ns: number | undefined) => Math.round((ns ?? 0) / 1e6);

  const absorb = (chunk: OllamaChatChunk) => {
    const delta: Delta = {};
    if (chunk.message.thinking) {
      result.thinking += chunk.message.thinking;
      delta.reasoning = chunk.message.thinking;
    }
    if (chunk.message.content) {
      const split = splitter.push(chunk.message.content);
      result.content += split.content;
      result.thinking += split.thinking;
      if (split.content) delta.content = split.content;
      if (split.thinking) delta.reasoning = (delta.reasoning ?? '') + split.thinking;
    }
    if (chunk.message.tool_calls?.length) result.nativeToolCalls.push(...chunk.message.tool_calls);
    if (chunk.done) {
      result.doneReason = chunk.done_reason;
      result.promptTokens += chunk.prompt_eval_count ?? 0;
      result.completionTokens += chunk.eval_count ?? 0;
      result.timing = {
        loadMs: ms(chunk.load_duration),
        promptEvalMs: ms(chunk.prompt_eval_duration),
        evalMs: ms(chunk.eval_duration),
      };
    }
    if (onDelta && (delta.content || delta.reasoning)) onDelta(delta);
  };

  if (onDelta) {
    for await (const chunk of client.chatStream(req, signal)) absorb(chunk);
  } else {
    absorb(await client.chat(req, signal));
  }

  const tail = splitter.flush();
  result.content += tail.content;
  result.thinking += tail.thinking;
  if (onDelta && tail.content) onDelta({ content: tail.content });
  if (onDelta && tail.thinking) onDelta({ reasoning: tail.thinking });
  result.upstreamMs = Date.now() - started;
  return result;
}
