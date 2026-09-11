/**
 * investigate_ambiguity — reference resolution for the extraction agent.
 *
 * Why it exists: a meeting is extracted one window at a time, and each
 * window is extracted with no memory of the others. "Yash, I'll take that,
 * we can finish it by Friday" often has its antecedent ("that") in a
 * *previous* window the model never sees. The prompt's REFERENCES section
 * says "never invent a referent" — but a referent that is resolvable, just
 * not from the current window, should not be thrown away either. This tool
 * lets the model go look before it gives up.
 *
 * Shape: gather, then resolve in an isolated call.
 *
 * - Gather (`gatherContext`, pure): keyword-match the reference's content
 *   words against every earlier line, or, for a bare pronoun with nothing to
 *   search on, take the lines from the MAX_LOOKBACK_MINUTES before the anchor
 *   line. No model call. Lookback is whole minutes because transcript lines
 *   are stamped to the minute; a "30 second" window is not a distinction the
 *   data can make.
 * - Resolve (`resolveWithModel`): ONE model call in its own throwaway
 *   conversation, asking only "what does this reference mean, given these
 *   lines?". Only the compact `{ resolved, referent }` crosses back into the
 *   extraction conversation; the candidate lines never do. An earlier version
 *   returned raw lines into the main conversation and let the model widen the
 *   search over several hops; every returned line then stayed in context for
 *   every later hop, which a chatty transcript could not afford inside the
 *   proxy's 8192-token window. The trade is one extra inference per ambiguous
 *   reference for a main conversation that never grows.
 *
 * Known weakness — read before trusting `resolved: true`: the resolver's
 * reply is accepted as the referent if it is non-empty and not literally
 * "UNRESOLVED". Nothing checks that the phrase it names actually occurs in,
 * or is supported by, the candidate lines, and the keyword gather returns
 * bare hit lines without their neighbours. A candidate set that mentions the
 * keyword in a *different sense* can therefore produce a confident, wrong
 * referent. docs/audit.md ("Can investigate_ambiguity fabricate a referent?")
 * has a concrete case from the kickoff transcript and the cheap fixes; that is
 * the extraction owner's first task on this tool.
 */

import { z } from "zod";
import { formatTranscriptLine, lineTimestampMs, type TranscriptLine } from "@meetai/core";
import type { QwenProxyClient } from "qwen-proxy/client";
import type { ChatMessage, Mode } from "qwen-proxy/types";
import { RESOLVER_PROMPT } from "../prompts/resolver.ts";
import { defineTool } from "./define.ts";

const MINUTE = 60_000;

/** How far back the time-window fallback looks, in one shot. */
const MAX_LOOKBACK_MINUTES = 20;
/** Safety cap on how many lines one gather pass hands to the resolver call. */
const MAX_LINES_RETURNED = 60;
/** Below this many normalized characters an anchor is too generic to locate reliably. */
const MIN_ANCHOR_CHARS = 8;
/** Cap on how many keyword-matched lines one gather pass returns. */
const MAX_KEYWORD_MATCHES = 5;

/** A transcript line with the two derived views the search needs, computed once per call. */
type Candidate = { line: TranscriptLine; raw: string; time: number };

/** What the gather pass found, before anything has tried to interpret it. */
type GatheredContext =
  | {
      match_type: "keyword";
      keywords: string[];
      context: string;
      lines_returned: number;
      note?: string;
    }
  | {
      match_type: "window";
      anchor_time: string;
      context: string;
      lines_returned: number;
      note?: string;
    }
  | { error: string };

/** What crosses back into the main conversation — no raw transcript in it. */
export type ResolvedAmbiguity =
  | { resolved: true; referent: string; match_type: "keyword" | "window"; lines_considered: number }
  | { resolved: false; referent: null; match_type?: "keyword" | "window"; lines_considered?: number; note?: string }
  | { error: string };

