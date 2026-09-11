/**
 * Runtime configuration for the API process, read from that app's own
 * `.env` — never a shared root one: the proxy runs on a different machine
 * from the API, and a shared env file would be a lie.
 *
 * Not implemented. The shape is the contract between deployment (who sets
 * the values) and the composition root (who reads them). Validate with zod
 * when implementing; fail fast at startup on a bad value.
 */

export type Config = {
  /** Where the API listens. */
  port: number;
  /** qwen-proxy, e.g. https://ai.sahil1337.com or http://nitro.lan:8000. */
  proxyBaseUrl: string;
  proxyApiKey: string | undefined;
  /** The embedding service (runs on the Mac in the prototype, not on the GPU laptop). */
  embedderBaseUrl: string;
  /** Extraction window target in seconds; see windows.ts. */
  windowSeconds: number;
};

export function loadConfig(_env: Record<string, string | undefined> = process.env): Config {
  throw new Error("not implemented: @meetai/ingestion loadConfig");
}
