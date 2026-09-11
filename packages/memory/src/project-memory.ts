/**
 * The intelligence of the memory unit: propositions → entities, states,
 * changes. Three steps per meeting, in transcript order (product spec §32
 * steps 5–7):
 *
 * 1. Entity resolution — match each proposition's speaker/subject to an
 *    existing Entity or create one. Conservative: when unsure, do not merge.
 * 2. State derivation — a commitment proposition yields owner + deadline +
 *    status states on the task entity; a decision proposition yields a
 *    `decided` state on a decision entity; a blocker proposition yields
 *    `blocked_by`. Each state carries `sourcePropositionId`.
 * 3. Change detection — for each new state, find the current state of the
 *    same aspect on the same entity; if it differs, close the old one
 *    (`validTo`), link the new one (`supersedes`), and emit a `StateChange`
 *    with a kind (§11) and a classification (§12). Contradictions and
 *    anything `unclear` are flagged `needsReview`, never silently applied.
 *
 * Deterministic where possible. If a step needs the model (e.g. deciding
 * whether two decisions contradict), that call goes through an `Answerer`-
 * like interface from @meetai/ai, not a prompt written here.
 *
 * Stub.
 */

import type { Id, MemoryUpdate, ProjectMemory, Proposition } from "@meetai/core";

export class InMemoryProjectMemory implements ProjectMemory {
  ingest(_meetingId: Id, _propositions: Proposition[]): Promise<MemoryUpdate> {
    throw new Error("not implemented: @meetai/memory ProjectMemory.ingest");
  }
}
