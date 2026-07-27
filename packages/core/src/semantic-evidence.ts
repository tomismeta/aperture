import {
  BUILD_METADATA_PATTERN,
  BUILD_METADATA_PHRASES,
  CODE_CONTENT_PATTERN,
  EXPECTED_DIAGNOSTIC_FAILURE_PHRASES,
  ISSUE_SIGNAL_PHRASES,
  LINE_NUMBERED_CODE_PATTERN,
  LINE_NUMBERED_SOURCE_CODE_PATTERN,
  LOG_LIKE_OBSERVATION_PHRASES,
  LOG_OUTPUT_PATTERN,
  OBSERVATIONAL_PAYLOAD_PHRASES,
  OBSERVATIONAL_READBACK_PHRASES,
  PATH_LIKE_TOKEN_PATTERN,
  ROUTINE_SUCCESS_PHRASES,
  SEARCH_RESULT_OUTPUT_PATTERN,
  SOURCE_CODE_CONTENT_PATTERN,
  SOURCE_CODE_FILENAME_PATTERN,
  SOURCE_CODE_PATH_PATTERN,
  TAGGED_FILE_OBSERVATION_PHRASES,
  TERMINAL_FAILURE_PHRASES,
} from "./semantic-patterns.js";
import type { SemanticInterpretation } from "./semantic-types.js";
import { containsAnySemanticPhrase, normalizeSemanticText } from "./semantic-text.js";
import { readExplicitSemanticToolFamily } from "./semantic-tool-family.js";

export type SemanticTextEvidence = {
  routineSuccessObservation: boolean;
  terminalFailureEvidence: boolean;
  expectedDiagnosticFailure: boolean;
  observationalReadback: boolean;
  taggedFileObservation: boolean;
  readObservationPayload: boolean;
  searchResultOutput: boolean;
  sourceCodeObservation: boolean;
  logObservation: boolean;
  buildMetadataObservation: boolean;
};

export type TaskFailureEvidenceKind =
  | "routine_bash_success_observation"
  | "observational_payload"
  | "routine_search_output"
  | "expected_diagnostic_failure"
  | "terminal_failure"
  | "unclassified_failure";

export type TaskFailureSemanticEvidence = {
  kind: TaskFailureEvidenceKind;
  toolFamily?: string;
  readsAsObservation: boolean;
  consequenceBaseline: "low" | "medium" | "high";
  text: SemanticTextEvidence;
};

type SemanticEvidenceTaskUpdateEvent = {
  id?: string;
  taskId?: string;
  timestamp?: string;
  type: string;
  status?: string;
  title?: string;
  summary?: string;
  toolFamily?: string;
  context?: {
    items?: Array<{
      id: string;
      label: string;
      value?: string;
    }>;
  };
  metadata?: Record<string, unknown>;
};

export function readSemanticTextEvidence(value: string, toolFamily?: string): SemanticTextEvidence {
  const text = normalizeSemanticText(value);
  const terminalFailureEvidence = looksLikeTerminalFailureEvidence(text);

  return {
    routineSuccessObservation:
      toolFamily === "bash" &&
      (isStandaloneRoutineSuccessObservation(text) ||
        (looksLikeZeroTerminalExit(text) && !looksLikeContradictoryFailureObservation(text))) &&
      !terminalFailureEvidence,
    terminalFailureEvidence,
    expectedDiagnosticFailure:
      toolFamily === "bash" &&
      containsAnySemanticPhrase(text, EXPECTED_DIAGNOSTIC_FAILURE_PHRASES) &&
      !terminalFailureEvidence,
    observationalReadback: containsAnySemanticPhrase(text, OBSERVATIONAL_READBACK_PHRASES),
    taggedFileObservation: looksLikeTaggedFileObservation(text),
    readObservationPayload: looksLikeReadObservationPayload(text),
    searchResultOutput: looksLikeSearchResultOutput(text),
    sourceCodeObservation: looksLikeSourceCodeObservation(text),
    logObservation: looksLikeLogObservation(text),
    buildMetadataObservation: looksLikeBuildMetadataObservation(text),
  };
}

