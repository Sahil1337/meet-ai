/**
 * The tool shape. One definition holds everything about a tool — name,
 * description, parameter schema, handler — so the proxy-facing JSON, the
 * argument validation and the handler's input type all come from the same
 * zod schema and cannot disagree.
 *
 * Two kinds, deliberately distinct:
 *
 * - A `ToolDefinition` is a normal tool: the model calls it, the handler runs,
 *   the result goes back to the model as a `role: "tool"` message, the
 *   conversation continues.
 * - A `TerminalTool` has no handler. It exists because this proxy cannot
 *   combine `response_format` with `tools`, so the structured *answer* is
 *   modelled as one more tool: calling it ends the loop and its arguments
 *   are the result. Nothing runs; the loop returns. Pretending it is a normal
 *   tool with a no-op handler would hide that the loop's exit condition
 *   lives here.
 */

import { z } from "zod";
import type { Tool } from "@meetai/proxy/types";
import type { ToolContext } from "./context.ts";

export interface ToolDefinition<Params extends z.ZodObject = z.ZodObject, Result = unknown> {
  readonly name: string;
  /** What the model reads to decide when to call it. Be concrete about when NOT to. */
  readonly description: string;
  /** Argument schema. Validated before `handler` runs; also the source of the proxy-facing JSON Schema. */
  readonly parameters: Params;
  /** Method syntax on purpose: it keeps a specific tool assignable to `ToolDefinition` without casts. */
  handler(args: z.output<Params>, ctx: ToolContext): Result | Promise<Result>;
}

export interface TerminalTool<Output extends z.ZodObject = z.ZodObject> {
  readonly name: string;
  readonly description: string;
  /** The output contract. The loop validates the model's final call against it. */
  readonly parameters: Output;
}

/** Identity with inference: lets `handler`'s `args` be typed from `parameters` at the definition site. */
export function defineTool<Params extends z.ZodObject, Result>(
  definition: ToolDefinition<Params, Result>,
): ToolDefinition<Params, Result> {
  return definition;
}

export function defineTerminalTool<Output extends z.ZodObject>(definition: TerminalTool<Output>): TerminalTool<Output> {
  return definition;
}

/**
 * The tool as the proxy (and the model) sees it, derived from the zod schema.
 * `io: "input"` and draft-7 give the same shape the schemas were hand-written
 * in before (`type: ["string", "null"]` for nullable, no
 * `additionalProperties`), which is what the proxy's grammar-constrained path
 * has been exercised with. `$schema` is dropped: it is noise in a tool
 * definition.
 */
export function toProxyTool(tool: { name: string; description: string; parameters: z.ZodObject }): Tool {
  const { $schema: _omit, ...parameters } = z.toJSONSchema(tool.parameters, { target: "draft-7", io: "input" });
  return {
    type: "function",
    function: { name: tool.name, description: tool.description, parameters },
  };
}
