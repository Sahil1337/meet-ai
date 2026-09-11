/**
 * The meeting-processing job: the one place the units are called in order.
 *
 *   parse → window → extract (per window) → persist → memory → index
 *
 * Each step is a `JobStage`; the job record is updated as each begins, so a
 * failure says where it failed and a retry can resume. Every step it calls
 * must be idempotent per meeting (the stores and ProjectMemory promise this)
 * so a retry never duplicates claims, states or changes.
 *
 * Not implemented. The signature is the contract: it takes the collaborators
 * as an object (so the API's composition root can pass in-memory stores while
 * the database is undecided) and returns nothing — progress is observable
 * through the job record.
 */

import type {
  Extractor,
  Id,
  Indexer,
  JobStore,
  MeetingStore,
  ProjectMemory,
  PropositionStore,
} from "@meetai/core";

export type PipelineDeps = {
  meetings: MeetingStore;
  jobs: JobStore;
  propositions: PropositionStore;
  extractor: Extractor;
  memory: ProjectMemory;
  indexer: Indexer;
  /** Window sizing; see windows.ts for why the default is 150 s. */
  windowSeconds?: number;
};

export async function processMeeting(_deps: PipelineDeps, _jobId: Id): Promise<void> {
  throw new Error("not implemented: @meetai/ingestion processMeeting");
}
