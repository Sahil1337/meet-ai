/**
 * Automated checks on one window's output. Pure: propositions and window in,
 * warnings out. Shape validity (type enum, confidence range) is no longer
 * checked here — `extractPropositions` validates the model's submission with
 * the zod schema, so a bad shape fails the fixture outright with the issues
 * listed. What remains are the things a valid-looking record can still get
 * wrong.
 */

import { speakersOf, type ExtractedProposition, type TranscriptWindow } from "@meetai/core";

const normalize = (s: string) =>
  s
    .replace(/^["'“”‘’\s]+|["'“”‘’\s.]+$/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();

export function checkPropositions(propositions: ExtractedProposition[], window: TranscriptWindow): string[] {
  const warnings: string[] = [];
  const speakers = speakersOf(window.lines);
  const seen = new Map<string, number>();
  propositions.forEach((p, i) => {
    const n = i + 1;
    if (p.speaker !== null && !speakers.includes(p.speaker)) {
      warnings.push(`#${n}: speaker "${p.speaker}" is not in the transcript`);
    }
    const key = normalize(p.text);
    const dupOf = seen.get(key);
    if (dupOf) warnings.push(`#${n}: duplicates #${dupOf}`);
    else seen.set(key, n);
  });
  if (propositions.length === 0) warnings.push("no propositions returned");
  return warnings;
}
