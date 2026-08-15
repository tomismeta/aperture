import type {
  ObservationKernelDecisionFields,
  ObservationKernelFields,
  ObservationKernelJudgmentFields,
} from "./observation-kernel-scorecard-model.js";

export function isObservationKernelFields(value: unknown): value is ObservationKernelFields {
  return (
    isRecord(value) &&
    typeof value.kind === "string" &&
    typeof value.polarity === "string" &&
    typeof value.owner === "string" &&
    isNullableString(value.toolFamily) &&
    typeof value.subject === "string" &&
    typeof value.evidenceLoss === "string" &&
    typeof value.evidenceStrength === "string" &&
    typeof value.semanticAgreement === "string" &&
    isNullableString(value.diagnosticClass) &&
    isNullableString(value.recoveryHint) &&
    typeof value.provenanceOrigin === "string" &&
    typeof value.provenanceAuthority === "string" &&
    typeof value.consequenceBaseline === "string"
  );
}

export function isObservationKernelJudgmentFields(
  value: unknown,
): value is ObservationKernelJudgmentFields {
  return (
    isRecord(value) &&
    typeof value.statusEvidence === "string" &&
    isNullableString(value.statusConflictKind) &&
    typeof value.recoveryPosture === "string" &&
    typeof value.baselineConsequence === "string" &&
    typeof value.outcomeOnlyFailureStatus === "boolean" &&
    typeof value.limitedFailureStatus === "boolean" &&
    typeof value.stableStatusEvidence === "boolean" &&
    typeof value.visibleDiagnosticFailure === "boolean"
  );
}

export function isObservationKernelDecisionFields(
  value: unknown,
): value is ObservationKernelDecisionFields {
  return (
    isRecord(value) &&
    ["activate", "ambient", "auto_approve", "clear", "queue", "suppressed"].includes(
      String(value.plannerKind),
    ) &&
    ["ambient", "next", "none", "now"].includes(String(value.resultLane))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNullableString(value: unknown): boolean {
  return typeof value === "string" || value === null;
}
