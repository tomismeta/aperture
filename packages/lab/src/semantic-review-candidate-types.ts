import { SEMANTIC_REVIEW_CANDIDATE_REPORT_SCHEMA_VERSION } from "./artifact-versions.js";
import type { OfflineReviewFocusArea } from "./offline-review.js";
import type { PublicCorpusRecordLedgerEntry } from "./public-corpus-manifest.js";
import { defaultLabRuntimeSubdirectory } from "./runtime-paths.js";
import type { SemanticReviewCoverageReport } from "./semantic-review-coverage-ledger-types.js";
import type { SemanticReviewTaskFailureEvidenceSummary } from "./semantic-review-failure-evidence-types.js";

export const SEMANTIC_REVIEW_CANDIDATE_KINDS = [
  "missing_why_now",
  "high_consequence_attention",
  "failure_attention",
  "blocked_attention",
  "queue_decision",
  "semantic_uncertainty",
  "routing_ambiguity",
  "tool_taxonomy_gap",
  "relation_signal",
] as const;

export type SemanticReviewCandidateKind = (typeof SEMANTIC_REVIEW_CANDIDATE_KINDS)[number];

export type CandidateBundleInput = {
  bundlePath: string;
  record?: PublicCorpusRecordLedgerEntry;
  manifestPath?: string;
};

export type SemanticReviewCandidateEvaluationMode =
  | "persisted_bundle_snapshots"
  | "current_engine_replay";

export type SemanticReviewCandidateReplayClock = {
  strategy: "none" | "monotonic_step_timestamp_previous_timestamp_fallback";
  fallback: "previous_replay_timestamp_then_reference_timestamp";
  referenceTimestampSourceCounts: {
    first_step_timestamp: number;
    exported_at: number;
    unix_epoch: number;
  };
  earliestReferenceTimestamp: string | null;
  latestReferenceTimestamp: string | null;
};

export type SemanticReviewCandidateEngineFingerprint = {
  corePackage: {
    name: string;
    version: string;
  };
  kernelDecisionRecordProjectionVersion: number;
  fingerprint: string;
};

export type SemanticReviewCandidate = {
  kind: SemanticReviewCandidateKind;
  pressureScore: number;
  bundlePath: string;
  sessionId: string;
  title: string;
  source?: {
    id?: string;
    label?: string;
  };
  publicCorpus?: {
    manifestPath?: string;
    offset?: number;
    rowIndex?: number;
    recordId?: string;
    sourceIdentity?: string;
    rowDigest?: `sha256:${string}`;
    bundleDigest?: `sha256:${string}`;
    canonicalSessionDigest?: `sha256:${string}`;
  };
  stepIndex: number;
  stepLabel?: string;
  sourceExcerpt: string | null;
  event: {
    type: string | null;
    status: string | null;
    title: string | null;
    summary: string | null;
    toolFamily: string | null;
  };
  semantic: {
    intentFrame: string | null;
    activityClass: string | null;
    toolFamily: string | null;
    consequence: string | null;
    confidence: string | null;
    whyNow: string | null;
    relationKinds: string[];
    provenance: Record<string, string>;
  };
  judgment: {
    evaluationKind: string | null;
    decisionKind: string | null;
    plannedLane: string | null;
    resultLane: string | null;
    semanticConfidence: string | null;
    semanticAbstained: boolean | null;
    ambiguityReason: string | null;
    ambiguityResolution: string | null;
    reasonCodes: string[];
  };
  reviewFocusAreas: OfflineReviewFocusArea[];
  reviewRationale: string;
};

export type SemanticReviewCandidateReport = {
  schemaVersion: typeof SEMANTIC_REVIEW_CANDIDATE_REPORT_SCHEMA_VERSION;
  generatedAt: string;
  selection: {
    maxCandidatesPerKind: number;
    maxCandidatesPerSessionPerKind: number;
    maxFailureEvidenceExamplesPerKind: number;
    maxFailureEvidenceExamplesPerSessionPerKind: number;
    maxUnclassifiedEventShapes: number;
    maxUnclassifiedExamplesPerEventShape: number;
    retainedSort: "pressure_score_desc_path_step";
    promotionAuthority: "review_required";
  };
  input: {
    evaluationMode: SemanticReviewCandidateEvaluationMode;
    engine: SemanticReviewCandidateEngineFingerprint;
    replayClock: SemanticReviewCandidateReplayClock;
    manifestPaths: string[];
    bundlePaths: string[];
    bundleDirectories: string[];
    fileCount: number;
    scannedBundleCount: number;
    invalidBundleCount: number;
    manifestRecordCount: number;
    manifestBundleCount: number;
  };
  summary: {
    candidateCount: number;
    countsByKind: Record<SemanticReviewCandidateKind, number>;
    retainedByKind: Record<SemanticReviewCandidateKind, number>;
    failedTaskEvidence: SemanticReviewTaskFailureEvidenceSummary;
  };
  coverage: SemanticReviewCoverageReport;
  candidatesByKind: Record<SemanticReviewCandidateKind, SemanticReviewCandidate[]>;
};

export const DEFAULT_SEMANTIC_REVIEW_CANDIDATE_RESULTS_DIR = defaultLabRuntimeSubdirectory(
  "results",
  "autoresearch",
  "review-candidates",
);
