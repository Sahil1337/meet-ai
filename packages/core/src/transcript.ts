/**
 * The transcript line grammar — `Speaker [HH:MM YYYY-MM-DD]: text` — and the
 * one parser for it.
 *
 * This is the input contract of the whole system: transcription and
 * diarization are out of scope, so a transcript arrives already in this
 * shape, and every unit downstream (windowing, extraction, the ambiguity
 * tool, evidence lookup, the evals) reads lines in this form. Before this
 * file existed the format was re-implemented three times, each copy partial
 * and each disagreeing with the others on malformed input. Do not add a
 * fourth: import `parseTranscript` / `formatTranscriptLine` from here.
 */

import { z } from "zod";
import { ClockTime, IsoDate } from "./primitives.ts";

/** One utterance. `index` is the line's 0-based position within its meeting's transcript. */
export const TranscriptLine = z.object({
  index: z.number().int().nonnegative(),
  speaker: z.string().min(1),
  date: IsoDate,
  time: ClockTime,
  text: z.string(),
});
export type TranscriptLine = z.infer<typeof TranscriptLine>;

/**
 * A contiguous run of lines handed to extraction as one unit. `index`/`total`
 * locate it within the meeting so propositions can say which window produced
 * them. Windows are produced by ingestion (`@meetai/ingestion`) and consumed
 * by extraction (`@meetai/ai`); the sizing policy lives with the producer.
 */
export const TranscriptWindow = z.object({
  index: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  lines: z.array(TranscriptLine).min(1),
});
export type TranscriptWindow = z.infer<typeof TranscriptWindow>;

/** The grammar, anchored. Named groups so callers never count parentheses. */
export const TRANSCRIPT_LINE_PATTERN = /^(?<speaker>[^[\n]+?) \[(?<time>\d{2}:\d{2}) (?<date>\d{4}-\d{2}-\d{2})\]: ?(?<text>.*)$/;

/** Parses one raw line. Returns `null` when the line is not in the grammar. */
export function parseTranscriptLine(raw: string, index: number): TranscriptLine | null {
  const match = TRANSCRIPT_LINE_PATTERN.exec(raw.trim());
  if (!match?.groups) return null;
  const { speaker, time, date, text } = match.groups;
  return { index, speaker: speaker!.trim(), date: date!, time: time!, text: text! };
}

export type ParsedTranscript = {
  lines: TranscriptLine[];
  /** Non-blank input lines that did not match the grammar, with their 1-based line numbers. */
  rejected: Array<{ lineNumber: number; raw: string }>;
};

/**
 * Parses a whole transcript. Blank lines are skipped; malformed lines are
 * reported in `rejected` rather than thrown, so ingestion can refuse an
 * upload with a precise message while tools that merely search a transcript
 * can carry on with what parsed. Indexes count accepted lines only.
 */
export function parseTranscript(text: string): ParsedTranscript {
  const lines: TranscriptLine[] = [];
  const rejected: ParsedTranscript["rejected"] = [];
  text.split("\n").forEach((raw, i) => {
    if (!raw.trim()) return;
    const line = parseTranscriptLine(raw, lines.length);
    if (line) lines.push(line);
    else rejected.push({ lineNumber: i + 1, raw });
  });
  return { lines, rejected };
}

/** Inverse of `parseTranscriptLine`: the line exactly as it appears in a transcript. */
export function formatTranscriptLine(line: TranscriptLine): string {
  return `${line.speaker} [${line.time} ${line.date}]: ${line.text}`;
}

/** Lines back to the text form the model is shown. */
export function formatTranscript(lines: TranscriptLine[]): string {
  return lines.map(formatTranscriptLine).join("\n");
}

/**
 * The line's stamp as epoch milliseconds, minute precision. Transcripts carry
 * no timezone, so stamps are read as UTC; that is consistent within one
 * transcript, which is all the time-window arithmetic needs.
 */
export function lineTimestampMs(line: TranscriptLine): number {
  const [hh, mm] = line.time.split(":").map(Number);
  const [y, m, d] = line.date.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!, hh!, mm!);
}

/** Distinct speakers in order of first appearance. */
export function speakersOf(lines: TranscriptLine[]): string[] {
  return [...new Set(lines.map((l) => l.speaker))];
}
