import type { AttentionConsequenceLevel } from "./frame.js";
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

// Preserve path-like separators and hyphens so file paths, commands, and
// hyphenated tool terms survive normalization as semantic anchors.
export function normalizeSemanticText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9/.-]+/g, " ").trim();
}

export function dedupeSemanticStrings(values: string[]): string[] {
  return [...new Set(values)];
}

export function readExplicitSemanticToolFamily(input: SemanticDetectionInput): string | null {
  return (
    normalizeToolFamily(input.toolFamily)
    ?? normalizeToolFamily(readMetadataToolFamily(input.metadata))
    ?? normalizeToolFamily(readContextToolFamily(input.context))
  );
}

export function inferSemanticToolFamily(input: SemanticDetectionInput): string | null {
  const explicit = readExplicitSemanticToolFamily(input);
  if (explicit) {
    return explicit;
  }

  const value = normalizeSemanticText(`${input.title} ${input.summary ?? ""}`);
  if (hasPhrase(value, "wants to read") || hasPhrase(value, "wants to inspect") || hasWord(value, "read") || hasWord(value, "inspect")) return "read";
  if (hasPhrase(value, "wants to write") || hasWord(value, "write")) return "write";
  if (hasPhrase(value, "wants to edit") || hasWord(value, "edit")) return "edit";
  if (hasPhrase(value, "shell command") || hasPhrase(value, "wants to run")) return "bash";
  if (hasPhrase(value, "search the web")) return "web";
  if (hasPhrase(value, "search files") || hasPhrase(value, "search file contents")) return "search";
  return null;
}

export function detectImpliedOperatorAsk(text: string): boolean {
  if (containsAnySemanticPhrase(text, IMPLIED_OPERATOR_NEGATIONS)) {
    return false;
  }

  return containsAnySemanticPhrase(text, IMPLIED_OPERATOR_ASKS);
}

