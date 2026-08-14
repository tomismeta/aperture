import type { ObservationalStatusConflictKind } from "./observational-status-conflict.js";

type ObservationInput = import("./normalized-observation.js").Observation;
type ObservationStatusConflictShape = Pick<
  ObservationInput,
  | "kind"
  | "polarity"
  | "ownership"
  | "subject"
  | "evidenceLoss"
  | "diagnosticClass"
  | "recoveryHint"
> & {
  provenance: { origin: string };
};

export type ObservationJudgment = {
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
  baselineConsequence: ObservationInput["consequenceBaseline"];
  outcomeOnlyFailureStatus: boolean;
  limitedFailureStatus: boolean;
  stableStatusEvidence: boolean;
  visibleDiagnosticFailure: boolean;
};

type RecoveryPostureKey =
  `${ObservationInput["kind"]}:${ObservationInput["polarity"]}:${ObservationInput["evidenceLoss"]}:${NonNullable<ObservationInput["diagnosticClass"]> | ""}:${NonNullable<ObservationInput["recoveryHint"]> | ""}`;
type RecoveryPosture = ObservationJudgment["recoveryPosture"];

const RECOVERY_POSTURE_BY_KEY: Readonly<Partial<Record<RecoveryPostureKey, RecoveryPosture>>> = {
  "control:neutral:none::await_authorization": "authorization_required",
  "diagnostic:failure:none:runtime:inspect_diagnostic": "diagnostic_inspection",
  "diagnostic:failure:none:expected:inspect_diagnostic": "diagnostic_inspection",
  "unknown:failure:unknown::inspect_original_evidence": "original_evidence_required",
  "diagnostic:failure:partial:source_limit:narrow_evidence_scope": "evidence_scope_required",
  "outcome:failure:absent::request_evidence": "evidence_required",
};

export function judgeObservation(observation: ObservationInput): ObservationJudgment {
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
  observation: ObservationInput,
): ObservationalStatusConflictKind | null {
  return resolveObservationStatusConflictKindFromShape(observation);
}

export function resolveObservationStatusConflictKindFromShape(
  observation: ObservationStatusConflictShape,
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

function isOutcomeOnlyFailure(observation: ObservationInput): boolean {
  return (
    isStableMediumFailure(observation) &&
    observation.kind === "outcome" &&
    observation.evidenceLoss === "none"
  );
}

function isLimitedFailure(
  observation: ObservationInput,
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

function isStableMediumFailure(observation: ObservationInput): boolean {
  return (
    observation.polarity === "failure" &&
    observation.evidenceLoss !== "unknown" &&
    observation.consequenceBaseline === "medium" &&
    observation.semanticAgreement === "stable"
  );
}

function hasStableStatusEvidence(observation: ObservationInput): boolean {
  return observation.semanticAgreement === "stable" && observation.evidenceStrength !== "weak";
}

function isVisibleDiagnosticFailure(observation: ObservationInput): boolean {
  return (
    observation.kind === "diagnostic" &&
    observation.diagnosticClass === "runtime" &&
    observation.evidenceLoss === "none" &&
    observation.polarity === "failure"
  );
}

function readObservationRecoveryPosture(
  observation: Pick<
    ObservationInput,
    "kind" | "polarity" | "evidenceLoss" | "diagnosticClass" | "recoveryHint"
  >,
): RecoveryPosture {
  const key =
    `${observation.kind}:${observation.polarity}:${observation.evidenceLoss}:${observation.diagnosticClass ?? ""}:${observation.recoveryHint ?? ""}` as RecoveryPostureKey;
  return RECOVERY_POSTURE_BY_KEY[key] ?? "none";
}
