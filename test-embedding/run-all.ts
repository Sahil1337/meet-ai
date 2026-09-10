// Runs every numbered script in order, one child process each.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const scripts = readdirSync(here)
  .filter((f) => /^\d\d-.*\.ts$/.test(f))
  .sort();

for (const s of scripts) {
  console.log(`\n${'='.repeat(70)}\n  ${s}\n${'='.repeat(70)}`);
  const r = spawnSync(process.execPath, [s], { stdio: 'inherit', cwd: here });
  if (r.status !== 0) {
    console.error(`\n${s} exited with ${r.status} — stopping.`);
    process.exit(r.status ?? 1);
  }
}
console.log('\nAll scripts finished.');
