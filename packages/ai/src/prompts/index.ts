/**
 * Prompts are a separate entrypoint (`@meetai/ai/prompts`) because they are
 * data, not behaviour — the evals swap them per run. Every prompt this
 * package sends to the model is exported from here; there are no inline
 * prompt strings elsewhere.
 */

export { EXTRACTION_PROMPT } from "./extraction.ts";
export { RESOLVER_PROMPT } from "./resolver.ts";
