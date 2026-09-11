/**
 * A meeting is the only kind of source in the prototype (product spec §9,
 * "Sources"): the thing propositions cite and the unit of processing. When a
 * second source kind arrives (Slack, GitHub — §18) `Evidence` in
 * proposition.ts grows a discriminant; nothing else here has to change.
 *
 * The transcript itself is not embedded in `Meeting`: it can be thousands of
 * lines, and most readers of a meeting (lists, timelines, job status) never
 * need it. `MeetingStore.getTranscript` / `getLines` fetch it on demand.
 */

import { z } from "zod";
import { Id, IsoDate, IsoDateTime } from "./primitives.ts";

export const Meeting = z.object({
  id: Id,
  projectId: Id,
  title: z.string().min(1),
  /** The calendar date the meeting happened; transcript lines carry their own stamps. */
  heldAt: IsoDate,
  /** Speaker names, as they appear in the transcript. */
  participants: z.array(z.string().min(1)),
  /** Number of accepted transcript lines, so evidence indexes can be range-checked without loading the text. */
  lineCount: z.number().int().nonnegative(),
  createdAt: IsoDateTime,
});
export type Meeting = z.infer<typeof Meeting>;

export const NewMeeting = Meeting.omit({ id: true, createdAt: true, lineCount: true });
export type NewMeeting = z.infer<typeof NewMeeting>;

/**
 * Processing is a background job (product spec §49): a one-hour meeting is
 * ~15 minutes of GPU time, so upload returns immediately and the frontend
 * polls the job. Stages are the pipeline's steps in order; `stage` is the one
 * that was running when the job last changed status, so a failed job says
 * where it failed and a retry can resume there (§50).
 */
export const ProcessingStatus = z.enum(["pending", "processing", "completed", "failed"]);
export type ProcessingStatus = z.infer<typeof ProcessingStatus>;

export const JobStage = z.enum(["parse", "window", "extract", "persist", "memory", "index"]);
export type JobStage = z.infer<typeof JobStage>;

export const ProcessingJob = z.object({
  id: Id,
  meetingId: Id,
  status: ProcessingStatus,
  stage: JobStage.nullable(),
  attempts: z.number().int().nonnegative(),
  error: z.string().nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ProcessingJob = z.infer<typeof ProcessingJob>;
