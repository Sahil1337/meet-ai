/**
 * An answer to a question about the project, with the evidence it rests on.
 * The product's no-evidence policy (spec §35): an answer without citations is
 * not an answer, and the UI must be able to expand each citation to the
 * original transcript lines.
 */

import { z } from "zod";
import { Id } from "./primitives.ts";
import { Evidence, Proposition } from "./proposition.ts";
import { TranscriptLine } from "./transcript.ts";

/** Whether the answer states what a source says, infers from sources, estimates, or admits it does not know (spec §30). */
export const AnswerBasis = z.enum(["fact", "inference", "estimate", "unknown"]);
export type AnswerBasis = z.infer<typeof AnswerBasis>;

/** Evidence plus the proposition it belongs to, so a citation can be rendered as claim → source lines. */
export const Citation = Evidence.extend({ propositionId: Id });
export type Citation = z.infer<typeof Citation>;

export const Answer = z.object({
  text: z.string().min(1),
  basis: AnswerBasis,
  citations: z.array(Citation),
});
export type Answer = z.infer<typeof Answer>;

/** A proposition together with its source lines, hydrated — what the answering step reads and what the UI expands. */
export const EvidenceBundle = z.object({
  proposition: Proposition,
  lines: z.array(TranscriptLine),
});
export type EvidenceBundle = z.infer<typeof EvidenceBundle>;
