/**
 * Contracts provided by the database/memory unit (`@meetai/memory`) and
 * consumed by the API. Two layers, kept apart on purpose:
 *
 * - The *stores* are plain persistence: put a record in, get it back. No
 *   intelligence. Ingestion writes meetings and jobs through them; everyone
 *   reads through them. An in-memory implementation is enough to run the
 *   whole pipeline end to end before a database is chosen — which is why
 *   these are interfaces and not a schema file.
 * - `ProjectMemory` is the intelligence: entity resolution, state derivation,
 *   change and contradiction detection. It reads propositions and writes
 *   entities, states and changes. `MemoryQueries` are the read models built
 *   on top.
 *
 * Nothing here names a database. That decision is deferred; these interfaces
 * are what lets it be deferred.
 */

import { z } from "zod";
import { Entity, Mention } from "../entity.ts";
import { Meeting, NewMeeting, ProcessingJob } from "../meeting.ts";
import { Id, IsoDateTime } from "../primitives.ts";
import { NewProject, Project } from "../project.ts";
import { NewProposition, Proposition } from "../proposition.ts";
import { EntityState } from "../state.ts";
import { StateChange } from "../change.ts";
import { TranscriptLine } from "../transcript.ts";
import { Commitment, TimelineEntry } from "../views.ts";

// --- Stores ----------------------------------------------------------------

export interface ProjectStore {
  create(input: NewProject): Promise<Project>;
  get(id: Id): Promise<Project | null>;
  list(): Promise<Project[]>;
}

export interface MeetingStore {
  /** Persists the meeting and its transcript together; `lineCount` is derived from `lines`. */
  create(input: NewMeeting, lines: TranscriptLine[]): Promise<Meeting>;
  get(id: Id): Promise<Meeting | null>;
  listByProject(projectId: Id): Promise<Meeting[]>;
  getTranscript(meetingId: Id): Promise<TranscriptLine[]>;
  /** Evidence hydration: the named lines only, in index order. */
  getLines(meetingId: Id, indexes: number[]): Promise<TranscriptLine[]>;
}

export const JobPatch = ProcessingJob.pick({ status: true, stage: true, error: true, attempts: true }).partial();
export type JobPatch = z.infer<typeof JobPatch>;

export interface JobStore {
  create(meetingId: Id): Promise<ProcessingJob>;
  get(id: Id): Promise<ProcessingJob | null>;
  getByMeeting(meetingId: Id): Promise<ProcessingJob | null>;
  update(id: Id, patch: JobPatch): Promise<ProcessingJob>;
}

export interface PropositionStore {
  /** Assigns ids. Must be idempotent per (meetingId, windowIndex) so a retried job does not duplicate claims (spec §50). */
  saveMany(input: NewProposition[]): Promise<Proposition[]>;
  getMany(ids: Id[]): Promise<Proposition[]>;
  listByMeeting(meetingId: Id): Promise<Proposition[]>;
  listByProject(projectId: Id): Promise<Proposition[]>;
}

// --- Memory ----------------------------------------------------------------

/** Everything one meeting's processing added to memory. Returned so the caller can log, index, and notify. */
export const MemoryUpdate = z.object({
  entities: z.array(Entity),
  mentions: z.array(Mention),
  states: z.array(EntityState),
  changes: z.array(StateChange),
});
export type MemoryUpdate = z.infer<typeof MemoryUpdate>;

export interface ProjectMemory {
  /**
   * Folds one meeting's propositions into project memory, in transcript
   * order: resolve entities, derive state records, compare with what was
   * current before, emit changes. Must be idempotent per meeting so a
   * retried job cannot produce duplicate states or changes.
   */
  ingest(meetingId: Id, propositions: Proposition[]): Promise<MemoryUpdate>;
}

export interface MemoryQueries {
  commitments(projectId: Id): Promise<Commitment[]>;
  timeline(projectId: Id, range?: { from?: IsoDateTime; to?: IsoDateTime }): Promise<TimelineEntry[]>;
  /** Changes produced by processing one meeting: the "what changed?" view (spec §39). */
  changes(meetingId: Id): Promise<StateChange[]>;
  entities(projectId: Id, kind?: Entity["kind"]): Promise<Entity[]>;
  /** The current (validTo = null) state record for every aspect of one entity. */
  currentState(entityId: Id): Promise<EntityState[]>;
  /** Full history of one entity, oldest first, for the "why did this change?" view. */
  stateHistory(entityId: Id): Promise<EntityState[]>;
}
