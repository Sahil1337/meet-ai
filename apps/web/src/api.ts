/**
 * The frontend's only door to the backend: one function per endpoint in
 * @meetai/core/src/contracts/api.ts, typed against the contract. Everything
 * else in this app is UI over these calls. Never call the model proxy from
 * here.
 *
 * Stubs. Implement with `fetch` against `import.meta.env.VITE_API_URL` once
 * the Vite app is scaffolded (see README).
 */

import type {
  AskRequest,
  AskResponse,
  Commitment,
  CreateProjectRequest,
  Id,
  MeetingDetailResponse,
  ProcessingJob,
  Project,
  StateChange,
  TimelineEntry,
  UploadMeetingRequest,
  UploadMeetingResponse,
} from "@meetai/core";

const notImplemented = (what: string) => new Error(`not implemented: apps/web api.${what}`);

export async function createProject(_body: CreateProjectRequest): Promise<Project> {
  throw notImplemented("createProject");
}
export async function getProject(_id: Id): Promise<Project> {
  throw notImplemented("getProject");
}
export async function uploadMeeting(_projectId: Id, _body: UploadMeetingRequest): Promise<UploadMeetingResponse> {
  throw notImplemented("uploadMeeting");
}
export async function getMeeting(_id: Id): Promise<MeetingDetailResponse> {
  throw notImplemented("getMeeting");
}
export async function getJob(_id: Id): Promise<ProcessingJob> {
  throw notImplemented("getJob");
}
export async function listCommitments(_projectId: Id): Promise<Commitment[]> {
  throw notImplemented("listCommitments");
}
export async function getTimeline(_projectId: Id): Promise<TimelineEntry[]> {
  throw notImplemented("getTimeline");
}
export async function getChanges(_meetingId: Id): Promise<StateChange[]> {
  throw notImplemented("getChanges");
}
export async function ask(_projectId: Id, _body: AskRequest): Promise<AskResponse> {
  throw notImplemented("ask");
}
