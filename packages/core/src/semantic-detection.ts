import type { AttentionConsequenceLevel } from "./frame.js";
import {
  BUILD_METADATA_PATTERN,
  BUILD_METADATA_PHRASES,
  CODE_CONTENT_PATTERN,
  CONTEXTUAL_RESOLVE_PHRASES,
  DIRECT_RESOLVE_PHRASES,
  ESCALATE_PHRASES,
  EXPECTED_DIAGNOSTIC_FAILURE_PHRASES,
  EXPLICIT_BLOCKING_PHRASES,
  EXPLICIT_WAITING_PHRASES,
  HIGH_RISK_PHRASES,
  IMPLIED_OPERATOR_ASKS,
  IMPLIED_OPERATOR_NEGATIONS,
  ISSUE_SIGNAL_PHRASES,
  LINE_NUMBERED_CODE_PATTERN,
  LINE_NUMBERED_SOURCE_CODE_PATTERN,
  LOG_LIKE_OBSERVATION_PHRASES,
  LOG_OUTPUT_PATTERN,
  NEGATED_ESCALATE_PHRASES,
  NEGATED_REPEAT_PHRASES,
  NEGATED_RESOLVE_PHRASES,
  OBSERVATIONAL_PAYLOAD_PHRASES,
  OBSERVATIONAL_READBACK_PHRASES,
  PATH_LIKE_TOKEN_PATTERN,
  REPEAT_PHRASES,
  ROUTINE_SUCCESS_PHRASES,
  SEARCH_RESULT_OUTPUT_PATTERN,
  SOURCE_CODE_CONTENT_PATTERN,
  SOURCE_CODE_FILENAME_PATTERN,
  SOURCE_CODE_PATH_PATTERN,
  SUPERSEDE_PHRASES,
  TAGGED_FILE_OBSERVATION_PHRASES,
  TERMINAL_FAILURE_PHRASES,
} from "./semantic-patterns.js";
import type { SemanticRelationHint } from "./semantic-types.js";

export type SemanticDetectionContextItem = {
  id: string;
  label: string;
  value?: string;
};

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

// Preserve path-like separators, underscores, and hyphens so file paths,
// command tokens, and constant-like log terms survive normalization as stable
// anchors instead of being rewritten into natural-language phrases.
export function normalizeSemanticText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9/._-]+/g, " ")
    .trim();
}

export function dedupeSemanticStrings(values: string[]): string[] {
  return [...new Set(values)];
}

export function readExplicitSemanticToolFamily(input: SemanticDetectionInput): string | null {
  return (
    normalizeToolFamily(input.toolFamily) ??
    normalizeToolFamily(readMetadataToolFamily(input.metadata)) ??
    normalizeToolFamily(readContextToolFamily(input.context))
  );
}

