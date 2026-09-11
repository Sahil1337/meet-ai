/**
 * Terminal output only: colours, wrapping, headings, the spinner, and the
 * printers for each block of a run. Nothing here computes a result.
 */

import { formatTranscript, type ExtractedProposition, type TranscriptWindow } from "@meetai/core";
import type { ChatCompletion } from "qwen-proxy/types";
import type { Outcome } from "./types.ts";

export const WIDTH = 100;

const tty = process.stdout.isTTY ?? false;
const style = (code: string) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
export const bold = style("1");
export const dim = style("2");
export const green = style("32");
export const red = style("31");
export const yellow = style("33");
export const cyan = style("36");

export function wrap(text: string, indent = "    ", width = WIDTH): string {
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

/** "  TITLE  subtitle", always preceded by a blank line so sections never glue onto the previous block. */
export function heading(title: string, subtitle?: string, color: (s: string) => string = bold): string {
  return `\n${color(`  ${title}`)}${subtitle ? `  ${dim(subtitle)}` : ""}`;
}

// Spinner shown while waiting on the proxy. log() surfaces agentic-loop
// events (tool calls between hops) as a block without breaking the spin.

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export interface Spinner {
  log: (line: string) => void;
  stop: () => void;
}

export function startSpinner(label: string): Spinner {
  if (!tty) return { log: (line) => console.log(line), stop: () => {} };
  let i = 0;
  const draw = (lead: "\n" | "\r") => process.stdout.write(`${lead}${dim(SPINNER_FRAMES[i]!)} ${dim(label)}`);
  const clear = () => process.stdout.write(`\r${" ".repeat(label.length + 2)}\r`);
  draw("\n");
  const timer = setInterval(() => {
    i = (i + 1) % SPINNER_FRAMES.length;
    draw("\r");
  }, 80);
  return {
    log: (line) => {
      clear();
      console.log(line);
      draw("\n");
    },
    stop: () => {
      clearInterval(timer);
      clear();
    },
  };
}

// Blocks of one run

export function printFixtureHeader(index: number, total: number, name: string, window: TranscriptWindow): void {
  console.log(`\n${bold(`═══ ${index + 1}/${total}  ${name} `.padEnd(WIDTH, "═"))}\n`);
  console.log(bold("  TRANSCRIPT"));
  console.log(wrap(formatTranscript(window.lines), "    "), "\n");
}

export function printPropositions(propositions: ExtractedProposition[], ms: number): void {
  console.log(heading("PROPOSITIONS", `${propositions.length} in ${ms} ms`));
  propositions.forEach((p, i) => {
    const typeTag = p.type === "decision" || p.type === "commitment" ? green(p.type) : yellow(p.type);
    console.log(
      `\n    ${bold(`${i + 1}.`)} [${typeTag}] ${p.speaker ? bold(p.speaker) : dim("no speaker")}  ${dim(`conf ${p.confidence.toFixed(2)}`)}`,
    );
    console.log(wrap(p.text, "       "));
  });
}

export function printChecks(meta: string, count: number, warnings: string[]): void {
  console.log(`\n  ${dim("META")}  ${dim(meta)}`);
  console.log(heading("CHECKS"));
  console.log(`    ${count > 0 ? green("✓") : red("✗")} propositions returned: ${count}`);
  for (const w of warnings) console.log(`    ${yellow("!")} ${w}`);
}

/** The ChatCompletion exactly as the proxy returned it, minus the debug payload. */
export function printRaw(completion: ChatCompletion, parsed: unknown): void {
  const { meetiq, ...rest } = completion;
  const { upstream_requests, ...meetiqRest } = meetiq;
  console.log(heading("RAW RESPONSE", "the ChatCompletion object as received"));
  console.log(json({ ...rest, meetiq: meetiqRest }));
  if (upstream_requests) {
    console.log(heading("UPSTREAM REQUEST(S)", "exact payload(s) the proxy sent to Ollama /api/chat"));
    console.log(json(upstream_requests));
  }
  const reasoning = completion.choices[0]?.message.reasoning_content;
  if (reasoning) {
    console.log(
      heading(
        "THINKING",
        `message.reasoning_content, ${reasoning.length} chars, ${completion.usage.completion_tokens_details.reasoning_tokens} tokens`,
      ),
    );
    console.log(dim(wrap(reasoning, "    ")));
  }
  console.log(heading("SUBMITTED", "submit_propositions arguments, validated"));
  console.log(json(parsed));
}

export function printError(error: string): void {
  console.log(`\n${red("  ERROR")}\n${wrap(error, "    ")}`);
}

export function printSummary(outcomes: Outcome[]): void {
  console.log(`\n${bold("═".repeat(WIDTH))}`);
  console.log(`${"transcript".padEnd(44)} ${"result".padEnd(6)} ${"props".padEnd(6)} ${"you".padEnd(6)} ms`);
  for (const o of outcomes) {
    const result = o.status === "pass" ? green("PASS") : o.status === "warn" ? yellow("WARN") : red("FAIL");
    console.log(
      `${o.name.padEnd(44)} ${result.padEnd(tty ? 15 : 6)} ${String(o.count).padEnd(6)} ${o.verdict.padEnd(6)} ${o.ms}`,
    );
  }
  const failed = outcomes.filter((o) => o.status === "fail" || o.verdict === "FAIL");
  console.log(`\n${outcomes.length - failed.length}/${outcomes.length} ok${failed.length ? `, ${failed.length} failed` : ""}`);
}
