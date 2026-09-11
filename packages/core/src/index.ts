/**
 * @meetai/core — the shared contracts of meetAI.
 *
 * Everything here is framework-free and storage-free: no HTTP, no SQL, no
 * model calls, no file system. The one dependency is zod, because a contract
 * that cannot be validated at a boundary is a suggestion. Schemas are the
 * source of truth; types are inferred from them and share their names.
 *
 * Rule: a type may live here only if it crosses a unit boundary. A unit's
 * private types stay in that unit.
 *
 * Read in this order — it is the spine, Source → Claim → Entity → State → Change:
 */

export * from "./primitives.ts"; // Id, IsoDate, ClockTime, IsoDateTime, Confidence
export * from "./project.ts"; // Project
export * from "./meeting.ts"; // Meeting (the source), ProcessingJob
export * from "./transcript.ts"; // TranscriptLine grammar + the one parser, TranscriptWindow
export * from "./proposition.ts"; // ExtractedProposition (model output), Proposition (persisted claim), Evidence
export * from "./entity.ts"; // Entity, Mention
export * from "./state.ts"; // EntityState, StateValue, Deadline
export * from "./change.ts"; // StateChange, ChangeKind, ChangeClassification
export * from "./views.ts"; // Commitment, TimelineEntry (read models)
export * from "./answer.ts"; // Answer, Citation, EvidenceBundle

// Interfaces between units. Who provides and who consumes is in each file's header.
export * from "./contracts/extraction.ts"; // ingestion → ai
export * from "./contracts/memory.ts"; // memory → api (and ingestion, for stores)
export * from "./contracts/retrieval.ts"; // retrieval → api
export * from "./contracts/answering.ts"; // ai → api
export * from "./contracts/api.ts"; // api → web
