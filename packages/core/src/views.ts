/**
 * Read models: the shapes the API serves and the frontend renders. They are
 * *derived* from entities, states and changes by `@meetai/memory`; whether it
 * materializes them in a table or computes them per request is its call and
 * invisible to callers.
 */

import { z } from "zod";
import { Id, IsoDateTime } from "./primitives.ts";
import { Deadline } from "./state.ts";

/** The commitment ledger row (product spec §13). */
export const CommitmentStatus = z.enum(["open", "in_progress", "at_risk", "overdue", "completed", "cancelled"]);
export type CommitmentStatus = z.infer<typeof CommitmentStatus>;

export const Commitment = z.object({
  /** Stable across meetings: the same (owner, task) pair keeps its id as its status evolves. */
  id: Id,
  projectId: Id,
  ownerId: Id,
  taskId: Id,
  description: z.string().min(1),
  deadline: Deadline.nullable(),
  status: CommitmentStatus,
  /** The proposition in which the commitment was made. */
  createdFrom: Id,
  createdAt: IsoDateTime,
  /** State changes affecting this commitment, oldest first — the "change history" column of the ledger. */
  changeIds: z.array(Id),
});
export type Commitment = z.infer<typeof Commitment>;

/** One row of the chronological project history (spec §37). */
export const TimelineEntry = z.object({
  at: IsoDateTime,
  meetingId: Id,
  kind: z.enum(["proposition", "change"]),
  /** A `Proposition.id` or a `StateChange.id`, per `kind`. */
  refId: Id,
  /** One line the UI can show without a second fetch. */
  summary: z.string().min(1),
});
export type TimelineEntry = z.infer<typeof TimelineEntry>;
