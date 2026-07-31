import type { AttentionConsequenceLevel } from "./frame.js";
import {
  ESCALATE_PHRASES,
  EXPLICIT_BLOCKING_PHRASES,
  EXPLICIT_WAITING_PHRASES,
  HIGH_RISK_PHRASES,
  IMPLIED_OPERATOR_ASKS,
  IMPLIED_OPERATOR_NEGATIONS,
  ISSUE_SIGNAL_PHRASES,
  NEGATED_ESCALATE_PHRASES,
  NEGATED_REPEAT_PHRASES,
  REPEAT_PHRASES,
  SUPERSEDE_PHRASES,
} from "./semantic-patterns.js";
import {
  hasAssertedContextualResolutionSignal,
  hasAssertedDirectResolutionSignal,
} from "./semantic-resolution-polarity.js";
import { readSemanticTextEvidence } from "./semantic-evidence.js";
import {
  containsAnySemanticPhrase,
  containsSemanticPhrase,
  normalizeSemanticLexicalText,
} from "./semantic-text.js";
import {
  isSemanticCommandExecutionToolFamily,
  type SemanticToolFamilyContextItem,
} from "./semantic-tool-family.js";
import type { SemanticRelationHint } from "./semantic-types.js";

export { containsAnySemanticPhrase, normalizeSemanticText } from "./semantic-text.js";
export { inferSemanticToolFamily, readExplicitSemanticToolFamily } from "./semantic-tool-family.js";

export type SemanticDetectionContextItem = SemanticToolFamilyContextItem;

export type SemanticDetectionInput = {
  title: string;
  summary?: string;
  toolFamily?: string;
  context?: {
    items?: SemanticDetectionContextItem[];
  };
  metadata?: Record<string, unknown>;
};

export type SemanticBlockingSignal = "blocking" | "waiting";

export function dedupeSemanticStrings(values: string[]): string[] {
  return [...new Set(values)];
}

export function detectImpliedOperatorAsk(text: string): boolean {
  if (containsAnySemanticPhrase(text, IMPLIED_OPERATOR_NEGATIONS)) {
    return false;
  }

  return containsAnySemanticPhrase(text, IMPLIED_OPERATOR_ASKS);
}

export function detectSemanticBlockingSignal(text: string): SemanticBlockingSignal | null {
  if (containsAnySemanticPhrase(text, IMPLIED_OPERATOR_NEGATIONS)) {
    return null;
  }

  if (containsAnySemanticPhrase(text, EXPLICIT_BLOCKING_PHRASES)) {
    return "blocking";
  }

  if (containsAnySemanticPhrase(text, EXPLICIT_WAITING_PHRASES)) {
    return "waiting";
  }

  return null;
}

export function detectSemanticRelationHints(text: string): SemanticRelationHint[] {
  const hints: SemanticRelationHint[] = [];
  const hasRepeatSignal = hasLatestAssertedSemanticSignal(
    text,
    REPEAT_PHRASES,
    NEGATED_REPEAT_PHRASES,
  );
  const hasDirectResolveSignal = hasAssertedDirectResolutionSignal(text);
  const hasContextualResolveSignal = hasAssertedContextualResolutionSignal(text);
  const hasEscalateSignal = hasLatestAssertedSemanticSignal(
    text,
    ESCALATE_PHRASES,
    NEGATED_ESCALATE_PHRASES,
  );
  const hasIssueSignal =
    hasAnyAssertedSemanticSignal(text, ISSUE_SIGNAL_PHRASES, []) ||
    hasLatestAssertedSemanticSignal(text, SUPERSEDE_PHRASES, []) ||
    hasEscalateSignal;

  if (hasRepeatSignal && hasIssueSignal) {
    hints.push({ kind: "same_issue" }, { kind: "repeats" });
  }

  if (hasDirectResolveSignal || (hasContextualResolveSignal && hasIssueSignal)) {
    hints.push({ kind: "same_issue" }, { kind: "resolves" });
  }

  if (hasLatestAssertedSemanticSignal(text, SUPERSEDE_PHRASES, [])) {
    hints.push({ kind: "same_issue" }, { kind: "supersedes" });
  }

  if (hasEscalateSignal) {
    hints.push({ kind: "same_issue" }, { kind: "escalates" });
  }

  return dedupeRelationHints(hints);
}

export function inferConsequenceFromSemanticText(
  text: string,
  fallback: AttentionConsequenceLevel,
  toolFamily?: string,
): AttentionConsequenceLevel {
  const evidence = readSemanticTextEvidence(text, toolFamily);

  if (evidence.routineSuccessObservation) {
    return fallback;
  }

  // Read/search work is treated as side-effect-free. Production wording alone
  // should not escalate those requests beyond the explicit source fallback.
  if (toolFamily === "read" || toolFamily === "search") {
    return fallback;
  }

  if (containsAnySemanticRiskPhrase(text, HIGH_RISK_PHRASES)) {
    return "high";
  }

  if (
    toolFamily === "write" ||
    toolFamily === "edit" ||
    isSemanticCommandExecutionToolFamily(toolFamily)
  ) {
    return fallback === "low" ? "medium" : fallback;
  }

  return fallback;
}

export function detectObservationalFailureStatus(text: string, toolFamily?: string): boolean {
  const evidence = readSemanticTextEvidence(text, toolFamily);

  if (isSemanticCommandExecutionToolFamily(toolFamily)) {
    return evidence.routineSuccessObservation;
  }

  if (toolFamily !== "edit" && toolFamily !== "read") {
    return false;
  }

  return (
    evidence.observationalReadback ||
    evidence.taggedFileObservation ||
    evidence.readObservationPayload
  );
}

