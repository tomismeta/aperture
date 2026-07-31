import { SEMANTIC_REVIEW_CANDIDATE_REPORT_SCHEMA_VERSION } from "./artifact-versions.js";
import { prepareOfflineReviewArtifact } from "./offline-review.js";
import type {
  ReplayDecisionSnapshot,
  ReplayNormalizedEventSnapshot,
  ReplaySemanticSnapshot,
} from "./scenario.js";
import type { ReplaySessionBundle } from "./session-bundle.js";
import {
  loadCandidateBundleIfValid,
  resolveCandidateBundleInputs,
} from "./semantic-review-candidate-input.js";
import {
  buildSemanticReviewCandidate,
  candidateKindsForStep,
  retainSemanticReviewCandidate,
  sumCandidateCounts,
} from "./semantic-review-candidate-policy.js";
import {
  countRetainedCandidatesByKind,
  createSemanticReviewCandidateEngineFingerprint,
  prepareBundleForCandidateReview,
  recordReplayClockReference,
  repoRelativePath,
} from "./semantic-review-candidate-report-support.js";
import {
  createCandidateReportAccumulator,
  type CandidateReportAccumulator,
} from "./semantic-review-candidate-accumulator.js";
import {
  addCoverageLedgerStep,
  finalizeCoverageLedgerSummary,
  unavailableCoverageBaselineComparison,
  type SemanticReviewCoverageBaselineComparisonInput,
} from "./semantic-review-coverage-ledger.js";
import { createKernelCorpusCoverageBaselineComparison } from "./semantic-review-coverage-baseline.js";
import {
  type CandidateBundleInput,
  type SemanticReviewCandidateReport,
} from "./semantic-review-candidate-types.js";
import {
  addFailureEvidenceExample,
  classifyFailureEvidenceForStep,
  finalizeFailureEvidenceSummary,
} from "./semantic-review-failure-evidence.js";

export {
  DEFAULT_SEMANTIC_REVIEW_CANDIDATE_RESULTS_DIR,
  SEMANTIC_REVIEW_CANDIDATE_KINDS,
  type CandidateBundleInput,
  type SemanticReviewCandidate,
  type SemanticReviewCandidateKind,
  type SemanticReviewCandidateReport,
} from "./semantic-review-candidate-types.js";
export {
  SEMANTIC_REVIEW_TASK_FAILURE_EVIDENCE_KINDS,
  type SemanticReviewTaskFailureConsequenceBaseline,
  type SemanticReviewTaskFailureEvidenceExample,
  type SemanticReviewTaskFailureEvidenceKind,
  type SemanticReviewTaskFailureEvidenceSummary,
} from "./semantic-review-failure-evidence-types.js";
export {
  type SemanticReviewCoverageBaseline,
  type SemanticReviewCoverageEvaluationMode,
  type SemanticReviewCoverageBaselineComparison,
  type SemanticReviewCoverageBaselineComparisonStatus,
  type SemanticReviewCoverageObservations,
  type SemanticReviewCoverageReport,
  type SemanticReviewLedgerSignatureCount,
  type SemanticReviewLedgerSignatureExample,
  type SemanticReviewNoveltySummary,
  type SemanticReviewSignatureBaselineComparison,
} from "./semantic-review-coverage-ledger-types.js";
export {
  defaultSemanticReviewCandidateReportPath,
  renderSemanticReviewCandidateMarkdown,
  writeSemanticReviewCandidateMarkdown,
  writeSemanticReviewCandidateReport,
} from "./semantic-review-candidate-render.js";
export async function createSemanticReviewCandidateReportFromPaths(options: {
  manifestPaths?: readonly string[];
  bundlePaths?: readonly string[];
  bundleDirectories?: readonly string[];
  generatedAt?: string;
  maxCandidatesPerKind?: number;
  maxCandidatesPerSessionPerKind?: number;
  repoRoot?: string;
  replayCurrent?: boolean;
}): Promise<SemanticReviewCandidateReport> {
  const inputs = await resolveCandidateBundleInputs({
    manifestPaths: options.manifestPaths ?? [],
    bundlePaths: options.bundlePaths ?? [],
    bundleDirectories: options.bundleDirectories ?? [],
  });
  const accumulator = createCandidateReportAccumulator(options);
  let invalidBundleCount = 0;

  for (const input of inputs.bundleInputs) {
    const bundle = await loadCandidateBundleIfValid(input);
    if (!bundle) {
      invalidBundleCount += 1;
      continue;
    }
    addBundleCandidates(accumulator, input, bundle);
  }

  const coverageBaselineComparison = await createKernelCorpusCoverageBaselineComparison({
    evaluationMode: accumulator.evaluationMode,
    repoRoot: accumulator.repoRoot,
  });

  return finalizeCandidateReport(accumulator, {
    ...(options.generatedAt !== undefined ? { generatedAt: options.generatedAt } : {}),
    manifestPaths: options.manifestPaths ?? [],
    bundlePaths: options.bundlePaths ?? [],
    bundleDirectories: options.bundleDirectories ?? [],
    fileCount: inputs.fileCount,
    invalidBundleCount,
    manifestRecordCount: inputs.manifestRecordCount,
    manifestBundleCount: inputs.manifestBundleCount,
    coverageBaselineComparison,
  });
}

