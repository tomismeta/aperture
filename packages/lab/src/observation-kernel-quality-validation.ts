import {
  OBSERVATION_KERNEL_QUALITY_THRESHOLDS,
  type ObservationKernelAccuracy,
  type ObservationKernelFieldAccuracy,
  type ObservationKernelQuality,
  type ObservationKernelQualityBreakdown,
} from "./observation-kernel-quality.js";

export function isObservationKernelQuality(value: unknown): value is ObservationKernelQuality {
  return (
    isRecord(value) &&
    isThresholds(value.thresholds) &&
    typeof value.passed === "boolean" &&
    isStringArray(value.failures) &&
    isSplitFixtures(value.fixtures) &&
    isBreakdown(value.summary) &&
    isRecord(value.bySplit) &&
    isBreakdown(value.bySplit.calibration) &&
    isBreakdown(value.bySplit.retired_regression) &&
    isFieldAccuracyArray(value.semanticFields) &&
    isFieldAccuracyArray(value.judgmentFields) &&
    isFieldAccuracyArray(value.decisionFields)
  );
}

function isThresholds(value: unknown): boolean {
  const expected = OBSERVATION_KERNEL_QUALITY_THRESHOLDS;
  return (
    isRecord(value) &&
    value.minimumCalibrationFixtures === expected.minimumCalibrationFixtures &&
    value.minimumRetiredRegressionFixtures === expected.minimumRetiredRegressionFixtures &&
    value.minimumSemanticAccuracy === expected.minimumSemanticAccuracy &&
    value.minimumJudgmentAccuracy === expected.minimumJudgmentAccuracy &&
    value.minimumDecisionAccuracy === expected.minimumDecisionAccuracy &&
    value.minimumExactOutcomeAccuracy === expected.minimumExactOutcomeAccuracy
  );
}

function isSplitFixtures(value: unknown): boolean {
  return (
    isRecord(value) && isFiniteNumber(value.calibration) && isFiniteNumber(value.retired_regression)
  );
}

function isBreakdown(value: unknown): value is ObservationKernelQualityBreakdown {
  return (
    isRecord(value) &&
    isAccuracy(value.semantics) &&
    isAccuracy(value.judgment) &&
    isAccuracy(value.decision) &&
    isAccuracy(value.exactOutcomes)
  );
}

function isFieldAccuracyArray(value: unknown): value is ObservationKernelFieldAccuracy[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => isRecord(entry) && typeof entry.field === "string" && isAccuracy(entry))
  );
}

function isAccuracy(value: unknown): value is ObservationKernelAccuracy {
  return (
    isRecord(value) &&
    isFiniteNumber(value.passed) &&
    isFiniteNumber(value.total) &&
    isFiniteNumber(value.score) &&
    value.passed >= 0 &&
    value.total >= value.passed &&
    value.score >= 0 &&
    value.score <= 1
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
