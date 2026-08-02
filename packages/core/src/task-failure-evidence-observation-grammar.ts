import type { ObservationSemantics } from "./observation-semantics.js";
import type { TaskFailureSemanticEvidence } from "./semantic-evidence.js";

type TaskFailureEvidenceObservationInput = Pick<
  TaskFailureSemanticEvidence,
  "consequenceBaseline" | "failureDetail" | "kind" | "readsAsObservation" | "toolFamily"
>;

type ObservationDiagnosticClass = NonNullable<ObservationSemantics["diagnosticClass"]>;
type ObservationRecoveryHint = NonNullable<ObservationSemantics["recoveryHint"]>;

export function readTaskFailureEvidenceObservationSemantics(
  input: TaskFailureEvidenceObservationInput,
): ObservationSemantics {
  const evidenceLoss = readObservationEvidenceLoss(input.failureDetail);
  const diagnosticClass = readObservationDiagnosticClass(input);
  const recoveryHint = readObservationRecoveryHint(input, evidenceLoss, diagnosticClass);
  return {
    kind: readObservationKind(input),
    polarity: readObservationPolarity(input),
    ownership: {
      owner: readObservationOwner(input),
      ...(input.toolFamily !== undefined ? { toolFamily: input.toolFamily } : {}),
    },
    subject: readObservationSubject(input),
    evidenceLoss,
    ...(diagnosticClass !== null ? { diagnosticClass } : {}),
    ...(recoveryHint !== null ? { recoveryHint } : {}),
    provenance: { origin: "semantic_evidence" },
    consequenceBaseline: input.consequenceBaseline,
    evidenceCertainty:
      input.kind === "terminal_failure" && input.failureDetail === "indeterminate"
        ? "indeterminate"
        : "determinate",
  };
}

function readObservationKind(
  input: TaskFailureEvidenceObservationInput,
): ObservationSemantics["kind"] {
  switch (input.kind) {
    case "expected_diagnostic_failure":
      return "diagnostic";
    case "terminal_failure":
      return input.failureDetail === "diagnostic" || input.failureDetail === "source_window_limit"
        ? "diagnostic"
        : input.failureDetail === "outcome_only"
          ? "outcome"
          : "unknown";
    case "empty_failure_payload":
      return "outcome";
    case "rejected_tool_use_observation":
      return "control";
    case "routine_bash_success_observation":
    case "structured_execution_success_observation":
    case "operation_success_observation":
      return "outcome";
    case "structured_tool_output_observation":
    case "observational_payload":
    case "routine_search_output":
      return "payload";
    case "unclassified_failure":
      return "unknown";
  }
}

function readObservationPolarity(
  input: TaskFailureEvidenceObservationInput,
): ObservationSemantics["polarity"] {
  if (!input.readsAsObservation) {
    return "failure";
  }
  return input.kind === "routine_bash_success_observation" ||
    input.kind === "structured_execution_success_observation" ||
    input.kind === "operation_success_observation"
    ? "success"
    : "neutral";
}

function readObservationOwner(
  input: TaskFailureEvidenceObservationInput,
): ObservationSemantics["ownership"]["owner"] {
  return input.toolFamily !== undefined
    ? "tool"
    : input.readsAsObservation
      ? "source"
      : input.kind === "unclassified_failure"
        ? "unknown"
        : "engine";
}

function readObservationSubject(
  input: TaskFailureEvidenceObservationInput,
): ObservationSemantics["subject"] {
  return input.kind === "routine_bash_success_observation" ||
    input.kind === "structured_execution_success_observation"
    ? "command"
    : input.kind === "routine_search_output" || input.toolFamily === "search"
      ? "search"
      : input.failureDetail === "source_window_limit"
        ? "source"
        : input.toolFamily !== undefined
          ? "tool"
          : "unknown";
}

function readObservationEvidenceLoss(
  failureDetail: TaskFailureEvidenceObservationInput["failureDetail"],
): ObservationSemantics["evidenceLoss"] {
  switch (failureDetail) {
    case "absent_evidence":
      return "absent";
    case "source_window_limit":
      return "partial";
    case "indeterminate":
      return "unknown";
    default:
      return "none";
  }
}

function readObservationDiagnosticClass(
  input: TaskFailureEvidenceObservationInput,
): ObservationDiagnosticClass | null {
  if (input.kind === "expected_diagnostic_failure") {
    return "expected";
  }
  switch (input.failureDetail) {
    case "diagnostic":
      return "runtime";
    case "source_window_limit":
      return "source_limit";
    default:
      return null;
  }
}

function readObservationRecoveryHint(
  input: TaskFailureEvidenceObservationInput,
  evidenceLoss: ObservationSemantics["evidenceLoss"],
  diagnosticClass: ObservationDiagnosticClass | null,
): ObservationRecoveryHint | null {
  if (input.kind === "rejected_tool_use_observation") {
    return "await_authorization";
  }
  switch (evidenceLoss) {
    case "absent":
      return "request_evidence";
    case "partial":
      return "narrow_evidence_scope";
    case "unknown":
      return "inspect_original_evidence";
    case "none":
      return diagnosticClass !== null ? "inspect_diagnostic" : null;
  }
}
