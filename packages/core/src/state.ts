/**
 * State is what memory knows about an entity *at a point in time* (spine:
 * Entity → State). It is time-aware by construction (product spec §10, §52):
 * a state record is never overwritten. When a later meeting changes a
 * deadline, the old record gets a `validTo` and a new record is written; the
 * pair is what `StateChange` (change.ts) points at.
 *
 * Each record carries one *aspect* of one entity — its status, its owner, its
 * deadline, what blocks it, what was decided — so change detection is a diff
 * of same-aspect records rather than a field-by-field comparison of a fat
 * task object. The commitment ledger and the timeline are views over these
 * records (views.ts), not separate stores.
 */

import { z } from "zod";
import { Id, IsoDate, IsoDateTime } from "./primitives.ts";

/**
 * How firmly a deadline is pinned down (product spec §14). The original
 * wording is always kept; `date` is filled only when the speaker's words and
 * the line's date determine one. "Soon" stays "soon".
 */
export const DeadlinePrecision = z.enum(["exact", "approximate", "conditional", "ambiguous"]);
export type DeadlinePrecision = z.infer<typeof DeadlinePrecision>;

export const Deadline = z.object({
  originalText: z.string().min(1),
  date: IsoDate.nullable(),
  precision: DeadlinePrecision,
});
export type Deadline = z.infer<typeof Deadline>;

export const TaskStatus = z.enum(["open", "in_progress", "blocked", "delayed", "completed", "cancelled"]);
export type TaskStatus = z.infer<typeof TaskStatus>;

/** The typed payload of a state record, discriminated by which aspect of the entity it describes. */
export const StateValue = z.discriminatedUnion("aspect", [
  z.object({ aspect: z.literal("status"), status: TaskStatus }),
  z.object({ aspect: z.literal("owner"), ownerId: Id }),
  z.object({ aspect: z.literal("deadline"), deadline: Deadline }),
  z.object({
    aspect: z.literal("blocked_by"),
    description: z.string().min(1),
    /** The entity doing the blocking, when it resolved to one. */
    blockerEntityId: Id.nullable(),
  }),
  z.object({
    aspect: z.literal("decided"),
    statement: z.string().min(1),
    rationale: z.string().nullable(),
  }),
]);
export type StateValue = z.infer<typeof StateValue>;
export type StateAspect = StateValue["aspect"];

export const EntityState = z.object({
  id: Id,
  entityId: Id,
  value: StateValue,
  /** When this became true — the meeting date of the proposition that established it. */
  validFrom: IsoDateTime,
  /** When it stopped being current; null while it is the latest record for its aspect. */
  validTo: IsoDateTime.nullable(),
  /** The proposition this state was derived from. Every state has evidence, via that proposition. */
  sourcePropositionId: Id,
  /** The record this one replaced, for walking history without a date sort. */
  supersedes: Id.nullable(),
});
export type EntityState = z.infer<typeof EntityState>;

export const NewEntityState = EntityState.omit({ id: true });
export type NewEntityState = z.infer<typeof NewEntityState>;
