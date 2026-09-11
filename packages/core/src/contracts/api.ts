/**
 * The HTTP contract between `apps/api` and `apps/web`. The frontend imports
 * these type-only and talks JSON; the API validates request bodies with the
 * same schemas. This is the only file the frontend owner needs to read to
 * start, and the only file the API owner needs to keep true.
 *
 * Responses reuse the domain shapes directly — no parallel DTO layer to
 * drift. Routes are listed here as documentation; the API is the source of
 * truth for what is mounted.
 *
 *   POST /projects                        CreateProjectRequest  → Project
 *   GET  /projects/:id                                          → Project
 *   POST /projects/:id/meetings           UploadMeetingRequest  → UploadMeetingResponse
 *   GET  /meetings/:id                                          → MeetingDetailResponse
 *   GET  /jobs/:id                                              → ProcessingJob
 *   GET  /projects/:id/commitments                              → Commitment[]
 *   GET  /projects/:id/timeline                                 → TimelineEntry[]
 *   GET  /meetings/:id/changes                                  → StateChange[]
 *   POST /projects/:id/ask                AskRequest            → AskResponse
 *
 * Errors: any non-2xx body is `ErrorResponse`.
 */

import { z } from "zod";
import { Answer, EvidenceBundle } from "../answer.ts";
import { Meeting, ProcessingJob } from "../meeting.ts";
import { IsoDate } from "../primitives.ts";
import { NewProject } from "../project.ts";
import { Proposition } from "../proposition.ts";
import { TranscriptLine } from "../transcript.ts";

export const CreateProjectRequest = NewProject;
export type CreateProjectRequest = z.infer<typeof CreateProjectRequest>;

export const UploadMeetingRequest = z.object({
  title: z.string().min(1),
  heldAt: IsoDate,
  /** Raw transcript text in the `Speaker [HH:MM YYYY-MM-DD]: text` grammar. Participants are derived from it. */
  transcript: z.string().min(1),
});
export type UploadMeetingRequest = z.infer<typeof UploadMeetingRequest>;

export const UploadMeetingResponse = z.object({
  meeting: Meeting,
  job: ProcessingJob,
});
export type UploadMeetingResponse = z.infer<typeof UploadMeetingResponse>;

export const MeetingDetailResponse = z.object({
  meeting: Meeting,
  job: ProcessingJob.nullable(),
  lines: z.array(TranscriptLine),
  propositions: z.array(Proposition),
});
export type MeetingDetailResponse = z.infer<typeof MeetingDetailResponse>;

export const AskRequest = z.object({
  question: z.string().min(1),
});
export type AskRequest = z.infer<typeof AskRequest>;

export const AskResponse = z.object({
  answer: Answer,
  /** Every bundle the answer was allowed to cite, so the UI can expand any citation without a second call. */
  evidence: z.array(EvidenceBundle),
});
export type AskResponse = z.infer<typeof AskResponse>;

export const ErrorResponse = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;
