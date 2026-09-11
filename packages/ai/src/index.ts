/**
 * The AI service layer: everything that turns transcripts into structured
 * memory. Callers (the API, the evals) come through this entrypoint rather
 * than reaching into individual modules, so the internal file layout stays
 * free to change.
 *
 * Prompts are a separate entrypoint (`@meetai/ai/prompts`) because they are
 * data, not behaviour — the evals swap them per run.
 */
export { extractPropositions, SUBMIT_PROPOSITIONS_TOOL_NAME } from "./extraction-agent.ts";
export { RESOLVE_DATE_TOOL, resolveDateHandler } from "./date-tool.ts";
export { INVESTIGATE_AMBIGUITY_TOOL, investigateAmbiguityHandler } from "./ambiguity-tool.ts";
