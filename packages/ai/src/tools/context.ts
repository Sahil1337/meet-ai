/**
 * What a tool handler may reach for. Built once per extraction by
 * src/extraction.ts and passed to every handler; tools never construct
 * clients or hold state of their own.
 */

import type { TranscriptLine } from "@meetai/core";
import type { QwenProxyClient } from "qwen-proxy/client";
import type { Mode } from "qwen-proxy/types";

export type ToolContext = {
  /** For tools that make their own isolated model call. */
  client: QwenProxyClient;
  /** Everything the model could legitimately look back through: the preceding lines plus the current window, in order. */
  transcript: TranscriptLine[];
  /** Mode for side calls a tool makes. Defaults to `fast`: bounded lookups, not reasoning. */
  resolverMode: Mode;
};
