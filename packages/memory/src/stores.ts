/**
 * Persistence. Four small stores, each an interface from @meetai/core, each
 * implemented once per backend. The first backend to write is `InMemory*`
 * (plain Maps): it lets the API and the pipeline run end to end today and
 * doubles as the reference the database-backed versions are tested against.
 *
 * Stubs. Method bodies throw until implemented.
 */

import type {
  Id,
  JobPatch,
  JobStore,
  Meeting,
  MeetingStore,
  NewMeeting,
  NewProject,
  NewProposition,
  ProcessingJob,
  Project,
  ProjectStore,
  Proposition,
  PropositionStore,
  TranscriptLine,
} from "@meetai/core";

const notImplemented = (what: string) => new Error(`not implemented: @meetai/memory ${what}`);

export class InMemoryProjectStore implements ProjectStore {
  create(_input: NewProject): Promise<Project> {
    throw notImplemented("ProjectStore.create");
  }
  get(_id: Id): Promise<Project | null> {
    throw notImplemented("ProjectStore.get");
  }
  list(): Promise<Project[]> {
    throw notImplemented("ProjectStore.list");
  }
}

export class InMemoryMeetingStore implements MeetingStore {
  create(_input: NewMeeting, _lines: TranscriptLine[]): Promise<Meeting> {
    throw notImplemented("MeetingStore.create");
  }
  get(_id: Id): Promise<Meeting | null> {
    throw notImplemented("MeetingStore.get");
  }
  listByProject(_projectId: Id): Promise<Meeting[]> {
    throw notImplemented("MeetingStore.listByProject");
  }
  getTranscript(_meetingId: Id): Promise<TranscriptLine[]> {
    throw notImplemented("MeetingStore.getTranscript");
  }
  getLines(_meetingId: Id, _indexes: number[]): Promise<TranscriptLine[]> {
    throw notImplemented("MeetingStore.getLines");
  }
}

export class InMemoryJobStore implements JobStore {
  create(_meetingId: Id): Promise<ProcessingJob> {
    throw notImplemented("JobStore.create");
  }
  get(_id: Id): Promise<ProcessingJob | null> {
    throw notImplemented("JobStore.get");
  }
  getByMeeting(_meetingId: Id): Promise<ProcessingJob | null> {
    throw notImplemented("JobStore.getByMeeting");
  }
  update(_id: Id, _patch: JobPatch): Promise<ProcessingJob> {
    throw notImplemented("JobStore.update");
  }
}

export class InMemoryPropositionStore implements PropositionStore {
  saveMany(_input: NewProposition[]): Promise<Proposition[]> {
    throw notImplemented("PropositionStore.saveMany");
  }
  getMany(_ids: Id[]): Promise<Proposition[]> {
    throw notImplemented("PropositionStore.getMany");
  }
  listByMeeting(_meetingId: Id): Promise<Proposition[]> {
    throw notImplemented("PropositionStore.listByMeeting");
  }
  listByProject(_projectId: Id): Promise<Proposition[]> {
    throw notImplemented("PropositionStore.listByProject");
  }
}