export function detectSemanticRelationHints(text: string): SemanticRelationHint[] {
  const hints: SemanticRelationHint[] = [];
  const hasIssueSignal = containsAnySemanticPhrase(text, ISSUE_SIGNAL_PHRASES)
    || containsAnySemanticPhrase(text, RESOLVE_PHRASES)
    || containsAnySemanticPhrase(text, SUPERSEDE_PHRASES)
    || containsAnySemanticPhrase(text, ESCALATE_PHRASES);

  if (containsAnySemanticPhrase(text, REPEAT_PHRASES) && hasIssueSignal) {
    hints.push({ kind: "same_issue" }, { kind: "repeats" });
  }

  if (containsAnySemanticPhrase(text, RESOLVE_PHRASES) && hasIssueSignal) {
    hints.push({ kind: "same_issue" }, { kind: "resolves" });
  }

  if (containsAnySemanticPhrase(text, SUPERSEDE_PHRASES)) {
    hints.push({ kind: "same_issue" }, { kind: "supersedes" });
  }

  if (containsAnySemanticPhrase(text, ESCALATE_PHRASES)) {
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

export function detectObservationalFailureStatus(
  text: string,
  toolFamily?: string,
): boolean {
  if (toolFamily !== "edit" && toolFamily !== "read") {
    return false;
  }

  return containsAnySemanticPhrase(text, OBSERVATIONAL_READBACK_PHRASES)
    || looksLikeTaggedFileObservation(text)
    || looksLikeReadObservationPayload(text);
}

export function detectRoutineObservationalFailureLowConsequence(
  text: string,
  toolFamily?: string,
): boolean {
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

export function detectExpectedDiagnosticFailure(
  text: string,
  toolFamily?: string,
): boolean {
  if (toolFamily !== "bash") {
    return false;
  }

  return containsAnySemanticPhrase(text, EXPECTED_DIAGNOSTIC_FAILURE_PHRASES)
    && !containsAnySemanticPhrase(text, TERMINAL_FAILURE_PHRASES);
}

export function containsAnySemanticPhrase(value: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => value.includes(phrase));
}

function containsAnySemanticRiskPhrase(value: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => containsSemanticRiskPhrase(value, phrase));
}

function containsSemanticRiskPhrase(value: string, phrase: string): boolean {
  const normalizedPhrase = normalizeSemanticText(phrase);
  if (!normalizedPhrase) {
    return false;
  }

  if (!normalizedPhrase.includes(" ")) {
    return hasWord(value, normalizedPhrase);
  }

  return new RegExp(`(?:^|\\s)${escapeRegExp(normalizedPhrase)}(?:\\s|$)`).test(value);
}

function looksLikeReadObservationPayload(text: string): boolean {
  if (!containsPathLikeToken(text)) {
    return false;
  }

  return containsAnySemanticPhrase(text, OBSERVATIONAL_PAYLOAD_PHRASES)
    || containsCodeLikeContent(text)
    || containsLineNumberedCodeContent(text);
}

function looksLikeTaggedFileObservation(text: string): boolean {
  return containsAnySemanticPhrase(text, TAGGED_FILE_OBSERVATION_PHRASES)
    && containsPathLikeToken(text);
}

function looksLikeSearchResultOutput(text: string): boolean {
  return SEARCH_RESULT_OUTPUT_PATTERN.test(text)
    || (containsPathLikeToken(text) && /\bmatch(?:es)?\b/.test(text));
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
  return SOURCE_CODE_PATH_PATTERN.test(text)
    || SOURCE_CODE_FILENAME_PATTERN.test(text)
    || SOURCE_CODE_CONTENT_PATTERN.test(text)
    || LINE_NUMBERED_SOURCE_CODE_PATTERN.test(text);
}

function looksLikeLogObservation(text: string): boolean {
  return LOG_OUTPUT_PATTERN.test(text)
    || containsAnySemanticPhrase(text, LOG_LIKE_OBSERVATION_PHRASES);
}

function looksLikeBuildMetadataObservation(text: string): boolean {
  return BUILD_METADATA_PATTERN.test(text)
    || containsAnySemanticPhrase(text, BUILD_METADATA_PHRASES);
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
  return value.includes(phrase);
}

function hasWord(value: string, word: string): boolean {
  return new RegExp(`(?:^|\\s)${escapeRegExp(word)}(?:\\s|$)`).test(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const IMPLIED_OPERATOR_ASKS = [
  "need your input",
  "need your approval",
  "waiting for approval",
  "approval required",
  "awaiting sign off",
  "awaiting sign-off",
  "sign off required",
  "sign-off required",
  "need your sign off",
  "need your sign-off",
  "should i continue",
  "can you approve",
  "what should i do",
  "please review",
] as const;

const IMPLIED_OPERATOR_NEGATIONS = [
  "no action needed",
  "no approval needed",
  "approval is not needed",
  "approval not needed",
  "sign off not needed",
  "sign-off not needed",
  "no input needed",
  "for awareness only",
  "for your awareness",
  "continuing automatically",
] as const;

const HIGH_RISK_PHRASES = [
  "production",
  "prod",
  "force push",
  "git push --force",
  "rm -rf",
  "drop table",
  "delete database",
  "delete prod",
  "sudo",
  "chmod 777",
  "kill process",
  "migrate",
] as const;

const OBSERVATIONAL_READBACK_PHRASES = [
  "result of running cat -n",
  "result of running sed -n",
  "result of running grep",
  "result of running ls",
  "result of running find",
  "here s the result of running cat -n",
  "here s the result of running sed -n",
] as const;

const OBSERVATIONAL_PAYLOAD_PHRASES = [
  "observation",
  "contents of",
  "showing first",
  "showing top",
  "found",
] as const;

const TAGGED_FILE_OBSERVATION_PHRASES = [
  "path",
  "type file",
  "content",
] as const;

const ROUTINE_SUCCESS_PHRASES = [
  "ran successfully and did not produce any output",
  "command ran successfully and did not produce any output",
  "completed successfully and did not produce any output",
] as const;

const LOG_LIKE_OBSERVATION_PHRASES = [
  "tool-output",
  "dmesg",
] as const;

const BUILD_METADATA_PHRASES = [
  "makefile",
  "spdx-license-identifier",
  "patchlevel",
  "sublevel",
  "extraversion",
] as const;

const PATH_LIKE_TOKEN_PATTERN = /(?:^|\s)\/[a-z0-9._-]+(?:\/[a-z0-9._-]+)+(?:\s|$)/;
const SEARCH_RESULT_OUTPUT_PATTERN = /\bfound\s+\d+\s+match(?:es)?\b|\bshowing\s+(?:first|top)\s+\d+\b|\bmatch(?:es)?\s+in\s+\d+\s+files?\b/;
const CODE_CONTENT_PATTERN = /\b(import|from|export|class|def|function|const|let|var|return)\b/;
const LINE_NUMBERED_CODE_PATTERN = /\b\d+\s+(?:import|from|export|class|def|function|const|let|var|return)\b/;
const SOURCE_CODE_PATH_PATTERN = /\/[a-z0-9._/-]+\.(?:c|cc|cpp|cxx|h|hpp|ts|tsx|js|jsx|py|rb|go|rs|java|kt|swift)(?:\b|\/)/;
const SOURCE_CODE_FILENAME_PATTERN = /\b[a-z0-9.-]+\.(?:c|cc|cpp|cxx|h|hpp|ts|tsx|js|jsx|py|rb|go|rs|java|kt|swift)\b/;
const SOURCE_CODE_CONTENT_PATTERN = /\b(static|struct|enum|typedef|void|int|char|bool|return)\b/;
const LINE_NUMBERED_SOURCE_CODE_PATTERN = /\b\d+\s+(?:static|struct|enum|typedef|void|int|char|bool|return)\b/;
const LOG_OUTPUT_PATTERN = /\b\d+\s+\[\s*\d+\.\d+\]\s+[a-z0-9_.:-]+/;
const BUILD_METADATA_PATTERN = /\b(?:version|patchlevel|sublevel|extraversion)\b/;

const EXPECTED_DIAGNOSTIC_FAILURE_PHRASES = [
  "form is valid false",
  "form without instance is valid false",
  "form errors",
  "errorlist",
  "decompress result",
] as const;

const TERMINAL_FAILURE_PHRASES = [
  "traceback",
  "exception",
  "permission denied",
  "command not found",
  "segmentation fault",
] as const;

function isRoutineSuccessObservation(text: string): boolean {
  return containsAnySemanticPhrase(text, ROUTINE_SUCCESS_PHRASES);
}

const REPEAT_PHRASES = [
  "still",
  "again",
  "continues",
  "continuing",
  "remains",
  "persisting",
  "retrying",
  "recurred",
] as const;

const RESOLVE_PHRASES = [
  "resolved",
  "fixed",
  "unblocked",
  "recovered",
  "completed successfully",
  "no longer blocked",
  "succeeded after",
] as const;

const SUPERSEDE_PHRASES = [
  "instead",
  "superseded",
  "supersedes",
  "replaced by",
  "use this plan instead",
  "follow this plan instead",
] as const;

const ESCALATE_PHRASES = [
  "worse",
  "worsened",
  "escalating",
  "spread",
  "broader impact",
  "degraded further",
  "critical now",
  "now failing",
] as const;

const ISSUE_SIGNAL_PHRASES = [
  "fail",
  "failed",
  "failing",
  "failure",
  "error",
  "broken",
  "blocked",
  "stalled",
  "stall",
  "incident",
  "issue",
  "outage",
  "degraded",
  "retry",
  "rollback",
] as const;

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
