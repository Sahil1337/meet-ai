/**
 * The retrieval eval's configuration, validated once at startup — same shape
 * as the propositions eval, so the two feel like one tool.
 */

import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export function loadEvalEnv(runtimeEnv: Record<string, string | undefined> = process.env) {
  return createEnv({
    server: {
      /** Required: embedding runs against a hosted API until the local service exists. */
      GEMINI_API_KEY: z.string().min(1),
      EMBED_MODEL: z.string().min(1).default("gemini-embedding-001"),
      /** 768 was the measured sweet spot — a quarter of 3072's storage, same separation. */
      EMBED_DIMENSIONS: z.coerce.number().int().positive().default(768),

      /** Extracted claims to index. Defaults to the checked-in kickoff set. */
      EVAL_CLAIMS: z.string().min(1).optional(),
      /**
       * Required: the eval indexes into a real Postgres with pgvector, the same
       * one a local API run uses. There is no embedded fallback — a run that
       * quietly built its own throwaway index would report numbers nobody else
       * can reproduce.
       */
      DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, "expected a postgres:// URL"),
      /** Re-embed even if the cached index already holds the claims. Also the way past a model or width change. */
      EVAL_REINDEX: z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1").default(false),
      /** Which search legs to run: one of them, or `all` for a comparison table. */
      EVAL_MODE: z.enum(["vector", "keyword", "hybrid", "all"]).default("all"),

      EVAL_TOP_K: z.coerce.number().int().positive().default(5),
      /**
       * Cosine floor, applied in every mode. Out-of-domain queries are graded
       * on whether *nothing* clears this, so it is the knob that decides "the
       * corpus cannot answer that" versus a confident wrong answer.
       */
      EVAL_MIN_SCORE: z.coerce.number().default(0.65),
    },
    runtimeEnv,
    emptyStringAsUndefined: true,
  });
}
