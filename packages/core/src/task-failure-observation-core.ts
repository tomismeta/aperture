import type { ObservationSemantics } from "./observation-semantics.js";
import type { TaskFailureDetail, TaskFailureEvidenceKind } from "./semantic-evidence.js";
import type { TaskFailureObservationSyntax } from "./task-failure-observation-grammar.js";

type ObservationDiagnosticClass = NonNullable<ObservationSemantics["diagnosticClass"]>;
type ObservationEvidenceLoss = ObservationSemantics["evidenceLoss"];
type ObservationRecoveryHint = NonNullable<ObservationSemantics["recoveryHint"]>;

export type TaskFailureObservationInput = {
  kind: TaskFailureEvidenceKind;
  failureDetail?: TaskFailureDetail;
  toolFamily?: string;
  observationSyntax?: TaskFailureObservationSyntax;
  readsAsObservation: boolean;
  consequenceBaseline: ObservationSemantics["consequenceBaseline"];
};

export type TaskFailureObservationExtractorId =
  | "command_success"
  | "empty_payload"
  | "expected_diagnostic"
  | "operation_success"
  | "payload"
  | "read_truncated_source"
  | "rejected_tool_use"
  | "search_output"
  | "structured_execution_success"
  | "structured_output"
  | "terminal_diagnostic"
  | "terminal_outcome"
  | "unknown_failure";

type ObservationExtraction = {
  observationExtractorId: TaskFailureObservationExtractorId;
  observationSemantics: ObservationSemantics;
};
type ObservationExtractor = (input: TaskFailureObservationInput) => ObservationExtraction;

const EVIDENCE_LOSS_BY_DETAIL: Partial<Record<TaskFailureDetail, ObservationEvidenceLoss>> = {
  absent_evidence: "absent",
  source_window_limit: "partial",
  indeterminate: "unknown",
};
const RECOVERY_HINT_BY_EVIDENCE_LOSS: Record<string, ObservationRecoveryHint> = {
  absent: "request_evidence",
  partial: "narrow_evidence_scope",
  unknown: "inspect_original_evidence",
};

const TASK_FAILURE_OBSERVATION_EXTRACTORS = {
  routine_bash_success_observation: o("command_success", "outcome", "success"),
  structured_execution_success_observation: o("structured_execution_success", "outcome", "success"),
  operation_success_observation: o("operation_success", "outcome", "success"),
  structured_tool_output_observation: o("structured_output", "payload", "neutral"),
  empty_failure_payload: o("empty_payload", "outcome", "failure", "absent_evidence"),
  observational_payload: o("payload", "payload", "neutral"),
  routine_search_output: o("search_output", "payload", "neutral"),
  expected_diagnostic_failure: o("expected_diagnostic", "diagnostic", "failure"),
  terminal_failure: extractTerminalFailureObservation,
  rejected_tool_use_observation: o("rejected_tool_use", "control", "neutral"),
  unclassified_failure: o("unknown_failure", "unknown", "failure", "indeterminate"),
} satisfies Record<TaskFailureEvidenceKind, ObservationExtractor>;

export function extractTaskFailureObservationCore(input: TaskFailureObservationInput) {
  if (input.observationSyntax !== undefined) return observationFromSyntax(input.observationSyntax);
  return TASK_FAILURE_OBSERVATION_EXTRACTORS[input.kind](input);
}

export function readTaskFailureObservationCore(input: TaskFailureObservationInput) {
  return extractTaskFailureObservationCore(input).observationSemantics;
}

function observationFromSyntax(syntax: TaskFailureObservationSyntax) {
  const toolFamily = syntax.toolFamily;
  const observationSemantics: ObservationSemantics = {
    kind: syntax.kind,
    polarity: syntax.kind === "outcome" ? "success" : "neutral",
    ownership: {
      owner: syntax.kind === "control" ? "tool" : toolFamily === undefined ? "source" : "tool",
      ...(toolFamily !== undefined ? { toolFamily } : {}),
    },
    subject: readSyntaxSubject(syntax),
    evidenceLoss: "none",
    provenance: { origin: syntax.origin },
    consequenceBaseline: readSyntaxConsequenceBaseline(syntax),
    evidenceCertainty: "determinate",
    ...(syntax.kind === "control" ? { recoveryHint: syntax.recoveryHint } : {}),
  };
  return { observationExtractorId: readSyntaxExtractorId(syntax), observationSemantics };
}

