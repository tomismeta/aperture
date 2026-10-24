import type { AttentionConsequenceLevel } from "./frame.js";
import {
  EXPLICIT_BLOCKING_PHRASES,
  EXPLICIT_WAITING_PHRASES,
  HIGH_CONSEQUENCE_COMMAND_PATTERN,
  HIGH_RISK_PHRASES,
  IMPLIED_OPERATOR_ASKS,
  IMPLIED_OPERATOR_ASK_PATTERNS,
  IMPLIED_OPERATOR_NEGATIONS,
} from "./semantic-patterns.js";
import { semanticTextShapeMatcher } from "./semantic-evidence.js";
import { containsAnySemanticPhrase, normalizeSemanticText } from "./semantic-text.js";
import { isSemanticCommandExecutionToolFamily } from "./semantic-tool-family.js";

export { containsAnySemanticPhrase, normalizeSemanticText } from "./semantic-text.js";
export { detectSemanticRelationHints } from "./semantic-relation-detection.js";
export { inferSemanticToolFamily, readExplicitSemanticToolFamily } from "./semantic-tool-family.js";

export type SemanticDetectionInput = {
  title: string;
  summary?: string;
  toolFamily?: string;
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
  if (
    isSemanticCommandExecutionToolFamily(toolFamily) &&
    HIGH_CONSEQUENCE_COMMAND_PATTERN.test(text)
  ) {
    return "high";
  }

  const hasShape = semanticTextShapeMatcher(text, toolFamily);

  if (hasShape("routine_success")) {
    return fallback;
  }

  // Read/search work is treated as side-effect-free. Production wording alone
  // should not escalate those requests beyond the explicit source fallback.
  if (toolFamily === "read" || toolFamily === "search") {
    return fallback;
  }

  if (containsAnySemanticPhrase(text, HIGH_RISK_PHRASES)) {
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
