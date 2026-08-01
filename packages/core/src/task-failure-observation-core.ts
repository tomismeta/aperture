import type {
  ObservationDiagnosticClass,
  ObservationRecoveryHint,
  ObservationSemantics,
} from "./observation-semantics.js";
import type { TaskFailureSemanticEvidence } from "./semantic-evidence.js";

export function readTaskFailureObservationCore(
  evidence: TaskFailureSemanticEvidence,
): ObservationSemantics {
  if (evidence.observationSemantics !== undefined) {
    return evidence.observationSemantics;
  }

  const evidenceLoss = readObservationEvidenceLoss(evidence);
  const diagnosticClass = readObservationDiagnosticClass(evidence);
  const recoveryHint = readObservationRecoveryHint(evidence, evidenceLoss);
  return {
    kind: readObservationKind(evidence),
    polarity: readObservationPolarity(evidence),
    ownership: {
      owner: readObservationOwner(evidence),
      ...(evidence.toolFamily !== undefined ? { toolFamily: evidence.toolFamily } : {}),
    },
    subject: readObservationSubject(evidence),
    evidenceLoss,
    ...(diagnosticClass !== null ? { diagnosticClass } : {}),
    ...(recoveryHint !== null ? { recoveryHint } : {}),
    provenance: { origin: "semantic_evidence" },
    consequenceBaseline: evidence.consequenceBaseline,
    evidenceCertainty:
      evidence.kind === "terminal_failure" && evidence.failureDetail === "indeterminate"
        ? "indeterminate"
        : "determinate",
  };
}

function readObservationKind(evidence: TaskFailureSemanticEvidence): ObservationSemantics["kind"] {
  switch (evidence.kind) {
    case "expected_diagnostic_failure":
      return "diagnostic";
    case "terminal_failure":
      return evidence.failureDetail === "diagnostic" ||
        evidence.failureDetail === "source_window_limit"
        ? "diagnostic"
        : evidence.failureDetail === "outcome_only"
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
  evidence: TaskFailureSemanticEvidence,
): ObservationSemantics["polarity"] {
  if (!evidence.readsAsObservation) {
    return "failure";
  }

  switch (evidence.kind) {
    case "routine_bash_success_observation":
    case "structured_execution_success_observation":
    case "operation_success_observation":
      return "success";
    case "rejected_tool_use_observation":
      return "neutral";
    default:
      return "neutral";
  }
}

function readObservationOwner(
  evidence: TaskFailureSemanticEvidence,
): ObservationSemantics["ownership"]["owner"] {
  if (evidence.toolFamily !== undefined) {
    return "tool";
  }

  return evidence.readsAsObservation
    ? "source"
    : evidence.kind === "unclassified_failure"
      ? "unknown"
      : "engine";
}

function readObservationSubject(
  evidence: TaskFailureSemanticEvidence,
): ObservationSemantics["subject"] {
  if (evidence.kind === "routine_search_output" || evidence.toolFamily === "search") {
    return "search";
  }

  if (evidence.failureDetail === "source_window_limit") {
    return "source";
  }

  if (evidence.toolFamily !== undefined) {
    return "tool";
  }

  return "unknown";
}

function readObservationEvidenceLoss(
  evidence: TaskFailureSemanticEvidence,
): ObservationSemantics["evidenceLoss"] {
  switch (evidence.failureDetail) {
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
  evidence: TaskFailureSemanticEvidence,
): ObservationDiagnosticClass | null {
  if (evidence.kind === "expected_diagnostic_failure") {
    return "expected";
  }

  switch (evidence.failureDetail) {
    case "diagnostic":
      return "runtime";
    case "source_window_limit":
      return "source_limit";
    default:
      return null;
  }
}

function readObservationRecoveryHint(
  evidence: TaskFailureSemanticEvidence,
  evidenceLoss: ObservationSemantics["evidenceLoss"],
): ObservationRecoveryHint | null {
  if (evidence.kind === "rejected_tool_use_observation") {
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
      return readObservationDiagnosticClass(evidence) !== null ? "inspect_diagnostic" : null;
  }
}
