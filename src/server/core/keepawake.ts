import { readdirSync, readFileSync } from 'node:fs';
import type { Config } from '../config.js';
import { baseOptions } from './mapping.js';
import type { OllamaClient } from './ollama.js';
import type { RequestQueue } from './queue.js';
import type { Logger } from '../util/logger.js';

/**
 * Laptop NVIDIA GPUs with runtime D3 power management suspend within a
 * second of going idle. Once the GPU has been suspended for a few seconds
 * with the model resident, every following generation runs at roughly half
 * speed until the model is reloaded (measured: 41 -> 19.6 tok/s on an RTX
 * 3050). Touching the GPU with a one-token generation every few seconds
 * keeps it active. The permanent fix is to disable runtime PM for the GPU;
 * see README "Laptop GPUs".
 */
const NVIDIA_POWER_DIR = '/proc/driver/nvidia/gpus';

function nvidiaRuntimePmEnabled(): boolean {
  try {
    return readdirSync(NVIDIA_POWER_DIR).some((gpu) =>
      /Runtime D3 status:\s+Enabled/.test(readFileSync(`${NVIDIA_POWER_DIR}/${gpu}/power`, 'utf8')),
    );
  } catch {
    return false;
  }
}

export function startKeepAwake(client: OllamaClient, config: Config, queue: RequestQueue, log: Logger): () => void {
  const enabled = config.GPU_KEEP_AWAKE === 'true' || (config.GPU_KEEP_AWAKE === 'auto' && nvidiaRuntimePmEnabled());
  if (!enabled) return () => undefined;

  log.warn(
    { interval_ms: config.GPU_KEEP_AWAKE_MS },
    'GPU runtime power management is enabled; touching the GPU periodically so generation does not drop to half speed after idling. Disable runtime PM for the GPU to avoid this (README: Laptop GPUs) or set GPU_KEEP_AWAKE=false',
  );
  let busy = false;
  const timer = setInterval(async () => {
    if (busy || queue.running > 0 || queue.waiting > 0) return;
    busy = true;
    try {
      await client.touch(
        config.MODEL,
        baseOptions(config),
        config.KEEP_ALIVE,
        AbortSignal.timeout(config.GPU_KEEP_AWAKE_MS),
      );
    } catch (err) {
      log.debug({ err }, 'keep-awake touch failed');
    } finally {
      busy = false;
    }
  }, config.GPU_KEEP_AWAKE_MS);
  timer.unref();
  return () => clearInterval(timer);
}
