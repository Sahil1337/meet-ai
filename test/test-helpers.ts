/**
 * Helpers for test.ts: terminal rendering, automated checks, the manual
 * verdict loop and the summary table. Nothing prompt-related lives here.
 */

import { createInterface } from "node:readline/promises";
import { QwenProxyClient, QwenProxyError } from "../src/client.ts";
import { extractPropositions } from "../src/extraction-agent.ts";
import type { ChatCompletion } from "../src/shared/types.ts";
import type { EvalConfig, Fixture, Outcome, Proposition } from "./types.ts";

const tty = process.stdout.isTTY ?? false;
const style = (code: string) => (s: string) =>
  tty ? `\x1b[${code}m${s}\x1b[0m` : s;
export const bold = style("1");
export const dim = style("2");
export const green = style("32");
export const red = style("31");
export const yellow = style("33");

export function wrap(text: string, indent = "    ", width = 100): string {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      if (line && (indent + line + " " + word).length > width) {
        out.push(indent + line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    out.push(indent + line);
  }
  return out.join("\n");
}

export function json(value: unknown, indent = "    "): string {
  return JSON.stringify(value, null, 2)
    .split("\n")
    .map((l) => indent + l)
    .join("\n");
}

// Checks

const normalize = (s: string) =>
  s
    .replace(/^["'“”‘’\s]+|["'“”‘’\s.]+$/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();

/** True when the evidence appears in the transcript, ignoring quotes, case and whitespace. */
export function isVerbatim(evidence: string, transcript: string): boolean {
  return normalize(transcript).includes(normalize(evidence));
}

/** Speaker names from `Speaker [time date]: text` lines. */
export function speakersOf(transcript: string): string[] {
  return [
    ...new Set(
      transcript
        .split("\n")
        .map((l) => l.split(" [")[0]!.trim())
        .filter(Boolean),
    ),
  ];
}

// Raw response, exactly as the proxy returned it

function printRaw(completion: ChatCompletion, parsed: unknown): void {
  const { meetiq, ...rest } = completion;
  const { upstream_requests, ...meetiqRest } = meetiq;
  console.log(
    `\n${bold("  RAW RESPONSE")}  ${dim("the ChatCompletion object as received; message.content is a JSON string")}`,
  );
  console.log(json({ ...rest, meetiq: meetiqRest }));
  if (upstream_requests) {
    console.log(
      `\n${bold("  UPSTREAM REQUEST(S)")}  ${dim("exact payload(s) the proxy sent to Ollama /api/chat")}`,
    );
    console.log(json(upstream_requests));
  }
  const reasoning = completion.choices[0]?.message.reasoning_content;
  if (reasoning) {
    console.log(
      `\n${bold("  THINKING")}  ${dim(`message.reasoning_content, ${reasoning.length} chars, ${completion.usage.completion_tokens_details.reasoning_tokens} tokens`)}`,
    );
    console.log(dim(wrap(reasoning, "    ")));
  }
  console.log(
    `\n${bold("  CONTENT PARSED")}  ${dim("JSON.parse(message.content)")}`,
  );
  console.log(json(parsed));
}

function describeError(err: unknown): string {
  let error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  if (err instanceof QwenProxyError) {
    error = `${err.code} (HTTP ${err.status}): ${err.message}`;
    if (err.status === 524)
      error += " — Cloudflare edge gave up after 100 s; the proxy did not answer in time.";
    if (err.status === 530)
      error += " — Cloudflare cannot reach the Nitro; cloudflared or the laptop is down.";
  }
  return error;
}

function failOutcome(
  fixture: Fixture,
  warnings: string[],
  error: string,
  ms: number,
  width: number,
): Outcome {
  console.log(`\n${red("  ERROR")}\n${wrap(error, "    ", width)}`);
  return {
    name: fixture.name,
    status: "fail",
    count: 0,
    verbatim: 0,
    warnings,
    error,
    ms,
    verdict: "-",
  };
}

/** Prints the propositions + CHECKS block and builds the final Outcome. */
function finishOutcome(
  cfg: EvalConfig,
  fixture: Fixture,
  propositions: Proposition[],
  warnings: string[],
  meta: string,
  ms: number,
): Outcome {
  const width = cfg.wrapWidth ?? 100;
  console.log(
    `\n${bold("  PROPOSITIONS")}  ${dim(`${propositions.length} in ${ms} ms`)}`,
  );
  const speakers = speakersOf(fixture.transcript);
  const withEvidence = propositions.filter(
    (p) => typeof p.evidence === "string",
  ).length;
  let verbatim = 0;
  const ids = new Set<string>();
  propositions.forEach((p, i) => {
    const n = i + 1;
    const hasEvidence = typeof p.evidence === "string";
    const ok = hasEvidence && isVerbatim(p.evidence!, fixture.transcript);
    if (ok) verbatim++;
    const typeTag = cfg.types.includes(p.type)
      ? p.type === "decision" || p.type === "commitment"
        ? green(p.type)
        : yellow(p.type)
      : red(p.type);
    const conf =
      typeof p.confidence === "number"
        ? p.confidence.toFixed(2)
        : String(p.confidence);
    console.log(
      `\n    ${bold(`${n}.`)} ${dim(p.id)} [${typeTag}] ${p.speaker ? bold(p.speaker) : dim("no speaker")}  ${dim(`conf ${conf}`)}`,
    );
    console.log(wrap(p.text, "       ", width));
    if (hasEvidence)
      console.log(
        `       ${dim("evidence:")} "${p.evidence}"  ${ok ? green("verbatim") : red("NOT verbatim")}`,
      );
    if (!cfg.types.includes(p.type))
      warnings.push(`#${n}: type "${p.type}" is not an allowed type`);
    if (p.speaker !== null && !speakers.includes(p.speaker))
      warnings.push(`#${n}: speaker "${p.speaker}" is not in the transcript`);
    if (
      typeof p.confidence !== "number" ||
      p.confidence < 0 ||
      p.confidence > 1
    )
      warnings.push(`#${n}: confidence ${p.confidence} is outside 0..1`);
    if (ids.has(p.id)) warnings.push(`#${n}: duplicate id ${p.id}`);
    ids.add(p.id);
    if (hasEvidence && !ok)
      warnings.push(`#${n}: evidence is not a verbatim span`);
  });

  if (propositions.length === 0) warnings.push("no propositions returned");

  console.log(`\n  ${dim("META")}  ${dim(meta)}`);
  console.log(`\n${bold("  CHECKS")}`);
  console.log(
    `    ${propositions.length > 0 ? green("✓") : red("✗")} propositions returned: ${propositions.length}`,
  );
  if (withEvidence > 0)
    console.log(
      `    ${verbatim === withEvidence ? green("✓") : yellow("!")} evidence verbatim: ${verbatim}/${withEvidence}`,
    );
  for (const w of warnings) console.log(`    ${yellow("!")} ${w}`);

  const status: Outcome["status"] =
    propositions.length === 0 ? "fail" : warnings.length ? "warn" : "pass";
  return {
    name: fixture.name,
    status,
    count: propositions.length,
    verbatim: withEvidence > 0 ? verbatim : -1,
    warnings,
    ms,
    verdict: "-",
  };
}

/**
 * One conversation; the model gets resolve_date and submit_propositions as
 * tools and decides when to resolve a date. See src/extraction-agent.ts.
 */
async function runOne(
  cfg: EvalConfig,
  fixture: Fixture,
  index: number,
  total: number,
): Promise<Outcome> {
  const width = cfg.wrapWidth ?? 100;
  const warnings: string[] = [];
  console.log(
    `\n${bold(`═══ ${index + 1}/${total}  ${fixture.name} `.padEnd(width, "═"))}\n`,
  );
  console.log(bold("  TRANSCRIPT"));
  console.log(wrap(fixture.transcript, "    ", width));
  console.log(
    `\n${bold("  REQUEST")}  ${dim("single conversation: resolve_date + submit_propositions tools")}`,
  );

  const started = performance.now();
  try {
    const { value, completion, hops, dateCalls } = await extractPropositions<{
      propositions: Proposition[];
    }>(cfg.client, cfg.systemPrompt, fixture.transcript, cfg.schema, {
      mode: cfg.mode,
      stream: cfg.stream,
      onChunk: (chunk) => {
        if (!cfg.stream) return;
        const delta = chunk.choices[0]?.delta;
        if (delta?.reasoning_content) process.stdout.write(dim("."));
        if (delta?.content) process.stdout.write(dim("+"));
      },
      onToolCall: (call, result) => {
        if (cfg.stream) console.log();
        console.log(
          `\n${bold("  TOOL CALL")} ${call.function.name}(${call.function.arguments})`,
        );
        console.log(json(result));
      },
    });
    const propositions = value.propositions;
    printRaw(completion, value);
    const m = completion.meetiq;
    const meta =
      `mode=${m.mode_used} (${m.router.rule})  finish=${completion.choices[0]?.finish_reason}  hops=${hops}  date_calls=${dateCalls}  ` +
      `tokens in=${completion.usage.prompt_tokens} out=${completion.usage.completion_tokens}  retries=${m.retries}` +
      (m.mode_used === "thinking"
        ? `  reasoning_tokens=${completion.usage.completion_tokens_details.reasoning_tokens}`
        : "");
    if (completion.choices[0]?.finish_reason === "length")
      warnings.push("output hit maxTokens; propositions may be cut off");
    const ms = Math.round(performance.now() - started);
    return finishOutcome(cfg, fixture, propositions, warnings, meta, ms);
  } catch (err) {
    const ms = Math.round(performance.now() - started);
    return failOutcome(fixture, warnings, describeError(err), ms, width);
  }
}

// Whole run: header, health, manual loop, summary, exit code

export async function runEvaluation(cfg: EvalConfig): Promise<never> {
  const width = cfg.wrapWidth ?? 100;
  const rl =
    cfg.manual && process.stdin.isTTY
      ? createInterface({ input: process.stdin, output: process.stdout })
      : null;
  const ask = async (q: string) =>
    rl ? (await rl.question(q)).trim().toLowerCase() : "";

  console.log(
    bold(
      `transcript → propositions  ·  ${cfg.label}  ·  mode=${cfg.mode}  ·  ${cfg.fixtures.length} transcript(s)`,
    ),
  );
  try {
    const h = await cfg.client.health();
    const busy = h.queue.running > 0 || h.queue.waiting > 0;
    const line = `proxy ${h.status}  ·  ${h.model.name} ${h.model.loaded ? "loaded" : "NOT loaded"}  ·  queue running=${h.queue.running} waiting=${h.queue.waiting} of ${h.queue.concurrency}`;
    console.log(
      busy
        ? yellow(line + "  ← GPU already busy: timings inflated, 524s likely")
        : dim(line),
    );
  } catch (err) {
    console.log(
      red(
        `proxy health check failed: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
  }
  console.log(
    `\n${bold("  SYSTEM PROMPT")}  ${dim("sent as the first message of every request")}`,
  );
  console.log(dim(wrap(cfg.systemPrompt, "    ", width)));
  console.log(
    `\n${bold("  RESPONSE SCHEMA")}  ${dim("submit_propositions tool parameters")}`,
  );
  console.log(dim(json(cfg.schema)));
  if (rl)
    console.log(
      `\n${dim("after each transcript: [Enter] next   [r] rerun   [p] pass / [f] fail   [q] quit")}`,
    );

  const outcomes: Outcome[] = [];
  for (let i = 0; i < cfg.fixtures.length; i++) {
    let outcome = await runOne(cfg, cfg.fixtures[i]!, i, cfg.fixtures.length);
    let done = false;
    while (!done && rl) {
      const answer = await ask(`\n  › `);
      if (answer === "r")
        outcome = await runOne(cfg, cfg.fixtures[i]!, i, cfg.fixtures.length);
      else if (answer === "p" || answer === "f") {
        outcome.verdict = answer === "p" ? "pass" : "FAIL";
        done = true;
      } else if (answer === "q") {
        outcomes.push(outcome);
        i = cfg.fixtures.length;
        done = true;
      } else done = true;
    }
    if (i < cfg.fixtures.length) outcomes.push(outcome);
  }
  rl?.close();

  console.log(`\n${bold("═".repeat(width))}`);
  console.log(
    `${"transcript".padEnd(36)} ${"result".padEnd(6)} ${"props".padEnd(6)} ${"verbatim".padEnd(9)} ${"you".padEnd(6)} ms`,
  );
  for (const o of outcomes) {
    const result =
      o.status === "pass"
        ? green("PASS")
        : o.status === "warn"
          ? yellow("WARN")
          : red("FAIL");
    console.log(
      `${o.name.padEnd(36)} ${result.padEnd(tty ? 15 : 6)} ${String(o.count).padEnd(6)} ${(o.verbatim < 0 ? "-" : `${o.verbatim}/${o.count}`).padEnd(9)} ${o.verdict.padEnd(6)} ${o.ms}`,
    );
  }
  const failed = outcomes.filter(
    (o) => o.status === "fail" || o.verdict === "FAIL",
  );
  console.log(
    `\n${outcomes.length - failed.length}/${outcomes.length} ok${failed.length ? `, ${failed.length} failed` : ""}`,
  );
  process.exit(failed.length ? 1 : 0);
}
