/**
 * The proposition is the unit the whole system is built on: one atomic,
 * self-contained claim lifted out of a transcript (Dense X Retrieval, reading
 * list A1). Memory stores them, change detection diffs them, retrieval ranks
 * them, answers cite them.
 *
 * Two shapes, on purpose:
 *
 * - `ExtractedProposition` is what the model emits. It has no id and no
 *   evidence pointer yet — it is the raw output of one extraction call and
 *   the schema the model is constrained to. Its JSON Schema (the
 *   `submit_propositions` tool parameters in `@meetai/ai`) is DERIVED from
 *   this zod schema; there is no second hand-written copy.
 * - `Proposition` is what memory persists: the extracted claim plus where it
 *   came from. Everything downstream of extraction works on this one.
 */

import { z } from "zod";
import { Confidence, Id, IsoDateTime } from "./primitives.ts";

/**
 * The closed set of claim kinds the extractor may emit. Narrowed in Sep 2026
 * from a broader list (`fact`, `proposal`, `question`, `relationship`, `issue`
 * were dropped) because those invited classifying conversational material
 * that does not deserve a record — see the extraction prompt's history.
 */
export const PROPOSITION_TYPES = [
  "decision",
  "rationale",
  "commitment",
  "action_item",
  "requirement",
  "constraint",
  "ownership",
  "deadline",
  "dependency",
  "blocker",
  "risk",
  "open_question",
  "status",
] as const;

export const PropositionType = z.enum(PROPOSITION_TYPES);
export type PropositionType = z.infer<typeof PropositionType>;

export const ExtractedProposition = z.object({
  /** Standalone wording: understandable without the transcript or other records. */
  text: z.string().min(1),
  type: PropositionType,
  /** The person who expresses the knowledge (owner for ownership/commitments), a transcript speaker name, or null. */
  speaker: z.string().nullable(),
  confidence: Confidence,
});
export type ExtractedProposition = z.infer<typeof ExtractedProposition>;

/**
 * Where a claim came from: the meeting and the transcript lines that support
 * it. Lines are indexes into the meeting's transcript (see `TranscriptLine`),
 * fetched from the store when the UI or an answer needs the original words —
 * the transcript is not duplicated into the proposition. One source kind for
 * now; add a `kind` discriminant when a second one exists.
 */
export const Evidence = z.object({
  meetingId: Id,
  lineIndexes: z.array(z.number().int().nonnegative()).min(1),
});
export type Evidence = z.infer<typeof Evidence>;

export const Proposition = ExtractedProposition.extend({
  id: Id,
  meetingId: Id,
  /** Which extraction window produced it; useful for evals and for re-running one window. */
  windowIndex: z.number().int().nonnegative(),
  evidence: Evidence,
  /** Identifies the prompt/model/tool set that produced the claim, so outputs from different versions are never compared blindly. */
  extractorVersion: z.string().min(1),
  extractedAt: IsoDateTime,
});
export type Proposition = z.infer<typeof Proposition>;

export const NewProposition = Proposition.omit({ id: true });
export type NewProposition = z.infer<typeof NewProposition>;
