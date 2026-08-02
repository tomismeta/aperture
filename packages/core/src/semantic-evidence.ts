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
import {
  readTerminalFailureDetail,
  readTerminalFailureShape,
  type TaskFailureDetail,
  type TaskFailureTerminalShape,
} from "./semantic-failure-detail.js";
import { readExplicitOperationSuccessObservationTranscript } from "./semantic-operation-success-observation-shapes.js";
import { looksLikeEmptyJsonObject } from "./semantic-structured-output.js";
import type { ObservationSemantics } from "./observation-semantics.js";
import { readTaskFailureEvidenceObservationSemantics } from "./task-failure-evidence-observation-grammar.js";

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
  observationSemantics?: ObservationSemantics;
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
      !isMissingToolObservationTranscript(signals.observationSemantics) &&
      !(toolFamily === "search" && text.searchResultOutput) &&
      (!payloadObservationSuppressesGenericTerminalEvidence(signals.observationSemantics) ||
        signals.strongSourceRuntimeDiagnostic));

  if (terminalFailureEvidence) {
    const terminalShape = readTerminalFailureShape({ summary: event.summary, toolFamily });
    const failureDetail = readTerminalFailureDetail({
      summary: event.summary,
      signals,
      toolFamily,
    });
    const consequenceBaseline =
      failureDetail === "outcome_only" || failureDetail === "source_window_limit"
        ? "medium"
        : "high";
    return semanticEvidence({
      kind: "terminal_failure",
      failureDetail,
      ...(terminalShape !== null ? { terminalShape } : {}),
      ...(toolFamily !== undefined ? { toolFamily } : {}),
      readsAsObservation: false,
      consequenceBaseline,
      text,
    });
  }

  if (toolFamily !== undefined && looksLikeEmptyJsonObject(event.summary)) {
    return semanticEvidence({
      kind: "empty_failure_payload",
      failureDetail: "absent_evidence",
      toolFamily,
      readsAsObservation: false,
      consequenceBaseline: "medium",
      text,
    });
  }

  const operationSuccessObservation =
    toolFamily === undefined
      ? readExplicitOperationSuccessObservationTranscript(event.summary)
      : null;
  if (operationSuccessObservation) {
    return semanticEvidence({
      kind: "operation_success_observation",
      readsAsObservation: true,
      consequenceBaseline: operationSuccessObservation.consequenceBaseline,
      text,
    });
  }

  if (signals.observationSemantics !== null) {
    return readObservationSemanticEvidence(signals.observationSemantics, text);
  }

  if (
    isSemanticCommandExecutionToolFamily(toolFamily) &&
    text.routineSuccessObservation &&
    (!signals.unsafeStructuredToolOutputEnvelope ||
      signals.diagnosticStructuredToolOutput?.exitCode === 0)
  ) {
    return semanticEvidence({
      kind: "routine_bash_success_observation",
      ...(toolFamily !== undefined ? { toolFamily } : {}),
      readsAsObservation: true,
      consequenceBaseline: "low",
      text,
    });
  }

  if (isSemanticCommandExecutionToolFamily(toolFamily) && text.expectedDiagnosticFailure) {
    return semanticEvidence({
      kind: "expected_diagnostic_failure",
      ...(toolFamily !== undefined ? { toolFamily } : {}),
      readsAsObservation: false,
      consequenceBaseline: "medium",
      text,
    });
  }

  if (toolFamily === "search" && text.searchResultOutput) {
    return semanticEvidence({
      kind: "routine_search_output",
      toolFamily,
      readsAsObservation: true,
      consequenceBaseline: text.terminalFailureEvidence ? "high" : "low",
      text,
    });
  }

  if (
    toolFamily === "edit" &&
    signals.structuredOutputEnvelope.kind !== "invalid" &&
    (text.observationalReadback ||
      text.taggedFileObservation ||
      text.readObservationPayload ||
      signals.editOutputOutcome === "applied")
  ) {
    return semanticEvidence({
      kind: "observational_payload",
      toolFamily,
      readsAsObservation: true,
      consequenceBaseline: "high",
      text,
    });
  }

  return semanticEvidence({
    kind: "unclassified_failure",
    failureDetail: "indeterminate",
    ...(toolFamily !== undefined ? { toolFamily } : {}),
    readsAsObservation: false,
    consequenceBaseline: "high",
    text,
  });
}

function semanticEvidence(
  evidence: Omit<TaskFailureSemanticEvidence, "observationSemantics">,
): TaskFailureSemanticEvidence {
  return {
    ...evidence,
    observationSemantics: readTaskFailureEvidenceObservationSemantics(evidence),
  };
}

function readObservationSemanticEvidence(
  semantics: ObservationSemantics,
  text: SemanticTextEvidence,
): TaskFailureSemanticEvidence {
  return {
    kind: readObservationSemanticEvidenceKind(semantics),
    ...(semantics.ownership.toolFamily !== undefined
      ? { toolFamily: semantics.ownership.toolFamily }
      : {}),
    observationSemantics: semantics,
    readsAsObservation: true,
    consequenceBaseline: semantics.consequenceBaseline,
    text,
  };
}

function readObservationSemanticEvidenceKind(
  semantics: ObservationSemantics,
): TaskFailureEvidenceKind {
  switch (semantics.kind) {
    case "control":
      return "rejected_tool_use_observation";
    case "outcome":
      return semantics.polarity === "success"
        ? "structured_execution_success_observation"
        : "unclassified_failure";
    case "payload":
      return semantics.provenance.origin === "structured_output"
        ? "structured_tool_output_observation"
        : "observational_payload";
    case "diagnostic":
    case "unknown":
      return "unclassified_failure";
  }
}

function isMissingToolObservationTranscript(observation: ObservationSemantics | null): boolean {
  return (
    observation?.provenance.origin === "transcript" &&
    observation.ownership.toolFamily === undefined
  );
}

function payloadObservationSuppressesGenericTerminalEvidence(
  observation: ObservationSemantics | null,
): boolean {
  return (
    observation?.kind === "payload" &&
    (observation.provenance.origin === "read_output" ||
      observation.provenance.origin === "structured_output")
  );
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
