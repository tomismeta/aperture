import { createKindBuckets, createKindCounts } from "./semantic-review-candidate-policy.js";
import {
  assertPositiveInteger,
  createReplayClockReport,
  evaluationModeFromReplayOption,
} from "./semantic-review-candidate-report-support.js";
import type {
  SemanticReviewCandidate,
  SemanticReviewCandidateEvaluationMode,
  SemanticReviewCandidateKind,
  SemanticReviewCandidateReplayClock,
} from "./semantic-review-candidate-types.js";
import {
  createCoverageLedgerAccumulator,
  type SemanticReviewCoverageLedgerAccumulator,
} from "./semantic-review-coverage-ledger.js";
import {
  createFailureEvidenceAccumulator,
  type SemanticReviewTaskFailureEvidenceAccumulator,
} from "./semantic-review-failure-evidence.js";

export type CandidateReportAccumulator = {
  repoRoot: string;
  maxCandidatesPerKind: number;
  maxCandidatesPerSessionPerKind: number;
  maxFailureEvidenceExamplesPerKind: number;
  maxFailureEvidenceExamplesPerSessionPerKind: number;
  maxUnclassifiedEventShapes: number;
  maxUnclassifiedExamplesPerEventShape: number;
  evaluationMode: SemanticReviewCandidateEvaluationMode;
  replayClock: SemanticReviewCandidateReplayClock;
  countsByKind: Record<SemanticReviewCandidateKind, number>;
  candidatesByKind: Record<SemanticReviewCandidateKind, SemanticReviewCandidate[]>;
  coverageLedger: SemanticReviewCoverageLedgerAccumulator;
  failedTaskEvidence: SemanticReviewTaskFailureEvidenceAccumulator;
  scannedBundleCount: number;
};

export function createCandidateReportAccumulator(options: {
  maxCandidatesPerKind?: number;
  maxCandidatesPerSessionPerKind?: number;
  repoRoot?: string;
  replayCurrent?: boolean;
}): CandidateReportAccumulator {
  const maxCandidatesPerKind = options.maxCandidatesPerKind ?? 30;
  const maxCandidatesPerSessionPerKind = options.maxCandidatesPerSessionPerKind ?? 3;
  const evaluationMode = evaluationModeFromReplayOption(options);
  assertPositiveInteger(maxCandidatesPerKind, "maxCandidatesPerKind");
  assertPositiveInteger(maxCandidatesPerSessionPerKind, "maxCandidatesPerSessionPerKind");

  return {
    repoRoot: options.repoRoot ?? process.cwd(),
    maxCandidatesPerKind,
    maxCandidatesPerSessionPerKind,
    maxFailureEvidenceExamplesPerKind: maxCandidatesPerKind,
    maxFailureEvidenceExamplesPerSessionPerKind: maxCandidatesPerSessionPerKind,
    maxUnclassifiedEventShapes: maxCandidatesPerKind,
    maxUnclassifiedExamplesPerEventShape: maxCandidatesPerSessionPerKind,
    evaluationMode,
    replayClock: createReplayClockReport(evaluationMode),
    countsByKind: createKindCounts(),
    candidatesByKind: createKindBuckets(),
    coverageLedger: createCoverageLedgerAccumulator(),
    failedTaskEvidence: createFailureEvidenceAccumulator(),
    scannedBundleCount: 0,
  };
}
