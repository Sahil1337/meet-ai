/**
 * resolve_date — the date tool for the extraction pipeline.
 *
 * Propositions are retrieved months after the meeting, so "Friday" has to
 * become "Friday, 2026-09-04" before it is embedded. Small models are bad at
 * calendar arithmetic, so the arithmetic lives here and the model only decides
 * *which* expressions need resolving.
 *
 * The extraction call constrains decoding to a JSON schema, and a constrained
 * response cannot also emit tool calls, so the tool runs as a pre-pass:
 *
 *   resolveDatesWithModel()  → model calls resolve_date per expression (chat + tools)
 *   scanTranscriptDates()    → same arithmetic, no model call, regex-driven
 *   formatDateContext()      → the block appended to the transcript message
 *
 * `resolveDate()` is the single source of truth for both paths, and implements
 * exactly the rules stated in rule 6 of the system prompt.
 */

import type { QwenProxyClient } from "./client.ts";
import type { Mode, Tool } from "./shared/types.ts";

// Date arithmetic

const DAY = 86_400_000;
const NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export type Resolution =
  | { date: string; weekday: string; formatted: string; note?: string }
  | { error: string };

/** One resolved expression, ready to print or feed back to the model. */
export type Resolved = {
  expression: string;
  reference_date: string;
  date: string;
  weekday: string;
  /** "Friday, 2026-09-04" — the form the proposition should use. */
  formatted: string;
  note?: string;
  source: "tool" | "local";
};

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
    if (/\bnext\b/.test(e)) return at(monday + 7 * DAY + offset * DAY, "the occurrence in the week after the line's week");
    if (/\b(last|previous)\b/.test(e)) {
      const inWeek = monday + offset * DAY;
      return at(inWeek < ref ? inWeek : inWeek - 7 * DAY, "the most recent occurrence before the line's date");
    }
    if (/\bthis\b/.test(e)) return at(monday + offset * DAY, "the occurrence in the line's own week");
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

/** Handler for RESOLVE_DATE_TOOL; wire it into QwenProxyClient.runTools. */
export function resolveDateHandler(args: Record<string, unknown>): Resolution & { expression: string; reference_date: string } {
  const expression = String(args.expression ?? "");
  const reference_date = String(args.reference_date ?? "");
  return { expression, reference_date, ...resolveDate(expression, reference_date) };
}

// Local pass: same arithmetic, no model call

const LINE = /^\s*(.+?)\s*\[(\d{2}:\d{2})\s+(\d{4}-\d{2}-\d{2})\]\s*:/;
const EXPRESSION =
  /\b(?:end of (?:the |this |next )?week|(?:next|last|this) week|(?:next|last|this) (?:mon|tues|wednes|thurs|fri|satur|sun)day|(?:mon|tues|wednes|thurs|fri|satur|sun)day|day after tomorrow|today|tonight|tomorrow|yesterday|in (?:\d+|a|an|one|two|three) (?:day|week|month)s?)\b/gi;

