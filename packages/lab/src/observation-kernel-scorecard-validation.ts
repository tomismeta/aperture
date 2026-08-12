import { compareKernelCanonicalKey } from "./kernel-canonical-json.js";
import {
  isObservationKernelDecisionFields,
  isObservationKernelFields,
  isObservationKernelJudgmentFields,
} from "./observation-kernel-outcome-validation.js";
import { isObservationKernelQuality } from "./observation-kernel-quality-validation.js";
import {
  OBSERVATION_KERNEL_SCORECARD_PROFILE_ID,
  OBSERVATION_KERNEL_SCORECARD_PROFILE_VERSION,
  OBSERVATION_KERNEL_SCORECARD_PROOF,
  OBSERVATION_KERNEL_SCORECARD_SCHEMA_VERSION,
  OBSERVATION_KERNEL_SCORECARD_THRESHOLDS,
  type ObservationKernelCoverage,
  type ObservationKernelDistribution,
  type ObservationKernelObservation,
  type ObservationKernelScorecard,
} from "./observation-kernel-scorecard.js";

export function parseObservationKernelScorecard(source: string): ObservationKernelScorecard {
  const value = JSON.parse(source) as unknown;
  if (!isObservationKernelScorecard(value)) {
    throw new Error("Invalid observation kernel scorecard.");
  }
  return value;
}

function isObservationKernelScorecard(value: unknown): value is ObservationKernelScorecard {
  return (
    isRecord(value) &&
    value.schemaVersion === OBSERVATION_KERNEL_SCORECARD_SCHEMA_VERSION &&
    isRecord(value.profile) &&
    value.profile.id === OBSERVATION_KERNEL_SCORECARD_PROFILE_ID &&
    value.profile.version === OBSERVATION_KERNEL_SCORECARD_PROFILE_VERSION &&
    typeof value.profile.suiteDigest === "string" &&
    isObservationKernelThresholds(value.thresholds) &&
    isObservationKernelProof(value.proof) &&
    typeof value.passed === "boolean" &&
    isStringArray(value.failures) &&
    isScorecardSummary(value.summary) &&
    isObservationKernelQuality(value.quality) &&
    isObservationKernelCoverage(value.coverage) &&
    Array.isArray(value.observations) &&
    value.observations.every(isObservationKernelObservation)
  );
}

function isObservationKernelProof(
  value: unknown,
): value is typeof OBSERVATION_KERNEL_SCORECARD_PROOF {
  return (
    isRecord(value) &&
    value.releaseEligible === OBSERVATION_KERNEL_SCORECARD_PROOF.releaseEligible &&
    value.retiredRegressionHoldout ===
      OBSERVATION_KERNEL_SCORECARD_PROOF.retiredRegressionHoldout &&
    value.independentPostFreezeHoldoutRequired ===
      OBSERVATION_KERNEL_SCORECARD_PROOF.independentPostFreezeHoldoutRequired
  );
}

function isObservationKernelThresholds(
  value: unknown,
): value is typeof OBSERVATION_KERNEL_SCORECARD_THRESHOLDS {
  return (
    isRecord(value) &&
    value.minimumFixtures === OBSERVATION_KERNEL_SCORECARD_THRESHOLDS.minimumFixtures &&
    value.minimumObservationFixtures ===
      OBSERVATION_KERNEL_SCORECARD_THRESHOLDS.minimumObservationFixtures &&
    value.minimumObservations === OBSERVATION_KERNEL_SCORECARD_THRESHOLDS.minimumObservations &&
    value.minimumCoveredDimensions ===
      OBSERVATION_KERNEL_SCORECARD_THRESHOLDS.minimumCoveredDimensions
  );
}

function isScorecardSummary(value: unknown): value is ObservationKernelScorecard["summary"] {
  return (
    isRecord(value) &&
    isRecord(value.fixtures) &&
    isFiniteNumber(value.fixtures.total) &&
    isFiniteNumber(value.fixtures.withObservation) &&
    isFiniteNumber(value.fixtures.calibration) &&
    isFiniteNumber(value.fixtures.retiredRegression) &&
    isRecord(value.observations) &&
    isFiniteNumber(value.observations.total) &&
    isFiniteNumber(value.observations.unique) &&
    isRecord(value.dimensions) &&
    isFiniteNumber(value.dimensions.total) &&
    isFiniteNumber(value.dimensions.covered) &&
    isFiniteNumber(value.dimensions.missing) &&
    isRecord(value.determinism) &&
    value.determinism.repeatedRuns === 2 &&
    typeof value.determinism.stable === "boolean"
  );
}

function isObservationKernelCoverage(value: unknown): value is ObservationKernelCoverage {
  return (
    isRecord(value) &&
    isObservationDistribution(value.splits) &&
    isObservationDistribution(value.dimensions) &&
    isObservationDistribution(value.kinds) &&
    isObservationDistribution(value.polarities) &&
    isObservationDistribution(value.owners) &&
    isObservationDistribution(value.subjects) &&
    isObservationDistribution(value.evidenceLosses) &&
    isObservationDistribution(value.evidenceStrengths) &&
    isObservationDistribution(value.semanticAgreements) &&
    isObservationDistribution(value.diagnosticClasses) &&
    isObservationDistribution(value.recoveryHints) &&
    isObservationDistribution(value.provenanceOrigins) &&
    isObservationDistribution(value.provenanceAuthorities) &&
    isObservationDistribution(value.consequenceBaselines)
  );
}

function isObservationDistribution(value: unknown): value is ObservationKernelDistribution {
  return (
    Array.isArray(value) &&
    value.every(
      (entry, index) =>
        isRecord(entry) &&
        typeof entry.id === "string" &&
        isFiniteNumber(entry.count) &&
        isFiniteNumber(entry.fixtureCount) &&
        isStringArray(entry.fixtureIds) &&
        (index === 0 || compareKernelCanonicalKey(value[index - 1]?.id ?? "", entry.id) < 0),
    )
  );
}

function isObservationKernelObservation(value: unknown): value is ObservationKernelObservation {
  return (
    isRecord(value) &&
    typeof value.fixtureId === "string" &&
    typeof value.dimension === "string" &&
    (value.split === "calibration" || value.split === "holdout") &&
    isFiniteNumber(value.sequence) &&
    typeof value.digest === "string" &&
    typeof value.semanticDigest === "string" &&
    typeof value.judgmentDigest === "string" &&
    typeof value.decisionDigest === "string" &&
    isObservationKernelFields(value.fields) &&
    isObservationKernelJudgmentFields(value.judgment) &&
    isObservationKernelDecisionFields(value.decision)
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
