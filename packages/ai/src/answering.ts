/**
 * Question + retrieved evidence → answer with citations. The second job of
 * this package (the first is extraction), and the only place answer prose is
 * generated: the API runs retrieval, hydrates the hits, and hands the bundles
 * here.
 *
 * Not implemented yet. Shape decided; prompt and citation-checking are the
 * extraction owner's work after extraction quality is stable. Two things the
 * implementation must do, from the product spec: refuse to cite anything not
 * in `evidence` (§35, no-evidence policy) and label the answer's basis —
 * fact / inference / estimate / unknown (§30).
 */

import type { Answerer } from "@meetai/core";
import type { QwenProxyClient } from "qwen-proxy/client";

export const ANSWERER_VERSION = "qwen3.5-4b/answering-v0";

export function createAnswerer(_client: QwenProxyClient): Answerer {
  return {
    version: ANSWERER_VERSION,
    answer() {
      throw new Error("not implemented: @meetai/ai answering");
    },
  };
}
