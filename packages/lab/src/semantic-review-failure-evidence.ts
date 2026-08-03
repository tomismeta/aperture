import {
  readTaskFailureSemanticEvidence,
  type TaskFailureSemanticEvidence,
} from "@tomismeta/aperture-core/internal";

import type { OfflineReviewPreparedStep } from "./offline-review.js";
import type {
  ReplayDecisionSnapshot,
  ReplayObservationStep,
  ReplaySemanticSnapshot,
} from "./scenario.js";
import type { ReplaySessionBundle } from "./session-bundle.js";
import { buildFailureEvidenceExample } from "./semantic-review-failure-evidence-example.js";
import { createFailureDetailCounts } from "./semantic-review-failure-detail.js";
import {
  createFailureEvidenceLossCounts,
  createFailureEvidenceLossExampleBuckets,
  readFailureEvidenceLossKind,
} from "./semantic-review-failure-evidence-loss.js";
import {
  createFailureEvidenceExampleBuckets,
  createFailureEvidenceKindCounts,
  finalizeRetainedUnclassifiedExamplesByEventShape,
  retainFailureEvidenceExamples,
} from "./semantic-review-failure-evidence-retention.js";
import {
  type SemanticReviewTaskFailureDetail,
  type SemanticReviewTaskFailureConsequenceBaseline,
  type SemanticReviewTaskFailureEvidenceKind,
  type SemanticReviewTaskFailureEvidenceLossKind,
  type SemanticReviewTaskFailureEvidenceExample,
  type FailureEvidenceExampleBuckets,
  type SemanticReviewTaskFailureEvidenceSummary,
} from "./semantic-review-failure-evidence-types.js";

export type SemanticReviewTaskFailureEvidenceAccumulator = {
  failedTaskUpdateCount: number;
  readsAsObservationCount: number;
  consequenceBaselineCounts: Record<SemanticReviewTaskFailureConsequenceBaseline, number>;
  failureDetailCounts: Record<SemanticReviewTaskFailureDetail, number>;
  countsByKind: Record<SemanticReviewTaskFailureEvidenceKind, number>;
  countsByToolFamily: Map<string, number>;
  missingToolFamilyCount: number;
  evidenceLossCounts: Record<SemanticReviewTaskFailureEvidenceLossKind, number>;
  retainedEvidenceLossExamples: FailureEvidenceExampleBuckets<SemanticReviewTaskFailureEvidenceLossKind>;
  parserGapCandidateEventShapeCounts: Map<string, number>;
  retainedParserGapCandidateExamplesByEventShape: Map<
    string,
    SemanticReviewTaskFailureEvidenceExample[]
  >;
  unclassifiedEventShapeCounts: Map<string, number>;
  retainedUnclassifiedExamplesByEventShape: Map<string, SemanticReviewTaskFailureEvidenceExample[]>;
  retainedExamplesByKind: FailureEvidenceExampleBuckets<SemanticReviewTaskFailureEvidenceKind>;
};

export function classifyFailureEvidenceForStep(
  step: ReplayObservationStep | undefined,
): TaskFailureSemanticEvidence | null {
  if (step?.kind !== "publishSource" && step?.kind !== "publish") {
    return null;
  }

  return readTaskFailureSemanticEvidence(step.event);
}

export function createFailureEvidenceAccumulator(): SemanticReviewTaskFailureEvidenceAccumulator {
  return {
    failedTaskUpdateCount: 0,
    readsAsObservationCount: 0,
    consequenceBaselineCounts: {
      low: 0,
      medium: 0,
      high: 0,
    },
    failureDetailCounts: createFailureDetailCounts(),
    countsByKind: createFailureEvidenceKindCounts(),
    countsByToolFamily: new Map(),
    missingToolFamilyCount: 0,
    evidenceLossCounts: createFailureEvidenceLossCounts(),
    retainedEvidenceLossExamples: createFailureEvidenceLossExampleBuckets(),
    parserGapCandidateEventShapeCounts: new Map(),
    retainedParserGapCandidateExamplesByEventShape: new Map(),
    unclassifiedEventShapeCounts: new Map(),
    retainedUnclassifiedExamplesByEventShape: new Map(),
    retainedExamplesByKind: createFailureEvidenceExampleBuckets(),
  };
}

