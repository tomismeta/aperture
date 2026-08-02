import type { ObservationSemantics } from "./observation-semantics.js";
import type { ObservationalStatusConflictKind } from "./observational-status-conflict.js";

export type ObservationJudgmentDocument = Omit<
  ObservationSemantics,
  "evidenceCertainty" | "provenance"
> & {
  semanticAgreement: "stable" | "overridden" | "uncertain";
  evidenceStrength: "weak" | "qualified" | "strong";
  provenance: ObservationSemantics["provenance"] & {
    authority: "explicit" | "hinted" | "inferred" | "unknown";
  };
};

export type ObservationJudgmentStatusEvidence =
  | "limited_failure"
  | "stable_observation"
  | "visible_diagnostic_failure"
  | "weak_or_uncertain";

export type ObservationJudgmentContract = {
  statusEvidence: ObservationJudgmentStatusEvidence;
  statusConflictKind: ObservationalStatusConflictKind | null;
  outcomeOnlyFailureStatus: boolean;
  limitedFailureStatus: boolean;
  stableStatusEvidence: boolean;
  visibleDiagnosticFailure: boolean;
};

export function projectObservationJudgmentContract(
  observation: ObservationJudgmentDocument,
): ObservationJudgmentContract {
  const outcomeOnlyFailureStatus = isOutcomeOnlyFailure(observation);
  const limitedFailureStatus =
    outcomeOnlyFailureStatus || isAbsentFailure(observation) || isPartialFailure(observation);
  const stableStatusEvidence = hasStableStatusEvidence(observation);
  const visibleDiagnosticFailure = isVisibleDiagnosticFailure(observation);
  return {
    statusEvidence: readStatusEvidence({
      limitedFailureStatus,
      stableStatusEvidence,
      visibleDiagnosticFailure,
    }),
    statusConflictKind: resolveObservationStatusConflictKind(observation),
    outcomeOnlyFailureStatus,
    limitedFailureStatus,
    stableStatusEvidence,
    visibleDiagnosticFailure,
  };
}

export function resolveObservationStatusConflictKind(
  observation: ObservationJudgmentDocument,
): ObservationalStatusConflictKind | null {
  if (observation.kind === "control") {
    return observation.recoveryHint === "await_authorization"
      ? "rejected_tool_use_observation"
      : null;
  }
  if (observation.kind === "payload") {
    if (observation.provenance.origin === "structured_output") {
      return "structured_output_observation";
    }
    return observation.subject === "search" ? "search_output_observation" : "payload_observation";
  }
  if (observation.kind !== "outcome" || observation.polarity !== "success") {
    return null;
  }
  if (observation.provenance.origin === "structured_output") {
    return "execution_success_observation";
  }
  return observation.subject === "command" ? "command_success_observation" : "payload_observation";
}

function readStatusEvidence(input: {
  limitedFailureStatus: boolean;
  stableStatusEvidence: boolean;
  visibleDiagnosticFailure: boolean;
}): ObservationJudgmentStatusEvidence {
  return input.limitedFailureStatus
    ? "limited_failure"
    : input.visibleDiagnosticFailure
      ? "visible_diagnostic_failure"
      : input.stableStatusEvidence
        ? "stable_observation"
        : "weak_or_uncertain";
}

function isOutcomeOnlyFailure(observation: ObservationJudgmentDocument): boolean {
  return (
    isStableMediumFailure(observation) &&
    observation.kind === "outcome" &&
    observation.evidenceLoss === "none"
  );
}

function isAbsentFailure(observation: ObservationJudgmentDocument): boolean {
  return (
    isStableMediumFailure(observation) &&
    observation.kind === "outcome" &&
    observation.evidenceLoss === "absent" &&
    observation.recoveryHint === "request_evidence"
  );
}

function isPartialFailure(observation: ObservationJudgmentDocument): boolean {
  return (
    isStableMediumFailure(observation) &&
    observation.kind === "diagnostic" &&
    observation.evidenceLoss === "partial" &&
    observation.recoveryHint === "narrow_evidence_scope"
  );
}

function isStableMediumFailure(observation: ObservationJudgmentDocument): boolean {
  return (
    observation.polarity === "failure" &&
    observation.evidenceLoss !== "unknown" &&
    observation.consequenceBaseline === "medium" &&
    observation.semanticAgreement === "stable"
  );
}

function hasStableStatusEvidence(observation: ObservationJudgmentDocument): boolean {
  return observation.semanticAgreement === "stable" && observation.evidenceStrength !== "weak";
}

function isVisibleDiagnosticFailure(observation: ObservationJudgmentDocument): boolean {
  return (
    observation.kind === "diagnostic" &&
    observation.diagnosticClass === "runtime" &&
    observation.evidenceLoss === "none" &&
    observation.polarity === "failure"
  );
}
