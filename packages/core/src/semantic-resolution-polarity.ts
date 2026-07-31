import {
  CONTEXTUAL_RESOLVE_PHRASES,
  DIRECT_RESOLVE_PHRASES,
  NEGATED_RESOLVE_PHRASES,
} from "./semantic-patterns.js";
import { normalizeSemanticText } from "./semantic-text.js";

export type ResolutionPolarity = "asserted" | "modal" | "negated" | "prospective";

type ResolutionCue = { tokens: string[] };
type ResolutionClause = { tokens: string[]; isQuestion: boolean };

const DIRECT_RESOLUTION_CUES = DIRECT_RESOLVE_PHRASES.map(toResolutionCue);
const CONTEXTUAL_RESOLUTION_CUES = CONTEXTUAL_RESOLVE_PHRASES.map(toResolutionCue);
const NEGATED_RESOLUTION_CUES = NEGATED_RESOLVE_PHRASES.map(toResolutionCue);
const LOOKBEHIND_TOKEN_COUNT = 12;
const LOCAL_NEGATION_TOKENS = new Set(["never", "not"]);
const MODAL_TOKENS = new Set(["could", "expected", "hopefully", "may", "might", "should", "would"]);
const VERIFICATION_TOKENS = new Set([
  "check",
  "confirm",
  "determine",
  "ensure",
  "see",
  "validate",
  "verify",
]);
const PROSPECTIVE_PREFIX_TOKENS = new Set([
  "can",
  "could",
  "need",
  "needed",
  "needs",
  "please",
  "rerun",
  "retry",
  "run",
  "should",
  "to",
  "try",
  "trying",
  "will",
  "would",
]);
const CONDITIONAL_TOKENS = new Set(["if", "that", "whether"]);
const QUESTION_PREFIXES = [
  ["are", "we"],
  ["can", "you"],
  ["could", "you"],
  ["did", "it"],
  ["do", "you"],
  ["does", "it"],
  ["is", "it"],
  ["should", "i"],
  ["should", "we"],
  ["was", "it"],
  ["would", "you"],
] as const;

export function hasAssertedDirectResolutionSignal(value: string): boolean {
  return hasAssertedResolutionSignal(value, DIRECT_RESOLUTION_CUES);
}

export function hasAssertedContextualResolutionSignal(value: string): boolean {
  return hasAssertedResolutionSignal(value, CONTEXTUAL_RESOLUTION_CUES);
}

function hasAssertedResolutionSignal(value: string, cues: readonly ResolutionCue[]): boolean {
  let latestPolarity: ResolutionPolarity | null = null;
  for (const clause of readResolutionClauses(value)) {
    const events: Array<{ start: number; polarity: ResolutionPolarity }> = [];
    for (const cue of NEGATED_RESOLUTION_CUES) {
      for (const start of findCueStarts(clause.tokens, cue.tokens)) {
        events.push({ start, polarity: "negated" });
      }
    }

    for (const cue of cues) {
      for (const start of findCueStarts(clause.tokens, cue.tokens)) {
        events.push({ start, polarity: readResolutionPolarity(clause, start) });
      }
    }

    events
      .sort((left, right) => left.start - right.start)
      .forEach((event) => {
        latestPolarity = event.polarity;
      });
  }

  return latestPolarity === "asserted";
}

function readResolutionPolarity(clause: ResolutionClause, start: number): ResolutionPolarity {
  const tokens = clause.tokens;
  const lookbehind = tokens.slice(Math.max(0, start - LOOKBEHIND_TOKEN_COUNT), start);
  const localLookbehind = lookbehind.slice(-4);

  if (hasLocalNegation(localLookbehind)) {
    return "negated";
  }

  if (clause.isQuestion || hasQuestionRequestContext(lookbehind)) {
    return "prospective";
  }

  if (hasRecentModal(localLookbehind)) {
    return "modal";
  }

  return hasProspectiveVerificationContext(lookbehind) ? "prospective" : "asserted";
}

function hasLocalNegation(tokens: readonly string[]): boolean {
  return (
    tokens.some((token) => LOCAL_NEGATION_TOKENS.has(token)) ||
    hasTokenSequence(tokens, ["did", "n", "t"]) ||
    hasTokenSequence(tokens, ["did", "not"])
  );
}

function hasRecentModal(tokens: readonly string[]): boolean {
  return tokens.some((token) => MODAL_TOKENS.has(token));
}

function hasQuestionRequestContext(tokens: readonly string[]): boolean {
  return QUESTION_PREFIXES.some((sequence) => hasTokenSequence(tokens, sequence));
}

function hasProspectiveVerificationContext(tokens: readonly string[]): boolean {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (!VERIFICATION_TOKENS.has(token)) {
      continue;
    }

    const previous = tokens[index - 1];
    const next = tokens[index + 1];
    if (
      previous === undefined ||
      isListMarkerToken(previous) ||
      PROSPECTIVE_PREFIX_TOKENS.has(previous) ||
      (next !== undefined && CONDITIONAL_TOKENS.has(next)) ||
      hasConditionalAfter(tokens, index)
    ) {
      return true;
    }
  }

  return false;
}

function hasConditionalAfter(tokens: readonly string[], index: number): boolean {
  return tokens.slice(index + 1, index + 5).some((token) => CONDITIONAL_TOKENS.has(token));
}

function isListMarkerToken(token: string): boolean {
  return /^\d+$/.test(token);
}

function findCueStarts(tokens: readonly string[], cueTokens: readonly string[]): number[] {
  const starts: number[] = [];
  for (let index = 0; index <= tokens.length - cueTokens.length; index += 1) {
    if (cueTokens.every((token, offset) => tokens[index + offset] === token)) {
      starts.push(index);
    }
  }
  return starts;
}

function toResolutionCue(phrase: string): ResolutionCue {
  return { tokens: tokenizeResolutionText(phrase) };
}

function readResolutionClauses(value: string): ResolutionClause[] {
  const clauses: ResolutionClause[] = [];
  let start = 0;
  for (const match of value.matchAll(/[.!?;:]+/g)) {
    const end = match.index;
    const clause = toResolutionClause(value.slice(start, end), match[0].includes("?"));
    if (clause !== null) {
      clauses.push(clause);
    }
    start = end + match[0].length;
  }

  const finalClause = toResolutionClause(value.slice(start), false);
  if (finalClause !== null) {
    clauses.push(finalClause);
  }

  return clauses.length > 0
    ? clauses
    : [toResolutionClause(value, false)].filter(isResolutionClause);
}

function toResolutionClause(value: string, isQuestion: boolean): ResolutionClause | null {
  const tokens = tokenizeResolutionText(value);
  if (tokens.length === 0) {
    return null;
  }

  return { tokens, isQuestion };
}

function isResolutionClause(value: ResolutionClause | null): value is ResolutionClause {
  return value !== null;
}

function tokenizeResolutionText(value: string): string[] {
  return normalizeSemanticText(value).match(/[a-z0-9]+/g) ?? [];
}

function hasTokenSequence(tokens: readonly string[], sequence: readonly string[]): boolean {
  for (let index = 0; index <= tokens.length - sequence.length; index += 1) {
    if (sequence.every((token, offset) => tokens[index + offset] === token)) {
      return true;
    }
  }

  return false;
}
