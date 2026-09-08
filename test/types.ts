/**
 * Shared types for the evaluation harness: the proposition shape the model
 * returns, a transcript fixture, the harness config, and one run's outcome.
 */

import type { QwenProxyClient } from "../src/client.ts";
import type { Mode } from "../src/shared/types.ts";

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
  /** Use the streaming endpoint (extractStream) instead of a single buffered response. */
  stream?: boolean;
  /**
   * How relative dates ("Friday") become absolute before extraction.
   * "tool":  a pre-pass in which the model calls resolve_date per expression; anything it misses is filled in by the local scan.
   * "local": the same arithmetic run directly over the transcript, no extra model call.
   * "off":   nothing is pre-resolved; the model works dates out itself from rule 6.
   * A schema-constrained response cannot also emit tool calls, so the tool cannot run inside the extraction call itself.
   */
  dateResolution?: "tool" | "local" | "off";
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
