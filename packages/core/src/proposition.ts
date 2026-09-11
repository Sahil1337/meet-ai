/**
 * A proposition: one atomic, self-contained claim lifted out of a transcript.
 * This is the unit the whole system is built on — memory stores propositions,
 * change detection diffs them, retrieval ranks them, and the reasoning layer
 * cites them. Extraction produces them (`@meetai/ai`), so the shape lives here
 * rather than in the extractor: the API, the database, and the evals all need
 * it, and none of them should depend on the extractor to get it.
 */
export type Proposition = {
  text: string;
  type: string;
  speaker: string | null;
  confidence: number;
  /** Optional: exact transcript span. When present it is checked verbatim. */
  evidence?: string;
};
