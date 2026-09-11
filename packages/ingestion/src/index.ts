/**
 * @meetai/ingestion — transcript intake, windowing, and the processing job.
 * Parsing itself lives in @meetai/core (it is the input contract); this
 * package decides how parsed lines are cut up and in what order the other
 * units run.
 */

export { windowBySpeakingTime } from "./windows.ts";
export type { WindowOptions } from "./windows.ts";
export { processMeeting } from "./pipeline.ts";
export type { PipelineDeps } from "./pipeline.ts";
export { loadConfig } from "./config.ts";
export type { Config } from "./config.ts";
