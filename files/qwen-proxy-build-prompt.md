# Build `qwen-proxy`: minimal Express + TypeScript OpenAI-compatible wrapper over Ollama / Qwen3.5-4B

## Context
- Host: Debian 12 laptop, RTX 3050 4 GB, 16 GB RAM. Ollama serves `qwen3.5:4b` at http://127.0.0.1:11434 with OLLAMA_NUM_PARALLEL=2, OLLAMA_CONTEXT_LENGTH=8192, KV cache q8_0.
- Consumer: a Node/TypeScript backend on the LAN using the OpenAI SDK pointed at this proxy. Workloads: proposition extraction with JSON schema, contextual chunk headers, summaries, and later tool-using reasoning over project memory.
- Constraint: Ollama's chat template did not return structured `tool_calls` for this model in our tests. Qwen3.5 is trained on the Hermes-style format `<tool_call>{"name":..., "arguments":{...}}</tool_call>`, so the fallback parser must target exactly that format.
- Must stay OpenAI-compatible so the standard OpenAI SDK works unchanged. Extensions live in extra fields the SDK ignores.

## Stack (minimal)
Node 20+, TypeScript strict, Express 4, zod (request/env validation), ajv (JSON-schema validation of tool args and structured output), p-queue (concurrency), pino (JSON logs), vitest (tests), tsx (dev). No DB, no ORM, no auth framework. Single process. Under ten runtime dependencies.

## Endpoints
1. `POST /v1/chat/completions` — OpenAI-compatible. Supports `messages`, `tools`, `tool_choice`, `response_format` (`{type:'json_object'}` or `{type:'json_schema', json_schema:{schema}}`), `temperature`, `top_p`, `max_tokens`, `stop`, `stream`, `seed`. Extension: `mode: 'thinking' | 'fast' | 'adaptive'` (default env DEFAULT_MODE=adaptive). Also accept `reasoning_effort` as alias: `'none'` -> fast, anything else -> thinking.
2. `GET /v1/models` — returns the configured model id.
3. `GET /health` — Ollama reachable, model loaded (`/api/ps`), queue depth.
4. `POST /v1/route` — returns the adaptive router decision for a request body without generating. For debugging and evals.

## Upstream
Use Ollama's native `/api/chat`, not its `/v1` shim: native exposes `think`, `format` (JSON schema), `options.num_ctx/num_predict/temperature/seed/stop`, `keep_alive`, and returns `message.thinking` separately from `message.content`. Map OpenAI params to Ollama options. Model from env MODEL=qwen3.5:4b. Always send `options.num_ctx` from env NUM_CTX.

## Thinking modes
- `fast`: `think:false`. If `<think>...</think>` still appears in content, strip it.
- `thinking`: `think:true`. Return reasoning in `choices[0].message.reasoning_content`, never in `content`. Enforce a budget: env THINK_BUDGET_TOKENS (default 1024). Request with num_predict = budget + max_tokens. If the response ends inside the thinking block with no answer, make a second call that appends the truncated thinking as an assistant prefix plus a forced close (`</think>\n\nBased on the above, the final answer is:`) and generates with `think:false`. Set `meetiq.think_budget_hit=true` and log it.
- `adaptive`: decide per request, then run as fast or thinking. Rules in order, first match wins:
  1. Explicit `mode` or `reasoning_effort` from the caller.
  2. `response_format` present and no `tools` -> fast (extraction jobs).
  3. `tools` present -> thinking, unless env ADAPTIVE_TOOLS_THINK=false.
  4. Last user message contains a reasoning cue (case-insensitive): why, explain, compare, contradict, conflict, root cause, trade-off, prioriti, plan, should we, what changed, timeline, across meetings -> thinking.
  5. Last user message shorter than env ADAPTIVE_SHORT_TOKENS (default 60, estimate chars/4) with no cue -> fast.
  6. Otherwise one classifier call to the same model: `think:false`, temperature 0, num_predict 3, system prompt: "Decide whether answering the user's request needs multi-step reasoning. Reply with exactly one word: FAST or THINK." Only an exact THINK selects thinking. Timeout 3 s -> fast.
  Report the decision and the rule that fired in `meetiq.router = {mode, rule}` on the response and in the `x-meetiq-mode` header.

