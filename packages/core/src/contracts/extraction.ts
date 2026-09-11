/**
 * Contract between ingestion (caller) and AI extraction (implementer).
 *
 * Ingestion hands over one window plus what the extractor may search on
 * demand; extraction hands back claims plus what it cost. Nothing about
 * prompts, tools, or the proxy crosses this boundary — those are the
 * extractor's internals.
 */

import { z } from "zod";
import { IsoDate } from "../primitives.ts";
import { ExtractedProposition } from "../proposition.ts";
import { TranscriptLine, TranscriptWindow } from "../transcript.ts";

/** Meeting-level context the extractor may put in front of the window (the "context header" the kickoff decided on). */
export const MeetingContext = z.object({
  title: z.string().min(1),
  heldAt: IsoDate,
  participants: z.array(z.string().min(1)),
});
export type MeetingContext = z.infer<typeof MeetingContext>;

export const ExtractionRequest = z.object({
  meeting: MeetingContext,
  window: TranscriptWindow,
  /**
   * Lines spoken before the window, oldest first. Not shown to the model up
   * front — the window is what it extracts from — but available to tools that
   * look back (reference resolution) when a window's pronoun points at an
   * earlier one. Empty for the first window.
   */
  preceding: z.array(TranscriptLine),
});
export type ExtractionRequest = z.infer<typeof ExtractionRequest>;

/** What one extraction cost, in terms every caller can log without knowing the proxy. */
export const ExtractionUsage = z.object({
  /** Model turns taken to reach the final submission. */
  hops: z.number().int().positive(),
  /** Calls per tool name, e.g. `{ resolve_date: 2, investigate_ambiguity: 1 }`. Empty when no tool was used. */
  toolCalls: z.record(z.string(), z.number().int().nonnegative()),
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  reasoningTokens: z.number().int().nonnegative(),
  ms: z.number().nonnegative(),
});
export type ExtractionUsage = z.infer<typeof ExtractionUsage>;

export const ExtractionResult = z.object({
  propositions: z.array(ExtractedProposition),
  usage: ExtractionUsage,
});
export type ExtractionResult = z.infer<typeof ExtractionResult>;

/**
 * The extractor as ingestion sees it. `version` identifies the prompt + tool
 * set + model so persisted propositions record what produced them
 * (`Proposition.extractorVersion`).
 */
export interface Extractor {
  readonly version: string;
  extract(request: ExtractionRequest, options?: { signal?: AbortSignal }): Promise<ExtractionResult>;
}
