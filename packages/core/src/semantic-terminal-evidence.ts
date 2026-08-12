import { ISSUE_SIGNAL_PHRASES, TERMINAL_FAILURE_PHRASES } from "./semantic-patterns.js";
import { normalizeSemanticText } from "./semantic-text.js";

export function looksLikeTerminalFailureEvidence(text: string): boolean {
  if (
    looksLikeNonzeroTerminalExit(text) ||
    hasUnbenignSemanticPhraseOccurrence(text, "subprocess failed", defaultBenignPhrasePatterns)
  ) {
    return true;
  }

  return TERMINAL_FAILURE_PHRASES.some((phrase) =>
    hasUnbenignSemanticPhraseOccurrence(text, phrase, benignTerminalReferencePatterns(phrase)),
  );
}

export function looksLikeZeroTerminalExit(text: string): boolean {
  return hasTerminalExitCode(text, (code) => code === 0);
}

export function looksLikeContradictoryFailureObservation(text: string): boolean {
  const issueText = removeTerminalExitCodeObservations(stripRoutineFailurePrefix(text));
  return ISSUE_SIGNAL_PHRASES.some((phrase) =>
    hasUnbenignSemanticPhraseOccurrence(issueText, phrase, defaultBenignIssuePatterns),
  );
}

function looksLikeNonzeroTerminalExit(text: string): boolean {
  return (
    hasTerminalExitCode(text, (code) => code !== 0) ||
    hasUnbenignSemanticPhraseOccurrence(text, "non-zero exit", defaultBenignPhrasePatterns) ||
    hasUnbenignSemanticPhraseOccurrence(text, "nonzero exit", defaultBenignPhrasePatterns)
  );
}

function benignTerminalReferencePatterns(phrase: string): readonly RegExp[] {
  switch (phrase) {
    case "exception":
      return BENIGN_EXCEPTION_PATTERNS;
    case "traceback":
      return BENIGN_TRACEBACK_PATTERNS;
    default:
      return defaultBenignPhrasePatterns(phrase);
  }
}

const TERMINAL_EXIT_CODE_PATTERN_SOURCE = String.raw`\b(?:exit code|exit_code|exit-code|exited with code|exit status|exited with status|return code|return_code|returned code)\s*(?:is|was)?\s*(-?\d+)\b`;

function hasTerminalExitCode(text: string, predicate: (code: number) => boolean): boolean {
  for (const match of text.matchAll(new RegExp(TERMINAL_EXIT_CODE_PATTERN_SOURCE, "g"))) {
    const code = Number.parseInt(match[1] ?? "", 10);
    if (Number.isFinite(code) && predicate(code)) {
      return true;
    }
  }

  return false;
}

function removeTerminalExitCodeObservations(text: string): string {
  return text.replace(new RegExp(TERMINAL_EXIT_CODE_PATTERN_SOURCE, "g"), " ");
}

function stripRoutineFailurePrefix(text: string): string {
  return text.replace(
    /^(?:observation|bash failure|bash observation|tool failure|tool observation)\s+/,
    "",
  );
}

function hasUnbenignSemanticPhraseOccurrence(
  text: string,
  phrase: string,
  benignPatterns: readonly RegExp[] | ((phrase: string) => readonly RegExp[]),
): boolean {
  const patterns = typeof benignPatterns === "function" ? benignPatterns(phrase) : benignPatterns;

  for (const occurrence of semanticPhraseOccurrences(text, phrase)) {
    if (!isOccurrenceCoveredByAnyPattern(text, occurrence.start, occurrence.end, patterns)) {
      return true;
    }
  }

  return false;
}

function semanticPhraseOccurrences(
  text: string,
  phrase: string,
): Array<{ start: number; end: number }> {
  const normalizedPhrase = normalizeSemanticText(phrase);
  if (!normalizedPhrase) {
    return [];
  }

  const expression = new RegExp(
    `(^|[^a-z0-9_])(${escapeRegExp(normalizedPhrase)})(?=$|[^a-z0-9_])`,
    "g",
  );
  const occurrences: Array<{ start: number; end: number }> = [];
  for (const match of text.matchAll(expression)) {
    const start = (match.index ?? 0) + (match[1]?.length ?? 0);
    occurrences.push({ start, end: start + normalizedPhrase.length });
  }

  return occurrences;
}

function isOccurrenceCoveredByAnyPattern(
  text: string,
  start: number,
  end: number,
  patterns: readonly RegExp[],
): boolean {
  for (const pattern of patterns) {
    for (const match of text.matchAll(new RegExp(pattern.source, "g"))) {
      const matchStart = match.index ?? 0;
      const matchEnd = matchStart + match[0].length;
      if (start >= matchStart && end <= matchEnd) {
        return true;
      }
    }
  }

  return false;
}

function defaultBenignPhrasePatterns(phrase: string): RegExp[] {
  const normalizedPhrase = escapeRegExp(normalizeSemanticText(phrase));
  const absence =
    phrase === "permission denied"
      ? String.raw`(?:no ${normalizedPhrase}|${normalizedPhrase} before (?:tool )?(?:invocation|execution))`
      : String.raw`no ${normalizedPhrase}`;
  return [
    new RegExp(String.raw`\b${absence}\b`),
    new RegExp(String.raw`\bwithout ${normalizedPhrase}\b`),
  ];
}

function defaultBenignIssuePatterns(phrase: string): RegExp[] {
  const normalizedPhrase = escapeRegExp(normalizeSemanticText(phrase));
  return [
    ...defaultBenignPhrasePatterns(phrase),
    new RegExp(String.raw`\bnot ${normalizedPhrase}\b`),
    new RegExp(String.raw`\bdidn t ${normalizedPhrase}\b`),
    new RegExp(String.raw`\bdid not ${normalizedPhrase}\b`),
  ];
}

const BENIGN_EXCEPTION_PATTERNS = [
  /\b(?:no exceptions?(?: occurred| raised| reported| found| seen| present)?|without (?:an? )?exceptions?|expected exceptions?(?: was| were)? (?:caught|handled|raised)|(?:caught|handled) (?:the )?expected exceptions?|exceptions?(?: was| were)? expected)\b/,
] as const;
const BENIGN_TRACEBACK_PATTERNS = [
  /\b(?:no tracebacks?(?: occurred| raised| reported| found| seen| present)?|without (?:a )?tracebacks?|expected tracebacks?(?: was| were)? (?:caught|handled|raised|produced)|tracebacks?(?: was| were)? expected)\b/,
] as const;
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
