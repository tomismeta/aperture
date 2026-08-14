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
import { readExplicitSemanticToolFamily } from "./semantic-tool-family.js";
import {
  readTaskFailureTerminalProfile,
  type TaskFailureDetail,
} from "./semantic-failure-detail.js";
import { readExplicitOperationSuccessObservationTranscript } from "./semantic-operation-success-observation-shapes.js";
import { looksLikeEmptyJsonObject } from "./semantic-structured-output.js";
import type { SourceEvidence } from "./events.js";
import {
  compileSourceEvidenceSyntax,
  type TaskFailureObservationSyntax,
} from "./task-failure-observation-grammar.js";

export type SemanticTextShape =
  | "routine_success"
  | "terminal_failure"
  | "expected_diagnostic"
  | "observational_readback"
  | "tagged_file"
  | "read_payload"
  | "search_result"
  | "source_code"
  | "log"
  | "build_metadata";

export type SemanticTextEvidence = { shapes: readonly SemanticTextShape[] };

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

export type { TaskFailureDetail };

export type TaskFailureSemanticEvidence = {
  kind: TaskFailureEvidenceKind;
  failureDetail?: TaskFailureDetail;
  toolFamily?: string;
  observationSyntax?: TaskFailureObservationSyntax;
  readsAsObservation: boolean;
  consequenceBaseline: "low" | "medium" | "high";
  text: SemanticTextEvidence;
};
type TaskFailureEvidenceProfile = Omit<TaskFailureSemanticEvidence, "text">;
type TaskFailureEvidenceDetails = Partial<
  Pick<TaskFailureEvidenceProfile, "failureDetail" | "observationSyntax">
>;

type SemanticEvidenceTaskUpdateEvent = Record<string, unknown> & {
  type: string;
  status?: string;
  title?: string;
  summary?: string;
  toolFamily?: string;
  evidence?: SourceEvidence;
};

export function readSemanticTextEvidence(value: string, toolFamily?: string): SemanticTextEvidence {
  const text = normalizeSemanticText(value);
  const hasTerminalFailureShape = looksLikeTerminalFailureEvidence(text);
  const routineCommandText = stripCommandExecutionRoutinePrefix(text);
  const shapes: SemanticTextShape[] = [];
  if (
    (isStandaloneRoutineSuccessObservation(text) ||
      (looksLikeZeroTerminalExit(routineCommandText) &&
        !looksLikeContradictoryFailureObservation(routineCommandText))) &&
    !hasTerminalFailureShape
  ) {
    shapes.push("routine_success");
  }
  if (hasTerminalFailureShape) {
    shapes.push("terminal_failure");
  } else if (containsAnySemanticPhrase(text, EXPECTED_DIAGNOSTIC_FAILURE_PHRASES)) {
    shapes.push("expected_diagnostic");
  }
  if (containsAnySemanticPhrase(text, OBSERVATIONAL_READBACK_PHRASES))
    shapes.push("observational_readback");
  if (looksLikeTaggedFileObservation(text)) shapes.push("tagged_file");
  if (looksLikeReadObservationPayload(text)) shapes.push("read_payload");
  else if (toolFamily === "read" && looksLikePlainReadObservation(value))
    shapes.push("read_payload");
  if (looksLikeSearchResultObservation(text, value)) shapes.push("search_result");
  if (looksLikeSourceCodeObservation(text)) shapes.push("source_code");
  if (looksLikeLogObservation(text, value)) shapes.push("log");
  if (BUILD_METADATA_PATTERN.test(text) || containsAnySemanticPhrase(text, BUILD_METADATA_PHRASES))
    shapes.push("build_metadata");

  return { shapes };
}

export function semanticTextShapeMatcher(value: string, toolFamily?: string) {
  const shapes = readSemanticTextEvidence(value, toolFamily).shapes;
  return (shape: SemanticTextShape): boolean => shapes.includes(shape);
}

export function buildTaskFailureObservationInput(event: SemanticEvidenceTaskUpdateEvent) {
  if (
    event.type === "task.updated" &&
    event.status === "failed" &&
    event.title !== undefined &&
    event.evidence !== undefined
  ) {
    const toolFamily =
      readExplicitSemanticToolFamily({
        title: event.title,
        ...(event.toolFamily !== undefined ? { toolFamily: event.toolFamily } : {}),
      }) ?? undefined;
    return { syntax: compileSourceEvidenceSyntax(event.evidence, toolFamily) };
  }
  return readTaskFailureSemanticEvidence(event);
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
    }) ?? undefined;
  const text =
    event.summary !== undefined &&
    readSemanticTextEvidence(event.title, toolFamily).shapes.includes("terminal_failure")
      ? { shapes: ["terminal_failure"] as const }
      : readSemanticTextEvidence(event.summary ?? event.title, toolFamily);
  const signals = readTaskFailureSemanticSignals({ ...event, toolFamily });
  const selectedProfile = readTaskFailureEvidenceProfile({
    summary: event.summary,
    signals,
    text,
    toolFamily,
  });

  return { ...selectedProfile, text };
}

