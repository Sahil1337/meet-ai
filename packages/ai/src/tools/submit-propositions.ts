/**
 * submit_propositions — the terminal tool. Calling it is the model's way of
 * saying "I'm done, here is the structured result", and its arguments *are*
 * the extraction output.
 *
 * It is a tool only because the proxy cannot combine `response_format` with
 * `tools`. There is no handler: nothing runs when it is called, the loop
 * returns. Its parameter schema is derived from `ExtractedProposition` in
 * @meetai/core, so the shape the model is constrained to and the shape the
 * rest of the system consumes are the same object.
 */

import { z } from "zod";
import { ExtractedProposition } from "@meetai/core";
import { defineTerminalTool } from "./define.ts";

export const submitPropositionsTool = defineTerminalTool({
  name: "submit_propositions",
  description:
    "Submit the final list of extracted propositions. Call this exactly once, after every relative date has been resolved with resolve_date, to end the conversation. An empty array is a valid result when the transcript carries no substantive project information.",
  parameters: z.object({
    propositions: z.array(ExtractedProposition),
  }),
});
