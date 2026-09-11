// Tiny .env loader — avoids pulling in dotenv for a scratch test folder.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export function loadEnv(): void {
  for (const file of [join(here, '..', '.env'), join(here, '..', '..', '.env')]) {
    if (!existsSync(file)) continue;
    for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (/^(['"]).*\1$/s.test(value)) value = value.slice(1, -1);
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

export function requireApiKey(): string {
  loadEnv();
  const key = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!key) {
    console.error(
      'Missing API key. Put GOOGLE_API_KEY=... in test-embedding/.env\n' +
        '(copy .env.example), or export it in the shell first.',
    );
    process.exit(1);
  }
  return key;
}
