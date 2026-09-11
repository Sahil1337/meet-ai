/**
 * Read models over entities, states and changes: the commitment ledger, the
 * timeline, "what changed in this meeting". Whether these are computed per
 * request or materialized is this package's call; callers only see the
 * `MemoryQueries` interface.
 *
 * Stub.
 */

import type {
  Commitment,
  Entity,
  EntityState,
  Id,
  IsoDateTime,
  MemoryQueries,
  StateChange,
  TimelineEntry,
} from "@meetai/core";

const notImplemented = (what: string) => new Error(`not implemented: @meetai/memory MemoryQueries.${what}`);

export class InMemoryMemoryQueries implements MemoryQueries {
  commitments(_projectId: Id): Promise<Commitment[]> {
    throw notImplemented("commitments");
  }
  timeline(_projectId: Id, _range?: { from?: IsoDateTime; to?: IsoDateTime }): Promise<TimelineEntry[]> {
    throw notImplemented("timeline");
  }
  changes(_meetingId: Id): Promise<StateChange[]> {
    throw notImplemented("changes");
  }
  entities(_projectId: Id, _kind?: Entity["kind"]): Promise<Entity[]> {
    throw notImplemented("entities");
  }
  currentState(_entityId: Id): Promise<EntityState[]> {
    throw notImplemented("currentState");
  }
  stateHistory(_entityId: Id): Promise<EntityState[]> {
    throw notImplemented("stateHistory");
  }
}
