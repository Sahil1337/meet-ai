import type { Ajv } from 'ajv';
import { invalidRequest } from './errors.js';
import type { Tool, ToolChoice } from './mapping.js';
import type { ToolCall } from '../../shared/types.js';
import type { OllamaToolCall } from './ollama.js';
import { partialTagSuffix, splitThink } from './thinking.js';
import { newToolCallId } from '../util/ids.js';
import { isRecord, errorMessage, parseJsonLenient } from '../util/json.js';

// ---------------------------------------------------------------------------
// Schema slimming: what the model reads vs. what we validate against
// ---------------------------------------------------------------------------

/** Keywords that constrain validation but give the model nothing useful to read. */
const PROMPT_NOISE_KEYS = new Set([
  'additionalProperties',
  'unevaluatedProperties',
  'strict',
  '$schema',
  '$id',
  '$comment',
  'title',
  'examples',
]);
/** Keywords whose values are maps of name -> schema (the map keys must be preserved verbatim). */
const SCHEMA_MAP_KEYS = new Set(['properties', 'patternProperties', '$defs', 'definitions']);

/**
 * Returns a copy of a JSON schema with keywords the model does not need
 * removed at every level. Tool definitions are rendered into the prompt, so
 * every keyword costs context tokens on every request; validation still
 * uses the full schema.
 */
function slimSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(slimSchema);
  if (!isRecord(schema)) return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (PROMPT_NOISE_KEYS.has(key)) continue;
    if (SCHEMA_MAP_KEYS.has(key) && isRecord(value)) {
      out[key] = Object.fromEntries(Object.entries(value).map(([name, sub]) => [name, slimSchema(sub)]));
    } else {
      out[key] = slimSchema(value);
    }
  }
  return out;
}

export function slimTools(tools: Tool[]): Tool[] {
  return tools.map((t) => ({
    ...t,
    function: {
      name: t.function.name,
      ...(t.function.description ? { description: t.function.description } : {}),
      ...(t.function.parameters ? { parameters: slimSchema(t.function.parameters) as Record<string, unknown> } : {}),
    },
  }));
}

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

const TOOL_CALL_OPEN = '<tool_call>';

/**
 * Keeps `<tool_call>` text out of a content stream. Ollama normally returns
 * tool calls structurally, but when it does not the tags arrive as ordinary
 * content and the caller would see them as prose beside the parsed call.
 * Content fed through this has any partial opening tag held back, and stops
 * entirely once a real one appears; the tail is parsed as usual.
 */
export class ToolCallGate {
  private buffer = '';
  private stopped = false;

  /** The part of `chunk` that is safe to emit now. */
  push(chunk: string): string {
    if (this.stopped) return '';
    this.buffer += chunk;
    const at = this.buffer.indexOf(TOOL_CALL_OPEN);
    if (at >= 0) {
      this.stopped = true;
      const before = this.buffer.slice(0, at);
      this.buffer = '';
      return before;
    }
    const hold = partialTagSuffix(this.buffer, TOOL_CALL_OPEN);
    const emit = this.buffer.slice(0, this.buffer.length - hold);
    this.buffer = this.buffer.slice(this.buffer.length - hold);
    return emit;
  }