export function detectRoutineObservationalFailureLowConsequence(
  text: string,
  toolFamily?: string,
): boolean {
  const evidence = readSemanticTextEvidence(text, toolFamily);

  if (isSemanticCommandExecutionToolFamily(toolFamily)) {
    return evidence.routineSuccessObservation;
  }

  if (toolFamily === "search") {
    return evidence.searchResultOutput;
  }

  if (toolFamily === "read") {
    if (evidence.searchResultOutput) {
      return true;
    }

    if (!evidence.taggedFileObservation && !evidence.readObservationPayload) {
      return false;
    }

    if (evidence.sourceCodeObservation) {
      return false;
    }

    return evidence.logObservation || evidence.buildMetadataObservation;
  }

  return false;
}

export function detectExpectedDiagnosticFailure(text: string, toolFamily?: string): boolean {
  if (!isSemanticCommandExecutionToolFamily(toolFamily)) {
    return false;
  }

  return readSemanticTextEvidence(text, toolFamily).expectedDiagnosticFailure;
}

function containsAnySemanticRiskPhrase(value: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => containsSemanticRiskPhrase(value, phrase));
}

function containsSemanticRiskPhrase(value: string, phrase: string): boolean {
  return containsSemanticPhrase(value, phrase);
}

type SemanticSignalPolarity = "asserted" | "negated";

function hasLatestAssertedSemanticSignal(
  value: string,
  cues: readonly string[],
  negatedCues: readonly string[],
): boolean {
  return readLatestSemanticSignalPolarity(value, cues, negatedCues) === "asserted";
}

function hasAnyAssertedSemanticSignal(
  value: string,
  cues: readonly string[],
  negatedCues: readonly string[],
): boolean {
  for (const event of readSemanticSignalEvents(value, cues, negatedCues)) {
    if (event.polarity === "asserted") {
      return true;
    }
  }
  return false;
}

function readLatestSemanticSignalPolarity(
  value: string,
  cues: readonly string[],
  negatedCues: readonly string[],
): SemanticSignalPolarity | null {
  let latest: SemanticSignalPolarity | null = null;
  for (const event of readSemanticSignalEvents(value, cues, negatedCues)) {
    latest = event.polarity;
  }
  return latest;
}

function readSemanticSignalEvents(
  value: string,
  cues: readonly string[],
  negatedCues: readonly string[],
): Array<{ polarity: SemanticSignalPolarity }> {
  const events: Array<{ polarity: SemanticSignalPolarity }> = [];
  for (const tokens of tokenizeSemanticSignalClauses(value)) {
    const negatedRanges = negatedCues.flatMap((phrase) =>
      readSemanticPhraseRanges(tokens, tokenizeSemanticSignalText(phrase)),
    );
    const clauseEvents: Array<{ start: number; polarity: SemanticSignalPolarity }> =
      negatedRanges.map((range) => ({ start: range.start, polarity: "negated" }));

    for (const cue of cues) {
      for (const range of readSemanticPhraseRanges(tokens, tokenizeSemanticSignalText(cue))) {
        clauseEvents.push({
          start: range.start,
          polarity:
            isRangeCovered(range, negatedRanges) || hasLocalSemanticNegation(tokens, range.start)
              ? "negated"
              : "asserted",
        });
      }
    }

    clauseEvents
      .sort((left, right) => left.start - right.start)
      .forEach((event) => events.push({ polarity: event.polarity }));
  }

  return events;
}

function tokenizeSemanticSignalClauses(value: string): string[][] {
  return value
    .split(/[!?;:]+|\.+(?=\s|$)|\b(?:but|however|yet)\b/gi)
    .map(tokenizeSemanticSignalText)
    .filter((tokens) => tokens.length > 0);
}

function tokenizeSemanticSignalText(value: string): string[] {
  return normalizeSemanticLexicalText(value).match(/[a-z0-9]+/g) ?? [];
}

function readSemanticPhraseRanges(
  tokens: readonly string[],
  phraseTokens: readonly string[],
): Array<{ start: number; end: number }> {
  if (phraseTokens.length === 0 || phraseTokens.length > tokens.length) {
    return [];
  }

  const ranges: Array<{ start: number; end: number }> = [];
  for (let index = 0; index <= tokens.length - phraseTokens.length; index += 1) {
    if (phraseTokens.every((token, offset) => tokens[index + offset] === token)) {
      ranges.push({ start: index, end: index + phraseTokens.length });
    }
  }
  return ranges;
}

function isRangeCovered(
  range: { start: number; end: number },
  coveringRanges: ReadonlyArray<{ start: number; end: number }>,
): boolean {
  return coveringRanges.some(
    (coveringRange) => range.start >= coveringRange.start && range.end <= coveringRange.end,
  );
}

function hasLocalSemanticNegation(tokens: readonly string[], cueStart: number): boolean {
  const local = tokens.slice(Math.max(0, cueStart - 4), cueStart);
  return (
    local.includes("not") ||
    local.includes("never") ||
    local.at(-1) === "no" ||
    hasTokenSequence(local, ["did", "not"]) ||
    hasTokenSequence(local, ["didn", "t"])
  );
}

function hasTokenSequence(tokens: readonly string[], sequence: readonly string[]): boolean {
  for (let index = 0; index <= tokens.length - sequence.length; index += 1) {
    if (sequence.every((token, offset) => tokens[index + offset] === token)) {
      return true;
    }
  }
  return false;
}

function dedupeRelationHints(hints: SemanticRelationHint[]): SemanticRelationHint[] {
  const seen = new Set<string>();
  const result: SemanticRelationHint[] = [];

  for (const hint of hints) {
    const key = `${hint.kind}:${hint.target ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(hint);
  }

  return result;
}
