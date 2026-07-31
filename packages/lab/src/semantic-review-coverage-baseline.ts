import { loadGoldenScenarios } from "./golden.js";
import { KERNEL_CORPUS_PROFILE } from "./kernel-corpus-profile.js";
import { prepareOfflineReviewArtifact } from "./offline-review.js";
import type {
  ReplayDecisionSnapshot,
  ReplayNormalizedEventSnapshot,
  ReplaySemanticSnapshot,
} from "./scenario.js";
import { createSessionBundleFromScenario } from "./session-bundle-scenarios.js";
import {
  prepareBundleForCandidateReview,
  repoRelativePath,
} from "./semantic-review-candidate-report-support.js";
import {
  addCoverageLedgerStep,
  createCoverageLedgerAccumulator,
  unavailableCoverageBaselineComparison,
  type SemanticReviewCoverageBaselineComparisonInput,
} from "./semantic-review-coverage-ledger.js";
import { classifyFailureEvidenceForStep } from "./semantic-review-failure-evidence.js";
import type { SemanticReviewCoverageEvaluationMode } from "./semantic-review-coverage-ledger-types.js";

export async function createKernelCorpusCoverageBaselineComparison(options: {
  evaluationMode: SemanticReviewCoverageEvaluationMode;
  repoRoot: string;
}): Promise<SemanticReviewCoverageBaselineComparisonInput> {
  if (options.evaluationMode !== "current_engine_replay") {
    return unavailableCoverageBaselineComparison(
      "not_comparable_persisted_snapshots",
      "Kernel corpus baseline comparison requires current-engine replay.",
    );
  }

  const scenarios = await loadGoldenScenarios();
  const byId = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
  const accumulator = createCoverageLedgerAccumulator();

  for (const scenarioId of KERNEL_CORPUS_PROFILE.scenarioIds) {
    const scenario = byId.get(scenarioId);
    if (!scenario) {
      throw new Error(`Kernel corpus baseline scenario is missing: ${scenarioId}`);
    }
    const bundle = createSessionBundleFromScenario(scenario, {
      exportedAt: "1970-01-01T00:00:00.000Z",
    });
    const prepared = prepareBundleForCandidateReview(bundle, options.evaluationMode).bundle;
    const bundlePath = repoRelativePath(`kernel-corpus/${scenarioId}`, options.repoRoot);
    const artifact = prepareOfflineReviewArtifact(prepared, { bundlePath });
    const normalizedByStep = new Map(
      prepared.normalizedEvents.map((entry) => [entry.stepIndex, entry]),
    );
    const semanticByStep = new Map(
      prepared.semanticSnapshots.map((entry) => [entry.stepIndex, entry]),
    );
    const decisionByStep = new Map(
      prepared.decisionSnapshots.map((entry) => [entry.stepIndex, entry]),
    );

    for (const step of artifact.steps) {
      addCoverageLedgerStep(accumulator, {
        bundle: prepared,
        bundlePath,
        step,
        normalized: normalizedByStep.get(step.stepIndex) as ReplayNormalizedEventSnapshot | null,
        semantic: semanticByStep.get(step.stepIndex) as ReplaySemanticSnapshot | null,
        decision: decisionByStep.get(step.stepIndex) as ReplayDecisionSnapshot | null,
        failureEvidence: classifyFailureEvidenceForStep(prepared.steps[step.stepIndex]),
      });
    }
  }

  return { status: "compared", baseline: accumulator };
}