function readTaskFailureEvidenceProfile(input: {
  summary: string | undefined;
  signals: ReturnType<typeof readTaskFailureSemanticSignals>;
  text: SemanticTextEvidence;
  toolFamily: string | undefined;
}): TaskFailureEvidenceProfile {
  const { signals, summary, text, toolFamily } = input;
  const hasShape = text.shapes.includes.bind(text.shapes);
  const observation = signals.observationSyntax;
  if (observation?.completeBoundary && observation.kind !== "control")
    return readObservationProfile(observation);
  const terminalProfile = readTaskFailureTerminalProfile({
    summary,
    signals,
    toolFamily,
    searchResultText: hasShape("search_result"),
    terminalFailureText: hasShape("terminal_failure"),
  });
  if (terminalProfile !== null) {
    return profile("terminal_failure", false, terminalProfile.consequenceBaseline, toolFamily, {
      failureDetail: terminalProfile.failureDetail,
    });
  }
  if (toolFamily !== undefined && looksLikeEmptyJsonObject(summary)) {
    return profile("empty_failure_payload", false, "medium", toolFamily, {
      failureDetail: "absent_evidence",
    });
  }
  const operationSuccessObservation =
    toolFamily === undefined ? readExplicitOperationSuccessObservationTranscript(summary) : null;
  if (operationSuccessObservation) {
    return profile(
      "operation_success_observation",
      true,
      operationSuccessObservation.consequenceBaseline,
    );
  }
  if (observation !== null) return readObservationProfile(observation);
  if (
    hasShape("routine_success") &&
    signals.structuredOutputEnvelope.kind !== "unsupported" &&
    (!signals.unsafeStructuredToolOutputEnvelope ||
      signals.diagnosticStructuredToolOutput?.exitCode === 0)
  ) {
    return profile("routine_bash_success_observation", true, "low", toolFamily);
  }
  if (hasShape("expected_diagnostic")) {
    return profile("expected_diagnostic_failure", false, "medium", toolFamily);
  }
  if (hasShape("search_result")) {
    return profile(
      "routine_search_output",
      true,
      hasShape("terminal_failure") ? "high" : "low",
      toolFamily,
    );
  }

  if (
    toolFamily === "edit" &&
    signals.structuredOutputEnvelope.kind !== "invalid" &&
    (hasShape("observational_readback") ||
      hasShape("tagged_file") ||
      hasShape("read_payload") ||
      signals.editOutputOutcome === "applied")
  ) {
    return profile("observational_payload", true, "high", toolFamily);
  }

  return profile("unclassified_failure", false, "high", toolFamily, {
    failureDetail: "indeterminate",
  });
}

function readObservationProfile(syntax: TaskFailureObservationSyntax): TaskFailureEvidenceProfile {
  return profile(
    readObservationSyntaxEvidenceKind(syntax),
    syntax.kind === "payload" || syntax.kind === "control" || syntax.polarity === "success",
    syntax.consequenceBaseline,
    syntax.toolFamily,
    {
      observationSyntax: syntax,
      ...readObservationFailureDetail(syntax),
    },
  );
}

function readObservationFailureDetail(
  syntax: TaskFailureObservationSyntax,
): TaskFailureEvidenceDetails {
  if (syntax.diagnosticClass === "source_limit") return { failureDetail: "source_window_limit" };
  if (syntax.kind === "diagnostic") return { failureDetail: "diagnostic" };
  if (syntax.kind !== "outcome" || syntax.polarity !== "failure") return {};
  return { failureDetail: syntax.evidenceLoss === "absent" ? "absent_evidence" : "outcome_only" };
}

function profile(
  kind: TaskFailureEvidenceKind,
  readsAsObservation: boolean,
  consequenceBaseline: TaskFailureEvidenceProfile["consequenceBaseline"],
  toolFamily?: string,
  details: TaskFailureEvidenceDetails = {},
): TaskFailureEvidenceProfile {
  return {
    kind,
    ...details,
    ...(toolFamily !== undefined ? { toolFamily } : {}),
    readsAsObservation,
    consequenceBaseline,
  };
}

function readObservationSyntaxEvidenceKind(
  syntax: TaskFailureObservationSyntax,
): TaskFailureEvidenceKind {
  if (syntax.kind === "control") return "rejected_tool_use_observation";
  if (syntax.kind === "diagnostic")
    return syntax.diagnosticClass === "expected"
      ? "expected_diagnostic_failure"
      : "terminal_failure";
  if (syntax.kind === "outcome")
    return syntax.polarity === "failure"
      ? "terminal_failure"
      : "structured_execution_success_observation";
  return syntax.origin === "structured_output"
    ? "structured_tool_output_observation"
    : "observational_payload";
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

function isStandaloneRoutineSuccessObservation(text: string): boolean {
  const trimmedText = text.replace(/\.+$/, "");
  const observationPrefixIndex = trimmedText.indexOf(" observation ");
  const normalizedText =
    observationPrefixIndex > 0 && !trimmedText.slice(0, observationPrefixIndex).includes(" ")
      ? trimmedText.slice(observationPrefixIndex + " observation ".length)
      : trimmedText;
  const successPhrases = ROUTINE_SUCCESS_PHRASES.map((phrase) => normalizeSemanticText(phrase));

  return commandExecutionRoutinePrefixes().some((prefix) =>
    successPhrases.some((phrase) => {
      const expected = prefix.length > 0 ? `${prefix} ${phrase}` : phrase;
      return normalizedText === expected;
    }),
  );
}

function stripCommandExecutionRoutinePrefix(text: string): string {
  for (const prefix of commandExecutionRoutinePrefixes().filter(Boolean)) {
    if (text === prefix) return "";
    if (text.startsWith(`${prefix} `)) return text.slice(prefix.length + 1);
  }

  return text;
}

function commandExecutionRoutinePrefixes(): string[] {
  return ["", "observation", "bash failure", "tool failure"];
}
