/**
 * Shared types for the evaluation harness: the proposition shape the model
 * returns, a transcript fixture, the harness config, and one run's outcome.
 */

import type { QwenProxyClient } from "../src/client.ts";
import type { Mode, ToolChoice } from "../src/shared/types.ts";

export type Proposition = {
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
  /**
   * Transcript spoken before this window, oldest first — not sent to the
   * model as context, only searched by investigate_ambiguity (see
   * src/ambiguity-tool.ts) when a reference's antecedent fell in an earlier
   * chunk. Populated by fixturesFromMeeting(); absent for a standalone
   * fixture or the first chunk of a meeting.
   */
  precedingTranscript?: string;
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
  /**
   * Quiet mode: print only the transcript and the extracted propositions per
   * fixture — no system prompt/schema dump, no live streaming, no tool-call
   * trace, no raw response, no META/CHECKS. Everything is still computed
   * (warnings, pass/warn/fail) for the summary table at the end; only the
   * per-fixture printing is cut down. Errors still print regardless.
   */
  suppress?: boolean;
  /**
   * Write transcript.txt + claims.json to out/latest/ at the end of the run
   * (see saveRunOutput() in test-helpers.ts), for handing off to an agent to
   * review. Default true.
   */
  saveOutput?: boolean;
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
  /** The propositions themselves, so runEvaluation() can dump transcript+claims to disk after the run. */
  propositions: Proposition[];
};
