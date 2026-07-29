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
import { containsAnySemanticPhrase, normalizeSemanticText } from "./semantic-text.js";
import {
  hasStrongRuntimeDiagnosticEvidence,
  hasToolOutputFailureDiagnosticEvidence,
  looksLikeSearchFailureDiagnostic,
} from "./semantic-diagnostic-shapes.js";
import {
  looksLikeRecoveredListingObservation,
  looksLikeTruncatedRawReadListingObservation,
} from "./semantic-listing-observation-shapes.js";
import {
  looksLikeBuildOrLogObservation,
  looksLikePlainReadObservation,
  looksLikeStrongRawSourceObservation,
  looksLikeStructuredToolOutputObservation,
} from "./semantic-observation-shapes.js";
import { looksLikeExplicitObservationTranscript } from "./semantic-observation-transcript-shapes.js";
import { looksLikeReadTruncationProtocolObservation } from "./semantic-read-observation-shapes.js";
import { looksLikeSearchResultObservation } from "./semantic-search-observation-shapes.js";
import {
  looksLikeStructuredToolOutputEnvelope,
  readStructuredToolOutputObservation,
} from "./semantic-structured-output.js";
import {
  looksLikeContradictoryFailureObservation,
  looksLikeTerminalFailureEvidence,
  looksLikeZeroTerminalExit,
} from "./semantic-terminal-evidence.js";
import { readTruncatedStructuredToolOutputEnvelope } from "./semantic-truncated-structured-output.js";
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
  const supportsStructuredToolOutput =
    isSemanticCommandExecutionToolFamily(toolFamily) || toolFamily === "edit";
  const structuredToolOutput = supportsStructuredToolOutput
    ? readStructuredToolOutputObservation(event.summary)
    : null;
  const unsafeStructuredToolOutputEnvelope =
    supportsStructuredToolOutput &&
    structuredToolOutput === null &&
    looksLikeStructuredToolOutputEnvelope(event.summary);
  const truncatedStructuredToolOutput = unsafeStructuredToolOutputEnvelope
    ? readTruncatedStructuredToolOutputEnvelope(event.summary)
    : null;
  const diagnosticStructuredToolOutput = structuredToolOutput ?? truncatedStructuredToolOutput;
  const structuredOutputSourceObservation =
    diagnosticStructuredToolOutput !== null &&
    looksLikeStrongRawSourceObservation(diagnosticStructuredToolOutput.output);
  const zeroExitStructuredToolOutput = diagnosticStructuredToolOutput?.exitCode === 0;
  const structuredOutputObservation =
    diagnosticStructuredToolOutput !== null &&
    (looksLikeStructuredToolOutputObservation(diagnosticStructuredToolOutput.output) ||
      (truncatedStructuredToolOutput !== null &&
        looksLikeRecoveredListingObservation(truncatedStructuredToolOutput.output)));
  const rawReadSourceObservation =
    toolFamily === "read" && looksLikeStrongRawSourceObservation(event.summary ?? "");
  const rawReadListingObservation =
    toolFamily === "read" && looksLikeTruncatedRawReadListingObservation(event.summary ?? "");
  const rawReadTruncationObservation =
    toolFamily === "read" && looksLikeReadTruncationProtocolObservation(event.summary ?? "");
  const rawReadStructuredObservation =
    rawReadSourceObservation || rawReadListingObservation || rawReadTruncationObservation;
  const searchOutputObservation = toolFamily === "search" && text.searchResultOutput;
  const searchFailureDiagnostic =
    toolFamily === "search" && looksLikeSearchFailureDiagnostic(event.summary ?? "");
  const readFailureDiagnostic =
    toolFamily === "read" &&
    (looksLikeExplicitReadFailureDiagnostic(event.summary ?? "") ||
      (hasStrongRuntimeDiagnosticEvidence(event.summary ?? "") && !rawReadSourceObservation));
  const structuredOutputFailureDiagnostic =
    diagnosticStructuredToolOutput !== null &&
    hasToolOutputFailureDiagnosticEvidence(diagnosticStructuredToolOutput.output);
  const missingToolObservationTranscript =
    toolFamily === undefined && looksLikeExplicitObservationTranscript(event.summary ?? "");
  const strongSourceRuntimeDiagnostic =
    (structuredToolOutput !== null &&
      structuredOutputSourceObservation &&
      hasStrongRuntimeDiagnosticEvidence(structuredToolOutput.output)) ||
    (rawReadStructuredObservation && hasStrongRuntimeDiagnosticEvidence(event.summary ?? ""));
  const terminalFailureEvidence =
    diagnosticStructuredToolOutput?.exitCode !== undefined &&
    diagnosticStructuredToolOutput.exitCode !== 0
      ? true
      : strongSourceRuntimeDiagnostic
        ? true
        : structuredOutputFailureDiagnostic || searchFailureDiagnostic || readFailureDiagnostic
          ? true
          : text.terminalFailureEvidence &&
            !searchOutputObservation &&
            (!rawReadStructuredObservation || strongSourceRuntimeDiagnostic) &&
            (!structuredOutputSourceObservation || strongSourceRuntimeDiagnostic);

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

  if (missingToolObservationTranscript) {
    return {
      kind: "observational_payload",
      readsAsObservation: true,
      consequenceBaseline: "high",
      text,
    };
  }

  if (rawReadSourceObservation) {
    return {
      kind: "observational_payload",
      toolFamily: "read",
      readsAsObservation: true,
      consequenceBaseline: "high",
      text,
    };
  }

  if (rawReadTruncationObservation) {
    return {
      kind: "observational_payload",
      toolFamily: "read",
      readsAsObservation: true,
      consequenceBaseline: "low",
      text,
    };
  }

  if (
    supportsStructuredToolOutput &&
    diagnosticStructuredToolOutput &&
    structuredOutputObservation
  ) {
    return {
      kind: "structured_tool_output_observation",
      ...(toolFamily !== undefined ? { toolFamily } : {}),
      readsAsObservation: true,
      consequenceBaseline: structuredOutputSourceObservation ? "high" : "medium",
      text,
    };
  }

  if (
    isSemanticCommandExecutionToolFamily(toolFamily) &&
    text.routineSuccessObservation &&
    (!unsafeStructuredToolOutputEnvelope || zeroExitStructuredToolOutput)
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
    (text.observationalReadback ||
      text.taggedFileObservation ||
      text.readObservationPayload ||
      rawReadListingObservation ||
      rawReadTruncationObservation)
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
    failureEvidence?.readsAsObservation === true &&
    interpretation.intentFrame === "status_update" &&
    interpretation.activityClass === "status_update" &&
    hasCompatibleFailureEvidenceToolFamily(failureEvidence, interpretation) &&
    interpretation.consequence === failureEvidence.consequenceBaseline &&
    interpretation.confidence === "high" &&
    !abstained
  );
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

function looksLikeExplicitReadFailureDiagnostic(value: string): boolean {
  const text = value
    .trim()
    .replace(/^(?:read|tool)\s+failure\s+/i, "")
    .replace(/^#{1,6}\s+/, "");

  return /^(?:read\s+failed\b|failed to (?:read|open)\b|could not (?:read|open)\b|unable to (?:read|open)\b)/i.test(
    text,
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