  /** Held-back text, once the turn is known to contain no tool call. */
  flush(): string {
    const rest = this.stopped ? '' : this.buffer;
    this.buffer = '';
    return rest;
  }
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export interface ParsedToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ParseResult {
  /** Text before the first tool call, or null when the output starts with one. */
  content: string | null;
  calls: ParsedToolCall[];
  /** Blocks that were found but could not be turned into a call. */
  errors: string[];
}

const BLOCK_RE = /<tool_call>\s*([\s\S]*?)\s*(?:<\/tool_call>|$)/g;
const FUNCTION_RE = /^<function=([^>\s]+)>/;
const PARAMETER_RE = /<parameter=([^>\s]+)>\n?([\s\S]*?)\n?(?:<\/parameter>|$)/g;

/**
 * Extracts `<tool_call>` blocks from model output. Only reached when the
 * backend returned no structured tool calls of its own. Tolerates prose
 * around the blocks, several blocks, a missing closing tag at end of output,
 * and both block dialects:
 *
 *   Qwen XML   <function=name><parameter=key>value</parameter></function>
 *   Hermes     {"name": "...", "arguments": {...}}
 *
 * `tools` is used to type XML parameters, which arrive as untyped text.
 * Anything inside `<think>` is ignored.
 */
export function parseToolCalls(text: string, tools?: Tool[]): ParseResult {
  const visible = splitThink(text).content;
  const result: ParseResult = { content: null, calls: [], errors: [] };
  const first = visible.indexOf('<tool_call>');
  if (first === -1) {
    result.content = visible.trim() || null;
    return result;
  }
  result.content = visible.slice(0, first).trim() || null;

  for (const match of visible.slice(first).matchAll(BLOCK_RE)) {
    const raw = (match[1] ?? '').trim();
    if (!raw) continue;
    try {
      result.calls.push(FUNCTION_RE.test(raw) ? parseXmlCall(raw, tools) : toParsedCall(parseJsonLenient(raw)));
    } catch (err) {
      result.errors.push(`${errorMessage(err)} in: ${raw}`);
    }
  }
  return result;
}

/** `properties` of the named tool, used to type XML parameter text. */
function parameterSchemas(tools: Tool[] | undefined, name: string): Record<string, unknown> {
  const params = tools?.find((t) => t.function.name === name)?.function.parameters;
  const properties = isRecord(params) ? params['properties'] : undefined;
  return isRecord(properties) ? properties : {};
}

/**
 * XML parameters carry no types: the chat template writes objects and arrays
 * as JSON and everything else as bare text. The declared schema decides how
 * to read each one back; without one, JSON wins if it parses.
 */
function coerceParameter(text: string, schema: unknown): unknown {
  const declared = isRecord(schema) ? schema['type'] : undefined;
  const type = Array.isArray(declared) ? declared.find((t) => t !== 'null') : declared;
  switch (type) {
    case 'string':
      return text;
    case 'number':
    case 'integer': {
      const n = Number(text);
      return text.trim() !== '' && Number.isFinite(n) ? n : text;
    }
    case 'boolean':
      return text === 'true' ? true : text === 'false' ? false : text;
    case 'object':
    case 'array':
      try {
        return parseJsonLenient(text);
      } catch {
        return text;
      }
    default:
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
  }
}

function parseXmlCall(raw: string, tools: Tool[] | undefined): ParsedToolCall {
  const name = FUNCTION_RE.exec(raw)?.[1];
  if (!name) throw new Error('tool call must open with <function=name>');
  const schemas = parameterSchemas(tools, name);
  const args: Record<string, unknown> = {};
  for (const match of raw.matchAll(PARAMETER_RE)) {
    const key = match[1];
    if (!key) continue;
    args[key] = coerceParameter((match[2] ?? '').trim(), schemas[key]);
  }
  return { name, arguments: args };
}

function toParsedCall(value: unknown): ParsedToolCall {
  if (!isRecord(value) || typeof value['name'] !== 'string') {
    throw new Error('tool call must be an object with a string "name"');
  }
  const args = value['arguments'] ?? value['parameters'] ?? {};
  if (!isRecord(args)) throw new Error('"arguments" must be a JSON object');
  return { name: value['name'], arguments: args };
}

export function fromNativeToolCalls(native: OllamaToolCall[]): ParseResult {
  const result: ParseResult = { content: null, calls: [], errors: [] };
  for (const call of native) {
    try {
      const args =
        typeof call.function.arguments === 'string'
          ? parseJsonLenient(call.function.arguments)
          : call.function.arguments;
      result.calls.push(toParsedCall({ name: call.function.name, arguments: args }));
    } catch (err) {
      result.errors.push(`${errorMessage(err)} in native call ${call.function.name}`);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const EMPTY_OBJECT_SCHEMA = { type: 'object' };

export function validateToolCalls(calls: ParsedToolCall[], tools: Tool[], ajv: Ajv): string[] {
  const errors: string[] = [];
  for (const call of calls) {
    const tool = tools.find((t) => t.function.name === call.name);
    if (!tool) {
      errors.push(`unknown tool "${call.name}"; available: ${tools.map((t) => t.function.name).join(', ')}`);
      continue;
    }
    const validate = ajv.compile(tool.function.parameters ?? EMPTY_OBJECT_SCHEMA);
    if (!validate(call.arguments)) errors.push(`${call.name}: ${ajv.errorsText(validate.errors)}`);
  }
  return errors;
}

export function toOpenAIToolCalls(calls: ParsedToolCall[]): ToolCall[] {
  return calls.map((c) => ({
    id: newToolCallId(),
    type: 'function',
    function: { name: c.name, arguments: JSON.stringify(c.arguments) },
  }));
}

// ---------------------------------------------------------------------------
// Forced mode (constrained decoding)
// ---------------------------------------------------------------------------

export const isForcedChoice = (choice: ToolChoice | undefined): boolean =>
  choice === 'required' || (typeof choice === 'object' && choice.type === 'function');

function schemaForTool(tool: Tool): Record<string, unknown> {
  return {
    type: 'object',
    properties: { name: { const: tool.function.name }, arguments: tool.function.parameters ?? EMPTY_OBJECT_SCHEMA },
    required: ['name', 'arguments'],
    additionalProperties: false,
  };
}

/** JSON schema handed to Ollama's `format` so the model can only emit a valid call. */
export function forcedToolFormat(tools: Tool[], choice: ToolChoice): Record<string, unknown> {
  if (typeof choice === 'object') {
    const tool = tools.find((t) => t.function.name === choice.function.name);
    if (!tool) throw invalidRequest(`tool_choice names unknown tool "${choice.function.name}"`);
    return schemaForTool(tool);
  }
  const first = tools[0];
  if (tools.length === 1 && first) return schemaForTool(first);
  return { oneOf: tools.map(schemaForTool) };
}

/**
 * Grammar for a turn that may either call a tool or answer with the caller's
 * schema. Ollama constrains decoding to one branch of the union, so the model
 * chooses between calling and answering and cannot produce anything else.
 */
export function unionFormat(tools: Tool[], responseSchema: Record<string, unknown>): Record<string, unknown> {
  return { oneOf: [...tools.map(schemaForTool), responseSchema] };
}

/**
 * Reads a union turn, which is bare JSON in either branch. A tool call is an
 * object whose `name` is one of the declared tools and whose `arguments` is an
 * object; anything else is the caller's response shape and is handed back as
 * content so the structured-output path validates it.
 */
export function parseUnionOutput(content: string, tools: Tool[]): ParseResult {
  const asResponse: ParseResult = { content: content.trim() || null, calls: [], errors: [] };
  let value: unknown;
  try {
    value = parseJsonLenient(content);
  } catch {
    return asResponse;
  }
  if (!isRecord(value)) return asResponse;
  const name = value['name'];
  const args = value['arguments'];
  if (typeof name !== 'string' || !tools.some((t) => t.function.name === name) || !isRecord(args)) return asResponse;
  return { content: null, calls: [{ name, arguments: args }], errors: [] };
}

export function parseForcedOutput(content: string): ParseResult {
  try {
    return { content: null, calls: [toParsedCall(parseJsonLenient(content))], errors: [] };
  } catch (err) {
    return { content: null, calls: [], errors: [`${errorMessage(err)} in: ${content}`] };
  }
}