function readSyntaxExtractorId(
  syntax: TaskFailureObservationSyntax,
): TaskFailureObservationExtractorId {
  if (syntax.kind === "control") return "rejected_tool_use";
  if (syntax.kind === "outcome") return "structured_execution_success";
  return syntax.origin === "structured_output" ? "structured_output" : "payload";
}

function readSyntaxSubject(syntax: TaskFailureObservationSyntax): ObservationSemantics["subject"] {
  if (syntax.kind === "control") return "tool";
  if (syntax.kind === "outcome") return syntax.subject;
  return syntax.payload.source ? "source" : syntax.fallbackSubject;
}

function readSyntaxConsequenceBaseline(
  syntax: TaskFailureObservationSyntax,
): ObservationSemantics["consequenceBaseline"] {
  if (syntax.kind === "control") return "low";
  return syntax.kind === "payload"
    ? syntax.payload.consequenceBaseline
    : syntax.consequenceBaseline;
}

function extractTerminalFailureObservation(input: TaskFailureObservationInput) {
  switch (input.failureDetail) {
    case "source_window_limit":
      return observation(input, "read_truncated_source", "diagnostic", "failure");
    case "diagnostic":
      return observation(input, "terminal_diagnostic", "diagnostic", "failure");
    case "outcome_only":
      return observation(input, "terminal_outcome", "outcome", "failure");
    default:
      return observation(input, "unknown_failure", "unknown", "failure", "indeterminate");
  }
}

function o(
  observationExtractorId: TaskFailureObservationExtractorId,
  kind: ObservationSemantics["kind"],
  polarity: ObservationSemantics["polarity"],
  fallbackDetail?: TaskFailureDetail,
) {
  return (input: TaskFailureObservationInput) =>
    observation(input, observationExtractorId, kind, polarity, fallbackDetail);
}

function observation(
  input: TaskFailureObservationInput,
  observationExtractorId: TaskFailureObservationExtractorId,
  kind: ObservationSemantics["kind"],
  polarity: ObservationSemantics["polarity"],
  fallbackDetail?: TaskFailureDetail,
) {
  const failureDetail = fallbackDetail ?? input.failureDetail;
  const evidenceLoss = EVIDENCE_LOSS_BY_DETAIL[failureDetail ?? "outcome_only"] ?? "none";
  let diagnosticClass: ObservationDiagnosticClass | null = null;
  if (input.kind === "expected_diagnostic_failure") diagnosticClass = "expected";
  else if (kind === "diagnostic") {
    diagnosticClass = failureDetail === "source_window_limit" ? "source_limit" : "runtime";
  }
  const recoveryHint =
    input.kind === "rejected_tool_use_observation"
      ? "await_authorization"
      : readRecoveryHint(evidenceLoss, diagnosticClass);
  const observationSemantics: ObservationSemantics = {
    kind,
    polarity,
    ownership: { owner: readOwner(input) },
    subject: readSubject(input, observationExtractorId, failureDetail),
    evidenceLoss,
    provenance: { origin: "semantic_evidence" },
    consequenceBaseline: input.consequenceBaseline,
    evidenceCertainty: failureDetail === "indeterminate" ? "indeterminate" : "determinate",
  };
  if (input.toolFamily !== undefined) observationSemantics.ownership.toolFamily = input.toolFamily;
  if (diagnosticClass !== null) observationSemantics.diagnosticClass = diagnosticClass;
  if (recoveryHint !== null) observationSemantics.recoveryHint = recoveryHint;
  return { observationExtractorId, observationSemantics };
}

function readOwner(input: TaskFailureObservationInput) {
  if (input.toolFamily !== undefined) return "tool";
  if (input.readsAsObservation) return "source";
  return input.kind === "unclassified_failure" ? "unknown" : "engine";
}

function readSubject(
  input: TaskFailureObservationInput,
  id: TaskFailureObservationExtractorId,
  failureDetail: TaskFailureDetail | undefined,
) {
  if (id === "command_success" || id === "structured_execution_success") return "command";
  if (id === "search_output" || input.toolFamily === "search") return "search";
  if (failureDetail === "source_window_limit") return "source";
  return input.toolFamily !== undefined ? "tool" : "unknown";
}

function readRecoveryHint(
  evidenceLoss: ObservationEvidenceLoss,
  diagnosticClass: ObservationDiagnosticClass | null,
) {
  return (
    RECOVERY_HINT_BY_EVIDENCE_LOSS[evidenceLoss] ??
    (diagnosticClass !== null ? "inspect_diagnostic" : null)
  );
}