export function addFailureEvidenceExample(
  accumulator: SemanticReviewTaskFailureEvidenceAccumulator,
  limits: {
    maxExamplesPerKind: number;
    maxExamplesPerSessionPerKind: number;
    maxUnclassifiedExamplesPerEventShape: number;
  },
  input: {
    bundle: ReplaySessionBundle;
    bundlePath: string;
    step: OfflineReviewPreparedStep;
    semantic: ReplaySemanticSnapshot | null;
    decision: ReplayDecisionSnapshot | null;
    evidence: TaskFailureSemanticEvidence;
  },
): void {
  accumulator.failedTaskUpdateCount += 1;
  accumulator.countsByKind[input.evidence.kind] += 1;
  accumulator.consequenceBaselineCounts[input.evidence.consequenceBaseline] += 1;
  if (input.evidence.failureDetail !== undefined) {
    accumulator.failureDetailCounts[input.evidence.failureDetail] += 1;
  }
  if (input.evidence.readsAsObservation) {
    accumulator.readsAsObservationCount += 1;
  }

  if (input.evidence.toolFamily) {
    const toolFamily = input.evidence.toolFamily;
    accumulator.countsByToolFamily.set(
      toolFamily,
      (accumulator.countsByToolFamily.get(toolFamily) ?? 0) + 1,
    );
  } else {
    accumulator.missingToolFamilyCount += 1;
  }

  const example = buildFailureEvidenceExample(input);
  const evidenceLossKind = readFailureEvidenceLossKind(input.step.sourceEvent);
  if (evidenceLossKind) {
    accumulator.evidenceLossCounts[evidenceLossKind] += 1;
    accumulator.retainedEvidenceLossExamples[evidenceLossKind] = retainFailureEvidenceExamples(
      accumulator.retainedEvidenceLossExamples[evidenceLossKind],
      example,
      limits,
    );
  }

  const bucket = accumulator.retainedExamplesByKind[input.evidence.kind];
  accumulator.retainedExamplesByKind[input.evidence.kind] = retainFailureEvidenceExamples(
    bucket,
    example,
    limits,
  );

  if (input.evidence.kind === "unclassified_failure") {
    if (!evidenceLossKind) {
      accumulator.parserGapCandidateEventShapeCounts.set(
        example.eventShape,
        (accumulator.parserGapCandidateEventShapeCounts.get(example.eventShape) ?? 0) + 1,
      );
      accumulator.retainedParserGapCandidateExamplesByEventShape.set(
        example.eventShape,
        retainFailureEvidenceExamples(
          accumulator.retainedParserGapCandidateExamplesByEventShape.get(example.eventShape) ?? [],
          example,
          {
            maxExamplesPerKind: limits.maxUnclassifiedExamplesPerEventShape,
            maxExamplesPerSessionPerKind: limits.maxExamplesPerSessionPerKind,
          },
        ),
      );
    }

    accumulator.unclassifiedEventShapeCounts.set(
      example.eventShape,
      (accumulator.unclassifiedEventShapeCounts.get(example.eventShape) ?? 0) + 1,
    );
    accumulator.retainedUnclassifiedExamplesByEventShape.set(
      example.eventShape,
      retainFailureEvidenceExamples(
        accumulator.retainedUnclassifiedExamplesByEventShape.get(example.eventShape) ?? [],
        example,
        {
          maxExamplesPerKind: limits.maxUnclassifiedExamplesPerEventShape,
          maxExamplesPerSessionPerKind: limits.maxExamplesPerSessionPerKind,
        },
      ),
    );
  }
}

export function finalizeFailureEvidenceSummary(
  accumulator: SemanticReviewTaskFailureEvidenceAccumulator,
  limits: { maxUnclassifiedEventShapes: number },
): SemanticReviewTaskFailureEvidenceSummary {
  return {
    failedTaskUpdateCount: accumulator.failedTaskUpdateCount,
    readsAsObservationCount: accumulator.readsAsObservationCount,
    consequenceBaselineCounts: accumulator.consequenceBaselineCounts,
    failureDetailCounts: accumulator.failureDetailCounts,
    countsByKind: accumulator.countsByKind,
    countsByToolFamily: Object.fromEntries(
      [...accumulator.countsByToolFamily.entries()].sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
    missingToolFamilyCount: accumulator.missingToolFamilyCount,
    evidenceLossCounts: accumulator.evidenceLossCounts,
    retainedEvidenceLossExamples: accumulator.retainedEvidenceLossExamples,
    parserGapCandidateEventShapeCounts: Object.fromEntries(
      [...accumulator.parserGapCandidateEventShapeCounts.entries()].sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
    retainedParserGapCandidateExamplesByEventShape:
      finalizeRetainedUnclassifiedExamplesByEventShape({
        counts: accumulator.parserGapCandidateEventShapeCounts,
        examplesByShape: accumulator.retainedParserGapCandidateExamplesByEventShape,
        maxEventShapes: limits.maxUnclassifiedEventShapes,
      }),
    unclassifiedEventShapeCounts: Object.fromEntries(
      [...accumulator.unclassifiedEventShapeCounts.entries()].sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
    retainedUnclassifiedExamplesByEventShape: finalizeRetainedUnclassifiedExamplesByEventShape({
      counts: accumulator.unclassifiedEventShapeCounts,
      examplesByShape: accumulator.retainedUnclassifiedExamplesByEventShape,
      maxEventShapes: limits.maxUnclassifiedEventShapes,
    }),
    retainedExamplesByKind: accumulator.retainedExamplesByKind,
  };
}
