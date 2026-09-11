/**
 * Contract for turning retrieved evidence into an answer. Provided by
 * `@meetai/ai` (it owns every prompt and every model call), consumed by the
 * API after it has run retrieval and hydrated the hits.
 *
 * The answerer gets evidence, not a database: it cannot go looking for more,
 * which is what keeps answers citable — every citation is one of the bundles
 * it was given.
 */

import type { Answer, EvidenceBundle } from "../answer.ts";

export interface Answerer {
  readonly version: string;
  answer(question: string, evidence: EvidenceBundle[], options?: { signal?: AbortSignal }): Promise<Answer>;
}