export function inferSemanticToolFamily(input: SemanticDetectionInput): string | null {
  const explicit = readExplicitSemanticToolFamily(input);
  if (explicit) {
    return explicit;
  }

  const value = normalizeSemanticText(`${input.title} ${input.summary ?? ""}`);
  const candidates: Array<{ toolFamily: string; risk: number; order: number }> = [];

  if (
    hasPhrase(value, "wants to read") ||
    hasPhrase(value, "wants to inspect") ||
    hasWord(value, "read") ||
    hasWord(value, "inspect")
  ) {
    candidates.push({ toolFamily: "read", risk: 1, order: 0 });
  }
  if (hasPhrase(value, "search files") || hasPhrase(value, "search file contents")) {
    candidates.push({ toolFamily: "search", risk: 1, order: 1 });
  }
  if (hasPhrase(value, "search the web")) {
    candidates.push({ toolFamily: "web", risk: 2, order: 2 });
  }
  if (hasPhrase(value, "wants to write") || hasWord(value, "write")) {
    candidates.push({ toolFamily: "write", risk: 3, order: 3 });
  }
  if (hasPhrase(value, "wants to edit") || hasWord(value, "edit")) {
    candidates.push({ toolFamily: "edit", risk: 3, order: 4 });
  }
  if (hasPhrase(value, "shell command") || hasPhrase(value, "wants to run")) {
    candidates.push({ toolFamily: "bash", risk: 3, order: 5 });
  }

  return (
    candidates.sort((left, right) => right.risk - left.risk || left.order - right.order)[0]
      ?.toolFamily ?? null
  );
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
  const hasRepeatSignal =
    containsAnySemanticPhrase(text, REPEAT_PHRASES) &&
    !containsAnySemanticPhrase(text, NEGATED_REPEAT_PHRASES);
  const hasDirectResolveSignal =
    containsAnySemanticPhrase(text, DIRECT_RESOLVE_PHRASES) &&
    !containsAnySemanticPhrase(text, NEGATED_RESOLVE_PHRASES);
  const hasContextualResolveSignal =
    containsAnySemanticPhrase(text, CONTEXTUAL_RESOLVE_PHRASES) &&
    !containsAnySemanticPhrase(text, NEGATED_RESOLVE_PHRASES);
  const hasEscalateSignal =
    containsAnySemanticPhrase(text, ESCALATE_PHRASES) &&
    !containsAnySemanticPhrase(text, NEGATED_ESCALATE_PHRASES);
  const hasIssueSignal =
    containsAnySemanticPhrase(text, ISSUE_SIGNAL_PHRASES) ||
    containsAnySemanticPhrase(text, SUPERSEDE_PHRASES) ||
    hasEscalateSignal;

  if (hasRepeatSignal && hasIssueSignal) {
    hints.push({ kind: "same_issue" }, { kind: "repeats" });
  }

  if (hasDirectResolveSignal || (hasContextualResolveSignal && hasIssueSignal)) {
    hints.push({ kind: "same_issue" }, { kind: "resolves" });
  }

  if (containsAnySemanticPhrase(text, SUPERSEDE_PHRASES)) {
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
  if (isRoutineSuccessObservation(text)) {
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

  if (toolFamily === "write" || toolFamily === "edit" || toolFamily === "bash") {
    return fallback === "low" ? "medium" : fallback;
  }

  return fallback;
}

export function detectObservationalFailureStatus(text: string, toolFamily?: string): boolean {
  if (toolFamily === "bash") {
    return isRoutineSuccessObservation(text);
  }

  if (toolFamily !== "edit" && toolFamily !== "read") {
    return false;
  }

  return (
    containsAnySemanticPhrase(text, OBSERVATIONAL_READBACK_PHRASES) ||
    looksLikeTaggedFileObservation(text) ||
    looksLikeReadObservationPayload(text)
  );
}

export function detectRoutineObservationalFailureLowConsequence(
  text: string,
  toolFamily?: string,
): boolean {
  if (toolFamily === "bash") {
    return isRoutineSuccessObservation(text);
  }

  if (toolFamily === "search") {
    return looksLikeSearchResultOutput(text);
  }

  if (toolFamily === "read") {
    if (looksLikeSearchResultOutput(text)) {
      return true;
    }

    if (!looksLikeTaggedFileObservation(text) && !looksLikeReadObservationPayload(text)) {
      return false;
    }

    if (looksLikeSourceCodeObservation(text)) {
      return false;
    }

    return looksLikeLogObservation(text) || looksLikeBuildMetadataObservation(text);
  }

  return false;
}

export function detectExpectedDiagnosticFailure(text: string, toolFamily?: string): boolean {
  if (toolFamily !== "bash") {
    return false;
  }

  return (
    containsAnySemanticPhrase(text, EXPECTED_DIAGNOSTIC_FAILURE_PHRASES) &&
    !containsAnySemanticPhrase(text, TERMINAL_FAILURE_PHRASES)
  );
}

export function containsAnySemanticPhrase(value: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => containsSemanticPhrase(value, phrase));
}

function containsAnySemanticRiskPhrase(value: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => containsSemanticRiskPhrase(value, phrase));
}

function containsSemanticPhrase(value: string, phrase: string): boolean {
  const normalizedPhrase = normalizeSemanticText(phrase);
  if (!normalizedPhrase) {
    return false;
  }

  if (!normalizedPhrase.includes(" ")) {
    return hasWord(value, normalizedPhrase);
  }

  return hasPhrase(value, normalizedPhrase);
}

