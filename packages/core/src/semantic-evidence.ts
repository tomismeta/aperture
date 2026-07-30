import {
  BUILD_METADATA_PATTERN,
  BUILD_METADATA_PHRASES,
  CODE_CONTENT_PATTERN,
  EXPECTED_DIAGNOSTIC_FAILURE_PHRASES,
  LINE_NUMBERED_CODE_PATTERN,
  LINE_NUMBERED_SOURCE_CODE_PATTERN,
  LOG_LIKE_OBSERVATION_PHRASES,
  LOG_OUTPUT_PATTERN,
  OBSERVATIONAL_PAYLOAD_PHRASES,
  OBSERVATIONAL_READBACK_PHRASES,
  PATH_LIKE_TOKEN_PATTERN,
  ROUTINE_SUCCESS_PHRASES,
  SOURCE_CODE_CONTENT_PATTERN,
  SOURCE_CODE_FILENAME_PATTERN,
  SOURCE_CODE_PATH_PATTERN,
  TAGGED_FILE_OBSERVATION_PHRASES,
} from "./semantic-patterns.js";
import type { SemanticInterpretation } from "./semantic-types.js";
import type {
  ObservationalStatusConflictEvidence,
  ObservationalStatusConflictKind,
} from "./judgment-input-types.js";
import { containsAnySemanticPhrase, normalizeSemanticText } from "./semantic-text.js";
import { readTaskFailureSemanticSignals } from "./semantic-task-failure-signals.js";
import {
  looksLikeBuildOrLogObservation,
  looksLikePlainReadObservation,
} from "./semantic-observation-shapes.js";
import { looksLikeSearchResultObservation } from "./semantic-search-observation-shapes.js";
import {
  looksLikeContradictoryFailureObservation,
  looksLikeTerminalFailureEvidence,
  looksLikeZeroTerminalExit,
} from "./semantic-terminal-evidence.js";
import {
  isSemanticCommandExecutionToolFamily,
  readExplicitSemanticToolFamily,
} from "./semantic-tool-family.js";

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
  | "structured_tool_output_observation"
  | "empty_failure_payload"
  | "observational_payload"
  | "routine_search_output"
  | "expected_diagnostic_failure"
  | "terminal_failure"
  | "rejected_tool_use_observation"
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
  const commandExecutionTool = isSemanticCommandExecutionToolFamily(toolFamily);
  const routineCommandText = stripCommandExecutionRoutinePrefix(text, toolFamily);

  return {
    routineSuccessObservation:
      commandExecutionTool &&
      (isStandaloneRoutineSuccessObservation(text, toolFamily) ||
        (looksLikeZeroTerminalExit(routineCommandText) &&
          !looksLikeContradictoryFailureObservation(routineCommandText))) &&
      !terminalFailureEvidence,
    terminalFailureEvidence,
    expectedDiagnosticFailure:
      commandExecutionTool &&
      containsAnySemanticPhrase(text, EXPECTED_DIAGNOSTIC_FAILURE_PHRASES) &&
      !terminalFailureEvidence,
    observationalReadback: containsAnySemanticPhrase(text, OBSERVATIONAL_READBACK_PHRASES),
    taggedFileObservation: looksLikeTaggedFileObservation(text),
    readObservationPayload:
      looksLikeReadObservationPayload(text) ||
      (toolFamily === "read" && looksLikePlainReadObservation(value)),
    searchResultOutput: looksLikeSearchResultObservation(text, value),
    sourceCodeObservation: looksLikeSourceCodeObservation(text),
    logObservation: looksLikeLogObservation(text, value),
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
  const text = readSemanticTextEvidence(
    toolFamily === "search"
      ? (event.summary ?? event.title)
      : `${event.title} ${event.summary ?? ""}`,
    toolFamily,
  );
  const signals = readTaskFailureSemanticSignals({ summary: event.summary, toolFamily });
  const searchOutputObservation = toolFamily === "search" && text.searchResultOutput;
  const terminalFailureEvidence = signals.structuredOutputExitFailure
    ? true
    : signals.strongSourceRuntimeDiagnostic
      ? true
      : signals.structuredOutputFailureDiagnostic ||
          signals.editOutputOutcome === "failure" ||
          signals.searchFailureDiagnostic ||
          signals.readFailureDiagnostic ||
          signals.diagnosticObservationTranscript
        ? true
        : signals.rawToolOutputFailureDiagnostic
          ? true
          : text.terminalFailureEvidence &&
            signals.missingToolObservationTranscript === null &&
            !searchOutputObservation &&
            (!signals.rawReadStructuredObservation || signals.strongSourceRuntimeDiagnostic) &&
            (!signals.structuredOutputSourceObservation || signals.strongSourceRuntimeDiagnostic);

  if (terminalFailureEvidence) {
    return {
      kind: "terminal_failure",
      ...(toolFamily !== undefined ? { toolFamily } : {}),
      readsAsObservation: false,
      consequenceBaseline: "high",
      text,
    };
  }

  if (toolFamily !== undefined && event.summary?.trim() === "{}") {
    return {
      kind: "empty_failure_payload",
      toolFamily,
      readsAsObservation: false,
      consequenceBaseline: "high",
      text,
    };
  }

  if (signals.missingToolObservationTranscript) {
    return {
      kind: "observational_payload",
      readsAsObservation: true,
      consequenceBaseline: signals.missingToolObservationTranscript.consequenceBaseline,
      text,
    };
  }

  if (signals.rejectedToolUseOutcome) {
    return {
      kind: "rejected_tool_use_observation",
      ...(toolFamily !== undefined ? { toolFamily } : {}),
      readsAsObservation: true,
      consequenceBaseline: "low",
      text,
    };
  }

  if (signals.rawReadSourceObservation) {
    return {
      kind: "observational_payload",
      toolFamily: "read",
      readsAsObservation: true,
      consequenceBaseline: "high",
      text,
    };
  }

  if (signals.rawReadTruncationObservation) {
    return {
      kind: "observational_payload",
      toolFamily: "read",
      readsAsObservation: true,
      consequenceBaseline: "low",
      text,
    };
  }

  if (
    signals.supportsStructuredToolOutput &&
    signals.diagnosticStructuredToolOutput &&
    signals.structuredOutputObservation
  ) {
    return {
      kind: "structured_tool_output_observation",
      ...(toolFamily !== undefined ? { toolFamily } : {}),
      readsAsObservation: true,
      consequenceBaseline: signals.structuredOutputSourceObservation ? "high" : "medium",
      text,
    };
  }

  if (
    isSemanticCommandExecutionToolFamily(toolFamily) &&
    text.routineSuccessObservation &&
    (!signals.unsafeStructuredToolOutputEnvelope || signals.zeroExitStructuredToolOutput)
  ) {
    return {
      kind: "routine_bash_success_observation",
      ...(toolFamily !== undefined ? { toolFamily } : {}),
      readsAsObservation: true,
      consequenceBaseline: "low",
      text,
    };
  }

  if (isSemanticCommandExecutionToolFamily(toolFamily) && text.expectedDiagnosticFailure) {
    return {
      kind: "expected_diagnostic_failure",
      ...(toolFamily !== undefined ? { toolFamily } : {}),
      readsAsObservation: false,
      consequenceBaseline: "medium",
      text,
    };
  }

  if (toolFamily === "search" && text.searchResultOutput) {
    return {
      kind: "routine_search_output",
      toolFamily,
      readsAsObservation: true,
      consequenceBaseline: text.terminalFailureEvidence ? "high" : "low",
      text,
    };
  }

  if (
    (toolFamily === "edit" || toolFamily === "read") &&
    signals.structuredOutputEnvelope.kind !== "invalid" &&
    (text.observationalReadback ||
      text.taggedFileObservation ||
      text.readObservationPayload ||
      signals.editOutputOutcome === "applied" ||
      signals.rawReadListingObservation ||
      signals.rawReadTruncationObservation)
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
  return readRoutineObservationalStatusConflictEvidence(event, interpretation, abstained) !== null;
}

export function readRoutineObservationalStatusConflictEvidence(
  event: SemanticEvidenceTaskUpdateEvent,
  interpretation: SemanticInterpretation,
  abstained = interpretation.abstained === true,
): ObservationalStatusConflictEvidence | null {
  const failureEvidence = readTaskFailureSemanticEvidence(event);

  if (
    event.type === "task.updated" &&
    event.status === "failed" &&
    failureEvidence?.readsAsObservation === true &&
    interpretation.intentFrame === "status_update" &&
    interpretation.activityClass === "status_update" &&
    hasCompatibleFailureEvidenceToolFamily(failureEvidence, interpretation) &&
    interpretation.consequence === failureEvidence.consequenceBaseline &&
    interpretation.confidence === "high" &&
    !abstained
  ) {
    const kind = readObservationalStatusConflictKind(failureEvidence.kind);
    if (kind === null) {
      return null;
    }

    return {
      kind,
      ...(failureEvidence.toolFamily !== undefined
        ? { toolFamily: failureEvidence.toolFamily }
        : {}),
      baselineConsequence: failureEvidence.consequenceBaseline,
    };
  }

  return null;
}

function readObservationalStatusConflictKind(
  kind: TaskFailureEvidenceKind,
): ObservationalStatusConflictKind | null {
  switch (kind) {
    case "routine_bash_success_observation":
      return "command_success_observation";
    case "structured_tool_output_observation":
      return "structured_output_observation";
    case "observational_payload":
      return "payload_observation";
    case "routine_search_output":
      return "search_output_observation";
    case "rejected_tool_use_observation":
      return "rejected_tool_use_observation";
    case "empty_failure_payload":
    case "expected_diagnostic_failure":
    case "terminal_failure":
    case "unclassified_failure":
      return null;
  }
}

function hasCompatibleFailureEvidenceToolFamily(
  failureEvidence: TaskFailureSemanticEvidence,
  interpretation: SemanticInterpretation,
): boolean {
  return failureEvidence.toolFamily === interpretation.toolFamily;
}

function looksLikeReadObservationPayload(text: string): boolean {
  if (!containsPathLikeToken(text)) {
    return false;
  }

  return (
    containsAnySemanticPhrase(text, OBSERVATIONAL_PAYLOAD_PHRASES) ||
    (containsSourceCodePath(text) && containsCodeLikeContent(text)) ||
    containsLineNumberedCodeContent(text)
  );
}

function looksLikeTaggedFileObservation(text: string): boolean {
  return (
    containsAnySemanticPhrase(text, TAGGED_FILE_OBSERVATION_PHRASES) && containsPathLikeToken(text)
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

function containsSourceCodePath(text: string): boolean {
  return SOURCE_CODE_PATH_PATTERN.test(text) || SOURCE_CODE_FILENAME_PATTERN.test(text);
}

function looksLikeSourceCodeObservation(text: string): boolean {
  return (
    SOURCE_CODE_PATH_PATTERN.test(text) ||
    SOURCE_CODE_FILENAME_PATTERN.test(text) ||
    SOURCE_CODE_CONTENT_PATTERN.test(text) ||
    LINE_NUMBERED_SOURCE_CODE_PATTERN.test(text)
  );
}

function looksLikeLogObservation(text: string, rawText: string): boolean {
  return (
    LOG_OUTPUT_PATTERN.test(text) ||
    looksLikeBuildOrLogObservation(rawText) ||
    containsAnySemanticPhrase(text, LOG_LIKE_OBSERVATION_PHRASES)
  );
}

function looksLikeBuildMetadataObservation(text: string): boolean {
  return (
    BUILD_METADATA_PATTERN.test(text) || containsAnySemanticPhrase(text, BUILD_METADATA_PHRASES)
  );
}

function isStandaloneRoutineSuccessObservation(text: string, toolFamily?: string): boolean {
  const normalizedText = text.replace(/\.+$/, "");
  const successPhrases = ROUTINE_SUCCESS_PHRASES.map((phrase) => normalizeSemanticText(phrase));
  const allowedPrefixes = commandExecutionRoutinePrefixes(toolFamily);

  return allowedPrefixes.some((prefix) =>
    successPhrases.some((phrase) => {
      const expected = prefix.length > 0 ? `${prefix} ${phrase}` : phrase;
      return normalizedText === expected;
    }),
  );
}

function stripCommandExecutionRoutinePrefix(text: string, toolFamily?: string): string {
  for (const prefix of commandExecutionRoutinePrefixes(toolFamily).filter(Boolean)) {
    if (text === prefix) {
      return "";
    }

    if (text.startsWith(`${prefix} `)) {
      return text.slice(prefix.length + 1);
    }
  }

  return text;
}

function commandExecutionRoutinePrefixes(toolFamily?: string): string[] {
  return [
    "",
    "observation",
    "bash failure",
    "bash observation",
    "tool failure",
    "tool observation",
    ...(toolFamily && toolFamily !== "bash"
      ? [`${toolFamily} failure`, `${toolFamily} observation`]
      : []),
  ];
}
