import { Writable } from 'node:stream';
import pino, { type Logger } from 'pino';

export type { Logger };
export type LogFormat = 'pretty' | 'json' | 'auto';

/**
 * `json`: one pino JSON line per event (production, log shippers).
 * `pretty`: coloured, human-readable lines with multi-line blocks for the
 * model's prompt, reasoning, tool calls and answer.
 * `auto`: pretty on a terminal, json otherwise.
 */
export function createLogger(level: string, format: LogFormat = 'auto'): Logger {
  const pretty = format === 'pretty' || (format === 'auto' && Boolean(process.stdout.isTTY));
  const base = { service: 'qwen-proxy' };
  return pretty ? pino({ level, base }, prettyDestination()) : pino({ level, base });
}

// ---------------------------------------------------------------------------
// Pretty formatter (no dependency; ~1 screen of code)
// ---------------------------------------------------------------------------

const useColor = !process.env['NO_COLOR'];
const paint = (code: string, text: string) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);
const dim = (t: string) => paint('2', t);
const bold = (t: string) => paint('1', t);
const gray = (t: string) => paint('90', t);
// Bright variants read well on both dark and light terminals.
const blue = (t: string) => paint('94', t);
const green = (t: string) => paint('92', t);
const yellow = (t: string) => paint('93', t);
const red = (t: string) => paint('91', t);
const magenta = (t: string) => paint('95', t);
const cyan = (t: string) => paint('96', t);
const orange = (t: string) => paint('38;5;214', t);
const white = (t: string) => paint('97', t);

const LEVELS: Record<number, string> = {
  10: gray('TRACE'),
  20: blue('DEBUG'),
  30: green('INFO '),
  40: yellow('WARN '),
  50: red('ERROR'),
  60: red(bold('FATAL')),
};

/** Fields rendered as indented blocks below the line instead of key=value. */
const BLOCKS: Array<[key: string, title: string, colour: (t: string) => string]> = [
  ['prompt', 'prompt', cyan],
  ['reasoning', 'reasoning', magenta],
  ['tool_calls', 'tool calls', yellow],
  ['content', 'answer', green],
  ['err', 'error', red],
];
const HIDDEN = new Set(['level', 'time', 'msg', 'pid', 'hostname', 'service', 'ollama']);