function containsSemanticRiskPhrase(value: string, phrase: string): boolean {
  return containsSemanticPhrase(value, phrase);
}

function looksLikeReadObservationPayload(text: string): boolean {
  if (!containsPathLikeToken(text)) {
    return false;
  }

  return (
    containsAnySemanticPhrase(text, OBSERVATIONAL_PAYLOAD_PHRASES) ||
    containsCodeLikeContent(text) ||
    containsLineNumberedCodeContent(text)
  );
}

function looksLikeTaggedFileObservation(text: string): boolean {
  return (
    containsAnySemanticPhrase(text, TAGGED_FILE_OBSERVATION_PHRASES) && containsPathLikeToken(text)
  );
}

function looksLikeSearchResultOutput(text: string): boolean {
  return (
    SEARCH_RESULT_OUTPUT_PATTERN.test(text) ||
    (containsPathLikeToken(text) && /\bmatch(?:es)?\b/.test(text))
  );
}

function containsPathLikeToken(text: string): boolean {
  return PATH_LIKE_TOKEN_PATTERN.test(text);
}

function containsCodeLikeContent(text: string): boolean {
  return CODE_CONTENT_PATTERN.test(text);
}

function containsLineNumberedCodeContent(text: string): boolean {
  return LINE_NUMBERED_CODE_PATTERN.test(text);
}

function looksLikeSourceCodeObservation(text: string): boolean {
  return (
    SOURCE_CODE_PATH_PATTERN.test(text) ||
    SOURCE_CODE_FILENAME_PATTERN.test(text) ||
    SOURCE_CODE_CONTENT_PATTERN.test(text) ||
    LINE_NUMBERED_SOURCE_CODE_PATTERN.test(text)
  );
}

function looksLikeLogObservation(text: string): boolean {
  return (
    LOG_OUTPUT_PATTERN.test(text) || containsAnySemanticPhrase(text, LOG_LIKE_OBSERVATION_PHRASES)
  );
}

function looksLikeBuildMetadataObservation(text: string): boolean {
  return (
    BUILD_METADATA_PATTERN.test(text) || containsAnySemanticPhrase(text, BUILD_METADATA_PHRASES)
  );
}

function readMetadataToolFamily(metadata?: Record<string, unknown>): string | null {
  const value = metadata?.toolFamily;
  return typeof value === "string" ? value : null;
}

function readContextToolFamily(input?: SemanticDetectionInput["context"]): string | null {
  if (!input?.items) {
    return null;
  }

  for (const item of input.items) {
    const id = item.id.toLowerCase();
    const label = item.label.toLowerCase();
    if (id === "toolfamily" || id === "tool_family" || id === "tool" || label === "tool family") {
      return item.value ?? null;
    }
  }

  return null;
}

function normalizeToolFamily(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function hasPhrase(value: string, phrase: string): boolean {
  const normalizedPhrase = normalizeSemanticText(phrase);
  if (!normalizedPhrase) {
    return false;
  }

  return new RegExp(`(?:^|[^a-z0-9_])${escapeRegExp(normalizedPhrase)}(?:$|[^a-z0-9_])`).test(
    value,
  );
}

function hasWord(value: string, word: string): boolean {
  return new RegExp(`(?:^|[^a-z0-9_])${escapeRegExp(word)}(?:$|[^a-z0-9_])`).test(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isRoutineSuccessObservation(text: string): boolean {
  return (
    isStandaloneRoutineSuccessObservation(text) &&
    !containsAnySemanticPhrase(text, TERMINAL_FAILURE_PHRASES)
  );
}

function isStandaloneRoutineSuccessObservation(text: string): boolean {
  const normalizedText = text.replace(/\.+$/, "");
  const successPhrases = ROUTINE_SUCCESS_PHRASES.map((phrase) => normalizeSemanticText(phrase));
  const allowedPrefixes = [
    "",
    "observation",
    "bash failure",
    "bash observation",
    "tool failure",
    "tool observation",
  ];

  return allowedPrefixes.some((prefix) =>
    successPhrases.some((phrase) => {
      const expected = prefix.length > 0 ? `${prefix} ${phrase}` : phrase;
      return normalizedText === expected;
    }),
  );
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
