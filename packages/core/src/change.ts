/**
 * A change is the product's core value (product spec §2, §11, §54 principle
 * 6): not "the API is incomplete" but "the API went from committed to
 * blocked, in meeting 2, because gateway docs were late". It points at the
 * state record before and the state record after (spine: State → Change).
 *
 * Not every difference is a contradiction (§12). `classification` records
 * what the detector believes the change is, and `needsReview` is the
 * human-in-the-loop hook (§36): when the detector is unsure it must flag,
 * not decide.
 */

import { z } from "zod";
import { Id, IsoDateTime } from "./primitives.ts";

/** The state transitions the spec enumerates (§11), verbatim. */
export const ChangeKind = z.enum([
  "new",
  "updated",
  "completed",
  "delayed",
  "cancelled",
  "reassigned",
  "deadline_changed",
  "blocked",
  "unblocked",
  "contradicted",
]);
export type ChangeKind = z.infer<typeof ChangeKind>;

/** What kind of difference this is (§12). `unclear` means: ask the user. */
export const ChangeClassification = z.enum([
  "intentional",
  "correction",
  "contradiction",
  "additional",
  "temporary_exception",
  "unclear",
]);
export type ChangeClassification = z.infer<typeof ChangeClassification>;

export const StateChange = z.object({
  id: Id,
  entityId: Id,
  kind: ChangeKind,
  /** The state record that was current before; null for `new`. */
  before: Id.nullable(),
  /** The state record that is current after. */
  after: Id,
  classification: ChangeClassification,
  /** The meeting whose processing produced the change. */
  meetingId: Id,
  /** Propositions that justify the change — the answer to "why do you say that changed?". */
  evidence: z.array(Id).min(1),
  needsReview: z.boolean(),
  detectedAt: IsoDateTime,
});
export type StateChange = z.infer<typeof StateChange>;

export const NewStateChange = StateChange.omit({ id: true });
export type NewStateChange = z.infer<typeof NewStateChange>;
