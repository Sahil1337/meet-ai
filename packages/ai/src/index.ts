/**
 * @meetai/ai — the AI extraction unit: everything that talks to the model.
 *
 * Callers (the API, the evals) come through this entrypoint. Prompts are a
 * separate entrypoint (`@meetai/ai/prompts`) because they are data.
 */

// Extraction: window → propositions
export { extractPropositions, createExtractor, EXTRACTOR_VERSION } from "./extraction.ts";
export type { ExtractOptions, ExtractionTrace } from "./extraction.ts";

// Answering: evidence → answer (stub)
export { createAnswerer, ANSWERER_VERSION } from "./answering.ts";

// The tool layer, for evals that build their own registries and for new tools
export { defineTool, defineTerminalTool, toProxyTool } from "./tools/define.ts";
export type { ToolDefinition, TerminalTool } from "./tools/define.ts";
export { ToolRegistry } from "./tools/registry.ts";
export type { ToolHandlers } from "./tools/registry.ts";
export type { ToolContext } from "./tools/context.ts";
export { extractionTools, resolveDateTool, investigateAmbiguityTool, submitPropositionsTool } from "./tools/index.ts";