## Tool calling: native first, parser second, always validated
1. If `tools` present, pass them to Ollama natively. If the response has `message.tool_calls`, use them (`tool_parse:'native'`).
2. If not, inject the tools into the system prompt (prepend to the caller's system message, or create one) using exactly this block, and parse `<tool_call>...</tool_call>` from `content`:
   ```
   # Tools
   You may call one or more functions to assist with the user query.
   You are provided with function signatures within <tools></tools> XML tags:
   <tools>
   {one JSON object per line: {"type":"function","function":{"name","description","parameters"}}}
   </tools>
   For each function call, return a json object with function name and arguments within <tool_call></tool_call> XML tags:
   <tool_call>
   {"name": <function-name>, "arguments": <args-json-object>}
   </tool_call>
   ```
   Parser: multiline regex, multiple blocks, ignore anything inside a `<think>` block, tolerate prose before and after, tolerate a missing closing tag at end of output, attempt one lenient JSON repair (single quotes, trailing commas). Text before the first block becomes `content`, otherwise `content:null`. (`tool_parse:'fallback'`)
3. Validate `arguments` with ajv against the tool's `parameters`. On failure retry once with an appended user message: "Your previous tool call was invalid: <ajv errors>. Emit a corrected <tool_call>." If still invalid return 502 `tool_call_invalid` with the raw text. Never return a silently wrong call.
4. `tool_choice`: `'none'` -> strip tools, never parse. `'auto'` -> above. `'required'` or `{type:'function', function:{name}}` -> force with Ollama `format` set to a JSON schema `{name: const, arguments: <that tool's parameters>}` (a oneOf across tools for `'required'`), `think:false`, then wrap as a tool call. Constrained decoding makes this path unbreakable. (`tool_parse:'forced'`)
5. Output shape: `message.tool_calls=[{id:'call_<id>', type:'function', function:{name, arguments:<JSON string>}}]`, `finish_reason:'tool_calls'`.
6. Incoming `role:'tool'` messages: convert each to a user message `<tool_response>\n{content}\n</tool_response>`. Re-render a preceding assistant message that has `tool_calls` as `<tool_call>` text so the model sees a consistent transcript. Preserve order.
7. Always set `meetiq.tool_parse: 'native' | 'fallback' | 'forced' | 'none'`.

## Structured output
`response_format.json_schema.schema` -> Ollama `format`. `json_object` -> `format:'json'`. Validate the returned content with ajv; retry once with errors appended; then 502 `structured_output_invalid`. Structured requests default to fast via router rule 2. Do not special-case any MeetIQ schema; the backend verifies evidence spans itself.

## Streaming
`stream:true` -> SSE in OpenAI chunk format, ending with `data: [DONE]`. Thinking tokens stream as `delta.reasoning_content`, answer tokens as `delta.content`. When `tools` are present, buffer the full upstream response, run the parser, then emit one content/tool_calls chunk plus a finish chunk. Document this limitation in the README.

## Concurrency and limits
p-queue with concurrency env MAX_PARALLEL (default 2, must equal OLLAMA_NUM_PARALLEL). Queue wait over env QUEUE_TIMEOUT_MS (default 120000) -> 503 with Retry-After. Upstream timeout env UPSTREAM_TIMEOUT_MS (default 600000). Body limit 2 MB. Reject prompts estimated over env MAX_PROMPT_TOKENS (default 7000, chars/4) with 400 `context_length_exceeded` so callers chunk instead of getting silent truncation.

## Config (env with defaults, zod-validated)
PORT=8000, OLLAMA_BASE_URL=http://127.0.0.1:11434, MODEL=qwen3.5:4b, NUM_CTX=8192, DEFAULT_MODE=adaptive, THINK_BUDGET_TOKENS=1024, MAX_PARALLEL=2, ADAPTIVE_SHORT_TOKENS=60, ADAPTIVE_TOOLS_THINK=true, QUEUE_TIMEOUT_MS, UPSTREAM_TIMEOUT_MS, MAX_PROMPT_TOKENS, API_KEY (optional; when set require `Authorization: Bearer`), LOG_LEVEL=info.

## Observability
One pino JSON line per request: request id, mode requested and used, router rule, tool_parse path, retries, prompt/completion/thinking token counts from Ollama's `prompt_eval_count` and `eval_count`, upstream latency, queue wait, status. Echo `x-request-id`.

## Errors
OpenAI envelope `{error:{message,type,code}}`. Ollama unreachable -> 503 `upstream_unavailable`. Ollama 4xx -> 502 with upstream message. Validation -> 400 `invalid_request_error`.

## Layout
```
qwen-proxy/
  src/
    index.ts              # express bootstrap
    config.ts             # zod env
    routes/chat.ts  routes/models.ts  routes/health.ts  routes/route.ts
    core/ollama.ts        # native /api/chat client, stream + non-stream
    core/mapping.ts       # OpenAI <-> Ollama request/response mapping
    core/router.ts        # adaptive decision
    core/thinking.ts      # think handling, budget, strip
    core/tools.ts         # injection, parser, repair, validation, forced mode
    core/structured.ts    # response_format + validation
    core/stream.ts        # SSE writer
    core/queue.ts
    util/tokens.ts  util/ids.ts  util/logger.ts
  test/
    tools.parse.test.ts  router.test.ts  mapping.test.ts  chat.e2e.test.ts (mocked Ollama)
  .env.example  README.md  package.json  tsconfig.json
```

## Tests that must pass (vitest, mocked Ollama)
Parser: single call; two calls; prose before and after; missing closing tag at EOF; `<tool_call>` inside `<think>` ignored; invalid JSON repaired once; schema failure triggers one retry then 502. Router: one case per rule 1 to 6. Mapping: tool role -> tool_response, assistant tool_calls re-rendered. Thinking: budget-hit path yields an answer with `think_budget_hit=true`. Streaming: chunk sequence ends with [DONE].

## README must include
`npm run dev`, `npm run build && npm start`, a systemd unit example, and curl examples for: fast extraction with json_schema; a thinking question; an adaptive "why" question showing the `x-meetiq-mode` header; a tool-call round trip including sending the `tool` result back; a streaming request. Plus the note: bind Ollama to 127.0.0.1 and expose only this proxy on the LAN.

## Non-goals
No embeddings, no per-request model switching, no persistence, no multi-tenant auth, no MeetIQ prompt templates (the backend owns those).

## Deliverable
Working repo, `npm test` green, `npm run dev` serving on :8000, README as above.