export function readTaskFailureSemanticEvidence(
  event: SemanticEvidenceTaskUpdateEvent,
): TaskFailureSemanticEvidence | null {
  if (event.type !== "task.updated" || event.status !== "failed" || event.title === undefined) {
    return null;
  }

  const toolFamily =
    readExplicitSemanticToolFamily({
      title: event.title,
      ...(event.summary !== undefined ? { summary: event.summary } : {}),
      ...(event.toolFamily !== undefined ? { toolFamily: event.toolFamily } : {}),
      ...(event.context !== undefined ? { context: event.context } : {}),
    }) ?? undefined;
  const text = readSemanticTextEvidence(`${event.title} ${event.summary ?? ""}`, toolFamily);

  if (text.terminalFailureEvidence) {
    return {
      kind: "terminal_failure",
      ...(toolFamily !== undefined ? { toolFamily } : {}),
      readsAsObservation: false,
      consequenceBaseline: "high",
      text,
    };
  }

  if (toolFamily === "bash" && text.routineSuccessObservation) {
    return {
      kind: "routine_bash_success_observation",
      toolFamily,
      readsAsObservation: true,
      consequenceBaseline: "low",
      text,
    };
  }

  if (toolFamily === "bash" && text.expectedDiagnosticFailure) {
    return {
      kind: "expected_diagnostic_failure",
      toolFamily,
      readsAsObservation: false,
      consequenceBaseline: "medium",
      text,
    };
  }

  if (toolFamily === "search" && text.searchResultOutput) {
    return {
      kind: "routine_search_output",
      toolFamily,
      readsAsObservation: false,
      consequenceBaseline: "low",
      text,
    };
  }

  if (
    (toolFamily === "edit" || toolFamily === "read") &&
    (text.observationalReadback || text.taggedFileObservation || text.readObservationPayload)
  ) {
    return {
      kind: "observational_payload",
      toolFamily,
      readsAsObservation: true,
      consequenceBaseline:
        toolFamily === "read" &&
        !text.sourceCodeObservation &&
        (text.searchResultOutput || text.logObservation || text.buildMetadataObservation)
          ? "low"
          : "high",
      text,
    };
  }

  return {
    kind: "unclassified_failure",
    ...(toolFamily !== undefined ? { toolFamily } : {}),
    readsAsObservation: false,
    consequenceBaseline: "high",
    text,
  };
}

export function hasRoutineObservationalStatusConflictSemanticRead(
  event: SemanticEvidenceTaskUpdateEvent,
  interpretation: SemanticInterpretation,
  abstained = interpretation.abstained === true,
): boolean {
  const failureEvidence = readTaskFailureSemanticEvidence(event);

  return (
    event.type === "task.updated" &&
    event.status === "failed" &&
    failureEvidence?.kind === "routine_bash_success_observation" &&
    interpretation.intentFrame === "status_update" &&
    interpretation.activityClass === "status_update" &&
    interpretation.toolFamily === "bash" &&
    interpretation.consequence === "low" &&
    interpretation.confidence === "high" &&
    !abstained
  );
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

function looksLikeTerminalFailureEvidence(text: string): boolean {
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

function looksLikeNonzeroTerminalExit(text: string): boolean {
  return (
    hasTerminalExitCode(text, (code) => code !== 0) ||
    hasUnbenignSemanticPhraseOccurrence(text, "non-zero exit", defaultBenignPhrasePatterns) ||
    hasUnbenignSemanticPhraseOccurrence(text, "nonzero exit", defaultBenignPhrasePatterns)
  );
}

function looksLikeZeroTerminalExit(text: string): boolean {
  return hasTerminalExitCode(text, (code) => code === 0);
}

function looksLikeContradictoryFailureObservation(text: string): boolean {
  const issueText = removeTerminalExitCodeObservations(stripRoutineFailurePrefix(text));
  return ISSUE_SIGNAL_PHRASES.some((phrase) =>
    hasUnbenignSemanticPhraseOccurrence(issueText, phrase, defaultBenignIssuePatterns),
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
  return [
    new RegExp(String.raw`\bno ${normalizedPhrase}\b`),
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
  /\bno exceptions?(?: occurred| raised| reported| found| seen| present)?\b/,
  /\bwithout (?:an? )?exceptions?\b/,
  /\bexpected exceptions?(?: was| were)? (?:caught|handled|raised)\b/,
  /\b(?:caught|handled) (?:the )?expected exceptions?\b/,
  /\bexceptions?(?: was| were)? expected\b/,
] as const;

const BENIGN_TRACEBACK_PATTERNS = [
  /\bno tracebacks?(?: occurred| raised| reported| found| seen| present)?\b/,
  /\bwithout (?:a )?tracebacks?\b/,
  /\bexpected tracebacks?(?: was| were)? (?:caught|handled|raised|produced)\b/,
  /\btracebacks?(?: was| were)? expected\b/,
] as const;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
