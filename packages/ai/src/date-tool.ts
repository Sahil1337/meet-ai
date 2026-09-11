/**
 * resolve_date — the date tool for the extraction agent (see
 * extraction-agent.ts). Small models are bad at calendar arithmetic, so the
 * arithmetic lives here in plain JS and the model only decides *which*
 * expressions need resolving and when to call the tool.
 *
 * `resolveDate()` implements exactly the rules stated in rule 6 of the
 * system prompt (test/prompts.ts).
 */

import type { Tool } from "qwen-proxy/types";

const DAY = 86_400_000;
const NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export type Resolution =
  | { date: string; weekday: string; formatted: string; note?: string }
  | { error: string };

const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const dow = (t: number) => new Date(t).getUTCDay();
const weekdayOf = (t: number) => NAMES[dow(t)]!;
/** Monday 00:00 UTC of the week containing t (weeks run Monday–Sunday). */
const mondayOf = (t: number) => t - ((dow(t) + 6) % 7) * DAY;

function parseISO(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return iso(t) === value.trim() ? t : null; // rejects 2026-02-31
}

/**
 * Resolves one relative expression against the date of the transcript line it
 * was spoken on. Returns `{ error }` for anything genuinely vague ("soon",
 * "later this quarter") so the caller keeps the speaker's own wording.
 */
export function resolveDate(expression: string, referenceDate: string): Resolution {
  const ref = parseISO(referenceDate);
  if (ref === null) return { error: `reference_date "${referenceDate}" is not a YYYY-MM-DD date` };

  const at = (t: number, note?: string): Resolution => ({
    date: iso(t),
    weekday: weekdayOf(t),
    formatted: `${weekdayOf(t)}, ${iso(t)}`,
    ...(note ? { note } : {}),
  });

  const e = expression.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  if (!e) return { error: "empty expression" };

  if (/\bday after tomorrow\b/.test(e)) return at(ref + 2 * DAY);
  if (/\bday before yesterday\b/.test(e)) return at(ref - 2 * DAY);
  if (/\btomorrow\b/.test(e)) return at(ref + DAY);
  if (/\byesterday\b/.test(e)) return at(ref - DAY);
  if (/\b(today|tonight|this (morning|afternoon|evening)|end of day|eod)\b/.test(e)) return at(ref);

  const inN = /\bin (\d+|a|an|one|two|three|four|five|six) (day|week|month)s?\b/.exec(e);
  if (inN) {
    const words: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
    const n = words[inN[1]!] ?? Number(inN[1]);
    if (!Number.isFinite(n)) return { error: `cannot read the count in "${expression}"` };
    if (inN[2] === "day") return at(ref + n * DAY);
    if (inN[2] === "week") return at(ref + n * 7 * DAY);
    const d = new Date(ref);
    return at(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate()), "month arithmetic clamps to the same day-of-month");
  }

  // Weekday names first, so "next Monday" is not eaten by the "next week" rule.
  const wd = NAMES.findIndex((n) => new RegExp(`\\b${n.toLowerCase()}\\b`).test(e));
  if (wd >= 0) {
    const monday = mondayOf(ref);
    const offset = (wd + 6) % 7; // Monday = 0 … Sunday = 6
    // "coming"/"upcoming" means the next occurrence even when paired with "this"
    // ("this coming Friday"), so check it before the "this" branch.
    const coming = /\b(coming|upcoming)\b/.test(e);
    if (/\bnext\b/.test(e)) return at(monday + 7 * DAY + offset * DAY, "the occurrence in the week after the line's week");
    if (/\b(last|previous)\b/.test(e)) {
      const inWeek = monday + offset * DAY;
      return at(inWeek < ref ? inWeek : inWeek - 7 * DAY, "the most recent occurrence before the line's date");
    }
    if (/\bthis\b/.test(e) && !coming) return at(monday + offset * DAY, "the occurrence in the line's own week");
    const ahead = ((wd - dow(ref) + 7) % 7) || 7;
    return at(ref + ahead * DAY, "next occurrence strictly after the line's date");
  }

  if (/\bend of next week\b/.test(e)) return at(mondayOf(ref) + 11 * DAY, "Friday of the week after the line's week");
  if (/\bend of (the |this )?week\b/.test(e)) return at(mondayOf(ref) + 4 * DAY, "Friday of the line's week");
  if (/\bnext week\b/.test(e)) return at(mondayOf(ref) + 7 * DAY, "start of that week; keep the phrase 'the week of' in the proposition");
  if (/\b(this|current) week\b/.test(e)) return at(mondayOf(ref), "start of that week; keep the phrase 'the week of' in the proposition");

  return { error: `"${expression}" is not a determinable date; keep the speaker's original wording` };
}

// The tool as the model sees it

export const RESOLVE_DATE_TOOL: Tool = {
  type: "function",
  function: {
    name: "resolve_date",
    description:
      "Convert a relative day expression from a transcript line into an absolute calendar date. " +
      "Use it for every relative expression: 'Friday', 'next Monday', 'tomorrow', 'end of this week', 'in two weeks'. " +
      "Never do the calendar arithmetic yourself.",
    parameters: {
      type: "object",
      properties: {
        reference_date: {
          type: "string",
          description: "The YYYY-MM-DD stamp on the transcript line the expression was spoken on.",
        },
        expression: {
          type: "string",
          description: "The relative expression exactly as spoken, e.g. \"next Monday\" or \"by Friday\".",
        },
      },
      required: ["reference_date", "expression"],
    },
  },
};

/** Handler for RESOLVE_DATE_TOOL; wire it into QwenProxyClient.runToolsUntil. */
export function resolveDateHandler(args: Record<string, unknown>): Resolution & { expression: string; reference_date: string } {
  const expression = String(args.expression ?? "");
  const reference_date = String(args.reference_date ?? "");
  return { expression, reference_date, ...resolveDate(expression, reference_date) };
}
