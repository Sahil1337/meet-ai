/**
 * investigate_ambiguity — the reference-resolution tool for the extraction
 * agent (see extraction-agent.ts).
 *
 * Why this exists: fixturesFromMeeting() (test/test-helpers.ts) splits a
 * long meeting into independent ~30s/120s windows, and each window is
 * extracted with no memory of the others — see that function's docblock.
 * That means a line like "Yash, I'll take that, we can finish it by Friday"
 * often has its antecedent ("that") sitting in a *previous* window the model
 * never sees. Rule 1 of the system prompt (test/prompts.ts) already says
 * "if the referent is genuinely unclear, do not invent one" — but a
 * referent that is resolvable, just not from the current window, shouldn't
 * be thrown away. This tool lets the model go look before it gives up.
 *
 * One correction versus the original idea of a "30s/1min" window: this
 * codebase's transcript lines are only timestamped to the minute
 * ("Speaker [HH:MM YYYY-MM-DD]: ..."), not the second — see MEETING_TRANSCRIPT
 * in test/test.ts. A "30 second" lookback isn't a distinction the data can
 * actually make, so lookback works in whole minutes instead of seconds.
 *
 * Architecture: gather, then resolve in an isolated call.
 *
 * There are two separable problems here: finding the candidate lines that
 * might explain a reference, and actually deciding what the reference means.
 * The first is cheap and deterministic (string/time matching over an
 * in-memory array); the second needs real language understanding.
 *
 * An earlier version handed the raw candidate lines back to the *same*
 * extraction conversation and let the model interpret them itself, widening
 * the lookback across several more hops if needed. That worked, but every
 * line it returned stayed in the conversation for every subsequent hop
 * (including the final submit_propositions call), so a chatty transcript
 * with several ambiguous references could add up fast against the proxy's
 * 8192-token context — and each widening round was its own full hop back
 * through the main model.
 *
 * Instead: investigateAmbiguity() below only gathers candidates (still pure,
 * still free) and, since there's no longer any reason to ration how much it
 * looks at, always gathers generously in one pass rather than starting small
 * and being asked to widen. investigateAndResolveAmbiguity() then does the
 * interpreting in a single, separate, throwaway chat — its own `messages`
 * array, never appended to the extraction conversation's transcript — and
 * only the compact answer (`{ resolved, referent }`) crosses back into the
 * main conversation as the tool result. The trade is one extra model
 * inference per ambiguous reference (real cost on a 4 GB 3050) for a main
 * conversation that never grows by raw retrieved transcript at all.
 */

import type { QwenProxyClient } from "./client.ts";
import type { ChatMessage, Mode, Tool } from "./shared/types.ts";

const MINUTE = 60_000;

/** How far back a gather pass will look, in one shot — see the architecture note above. */
const MAX_LOOKBACK_MINUTES = 20;
/** Safety cap on how many lines one gather pass hands to the resolver call. */
const MAX_LINES_RETURNED = 60;
/** Below this many normalized characters an anchor is too generic to locate reliably. */
const MIN_ANCHOR_CHARS = 8;
/** Cap on how many keyword-matched lines one gather pass returns. */
const MAX_KEYWORD_MATCHES = 5;

interface ParsedLine {
  raw: string;
  /** Epoch ms at minute precision, parsed from the line's own "[HH:MM YYYY-MM-DD]" stamp. */
  time: number;
}

/** Internal: what the gather pass found, before anything has tried to interpret it. */
type GatheredContext =
  | {
      match_type: "keyword";
      /** Content words pulled from `reference` and searched for. */
      keywords: string[];
      /** Matching lines, most-keywords-matched first then most recent, re-sorted chronologically. */
      context: string;
      lines_returned: number;
      note?: string;
    }
  | {
      match_type: "window";
      anchor_time: string;
      /** Transcript lines immediately before anchor_line, oldest first, verbatim. */
      context: string;
      lines_returned: number;
      note?: string;
    }
  | { error: string };

/** What the tool actually returns to the main conversation — no raw transcript in it. */
export type ResolvedAmbiguity =
  | { resolved: true; referent: string; match_type: "keyword" | "window"; lines_considered: number }
  | { resolved: false; referent: null; match_type?: "keyword" | "window"; lines_considered?: number; note?: string }
  | { error: string };

