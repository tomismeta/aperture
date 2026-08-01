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
import type { ObservationalStatusConflictEvidence } from "./observational-status-conflict.js";
import { readObservationalStatusConflictEvidenceFromObservation } from "./observational-status-conflict-kind.js";
import { containsAnySemanticPhrase, normalizeSemanticText } from "./semantic-text.js";
import {
  readTaskFailureSemanticSignals,
  type TaskFailureObservation,
} from "./semantic-task-failure-signals.js";
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
import {
  readTerminalFailureDetail,
  readTerminalFailureShape,
  type TaskFailureDetail,
  type TaskFailureTerminalShape,
} from "./semantic-failure-detail.js";
import { readExplicitOperationSuccessObservationTranscript } from "./semantic-operation-success-observation-shapes.js";
import { looksLikeEmptyJsonObject } from "./semantic-structured-output.js";
import { normalizeTaskFailureObservation } from "./task-failure-observation-normalizer.js";

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
  | "structured_execution_success_observation"
  | "operation_success_observation"
  | "structured_tool_output_observation"
  | "empty_failure_payload"
  | "observational_payload"
  | "routine_search_output"
  | "expected_diagnostic_failure"
  | "terminal_failure"
  | "rejected_tool_use_observation"
  | "unclassified_failure";

export type { TaskFailureDetail, TaskFailureTerminalShape };

export type TaskFailureSemanticEvidence = {
  kind: TaskFailureEvidenceKind;
  failureDetail?: TaskFailureDetail;
  terminalShape?: TaskFailureTerminalShape;
  toolFamily?: string;
  observation?: TaskFailureObservation;
  readsAsObservation: boolean;
  consequenceBaseline: "low" | "medium" | "high";
  text: SemanticTextEvidence;
};

type SemanticEvidenceTaskUpdateEvent = Record<string, unknown> & {
  type: string;
  status?: string;
  title?: string;
  summary?: string;
  toolFamily?: string;
  context?: {
    items?: Array<{ id: string; label: string; value?: string }>;
  };
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
  const terminalFailureEvidence =
    signals.structuredOutputExitFailure ||
    signals.strongSourceRuntimeDiagnostic ||
    signals.structuredOutputFailureDiagnostic ||
    signals.editOutputOutcome === "failure" ||
    signals.searchFailureDiagnostic ||
    signals.readFailureDiagnostic ||
    signals.diagnosticObservationTranscript ||
    signals.commandActualDiagnosticObservationTranscript ||
    (signals.commandDiagnosticObservationTranscript &&
      !signals.commandDiagnosticReferenceObservationTranscript) ||
    (signals.rawToolOutputFailureDiagnostic &&
      !signals.commandDiagnosticReferenceObservationTranscript) ||
    (text.terminalFailureEvidence &&
      !signals.commandDiagnosticReferenceObservationTranscript &&
      !isMissingToolObservationTranscript(signals.observation) &&
      !(toolFamily === "search" && text.searchResultOutput) &&
      (!signals.rawReadStructuredObservation || signals.strongSourceRuntimeDiagnostic) &&
      (!signals.structuredOutputSourceObservation || signals.strongSourceRuntimeDiagnostic) &&
      !signals.structuredOutputSingleListingObservation);

  if (terminalFailureEvidence) {
    const terminalShape = readTerminalFailureShape({ summary: event.summary, toolFamily });
    const failureDetail = readTerminalFailureDetail({
      summary: event.summary,
      signals,
      toolFamily,
    });
    return {
      kind: "terminal_failure",
      failureDetail,
      ...(terminalShape !== null ? { terminalShape } : {}),
      ...(toolFamily !== undefined ? { toolFamily } : {}),
      readsAsObservation: false,
      consequenceBaseline:
        failureDetail === "outcome_only" || failureDetail === "source_window_limit"
          ? "medium"
          : "high",
      text,
    };
  }

  if (toolFamily !== undefined && looksLikeEmptyJsonObject(event.summary)) {
    return {
      kind: "empty_failure_payload",
      failureDetail: "absent_evidence",
      toolFamily,
      readsAsObservation: false,
      consequenceBaseline: "medium",
      text,
    };
  }

  const operationSuccessObservation =
    toolFamily === undefined
      ? readExplicitOperationSuccessObservationTranscript(event.summary)
      : null;
  if (operationSuccessObservation) {
    return {
      kind: "operation_success_observation",
      readsAsObservation: true,
      consequenceBaseline: operationSuccessObservation.consequenceBaseline,
      text,
    };
  }

  if (signals.observation !== null) {
    return readObservationSemanticEvidence(signals.observation, text);
  }

  if (
    isSemanticCommandExecutionToolFamily(toolFamily) &&
    text.routineSuccessObservation &&
    (!signals.unsafeStructuredToolOutputEnvelope ||
      signals.diagnosticStructuredToolOutput?.exitCode === 0)
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
      signals.rawReadListingObservation)
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
    failureDetail: "indeterminate",
    ...(toolFamily !== undefined ? { toolFamily } : {}),
    readsAsObservation: false,
    consequenceBaseline: "high",
    text,
  };
}

function readObservationSemanticEvidence(
  observation: TaskFailureObservation,
  text: SemanticTextEvidence,
): TaskFailureSemanticEvidence {
  return {
    kind: readObservationEvidenceKind(observation),
    ...(observation.toolFamily !== undefined ? { toolFamily: observation.toolFamily } : {}),
    observation,
    readsAsObservation: true,
    consequenceBaseline: observation.consequenceBaseline,
    text,
  };
}

function readObservationEvidenceKind(observation: TaskFailureObservation): TaskFailureEvidenceKind {
  switch (observation.kind) {
    case "execution_success":
      return "structured_execution_success_observation";
    case "tool_rejection":
      return "rejected_tool_use_observation";
    case "payload":
      return observation.origin === "structured_output"
        ? "structured_tool_output_observation"
        : "observational_payload";
  }
}

function isMissingToolObservationTranscript(observation: TaskFailureObservation | null): boolean {
  return observation?.origin === "transcript" && observation.toolFamily === undefined;
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
  if (failureEvidence === null) {
    return null;
  }

  return readObservationalStatusConflictEvidenceFromObservation({
    event,
    interpretation,
    abstained,
    observation: normalizeTaskFailureObservation({
      failureEvidence,
      ontology: {
        ask: "status",
        activity: failureEvidence.readsAsObservation ? "task_progress" : "failure",
        ...(interpretation.consequence !== undefined
          ? { consequence: interpretation.consequence }
          : {}),
        blocking: "non_blocking",
        episode: "unknown",
        confidence: interpretation.confidence,
        source: "inferred",
      },
      abstained,
      semanticAgreement: "stable",
    }),
  });
}

function looksLikeReadObservationPayload(text: string): boolean {
  if (!PATH_LIKE_TOKEN_PATTERN.test(text)) {
    return false;
  }

  return (
    containsAnySemanticPhrase(text, OBSERVATIONAL_PAYLOAD_PHRASES) ||
    ((SOURCE_CODE_PATH_PATTERN.test(text) || SOURCE_CODE_FILENAME_PATTERN.test(text)) &&
      CODE_CONTENT_PATTERN.test(text)) ||
    LINE_NUMBERED_CODE_PATTERN.test(text)
  );
}

function looksLikeTaggedFileObservation(text: string): boolean {
  return (
    containsAnySemanticPhrase(text, TAGGED_FILE_OBSERVATION_PHRASES) &&
    PATH_LIKE_TOKEN_PATTERN.test(text)
  );
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
