import type {
  AttentionObservationAuthority,
  AttentionObservationDiagnosticClass,
  AttentionObservationEvidenceLoss,
  AttentionObservationIR,
  AttentionObservationKind,
  AttentionObservationOrigin,
  AttentionObservationOwner,
  AttentionObservationPolarity,
  AttentionObservationRecoveryHint,
  AttentionObservationStrength,
  AttentionObservationSubject,
  AttentionObservationAgreement,
} from "./observation.js";
import type { TaskFailureSemanticEvidence } from "./semantic-evidence.js";
import type {
  AttentionOntologyAuthority,
  AttentionOntologyDiagnostic,
} from "./semantic-ontology-types.js";

// First compiler target: task-failure evidence. The IR vocabulary is deliberately
// broader so other event families can compile into the same document later.
export function compileAttentionObservation(input: {
  failureEvidence: TaskFailureSemanticEvidence;
  ontology: AttentionOntologyDiagnostic;
  abstained: boolean;
  agreement: AttentionObservationAgreement;
}): AttentionObservationIR {
  const evidenceLoss = readObservationEvidenceLoss(input.failureEvidence);
  const diagnosticClass = readObservationDiagnosticClass(input.failureEvidence);
  const recoveryHint = readObservationRecoveryHint(input.failureEvidence, evidenceLoss);
  const toolFamily = input.failureEvidence.toolFamily;

  return {
    kind: readObservationKind(input.failureEvidence),
    polarity: readObservationPolarity(input.failureEvidence),
    agreement: input.agreement,
    ownership: {
      owner: readObservationOwner(input.failureEvidence),
      ...(toolFamily !== undefined ? { toolFamily } : {}),
    },
    strength: deriveObservationEvidenceStrength({
      ontology: input.ontology,
      abstained: input.abstained,
      agreement: input.agreement,
      evidenceLoss,
    }),
    subject: readObservationSubject(input.failureEvidence),
    evidenceLoss,
    ...(diagnosticClass !== null ? { diagnosticClass } : {}),
    ...(recoveryHint !== null ? { recoveryHint } : {}),
    provenance: {
      origin: readObservationOrigin(input.failureEvidence),
      authority: readObservationAuthority(input.ontology.source),
    },
    consequenceBaseline: input.failureEvidence.consequenceBaseline,
  };
}

function readObservationKind(evidence: TaskFailureSemanticEvidence): AttentionObservationKind {
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
): AttentionObservationPolarity {
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

function readObservationOwner(evidence: TaskFailureSemanticEvidence): AttentionObservationOwner {
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
): AttentionObservationSubject {
  if (evidence.observation !== undefined) {
    return normalizeObservationSubject(evidence.observation.subject);
  }

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

function normalizeObservationSubject(
  subject: NonNullable<TaskFailureSemanticEvidence["observation"]>["subject"],
): AttentionObservationSubject {
  switch (subject) {
    case "source":
    case "diff":
      return "source";
    case "document":
    case "linter":
    case "listing":
    case "readback":
    case "test":
      return "document";
    case "tool":
      return "tool";
  }
}

function readObservationEvidenceLoss(
  evidence: TaskFailureSemanticEvidence,
): AttentionObservationEvidenceLoss {
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
): AttentionObservationDiagnosticClass | null {
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
  evidenceLoss: AttentionObservationEvidenceLoss,
): AttentionObservationRecoveryHint | null {
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

function readObservationOrigin(evidence: TaskFailureSemanticEvidence): AttentionObservationOrigin {
  return evidence.observation?.origin ?? "semantic_evidence";
}

function readObservationAuthority(
  source: AttentionOntologyAuthority | undefined,
): AttentionObservationAuthority {
  switch (source) {
    case "explicit":
    case "hinted":
    case "inferred":
      return source;
    default:
      return "unknown";
  }
}

function deriveObservationEvidenceStrength(input: {
  ontology: AttentionOntologyDiagnostic;
  abstained: boolean;
  agreement: AttentionObservationAgreement;
  evidenceLoss: AttentionObservationEvidenceLoss;
}): AttentionObservationStrength {
  if (
    input.abstained ||
    input.agreement !== "stable" ||
    input.ontology.confidence === "low" ||
    input.evidenceLoss === "absent" ||
    input.evidenceLoss === "unknown"
  ) {
    return "weak";
  }

  if (input.ontology.confidence === "medium") {
    return input.ontology.source === "inferred" ? "weak" : "qualified";
  }

  return input.ontology.source === "inferred" ? "qualified" : "strong";
}