/** Every resolvable relative expression in the transcript, with its line's date. */
export function scanTranscriptDates(transcript: string): Resolved[] {
  const out: Resolved[] = [];
  const seen = new Set<string>();
  for (const line of transcript.split("\n")) {
    const stamp = LINE.exec(line);
    if (!stamp) continue;
    const reference_date = stamp[3]!;
    for (const match of line.slice(stamp[0].length).matchAll(EXPRESSION)) {
      const expression = match[0];
      const key = `${reference_date}|${expression.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const r = resolveDate(expression, reference_date);
      if ("error" in r) continue;
      out.push({ expression, reference_date, ...r, source: "local" });
    }
  }
  return out;
}

// Model pass: the model decides what needs resolving, the tool does the maths

const DATE_PASS_PROMPT = `You resolve relative day expressions in a meeting transcript. You do not extract or summarise anything.

Every line is stamped \`Speaker [HH:MM YYYY-MM-DD]: text\`.

For each relative day expression in the transcript — a weekday name ("Friday", "next Monday"), "today", "tonight", "tomorrow", "yesterday", "end of this week", "in two weeks" — call resolve_date once, with:

* reference_date: the YYYY-MM-DD stamp on the line the expression appears on
* expression: the words exactly as spoken

Call it once per distinct expression per line date; you may request several calls at a time. Never work the date out yourself.

When every expression has been resolved, reply with the single word DONE. If the transcript contains no relative day expression, reply DONE immediately.`;

/**
 * Runs the pre-pass: the model calls resolve_date for the expressions it finds,
 * and anything it missed is filled in by the local scan, so the extraction step
 * always gets a complete table.
 */
export async function resolveDatesWithModel(
  client: QwenProxyClient,
  transcript: string,
  options: { mode?: Mode; maxHops?: number } = {},
): Promise<{ resolved: Resolved[]; hops: number; calls: number; failed: string[] }> {
  const byKey = new Map<string, Resolved>();
  const failed: string[] = [];
  let calls = 0;

  const { hops } = await client.runTools(
    [
      { role: "system", content: DATE_PASS_PROMPT },
      { role: "user", content: transcript },
    ],
    [RESOLVE_DATE_TOOL],
    {
      resolve_date: (args) => {
        calls++;
        const result = resolveDateHandler(args);
        if ("error" in result) failed.push(`${result.expression || "?"} @ ${result.reference_date || "?"}: ${result.error}`);
        else byKey.set(`${result.reference_date}|${result.expression.toLowerCase()}`, { ...result, source: "tool" });
        return result;
      },
    },
    { mode: options.mode ?? "fast", temperature: 0, maxHops: options.maxHops ?? 4 },
  );

  for (const local of scanTranscriptDates(transcript)) {
    const key = `${local.reference_date}|${local.expression.toLowerCase()}`;
    if (!byKey.has(key)) byKey.set(key, local);
  }
  const resolved = [...byKey.values()].sort((a, b) =>
    a.reference_date === b.reference_date ? a.date.localeCompare(b.date) : a.reference_date.localeCompare(b.reference_date),
  );
  return { resolved, hops, calls, failed };
}

// The block handed to the extraction call

/** Empty string when nothing was resolved, so the caller can append it blindly. */
export function formatDateContext(resolved: Resolved[]): string {
  if (resolved.length === 0) return "";
  const lines: string[] = [
    "## DATE CONTEXT",
    "",
    "Already resolved with the resolve_date tool. Use these dates verbatim; do not recompute them.",
    "",
  ];
  let currentRef = "";
  for (const r of resolved) {
    if (r.reference_date !== currentRef) {
      currentRef = r.reference_date;
      const ref = parseISO(currentRef)!;
      lines.push(`Lines dated ${currentRef} (${weekdayOf(ref)}):`);
    }
    const alt = r.source === "local" || r.note?.startsWith("next occurrence")
      ? resolveDate(`next ${r.weekday}`, r.reference_date)
      : { error: "" };
    const later = !("error" in alt) && alt.date !== r.date && r.note?.startsWith("next occurrence")
      ? `; if the context means the following week: ${alt.formatted}`
      : "";
    lines.push(`  "${r.expression}" → ${r.formatted}${r.note ? `  (${r.note}${later})` : ""}`);
  }
  return lines.join("\n");
}

/** Appended to the system prompt whenever a DATE CONTEXT block is sent. */
export const DATE_CONTEXT_NOTE = `## DATE CONTEXT BLOCK

The user message ends with a DATE CONTEXT block: relative day expressions from the transcript, already resolved to absolute dates by the resolve_date tool.

Use those dates exactly as given, in the \`Weekday, YYYY-MM-DD\` form, in place of the relative word. They are authoritative — never recompute or adjust them, and never contradict them.

Two things the block cannot decide for you:

* If an expression is missing from the block, resolve it yourself under rule 6, or keep the speaker's wording when it is not determinable.
* The block always gives the next occurrence. When the context requires a later one — a deadline being pushed back to a weekday that would otherwise land earlier — use the entry for "next <weekday>" if it is listed, otherwise state the date the context requires and keep the weekday name consistent with it.`;
