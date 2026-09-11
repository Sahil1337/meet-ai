/**
 * Harness types: a fixture, the run configuration, one run's outcome. The
 * proposition and request shapes are domain, not harness, and come from
 * @meetai/core.
 */

import type { ExtractedProposition, ExtractionRequest } from "@meetai/core";
import type { QwenProxyClient } from "qwen-proxy/client";
import type { Mode, ToolChoice } from "qwen-proxy/types";

export type Fixture = {
  name: string;
  /** Exactly what production would hand the extractor for this window. */
  request: ExtractionRequest;
};

export type EvalConfig = {
  client: QwenProxyClient;
  /** Printed in the header, e.g. the proxy URL. */
  label: string;
  fixtures: Fixture[];
  systemPrompt: string;
  mode: Mode;
  /** Use the streaming endpoint; only visible when `suppress` is off. */
  stream: boolean;
  /**
   * `required`: grammar-constrained, guaranteed-valid tool call every turn,
   * but the proxy forces think:false on that path. `auto`: `mode`'s reasoning
   * actually runs, tool calls are parsed from text, and the model may answer
   * in prose instead — which fails the fixture with `no_tool_call`.
   */
  toolChoice: ToolChoice;
  /** Pause after each window for a verdict. Only applies in a terminal. */
  manual: boolean;
  /** Print only the transcript and the propositions per window; checks still run for the summary. */
  suppress: boolean;
  /** Write out/latest/{transcript.txt,claims.json} as the run progresses. */
  saveOutput: boolean;
};

export type Verdict = "-" | "pass" | "FAIL";

export type Outcome = {
  name: string;
  status: "pass" | "warn" | "fail";
  count: number;
  warnings: string[];
  error?: string;
  ms: number;
  verdict: Verdict;
  propositions: ExtractedProposition[];
};
