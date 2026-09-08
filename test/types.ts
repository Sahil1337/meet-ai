/**
 * Shared types for the evaluation harness: the proposition shape the model
 * returns, a transcript fixture, the harness config, and one run's outcome.
 */

import type { QwenProxyClient } from "../src/client.ts";
import type { Mode, ToolChoice } from "../src/shared/types.ts";

export type Proposition = {
  id: string;
  text: string;
  type: string;
  speaker: string | null;
  confidence: number;
  /** Optional: exact transcript span. When present it is checked verbatim. */
  evidence?: string;
};

export type Fixture = {
  name: string;
  transcript: string;
};

export type EvalConfig = {
  client: QwenProxyClient;
  /** Printed in the header, e.g. the proxy URL. */
  label: string;
  fixtures: Fixture[];
  systemPrompt: string;
  schema: Record<string, unknown>;
  /** Allowed proposition types, for the check that the model stayed inside the enum. */
  types: string[];
  mode: Mode;
  maxTokens?: number;
  /** Use the streaming endpoint instead of a single buffered response. */
  stream?: boolean;
  /**
   * 'required' (default): grammar-constrained, guaranteed-valid tool call every
   * turn, but the proxy also forces think:false on this path — thinking never
   * runs regardless of `mode`. 'auto': lets `mode`'s reasoning actually happen,
   * at the cost of tool-call parsing falling back to text extraction, and the
   * model may reply without calling any tool.
   */
  toolChoice?: ToolChoice;
  /** Pause after each transcript for a verdict. Only applies in a terminal. */
  manual: boolean;
  /** Ask the proxy for meetiq.upstream_requests and print them. */
  debug?: boolean;
  wrapWidth?: number;
};

export type Outcome = {
  name: string;
  status: "pass" | "warn" | "fail";
  count: number;
  verbatim: number;
  warnings: string[];
  error?: string;
  ms: number;
  verdict: string;
};