const normalize = (s: string) =>
  s
    .replace(/^["'“”‘’\s]+|["'“”‘’\s.]+$/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();

function toCandidates(lines: TranscriptLine[]): Candidate[] {
  return lines.map((line) => ({ line, raw: formatTranscriptLine(line), time: lineTimestampMs(line) }));
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
function findAnchor(lines: Candidate[], anchorLine: string): { line: Candidate; index: number } | { error: string } {
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

// Function words stripped before keyword extraction — the pronouns the
// prompt's REFERENCES section lists, plus the usual articles, prepositions
// and auxiliaries. A bare pronoun reference ("it", "he") yields zero keywords
// by design: there is nothing to search on, so the gather pass falls through
// to the time window.
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
 * re-sorted chronologically for display. Not bounded by recency: a keyword
 * match is a stronger signal than proximity.
 */
function findKeywordMatches(lines: Candidate[], beforeIndex: number, keywords: string[], cap: number): Candidate[] {
  const patterns = keywords.map((k) => new RegExp(`\\b${escapeRegExp(k)}\\b`, "i"));
  const scored: { line: Candidate; index: number; score: number }[] = [];
  for (let i = beforeIndex - 1; i >= 0; i--) {
    const line = lines[i]!;
    const score = patterns.reduce((n, p) => n + (p.test(line.raw) ? 1 : 0), 0);
    if (score > 0) scored.push({ line, index: i, score });
  }
  scored.sort((a, b) => b.score - a.score); // stable: ties keep scan order (nearest-first)
  return scored
    .slice(0, cap)
    // Chronological for display; same-minute ties break on transcript order.
    .sort((a, b) => a.line.time - b.line.time || a.index - b.index)
    .map((s) => s.line);
}

/**
 * Gather pass: keyword match anywhere earlier, else the MAX_LOOKBACK_MINUTES
 * window before `anchorLine`. Pure and deterministic; not exported — nothing
 * outside this file should be handed raw candidate lines.
 */
function gatherContext(params: { transcript: TranscriptLine[]; anchorLine: string; reference: string }): GatheredContext {
  const lines = toCandidates(params.transcript);
  if (lines.length === 0) {
    return { error: "no transcript lines are available to search" };
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

  const lowerBound = found.line.time - MAX_LOOKBACK_MINUTES * MINUTE;
  const collected: Candidate[] = [];
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

async function resolveWithModel(
  client: QwenProxyClient,
  mode: Mode,
  anchorLine: string,
  reference: string,
  candidateContext: string,
): Promise<{ resolved: boolean; referent: string | null }> {
  const messages: ChatMessage[] = [
    { role: "system", content: RESOLVER_PROMPT },
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
 * Gather candidates (cheap, deterministic), then, if there is anything to
 * look at, resolve them with one isolated model call. A resolver failure
 * (proxy hiccup, timeout) degrades to `resolved: false` instead of throwing,
 * so a flaky side call cannot take down an extraction that already made
 * progress.
 */
export async function investigateAndResolveAmbiguity(
  client: QwenProxyClient,
  params: { transcript: TranscriptLine[]; anchorLine: string; reference: string },
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

export const investigateAmbiguityTool = defineTool({
  name: "investigate_ambiguity",
  description:
    "Resolve a reference the current transcript window doesn't explain on its own — a pronoun ('it', 'he', 'they'), a bare noun phrase ('that feature', 'the deadline'), or an implicit subject ('I'll take that') whose antecedent isn't in the text you already have. " +
    "Give it the exact transcript line the reference occurs in (`anchor_line`, copied verbatim including the speaker and '[HH:MM YYYY-MM-DD]' prefix) and the reference itself (`reference`). " +
    "It searches the transcript spoken before that line on its own and resolves the reference itself — you get back `resolved: true` with the answer in `referent`, or `resolved: false` if nothing earlier makes it clear. " +
    "One call per reference is enough; it already looked as far back as it usefully can, so calling it again for the same reference will not find anything new. " +
    "If it comes back `resolved: false`, preserve the ambiguity in the record rather than invent a referent. " +
    "Do not call this for references that are already clear from the current window.",
  parameters: z.object({
    anchor_line: z
      .string()
      .describe(
        "The exact transcript line containing the ambiguous reference, copied verbatim including the speaker and '[HH:MM YYYY-MM-DD]' prefix.",
      ),
    reference: z.string().describe('The ambiguous word or phrase itself, exactly as spoken, e.g. "that" or "the feature".'),
  }),
  handler: async ({ anchor_line, reference }, ctx) => {
    const result = await investigateAndResolveAmbiguity(
      ctx.client,
      { transcript: ctx.transcript, anchorLine: anchor_line, reference },
      ctx.resolverMode,
    );
    return { anchor_line, reference, ...result };
  },
});