export function createSemanticReviewCandidateReport(
  bundles: Array<{ input: CandidateBundleInput; bundle: ReplaySessionBundle }>,
  options: {
    generatedAt?: string;
    maxCandidatesPerKind?: number;
    maxCandidatesPerSessionPerKind?: number;
    repoRoot?: string;
    replayCurrent?: boolean;
    manifestPaths?: readonly string[];
    bundlePaths?: readonly string[];
    bundleDirectories?: readonly string[];
    invalidBundleCount?: number;
    fileCount?: number;
    manifestRecordCount?: number;
    manifestBundleCount?: number;
  } = {},
): SemanticReviewCandidateReport {
  const maxCandidatesPerKind = options.maxCandidatesPerKind ?? 30;
  const maxCandidatesPerSessionPerKind = options.maxCandidatesPerSessionPerKind ?? 3;
  const accumulator = createCandidateReportAccumulator({
    ...(options.repoRoot !== undefined ? { repoRoot: options.repoRoot } : {}),
    maxCandidatesPerKind,
    maxCandidatesPerSessionPerKind,
    ...(options.replayCurrent !== undefined ? { replayCurrent: options.replayCurrent } : {}),
  });

  for (const { input, bundle } of bundles) {
    addBundleCandidates(accumulator, input, bundle);
  }

  return finalizeCandidateReport(accumulator, {
    ...(options.generatedAt !== undefined ? { generatedAt: options.generatedAt } : {}),
    manifestPaths: options.manifestPaths ?? [],
    bundlePaths: options.bundlePaths ?? [],
    bundleDirectories: options.bundleDirectories ?? [],
    fileCount: options.fileCount ?? bundles.length,
    invalidBundleCount: options.invalidBundleCount ?? 0,
    manifestRecordCount: options.manifestRecordCount ?? 0,
    manifestBundleCount: options.manifestBundleCount ?? 0,
    coverageBaselineComparison: unavailableCoverageBaselineComparison(
      "unavailable_sync_report",
      "Kernel corpus baseline comparison requires the async report path.",
    ),
  });
}

function addBundleCandidates(
  accumulator: CandidateReportAccumulator,
  input: CandidateBundleInput,
  bundle: ReplaySessionBundle,
): void {
  accumulator.scannedBundleCount += 1;
  const bundlePath = repoRelativePath(input.bundlePath, accumulator.repoRoot);
  const preparedBundle = prepareBundleForCandidateReview(bundle, accumulator.evaluationMode);
  recordReplayClockReference(accumulator.replayClock, preparedBundle.replayClockReference);
  const reviewBundle = preparedBundle.bundle;
  const artifact = prepareOfflineReviewArtifact(reviewBundle, { bundlePath });
  const normalizedByStep = new Map(
    reviewBundle.normalizedEvents.map((entry) => [entry.stepIndex, entry]),
  );
  const semanticByStep = new Map(
    reviewBundle.semanticSnapshots.map((entry) => [entry.stepIndex, entry]),
  );
  const decisionByStep = new Map(
    reviewBundle.decisionSnapshots.map((entry) => [entry.stepIndex, entry]),
  );

  for (const step of artifact.steps) {
    const normalized = normalizedByStep.get(step.stepIndex) ?? null;
    const semantic = semanticByStep.get(step.stepIndex) ?? null;
    const decision = decisionByStep.get(step.stepIndex) ?? null;
    const failureEvidence = classifyFailureEvidenceForStep(reviewBundle.steps[step.stepIndex]);
    addCoverageLedgerStep(accumulator.coverageLedger, {
      bundle: reviewBundle,
      bundlePath,
      step,
      normalized: normalized as ReplayNormalizedEventSnapshot | null,
      semantic: semantic as ReplaySemanticSnapshot | null,
      decision: decision as ReplayDecisionSnapshot | null,
      failureEvidence,
    });
    if (failureEvidence) {
      addFailureEvidenceExample(
        accumulator.failedTaskEvidence,
        {
          maxExamplesPerKind: accumulator.maxFailureEvidenceExamplesPerKind,
          maxExamplesPerSessionPerKind: accumulator.maxFailureEvidenceExamplesPerSessionPerKind,
          maxUnclassifiedExamplesPerEventShape: accumulator.maxUnclassifiedExamplesPerEventShape,
        },
        {
          bundle: reviewBundle,
          bundlePath,
          step,
          semantic: semantic as ReplaySemanticSnapshot | null,
          decision: decision as ReplayDecisionSnapshot | null,
          evidence: failureEvidence,
        },
      );
    }

    for (const kind of candidateKindsForStep(step, semantic, decision)) {
      accumulator.countsByKind[kind] += 1;
      accumulator.candidatesByKind[kind] = retainSemanticReviewCandidate(
        accumulator.candidatesByKind[kind],
        buildSemanticReviewCandidate(kind, {
          bundle: reviewBundle,
          bundlePath,
          input,
          repoRoot: accumulator.repoRoot,
          step,
          normalized: normalized as ReplayNormalizedEventSnapshot | null,
          semantic: semantic as ReplaySemanticSnapshot | null,
          decision: decision as ReplayDecisionSnapshot | null,
        }),
        {
          maxCandidatesPerKind: accumulator.maxCandidatesPerKind,
          maxCandidatesPerSessionPerKind: accumulator.maxCandidatesPerSessionPerKind,
        },
      );
    }
  }
}

