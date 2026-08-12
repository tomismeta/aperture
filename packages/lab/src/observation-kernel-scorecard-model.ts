import type { ObservationKernelFixtureSplit } from "./observation-kernel-fixtures.js";
import type { ObservationKernelQuality } from "./observation-kernel-quality.js";

export const OBSERVATION_KERNEL_SCORECARD_SCHEMA_VERSION = 3 as const;
export const OBSERVATION_KERNEL_SCORECARD_PROFILE_ID = "observation-kernel-scorecard" as const;
export const OBSERVATION_KERNEL_SCORECARD_PROFILE_VERSION = 3 as const;
export const OBSERVATION_KERNEL_SCORECARD_PROOF = {
  releaseEligible: false,
  retiredRegressionHoldout: true,
  independentPostFreezeHoldoutRequired: true,
} as const;

export const OBSERVATION_KERNEL_SCORECARD_THRESHOLDS = {
  minimumFixtures: 40,
  minimumObservationFixtures: 40,
  minimumObservations: 42,
  minimumCoveredDimensions: 40,
} as const;

export type ObservationKernelScorecard = {
  schemaVersion: typeof OBSERVATION_KERNEL_SCORECARD_SCHEMA_VERSION;
  profile: {
    id: typeof OBSERVATION_KERNEL_SCORECARD_PROFILE_ID;
    version: typeof OBSERVATION_KERNEL_SCORECARD_PROFILE_VERSION;
    suiteDigest: string;
  };
  thresholds: typeof OBSERVATION_KERNEL_SCORECARD_THRESHOLDS;
  proof: typeof OBSERVATION_KERNEL_SCORECARD_PROOF;
  passed: boolean;
  failures: string[];
  summary: {
    fixtures: {
      total: number;
      withObservation: number;
      calibration: number;
      retiredRegression: number;
    };
    observations: { total: number; unique: number };
    dimensions: { total: number; covered: number; missing: number };
    determinism: { repeatedRuns: 2; stable: boolean };
  };
  quality: ObservationKernelQuality;
  coverage: ObservationKernelCoverage;
  observations: ObservationKernelObservation[];
};

export type ObservationKernelCoverage = {
  splits: ObservationKernelDistribution;
  dimensions: ObservationKernelDistribution;
  kinds: ObservationKernelDistribution;
  polarities: ObservationKernelDistribution;
  owners: ObservationKernelDistribution;
  subjects: ObservationKernelDistribution;
  evidenceLosses: ObservationKernelDistribution;
  evidenceStrengths: ObservationKernelDistribution;
  semanticAgreements: ObservationKernelDistribution;
  diagnosticClasses: ObservationKernelDistribution;
  recoveryHints: ObservationKernelDistribution;
  provenanceOrigins: ObservationKernelDistribution;
  provenanceAuthorities: ObservationKernelDistribution;
  consequenceBaselines: ObservationKernelDistribution;
};

export type ObservationKernelDistribution = Array<{
  id: string;
  count: number;
  fixtureCount: number;
  fixtureIds: string[];
}>;

export type ObservationKernelObservation = {
  fixtureId: string;
  dimension: string;
  split: ObservationKernelFixtureSplit;
  sequence: number;
  digest: string;
  semanticDigest: string;
  judgmentDigest: string;
  decisionDigest: string;
  fields: ObservationKernelFields;
  judgment: ObservationKernelJudgmentFields;
  decision: ObservationKernelDecisionFields;
};

export type ObservationKernelFields = {
  kind: string;
  polarity: string;
  owner: string;
  toolFamily: string | null;
  subject: string;
  evidenceLoss: string;
  evidenceStrength: string;
  semanticAgreement: string;
  diagnosticClass: string | null;
  recoveryHint: string | null;
  provenanceOrigin: string;
  provenanceAuthority: string;
  consequenceBaseline: string;
};

export type ObservationKernelJudgmentFields = {
  statusEvidence: string;
  statusConflictKind: string | null;
  recoveryPosture: string;
  baselineConsequence: string;
  outcomeOnlyFailureStatus: boolean;
  limitedFailureStatus: boolean;
  stableStatusEvidence: boolean;
  visibleDiagnosticFailure: boolean;
};

export type ObservationKernelDecisionFields = {
  plannerKind: "activate" | "ambient" | "auto_approve" | "clear" | "queue" | "suppressed";
  resultLane: "ambient" | "next" | "none" | "now";
};
