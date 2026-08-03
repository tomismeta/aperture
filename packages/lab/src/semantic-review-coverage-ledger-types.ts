export const SEMANTIC_REVIEW_COVERAGE_SIGNATURE_SCHEMA_VERSION = 1 as const;

export type SemanticReviewLedgerSignatureExample = {
  bundlePath: string;
  sessionId: string;
  title: string;
  stepIndex: number;
  stepLabel?: string;
};

export type SemanticReviewLedgerSignatureCount = {
  signature: string;
  count: number;
  firstExample: SemanticReviewLedgerSignatureExample;
};

export type SemanticReviewNoveltySummary = {
  observedCount: number;
  uniqueSignatureCount: number;
  duplicateObservationCount: number;
  repeatedSignatureCount: number;
  maxSignatureCount: number;
  topSignatures: SemanticReviewLedgerSignatureCount[];
};

export type SemanticReviewSignatureBaselineComparison = {
  baselineObservedCount: number;
  baselineUniqueSignatureCount: number;
  observedUniqueSignatureCount: number;
  coveredSignatureCount: number;
  coveredObservationCount: number;
  novelSignatureCount: number;
  novelObservationCount: number;
  repeatedNovelSignatureCount: number;
  topNovelSignatures: SemanticReviewLedgerSignatureCount[];
};

export type SemanticReviewCoverageBaselineComparisonStatus =
  | "compared"
  | "not_comparable_persisted_snapshots"
  | "unavailable_sync_report";

export type SemanticReviewCoverageBaselineComparison = {
  status: SemanticReviewCoverageBaselineComparisonStatus;
  reason: string | null;
  structuralSignature: SemanticReviewSignatureBaselineComparison | null;
  failureSignature: SemanticReviewSignatureBaselineComparison | null;
};

export type SemanticReviewCoverageEvaluationMode =
  | "persisted_bundle_snapshots"
  | "current_engine_replay";

export type SemanticReviewCoverageBaseline = {
  profileId: string;
  profileVersion: number;
  profileDigest: `sha256:${string}`;
  signatureSchemaVersion: typeof SEMANTIC_REVIEW_COVERAGE_SIGNATURE_SCHEMA_VERSION;
  signatureSetDigest: `sha256:${string}` | null;
  engineFingerprint: string;
  evaluationMode: SemanticReviewCoverageEvaluationMode;
  authority: "engine_observation_coverage";
};

export type SemanticReviewCoverageObservations = {
  stepCount: number;
  semanticComparableCount: number;
  judgmentComparableCount: number;
  missingSemanticCount: number;
  missingJudgmentCount: number;
  semanticAbstainedCount: number;
};

export type SemanticReviewCoverageReport = {
  shapeSchemaVersion: 1;
  baseline: SemanticReviewCoverageBaseline;
  observations: SemanticReviewCoverageObservations;
  corpusNovelty: {
    structuralSignature: SemanticReviewNoveltySummary;
    failureSignature: SemanticReviewNoveltySummary;
  };
  corpusComparison: SemanticReviewCoverageBaselineComparison;
  semantic: {
    intentFrameCounts: Record<string, number>;
    activityClassCounts: Record<string, number>;
    toolFamilyCounts: Record<string, number>;
    consequenceCounts: Record<string, number>;
    confidenceCounts: Record<string, number>;
  };
  judgment: {
    evaluationKindCounts: Record<string, number>;
    decisionKindCounts: Record<string, number>;
    plannedLaneCounts: Record<string, number>;
    resultLaneCounts: Record<string, number>;
    ambiguityReasonCounts: Record<string, number>;
    reasonCodeFamilyCounts: Record<string, number>;
  };
};