function clock(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

function block(title: string, colour: (t: string) => string, body: string): string {
  const lines = body.split('\n');
  return [`  ${colour('┌')} ${colour(bold(title))}`, ...lines.map((l) => `  ${colour('│')} ${l}`)].join('\n');
}

function renderBlock(key: string, value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (key === 'tool_calls') {
    const calls = value as Array<{ function: { name: string; arguments: string } }>;
    return calls.length ? calls.map((c) => `${c.function.name}(${c.function.arguments})`).join('\n') : undefined;
  }
  if (key === 'err') {
    const e = value as { type?: string; message?: string; stack?: string };
    return [e.message ?? String(value), ...(e.stack ? [dim(e.stack)] : [])].join('\n');
  }
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

const secs = (ms: unknown) => `${(Number(ms ?? 0) / 1000).toFixed(1)}s`;
const str = (v: unknown) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : JSON.stringify(v));

const oneLine = (v: unknown, max: number) => {
  const text = str(v).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
};
const rid = (rec: Record<string, unknown>) => gray(`[${str(rec['request_id'])}]`);
const field = (label: string, value: string) => `${gray(label + ':')} ${value}`;
const fields = (...pairs: Array<[label: string, value: string | undefined]>) =>
  `  ${pairs
    .filter((p): p is [string, string] => Boolean(p[1]))
    .map(([l, v]) => field(l, v))
    .join(gray('  ·  '))}`;

/** Request received [id] / Mode · Tools · Stream / Prompt */
function renderRequest(rec: Record<string, unknown>): string {
  const tools = Number(rec['tool_count'] ?? 0);
  const lines = [
    `${cyan(bold('Request received'))} ${rid(rec)}`,
    fields(
      ['Mode', magenta(String(rec['mode_requested'] ?? 'adaptive'))],
      ['Tools', tools > 0 ? String(tools) : undefined],
      ['Format', rec['response_format'] ? str(rec['response_format']) : undefined],
      ['Stream', rec['stream'] ? 'yes' : undefined],
      ['Size', `~${str(rec['prompt_estimate'])} tokens`],
    ),
  ];
  if (rec['prompt']) lines.push(`  ${field('Prompt', white(oneLine(rec['prompt'], 200)))}`);
  return lines.join('\n');
}

/** Tool call [id] lines, then Completed [id] / Mode used · Tokens · Speed · Time · flags / Answer */
function renderCompletion(rec: Record<string, unknown>): string[] {
  const entries: string[] = [];
  const calls = (rec['tool_calls'] as Array<{ function: { name: string; arguments: string } }> | undefined) ?? [];
  for (const call of calls) {
    entries.push(
      [
        `${orange(bold('Tool call'))} ${rid(rec)}`,
        `  ${field('Name', orange(call.function.name))}${gray('  ·  ')}${field('Arguments', oneLine(call.function.arguments, 160))}`,
      ].join('\n'),
    );
  }
  const lines: string[] = [];
  const thinking = Number(rec['thinking_tokens'] ?? 0);
  const flags = [
    rec['finish_reason'] === 'length' ? 'cut off at max_tokens' : '',
    rec['think_budget_hit'] ? 'thinking budget hit' : '',
    Number(rec['retries'] ?? 0) > 0 ? `${str(rec['retries'])} validation retry` : '',
    Number(rec['queue_wait_ms'] ?? 0) > 1000 ? `waited ${secs(rec['queue_wait_ms'])} in queue` : '',
  ].filter(Boolean);
  lines.push(
    `${green(bold('Completed'))} ${rid(rec)}`,
    fields(
      [
        'Mode used',
        `${magenta(str(rec['mode_used']))} ${gray(`(rule: ${str(rec['router_rule'])}${rec['router_detail'] ? ` ${str(rec['router_detail'])}` : ''})`)}`,
      ],
      ['Tools', rec['tool_parse'] && rec['tool_parse'] !== 'none' ? str(rec['tool_parse']) : undefined],
      ['Tokens', `${str(rec['completion_tokens'])}${thinking > 0 ? ` (${thinking} thinking)` : ''}`],
      ['Speed', bold(white(`${str(rec['eval_tps'])} tok/s`))],
      ['Time', secs(rec['total_ms'])],
    ),
  );
  if (flags.length) lines.push(`  ${field('Note', yellow(flags.join(', ')))}`);
  if (rec['answer']) lines.push(`  ${field('Answer', white(oneLine(rec['answer'], 240)))}`);
  entries.push(lines.join('\n'));
  return entries;
}

/** Failed [id] / Status · Time / Error */
function renderFailure(rec: Record<string, unknown>): string {
  return [
    `${red(bold('Failed'))} ${rid(rec)}`,
    fields(['Status', red(`${str(rec['status'])} ${str(rec['code'])}`)], ['Time', secs(rec['total_ms'])]),
    `  ${field('Error', red(oneLine(rec['message'], 240)))}`,
  ].join('\n');
}

/** Each renderer returns one or more entries; every entry gets its own timestamp. */
const EVENT_RENDERERS: Record<string, (rec: Record<string, unknown>) => string | string[]> = {
  'chat.request': renderRequest,
  'chat.completion': renderCompletion,
  'chat.completion failed': renderFailure,
};

export function formatPretty(line: string): string {
  let rec: Record<string, unknown>;
  try {
    rec = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return line;
  }
  const stamp = gray(clock(Number(rec['time'])));
  const msg = String(rec['msg'] ?? '');

  // Forwarded Ollama output: keep it on one dim line.
  if (typeof rec['ollama'] === 'string') return `${stamp} ${gray(rec['ollama'])}`;

  const render = EVENT_RENDERERS[msg];
  if (render) {
    const entries = render(rec);
    return (Array.isArray(entries) ? entries : [entries]).map((e) => `${stamp} ${e}`).join('\n');
  }

  const level = LEVELS[Number(rec['level'])] ?? String(rec['level']);
  const head = `${stamp} ${level} ${bold(msg)}`;
  const blockKeys = new Set(BLOCKS.map(([k]) => k));
  const fields = Object.entries(rec)
    .filter(([k]) => !HIDDEN.has(k) && !blockKeys.has(k))
    .map(([k, v]) => `${dim(k + '=')}${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' ');
  const blocks = BLOCKS.map(([key, title, colour]) => {
    const body = renderBlock(key, rec[key]);
    return body === undefined ? undefined : block(title, colour, body);
  }).filter((b): b is string => b !== undefined);
  return [fields ? `${head} ${fields}` : head, ...blocks].join('\n');
}

function prettyDestination(): Writable {
  return new Writable({
    write(chunk: Buffer, _encoding, callback) {
      for (const line of chunk.toString().split('\n')) {
        if (line.trim()) process.stdout.write(formatPretty(line) + '\n');
      }
      callback();
    },
  });
}
