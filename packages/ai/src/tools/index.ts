/**
 * The extraction agent's tool set. To add a tool: create one file next to
 * these with a `defineTool(...)` export, and add it to the list below.
 * Nothing in src/extraction.ts changes.
 */

import { investigateAmbiguityTool } from "./investigate-ambiguity.ts";
import { ToolRegistry } from "./registry.ts";
import { resolveDateTool } from "./resolve-date.ts";

export { resolveDateTool } from "./resolve-date.ts";
export { investigateAmbiguityTool } from "./investigate-ambiguity.ts";
export { submitPropositionsTool } from "./submit-propositions.ts";

/** The default registry for extraction. Evals may build their own to A/B a tool. */
export const extractionTools = new ToolRegistry([resolveDateTool, investigateAmbiguityTool]);
