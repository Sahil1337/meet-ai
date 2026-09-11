/** JSON helpers for reading output the model wrote by hand. */

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export function parseJsonLenient(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return repairJson(text);
  }
}

/** One best-effort repair pass: code fences, trailing commas, Python literals, single quotes. */
export function repairJson(text: string): unknown {
  let t = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  t = t.replace(/,\s*([}\]])/g, '$1');
  t = t.replace(/\b(True|False|None)\b/g, (m) => ({ True: 'true', False: 'false', None: 'null' })[m] ?? m);
  try {
    return JSON.parse(t);
  } catch {
    // Fall through to quote repair.
  }
  const requoted = t.includes('"')
    ? t.replace(/'((?:[^'\\]|\\.)*)'/g, (_, s: string) => `"${s.replace(/"/g, '\\"')}"`)
    : t.replace(/'/g, '"');
  return JSON.parse(requoted);
}
