/**
 * A set of tools the agent loop consumes as a whole. The loop never names a
 * tool: it asks the registry for the proxy-facing definitions and for a
 * handler map, and the registry is where arguments are validated and where
 * per-call bookkeeping happens. Adding a tool is adding a file under
 * src/tools/ and listing it in src/tools/index.ts; the loop does not change.
 *
 * The handler map is shaped for `QwenProxyClient.runToolsUntil`, which
 * already owns the other half of the job — appending each result as a
 * `role: "tool"` message and re-asking the model. That mapping lives in one
 * place (the proxy client) and is not duplicated here.
 */

import type { Tool, ToolCall } from "@meetai/proxy/types";
import type { ToolContext } from "./context.ts";
import { toProxyTool, type ToolDefinition } from "./define.ts";

export type ToolHandlers = Record<string, (args: Record<string, unknown>, call: ToolCall) => Promise<unknown>>;

export class ToolRegistry {
  readonly #tools = new Map<string, ToolDefinition>();

  constructor(tools: readonly ToolDefinition[]) {
    for (const tool of tools) {
      if (this.#tools.has(tool.name)) throw new Error(`duplicate tool name "${tool.name}"`);
      this.#tools.set(tool.name, tool);
    }
  }

  get names(): string[] {
    return [...this.#tools.keys()];
  }

  /** Every tool as the proxy sees it. */
  proxyTools(): Tool[] {
    return [...this.#tools.values()].map(toProxyTool);
  }

  /**
   * Handlers for `runToolsUntil`, closed over `ctx`. Arguments are validated
   * against the tool's schema first; a schema failure is *returned* to the
   * model as an error result (so it can correct the call on the next hop),
   * never thrown — a bad argument must not abort an extraction that has
   * already made progress. `onDispatch` fires once per call, valid or not.
   */
  handlers(ctx: ToolContext, onDispatch?: (name: string) => void): ToolHandlers {
    const handlers: ToolHandlers = {};
    for (const tool of this.#tools.values()) {
      handlers[tool.name] = async (raw) => {
        onDispatch?.(tool.name);
        const parsed = tool.parameters.safeParse(raw);
        if (!parsed.success) {
          return {
            error: `invalid arguments for ${tool.name}`,
            issues: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
          };
        }
        return tool.handler(parsed.data, ctx);
      };
    }
    return handlers;
  }
}
