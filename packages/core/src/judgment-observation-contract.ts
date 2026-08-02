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

export type ObservationJudgmentContract = {
  statusEvidence:
    | "limited_failure"
    | "stable_observation"
    | "visible_diagnostic_failure"
    | "weak_or_uncertain";
  statusConflictKind: ObservationalStatusConflictKind | null;
  recoveryPosture:
    | "authorization_required"
    | "diagnostic_inspection"
    | "evidence_required"
    | "evidence_scope_required"
    | "original_evidence_required"
    | "none";
  baselineConsequence: ObservationJudgmentDocument["consequenceBaseline"];
  outcomeOnlyFailureStatus: boolean;
  limitedFailureStatus: boolean;
  stableStatusEvidence: boolean;
  visibleDiagnosticFailure: boolean;
};

type RecoveryPostureKey =
  `${ObservationJudgmentDocument["kind"]}:${ObservationJudgmentDocument["polarity"]}:${ObservationJudgmentDocument["evidenceLoss"]}:${NonNullable<ObservationJudgmentDocument["diagnosticClass"]> | ""}:${NonNullable<ObservationJudgmentDocument["recoveryHint"]> | ""}`;
type RecoveryPosture = ObservationJudgmentContract["recoveryPosture"];

const RECOVERY_POSTURE_BY_KEY: Readonly<Partial<Record<RecoveryPostureKey, RecoveryPosture>>> = {
  "control:neutral:none::await_authorization": "authorization_required",
  "diagnostic:failure:none:runtime:inspect_diagnostic": "diagnostic_inspection",
  "diagnostic:failure:none:expected:inspect_diagnostic": "diagnostic_inspection",
  "unknown:failure:unknown::inspect_original_evidence": "original_evidence_required",
  "diagnostic:failure:partial:source_limit:narrow_evidence_scope": "evidence_scope_required",
  "outcome:failure:absent::request_evidence": "evidence_required",
};

export function projectObservationJudgmentContract(
  observation: ObservationJudgmentDocument,
): ObservationJudgmentContract {
  const recoveryPosture = readObservationRecoveryPosture(observation);
  const outcomeOnlyFailureStatus = isOutcomeOnlyFailure(observation);
  const limitedFailureStatus = isLimitedFailure(observation, recoveryPosture);
  const stableStatusEvidence = hasStableStatusEvidence(observation);
  const visibleDiagnosticFailure = isVisibleDiagnosticFailure(observation);
  return {
    statusEvidence: limitedFailureStatus
      ? "limited_failure"
      : visibleDiagnosticFailure
        ? "visible_diagnostic_failure"
        : stableStatusEvidence
          ? "stable_observation"
          : "weak_or_uncertain",
    statusConflictKind: resolveObservationStatusConflictKind(observation),
    recoveryPosture,
    baselineConsequence: observation.consequenceBaseline,
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
    return readObservationRecoveryPosture(observation) === "authorization_required" &&
      observation.ownership.owner === "tool" &&
      observation.subject === "tool"
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

function isOutcomeOnlyFailure(observation: ObservationJudgmentDocument): boolean {
  return (
    isStableMediumFailure(observation) &&
    observation.kind === "outcome" &&
    observation.evidenceLoss === "none"
  );
}

function isLimitedFailure(
  observation: ObservationJudgmentDocument,
  recoveryPosture: RecoveryPosture,
): boolean {
  if (isOutcomeOnlyFailure(observation)) {
    return true;
  }
  if (!isStableMediumFailure(observation)) {
    return false;
  }
  return (
    (observation.kind === "outcome" &&
      observation.evidenceLoss === "absent" &&
      recoveryPosture === "evidence_required") ||
    (observation.kind === "diagnostic" &&
      observation.evidenceLoss === "partial" &&
      recoveryPosture === "evidence_scope_required")
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

function readObservationRecoveryPosture(observation: ObservationJudgmentDocument): RecoveryPosture {
  const key =
    `${observation.kind}:${observation.polarity}:${observation.evidenceLoss}:${observation.diagnosticClass ?? ""}:${observation.recoveryHint ?? ""}` as RecoveryPostureKey;
  return RECOVERY_POSTURE_BY_KEY[key] ?? "none";
}
