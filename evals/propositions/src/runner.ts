/**
 * The run loop: one extraction per fixture, live output while it runs,
 * checks after, an optional manual verdict, then the summary and exit code.
 */

import { createInterface } from "node:readline/promises";
import { extractPropositions } from "@meetai/ai";
import { QwenProxyError } from "@meetai/proxy/client";
import { checkPropositions } from "./checks.ts";
import { saveRunOutput } from "./output.ts";
import {
  bold,
  cyan,
  dim,
  heading,
  json,
  printChecks,
  printError,
  printFixtureHeader,
  printPropositions,
  printRaw,
  printSummary,
  red,
  startSpinner,
  wrap,
  yellow,
  type Spinner,
} from "./render.ts";
import type { EvalConfig, Fixture, Outcome } from "./types.ts";

function describeError(err: unknown): string {
  let error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  if (err instanceof QwenProxyError) {
    error = `${err.code} (HTTP ${err.status}): ${err.message}`;
    if (err.status === 524) error += " — Cloudflare edge gave up after 100 s; the proxy did not answer in time.";
    if (err.status === 530) error += " — Cloudflare cannot reach the Nitro; cloudflared or the laptop is down.";
  }
  return error;
}

async function runOne(cfg: EvalConfig, fixture: Fixture, index: number, total: number): Promise<Outcome> {
  const { window } = fixture.request;
  printFixtureHeader(index, total, fixture.name, window);
  if (!cfg.suppress) console.log(heading("REQUEST", "one conversation: registered tools + submit_propositions"));

  const started = performance.now();
  let spinner: Spinner | null = cfg.suppress ? null : startSpinner("waiting for response…");
  let hopStreaming = false;
  let thinkingStarted = false;
  let contentStarted = false;
  try {
    const result = await extractPropositions(cfg.client, fixture.request, {
      systemPrompt: cfg.systemPrompt,
      mode: cfg.mode,
      stream: cfg.stream,
      toolChoice: cfg.toolChoice,
      onChunk: (chunk) => {
        if (!cfg.stream || cfg.suppress) return;
        const delta = chunk.choices[0]?.delta;
        if (!delta?.reasoning_content && !delta?.content) return;
        if (!hopStreaming) {
          spinner?.stop();
          spinner = null;
          hopStreaming = true;
        }
        if (delta.reasoning_content) {
          if (!thinkingStarted) {
            console.log(heading("THINKING (live)"));
            thinkingStarted = true;
          }
          process.stdout.write(dim(delta.reasoning_content));
        }
        if (delta.content) {
          if (!contentStarted) {
            console.log(heading("CONTENT (live)"));
            contentStarted = true;
          }
          process.stdout.write(delta.content);
        }
      },
      onToolCall: (call, toolResult) => {
        if (cfg.suppress) return;
        if (hopStreaming) {
          console.log();
          hopStreaming = false;
          thinkingStarted = false;
          contentStarted = false;
        }
        const block = `${heading("TOOL CALL", `${call.function.name}(${call.function.arguments})`, cyan)}\n${json(toolResult)}`;
        if (spinner) spinner.log(block);
        else {
          console.log(block);
          spinner = startSpinner("waiting for response…");
        }
      },
    });
    if (hopStreaming) console.log();
    spinner?.stop();

    const ms = Math.round(performance.now() - started);
    const { propositions, usage, completion } = result;
    const warnings = checkPropositions(propositions, window);
    if (completion.choices[0]?.finish_reason === "length") warnings.push("output hit the token limit; propositions may be cut off");

    printPropositions(propositions, ms);
    if (!cfg.suppress) {
      printRaw(completion, { propositions });
      const m = completion.meetiq;
      const calls = Object.entries(usage.toolCalls).map(([k, v]) => `${k}=${v}`).join(" ");
      const meta =
        `mode=${m.mode_used} (${m.router.rule})  tool_parse=${m.tool_parse}  finish=${completion.choices[0]?.finish_reason}  hops=${usage.hops}  ${calls}  ` +
        `tokens in=${usage.promptTokens} out=${usage.completionTokens}  retries=${m.retries}` +
        (m.mode_used === "thinking" ? `  reasoning_tokens=${usage.reasoningTokens}` : "");
      printChecks(meta, propositions.length, warnings);
    }

    const status: Outcome["status"] = propositions.length === 0 ? "fail" : warnings.length ? "warn" : "pass";
    return { name: fixture.name, status, count: propositions.length, warnings, ms, verdict: "-", propositions };
  } catch (err) {
    if (hopStreaming) console.log();
    spinner?.stop();
    const ms = Math.round(performance.now() - started);
    const error = describeError(err);
    printError(error);
    return { name: fixture.name, status: "fail", count: 0, warnings: [], error, ms, verdict: "-", propositions: [] };
  }
}

export async function runEvaluation(cfg: EvalConfig): Promise<never> {
  const rl = cfg.manual && process.stdin.isTTY ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  const ask = async (q: string) => (rl ? (await rl.question(q)).trim().toLowerCase() : "");

  console.log(bold(`transcript → propositions  ·  ${cfg.label}  ·  mode=${cfg.mode}  ·  ${cfg.fixtures.length} window(s)`));
  try {
    const h = await cfg.client.health();
    const busy = h.queue.running > 0 || h.queue.waiting > 0;
    const line = `proxy ${h.status}  ·  ${h.model.name} ${h.model.loaded ? "loaded" : "NOT loaded"}  ·  queue running=${h.queue.running} waiting=${h.queue.waiting} of ${h.queue.concurrency}`;
    console.log(busy ? yellow(line + "  ← GPU already busy: timings inflated, 524s likely") : dim(line));
  } catch (err) {
    console.log(red(`proxy health check failed: ${err instanceof Error ? err.message : String(err)}`));
  }
  if (!cfg.suppress) {
    console.log(heading("SYSTEM PROMPT", "sent as the first message of every request"));
    console.log(dim(wrap(cfg.systemPrompt, "    ")));
  }
  if (rl) console.log(`\n${dim("after each window: [Enter] next   [r] rerun   [p] pass / [f] fail   [q] quit")}`);

  const outcomes: Outcome[] = [];
  for (let i = 0; i < cfg.fixtures.length; i++) {
    let outcome = await runOne(cfg, cfg.fixtures[i]!, i, cfg.fixtures.length);
    let done = false;
    while (!done && rl) {
      const answer = await ask(`\n  › `);
      if (answer === "r") outcome = await runOne(cfg, cfg.fixtures[i]!, i, cfg.fixtures.length);
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
    // Rewritten from the full array every window so out/latest/ is always a
    // complete snapshot: a crash mid-run loses at most the window in flight.
    if (cfg.saveOutput) saveRunOutput(cfg, outcomes);
  }
  rl?.close();

  printSummary(outcomes);
  if (cfg.saveOutput) console.log(dim(`\nsaved transcript.txt + claims.json to ${saveRunOutput(cfg, outcomes)}`));

  const failed = outcomes.filter((o) => o.status === "fail" || o.verdict === "FAIL");
  process.exit(failed.length ? 1 : 0);
}