function finalizeCandidateReport(
  accumulator: CandidateReportAccumulator,
  options: {
    generatedAt?: string;
    manifestPaths: readonly string[];
    bundlePaths: readonly string[];
    bundleDirectories: readonly string[];
    fileCount: number;
    invalidBundleCount: number;
    manifestRecordCount: number;
    manifestBundleCount: number;
    coverageBaselineComparison: SemanticReviewCoverageBaselineComparisonInput;
  },
): SemanticReviewCandidateReport {
  const retainedByKind = countRetainedCandidatesByKind(accumulator.candidatesByKind);
  const engine = createSemanticReviewCandidateEngineFingerprint();

  return {
    schemaVersion: SEMANTIC_REVIEW_CANDIDATE_REPORT_SCHEMA_VERSION,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    selection: {
      maxCandidatesPerKind: accumulator.maxCandidatesPerKind,
      maxCandidatesPerSessionPerKind: accumulator.maxCandidatesPerSessionPerKind,
      maxFailureEvidenceExamplesPerKind: accumulator.maxFailureEvidenceExamplesPerKind,
      maxFailureEvidenceExamplesPerSessionPerKind:
        accumulator.maxFailureEvidenceExamplesPerSessionPerKind,
      maxUnclassifiedEventShapes: accumulator.maxUnclassifiedEventShapes,
      maxUnclassifiedExamplesPerEventShape: accumulator.maxUnclassifiedExamplesPerEventShape,
      retainedSort: "pressure_score_desc_path_step",
      promotionAuthority: "review_required",
    },
    input: {
      manifestPaths: [...(options.manifestPaths ?? [])].map((entry) =>
        repoRelativePath(entry, accumulator.repoRoot),
      ),
      bundlePaths: [...(options.bundlePaths ?? [])].map((entry) =>
        repoRelativePath(entry, accumulator.repoRoot),
      ),
      bundleDirectories: [...(options.bundleDirectories ?? [])].map((entry) =>
        repoRelativePath(entry, accumulator.repoRoot),
      ),
      evaluationMode: accumulator.evaluationMode,
      engine,
      replayClock: accumulator.replayClock,
      fileCount: options.fileCount,
      scannedBundleCount: accumulator.scannedBundleCount,
      invalidBundleCount: options.invalidBundleCount,
      manifestRecordCount: options.manifestRecordCount,
      manifestBundleCount: options.manifestBundleCount,
    },
    summary: {
      candidateCount: sumCandidateCounts(accumulator.countsByKind),
      countsByKind: accumulator.countsByKind,
      retainedByKind,
      failedTaskEvidence: finalizeFailureEvidenceSummary(accumulator.failedTaskEvidence, {
        maxUnclassifiedEventShapes: accumulator.maxUnclassifiedEventShapes,
      }),
    },
    coverage: finalizeCoverageLedgerSummary(accumulator.coverageLedger, {
      maxSignatureEntries: accumulator.maxCandidatesPerKind,
      engineFingerprint: engine.fingerprint,
      evaluationMode: accumulator.evaluationMode,
      baselineComparison: options.coverageBaselineComparison,
    }),
    candidatesByKind: accumulator.candidatesByKind,
  };
}