const normalize = (s: string) =>
  s
    .replace(/^["'“”‘’\s]+|["'“”‘’\s.]+$/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();

// "Speaker [HH:MM YYYY-MM-DD]: text" — the one line format used throughout this codebase.
const LINE = /^.+? \[(\d{2}):(\d{2}) (\d{4})-(\d{2})-(\d{2})\]: ?.*$/;

function parseTranscriptLines(transcript: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  for (const rawLine of transcript.split("\n")) {
    const raw = rawLine.trim();
    if (!raw) continue;
    const m = LINE.exec(raw);
    if (!m) continue; // skip lines that aren't in the timestamped speaker format
    const [, hh, mm, yyyy, mo, dd] = m;
    const time = Date.UTC(Number(yyyy), Number(mo) - 1, Number(dd), Number(hh), Number(mm));
    out.push({ raw, time });
  }
  return out;
}

function formatMinute(t: number): string {
  const iso = new Date(t).toISOString();
  return `${iso.slice(11, 16)} ${iso.slice(0, 10)}`;
}

/**
 * Locates anchorLine among lines, verbatim (ignoring case/quotes/whitespace).
 * Requires exactly one match — a wrong anchor would silently search from the
 * wrong point in time, which is worse than refusing and asking for a more
 * specific one.
 */
function findAnchor(lines: ParsedLine[], anchorLine: string): { line: ParsedLine; index: number } | { error: string } {
  const needle = normalize(anchorLine);
  if (needle.length < MIN_ANCHOR_CHARS) {
    return {
      error: "anchor_line is too short to locate reliably; pass the full transcript line, including the speaker and '[HH:MM YYYY-MM-DD]' prefix",
    };
  }
  const matches: number[] = [];
  lines.forEach((l, i) => {
    const hay = normalize(l.raw);
    if (hay === needle || hay.includes(needle) || needle.includes(hay)) matches.push(i);
  });
  if (matches.length === 0) {
    return {
      error:
        "anchor_line was not found verbatim in the transcript seen so far; copy it exactly, including the speaker and '[HH:MM YYYY-MM-DD]' prefix",
    };
  }
  if (matches.length > 1) {
    return {
      error: `anchor_line matches ${matches.length} different lines (at ${matches.map((i) => formatMinute(lines[i]!.time)).join(", ")}); include more of the line so it identifies a single occurrence`,
    };
  }
  return { line: lines[matches[0]!]!, index: matches[0]! };
}

// Function words stripped before keyword extraction — the pronouns rule 1
// already lists, plus the usual articles/prepositions/auxiliaries. A bare
// pronoun reference ("it", "he") yields zero keywords by design: there's
// nothing there to search on, so the gather pass falls through to the time
// window.
const STOPWORDS = new Set([
  "a", "an", "the", "this", "that", "these", "those", "it", "he", "she", "they",
  "him", "her", "them", "his", "hers", "their", "theirs", "its", "we", "us",
  "our", "ours", "you", "your", "yours", "i", "me", "my", "mine", "of", "for",
  "to", "on", "in", "at", "by", "from", "about", "into", "over", "under",
  "with", "without", "is", "are", "was", "were", "be", "been", "being", "do",
  "does", "did", "done", "has", "have", "had", "having", "will", "would",
  "can", "could", "should", "shall", "may", "might", "must", "and", "or",
  "but", "not", "no", "nor", "so", "if", "then", "than", "as", "up", "out",
  "off", "again", "there", "here", "what", "which", "who", "whom", "one",
  "some", "any", "all", "just", "also", "still", "even", "only", "own",
  "same", "other", "another",
]);

/** Content words in `reference` worth searching for — everything but stopwords. */
function extractKeywords(reference: string): string[] {
  const words = reference
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return [...new Set(words.filter((w) => w.length >= 3 && !STOPWORDS.has(w)))];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Lines before `beforeIndex` that mention at least one of `keywords`, most
 * keywords matched first (recency breaks ties), capped at `cap`, then
 * re-sorted chronologically for display. Unlike the time-window search this
 * isn't bounded by how recent the mention is — a keyword match is a much
 * stronger signal than proximity, so there's no reason to require it to be
 * recent.
 */
function findKeywordMatches(lines: ParsedLine[], beforeIndex: number, keywords: string[], cap: number): ParsedLine[] {
  const patterns = keywords.map((k) => new RegExp(`\\b${escapeRegExp(k)}\\b`, "i"));
  const scored: { line: ParsedLine; index: number; score: number }[] = [];
  for (let i = beforeIndex - 1; i >= 0; i--) {
    const line = lines[i]!;
    const score = patterns.reduce((n, p) => n + (p.test(line.raw) ? 1 : 0), 0);
    if (score > 0) scored.push({ line, index: i, score });
  }
  scored.sort((a, b) => b.score - a.score); // stable: ties keep scan order (nearest-first)
  return scored
    .slice(0, cap)
    // Chronological for display. Transcript timestamps are minute-precision,
    // so two matches often tie on `time` — break ties with the original
    // transcript index, not whatever order the score-sort above left them
    // in, otherwise same-minute lines can come back out of speaking order.
    .sort((a, b) => a.line.time - b.line.time || a.index - b.index)
    .map((s) => s.line);
}

/**
 * Gather pass: first tries a keyword match anywhere in the known transcript,
 * then falls back to the transcript lines spoken in the MAX_LOOKBACK_MINUTES
 * window immediately before `anchorLine`. Pure and deterministic — no model
 * call, and not exported: nothing outside this file should be handed raw
 * candidate lines directly, that's the whole point of the split below.
 */
function gatherContext(params: { transcript: string; anchorLine: string; reference: string }): GatheredContext {
  const lines = parseTranscriptLines(params.transcript);
  if (lines.length === 0) {
    return {
      error: "no timestamped transcript lines are available ('Speaker [HH:MM YYYY-MM-DD]: text' format required)",
    };
  }

  const found = findAnchor(lines, params.anchorLine);
  if ("error" in found) return found;

  const keywords = extractKeywords(params.reference);
  if (keywords.length > 0) {
    const hits = findKeywordMatches(lines, found.index, keywords, MAX_KEYWORD_MATCHES);
    if (hits.length > 0) {
      return {
        match_type: "keyword",
        keywords,
        context: hits.map((l) => l.raw).join("\n"),
        lines_returned: hits.length,
        ...(hits.length >= MAX_KEYWORD_MATCHES
          ? { note: `showing the ${MAX_KEYWORD_MATCHES} most relevant mentions of ${keywords.join(", ")}; more may exist further back` }
          : {}),
      };
    }
  }

  // No usable keyword (a bare pronoun), or nothing in the known transcript
  // mentions one — fall back to a plain time-window lookback before
  // anchor_line, as generous as we'd ever want in one pass (see the
  // architecture note at the top of this file for why there's no widening
  // loop here anymore).
  const lowerBound = found.line.time - MAX_LOOKBACK_MINUTES * MINUTE;
  const collected: ParsedLine[] = [];
  for (let i = found.index - 1; i >= 0; i--) {
    if (lines[i]!.time < lowerBound) break;
    collected.push(lines[i]!);
  }
  collected.reverse(); // chronological order

  let context = collected;
  let note: string | undefined;
  if (context.length > MAX_LINES_RETURNED) {
    context = context.slice(context.length - MAX_LINES_RETURNED); // keep the lines closest to the anchor
    note = `truncated to the ${MAX_LINES_RETURNED} lines closest to anchor_line`;
  } else if (context.length === 0) {
    note = `no transcript in the ${MAX_LOOKBACK_MINUTES} minutes before anchor_line (either there is none, or the nearest mention is further back than that)`;
  }

  return {
    match_type: "window",
    anchor_time: formatMinute(found.line.time),
    context: context.map((l) => l.raw).join("\n"),
    lines_returned: context.length,
    ...(note ? { note } : {}),
  };
}

// --- Turning gathered candidates into an actual resolved answer -----------

const RESOLVER_SYSTEM_PROMPT = `You resolve exactly one ambiguous reference from a meeting transcript, using only the candidate context lines you are given below. Never use outside knowledge and never guess.

Reply with ONLY the resolved referent, stated as a short standalone phrase (for example: "the reranker" or "the claim schema field list"). No explanation, no restating the question, one line.

If the candidate context does not make the reference clear, reply with exactly this and nothing else: UNRESOLVED`;

async function resolveWithModel(
  client: QwenProxyClient,
  mode: Mode | undefined,
  anchorLine: string,
  reference: string,
  candidateContext: string,
): Promise<{ resolved: boolean; referent: string | null }> {
  const messages: ChatMessage[] = [
    { role: "system", content: RESOLVER_SYSTEM_PROMPT },
    {
      role: "user",
      content:
        `Line containing the reference:\n${anchorLine}\n\n` +
        `Reference to resolve: "${reference}"\n\n` +
        `Candidate context, earlier lines from the same meeting:\n${candidateContext}`,
    },
  ];
  const completion = await client.chat({ mode, temperature: 0, max_tokens: 80, messages });
  const text = (completion.choices[0]?.message.content ?? "").trim();
  if (!text || /^unresolved\.?$/i.test(text)) return { resolved: false, referent: null };
  return { resolved: true, referent: text };
}

/**
 * Public entry point: gather candidates (cheap, deterministic), then, if
 * there's anything to look at, resolve them with one isolated model call —
 * its own `messages` array, not the extraction conversation's. A resolver
 * failure (proxy hiccup, timeout) degrades to `resolved: false` instead of
 * throwing, so a flaky side call can't take down an extraction that already
 * made progress on other propositions.
 */
export async function investigateAndResolveAmbiguity(
  client: QwenProxyClient,
  params: { transcript: string; anchorLine: string; reference: string },
  resolverMode: Mode = "fast",
): Promise<ResolvedAmbiguity> {
  const gathered = gatherContext(params);
  if ("error" in gathered) return gathered;
  if (gathered.lines_returned === 0) {
    return {
      resolved: false,
      referent: null,
      match_type: gathered.match_type,
      lines_considered: 0,
      note: gathered.note ?? "nothing earlier to check",
    };
  }

  try {
    const { resolved, referent } = await resolveWithModel(
      client,
      resolverMode,
      params.anchorLine,
      params.reference,
      gathered.context,
    );
    return resolved
      ? { resolved: true, referent: referent!, match_type: gathered.match_type, lines_considered: gathered.lines_returned }
      : { resolved: false, referent: null, match_type: gathered.match_type, lines_considered: gathered.lines_returned };
  } catch (err) {
    return {
      resolved: false,
      referent: null,
      match_type: gathered.match_type,
      lines_considered: gathered.lines_returned,
      note: `resolver call failed, treating as unresolved: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// The tool as the model sees it

export const INVESTIGATE_AMBIGUITY_TOOL: Tool = {
  type: "function",
  function: {
    name: "investigate_ambiguity",
    description:
      "Resolve a reference the current transcript window doesn't explain on its own — a pronoun ('it', 'he', 'they'), a bare noun phrase ('that feature', 'the deadline'), or an implicit subject ('I'll take that') whose antecedent isn't in the text you already have. " +
      "Give it the exact transcript line the reference occurs in (`anchor_line`, copied verbatim including the speaker and '[HH:MM YYYY-MM-DD]' prefix) and the reference itself (`reference`). " +
      "It searches the transcript spoken before that line on its own and resolves the reference itself — you get back `resolved: true` with the answer in `referent`, or `resolved: false` if nothing earlier makes it clear. " +
      "One call per reference is enough; it already looked as far back as it usefully can, so calling it again for the same reference will not find anything new. " +
      "If it comes back `resolved: false`, follow rule 1: preserve the ambiguity in the proposition rather than invent a referent. " +
      "Do not call this for references that are already clear from the current window.",
    parameters: {
      type: "object",
      properties: {
        anchor_line: {
          type: "string",
          description:
            "The exact transcript line containing the ambiguous reference, copied verbatim including the speaker and '[HH:MM YYYY-MM-DD]' prefix.",
        },
        reference: {
          type: "string",
          description: "The ambiguous word or phrase itself, exactly as spoken, e.g. \"that\" or \"the feature\".",
        },
      },
      required: ["anchor_line", "reference"],
    },
  },
};

/**
 * Handler for INVESTIGATE_AMBIGUITY_TOOL; wire it into
 * QwenProxyClient.runToolsUntil with the transcript known so far
 * (precedingTranscript + the current window) and the client itself closed
 * over. Async, and does its own separate model call (see
 * investigateAndResolveAmbiguity above) on top of whatever hop is already in
 * flight for the main extraction conversation — runToolsUntil already awaits
 * handlers, so this needs no other wiring.
 */
export async function investigateAmbiguityHandler(
  args: Record<string, unknown>,
  knownTranscript: string,
  client: QwenProxyClient,
  resolverMode?: Mode,
): Promise<ResolvedAmbiguity & { anchor_line: string; reference: string }> {
  const anchorLine = String(args.anchor_line ?? "");
  const reference = String(args.reference ?? "");
  const result = await investigateAndResolveAmbiguity(
    client,
    { transcript: knownTranscript, anchorLine, reference },
    resolverMode,
  );
  return { anchor_line: anchorLine, reference, ...result };
}
