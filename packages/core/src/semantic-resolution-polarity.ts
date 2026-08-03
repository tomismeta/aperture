export type ResolutionPolarity = "asserted" | "modal" | "negated" | "prospective";

export type ResolutionClause = { tokens: string[]; isQuestion: boolean };

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

export function readResolutionPolarity(
  clause: ResolutionClause,
  start: number,
): ResolutionPolarity {
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

function hasTokenSequence(tokens: readonly string[], sequence: readonly string[]): boolean {
  for (let index = 0; index <= tokens.length - sequence.length; index += 1) {
    if (sequence.every((token, offset) => tokens[index + offset] === token)) {
      return true;
    }
  }

  return false;
}
