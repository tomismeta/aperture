import type {
  NormalizedObservationAuthority,
  NormalizedObservationDiagnosticClass,
  NormalizedObservationEvidenceLoss,
  NormalizedObservation,
  NormalizedObservationKind,
  NormalizedObservationOrigin,
  NormalizedObservationOwner,
  NormalizedObservationPolarity,
  NormalizedObservationRecoveryHint,
  NormalizedObservationEvidenceStrength,
  NormalizedObservationSubject,
  NormalizedObservationSemanticAgreement,
} from "./normalized-observation.js";
import type { TaskFailureSemanticEvidence } from "./semantic-evidence.js";
import type {
  AttentionOntologyAuthority,
  AttentionOntologyDiagnostic,
} from "./semantic-ontology-types.js";

export function createStableFailureOutcomeObservation(input: {
  authority?: NormalizedObservationAuthority;
  owner?: NormalizedObservationOwner;
  evidenceStrength?: NormalizedObservationEvidenceStrength;
  subject?: NormalizedObservationSubject;
  toolFamily?: string;
}): NormalizedObservation {
  return {
    kind: "outcome",
    polarity: "failure",
    semanticAgreement: "stable",
    ownership: {
      owner: input.owner ?? "engine",
      ...(input.toolFamily !== undefined ? { toolFamily: input.toolFamily } : {}),
    },
    evidenceStrength: input.evidenceStrength ?? "strong",
    subject: input.subject ?? "unknown",
    evidenceLoss: "none",
    provenance: { origin: "semantic_evidence", authority: input.authority ?? "unknown" },
    consequenceBaseline: "medium",
  };
}

export function normalizeTaskFailureObservation(input: {
  failureEvidence: TaskFailureSemanticEvidence;
  ontology: AttentionOntologyDiagnostic;
  abstained: boolean;
  semanticAgreement: NormalizedObservationSemanticAgreement;
}): NormalizedObservation {
  const evidenceLoss = readObservationEvidenceLoss(input.failureEvidence);
  const diagnosticClass = readObservationDiagnosticClass(input.failureEvidence);
  const recoveryHint = readObservationRecoveryHint(input.failureEvidence, evidenceLoss);
  const toolFamily = input.failureEvidence.toolFamily;
  const semanticAgreement =
    input.failureEvidence.kind === "terminal_failure" &&
    input.failureEvidence.failureDetail === "indeterminate"
      ? "uncertain"
      : input.semanticAgreement;
  return {
    kind: readObservationKind(input.failureEvidence),
    polarity: readObservationPolarity(input.failureEvidence),
    semanticAgreement,
    ownership: {
      owner: readObservationOwner(input.failureEvidence),
      ...(toolFamily !== undefined ? { toolFamily } : {}),
    },
    evidenceStrength: deriveObservationEvidenceStrength({
      ontology: input.ontology,
      abstained: input.abstained,
      semanticAgreement,
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

function readObservationKind(evidence: TaskFailureSemanticEvidence): NormalizedObservationKind {
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
): NormalizedObservationPolarity {
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

function readObservationOwner(evidence: TaskFailureSemanticEvidence): NormalizedObservationOwner {
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
): NormalizedObservationSubject {
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
): NormalizedObservationSubject {
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
): NormalizedObservationEvidenceLoss {
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
): NormalizedObservationDiagnosticClass | null {
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
  evidenceLoss: NormalizedObservationEvidenceLoss,
): NormalizedObservationRecoveryHint | null {
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

function readObservationOrigin(evidence: TaskFailureSemanticEvidence): NormalizedObservationOrigin {
  return evidence.observation?.origin ?? "semantic_evidence";
}

function readObservationAuthority(
  source: AttentionOntologyAuthority | undefined,
): NormalizedObservationAuthority {
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
  semanticAgreement: NormalizedObservationSemanticAgreement;
  evidenceLoss: NormalizedObservationEvidenceLoss;
}): NormalizedObservationEvidenceStrength {
  if (
    input.abstained ||
    input.semanticAgreement !== "stable" ||
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
