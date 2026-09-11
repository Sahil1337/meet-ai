/**
 * Splits a transcript into the windows extraction works on. Cuts only
 * between lines, never mid-utterance, and sizes windows by *estimated
 * speaking time* rather than by token count, because that is the quantity
 * the extraction budget is really about: the system prompt alone is ~2600
 * tokens, and a whole meeting plus the agent's tool round trips would blow
 * past the proxy's 8192-token context long before the model reached
 * submit_propositions.
 *
 * Each window is extracted independently; stitching windows back together
 * over time is memory's job, not extraction's. A pronoun whose antecedent
 * fell in an earlier window is handled by handing extraction the preceding
 * lines to search (`ExtractionRequest.preceding`), not by overlapping windows.
 *
 * Defaults: 150 s target (+10 s tolerance). The kickoff meeting settled on
 * 60 s; the evals moved to 150 s because more speaking time per window gives
 * the model more to weigh relevance against (shown one line in isolation,
 * agenda-setting reads as the most important thing in the window) and more
 * local context to resolve references without a tool call. The ceiling is
 * ~180 s: output grows with the window, and prompt + window + propositions +
 * tool round trips must fit in 8192. This knob belongs to ingestion; change
 * it here and re-run `bun run eval`.
 */

import type { TranscriptLine, TranscriptWindow } from "@meetai/core";

export type WindowOptions = {
  targetSeconds?: number;
  toleranceSeconds?: number;
  /** ~140 wpm conversational pace. */
  wordsPerSecond?: number;
};

export function windowBySpeakingTime(lines: TranscriptLine[], options: WindowOptions = {}): TranscriptWindow[] {
  const { targetSeconds = 150, toleranceSeconds = 10, wordsPerSecond = 2.3 } = options;
  const maxSeconds = targetSeconds + toleranceSeconds;
  const groups: TranscriptLine[][] = [];
  let current: TranscriptLine[] = [];
  let seconds = 0;
  for (const line of lines) {
    const lineSeconds = line.text.trim().split(/\s+/).filter(Boolean).length / wordsPerSecond;
    if (current.length > 0 && seconds + lineSeconds > maxSeconds) {
      groups.push(current);
      current = [];
      seconds = 0;
    }
    current.push(line);
    seconds += lineSeconds;
  }
  if (current.length > 0) groups.push(current);
  return groups.map((group, index) => ({ index, total: groups.length, lines: group }));
}
