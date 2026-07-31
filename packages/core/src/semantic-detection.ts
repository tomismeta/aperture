import type { AttentionConsequenceLevel } from "./frame.js";
import {
  EXPLICIT_BLOCKING_PHRASES,
  EXPLICIT_WAITING_PHRASES,
  HIGH_RISK_PHRASES,
  IMPLIED_OPERATOR_ASKS,
  IMPLIED_OPERATOR_ASK_PATTERNS,
  IMPLIED_OPERATOR_NEGATIONS,
} from "./semantic-patterns.js";
import { readSemanticTextEvidence } from "./semantic-evidence.js";
import {
  containsAnySemanticPhrase,
  containsSemanticPhrase,
  normalizeSemanticText,
} from "./semantic-text.js";
import {
  isSemanticCommandExecutionToolFamily,
  type SemanticToolFamilyContextItem,
} from "./semantic-tool-family.js";

export { containsAnySemanticPhrase, normalizeSemanticText } from "./semantic-text.js";
export { detectSemanticRelationHints } from "./semantic-relation-detection.js";
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

  if (containsAnySemanticPhrase(text, IMPLIED_OPERATOR_ASKS)) {
    return true;
  }

  const normalizedText = normalizeSemanticText(text);
  return IMPLIED_OPERATOR_ASK_PATTERNS.some((pattern) => pattern.test(normalizedText));
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
