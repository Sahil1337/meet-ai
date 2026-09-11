/**
 * A fixture per window, built exactly the way production builds an
 * extraction request: parse with core's parser, window with ingestion's
 * windower, hand each window everything spoken before it.
 */

import { parseTranscript, speakersOf, type IsoDate, type MeetingContext } from "@meetai/core";
import { windowBySpeakingTime } from "@meetai/ingestion";
import type { Fixture } from "./types.ts";

export function fixturesFromTranscript(
  name: string,
  text: string,
  options: { heldAt?: IsoDate; windowSeconds?: number } = {},
): Fixture[] {
  const { lines, rejected } = parseTranscript(text);
  if (rejected.length > 0) {
    const first = rejected[0]!;
    throw new Error(`transcript has ${rejected.length} malformed line(s); first at line ${first.lineNumber}: ${first.raw}`);
  }
  if (lines.length === 0) throw new Error("transcript is empty");

  const meeting: MeetingContext = {
    title: name,
    heldAt: options.heldAt ?? lines[0]!.date,
    participants: speakersOf(lines),
  };
  const windows = windowBySpeakingTime(lines, { targetSeconds: options.windowSeconds });
  return windows.map((window) => ({
    name: `${name} — window ${window.index + 1}/${window.total}`,
    request: { meeting, window, preceding: lines.slice(0, window.lines[0]!.index) },
  }));
}
