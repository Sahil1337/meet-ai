/**
 * Dumps a run to out/latest/ (gitignored) for handing off to an agent or a
 * teammate to review. transcript.txt is the raw dialogue, one
 * `=== fixture ===` section per window. claims.json is the self-contained
 * structured version: one entry per window with its own transcript, status,
 * warnings and propositions together, so a claim never has to be
 * cross-referenced against a separate file.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { formatTranscript } from "@meetai/core";
import type { EvalConfig, Outcome } from "./types.ts";

export function saveRunOutput(cfg: EvalConfig, outcomes: Outcome[]): string {
  const outDir = join(import.meta.dir, "..", "out", "latest");
  mkdirSync(outDir, { recursive: true });

  const runs = outcomes.map((o, i) => ({
    fixture: o.name,
    status: o.status,
    verdict: o.verdict,
    transcript: formatTranscript(cfg.fixtures[i]?.request.window.lines ?? []),
    propositions: o.propositions,
    warnings: o.warnings,
    ...(o.error ? { error: o.error } : {}),
    ms: o.ms,
  }));

  const transcriptText = runs.map((r) => `=== ${r.fixture} ===\n${r.transcript}`).join("\n\n");
  writeFileSync(join(outDir, "transcript.txt"), `${transcriptText}\n`);
  writeFileSync(join(outDir, "claims.json"), `${JSON.stringify(runs, null, 2)}\n`);
  return outDir;
}
