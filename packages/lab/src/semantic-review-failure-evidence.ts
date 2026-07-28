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
import { readFailureEvidenceEventShape } from "./semantic-review-failure-event-shapes.js";
import {
  createFailureEvidenceExampleBuckets,
  createFailureEvidenceKindCounts,
  finalizeRetainedUnclassifiedExamplesByEventShape,
  retainFailureEvidenceExamples,
} from "./semantic-review-failure-evidence-retention.js";
import {
  type SemanticReviewTaskFailureConsequenceBaseline,
  type SemanticReviewTaskFailureEvidenceExample,
  type SemanticReviewTaskFailureEvidenceKind,
  type SemanticReviewTaskFailureEvidenceSummary,
} from "./semantic-review-failure-evidence-types.js";

export type SemanticReviewTaskFailureEvidenceAccumulator = {
  failedTaskUpdateCount: number;
  readsAsObservationCount: number;
  consequenceBaselineCounts: Record<SemanticReviewTaskFailureConsequenceBaseline, number>;
  countsByKind: Record<SemanticReviewTaskFailureEvidenceKind, number>;
  countsByToolFamily: Map<string, number>;
  missingToolFamilyCount: number;
  unclassifiedEventShapeCounts: Map<string, number>;
  retainedUnclassifiedExamplesByEventShape: Map<string, SemanticReviewTaskFailureEvidenceExample[]>;
  retainedExamplesByKind: Record<
    SemanticReviewTaskFailureEvidenceKind,
    SemanticReviewTaskFailureEvidenceExample[]
  >;
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
    countsByKind: createFailureEvidenceKindCounts(),
    countsByToolFamily: new Map(),
    missingToolFamilyCount: 0,
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
  const bucket = accumulator.retainedExamplesByKind[input.evidence.kind];
  accumulator.retainedExamplesByKind[input.evidence.kind] = retainFailureEvidenceExamples(
    bucket,
    example,
    limits,
  );

  if (input.evidence.kind === "unclassified_failure") {
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
    countsByKind: accumulator.countsByKind,
    countsByToolFamily: Object.fromEntries(
      [...accumulator.countsByToolFamily.entries()].sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
    missingToolFamilyCount: accumulator.missingToolFamilyCount,
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

function buildFailureEvidenceExample(input: {
  bundle: ReplaySessionBundle;
  bundlePath: string;
  step: OfflineReviewPreparedStep;
  semantic: ReplaySemanticSnapshot | null;
  decision: ReplayDecisionSnapshot | null;
  evidence: TaskFailureSemanticEvidence;
}): SemanticReviewTaskFailureEvidenceExample {
  const sourceEvent = input.step.sourceEvent;
  const interpretation = input.semantic?.interpretation;
  const eventShape = readFailureEvidenceEventShape({
    evidence: input.evidence,
    event: {
      summary: sourceEvent?.summary ?? null,
      toolFamily: sourceEvent?.toolFamily ?? null,
    },
  });

  return {
    bundlePath: input.bundlePath,
    sessionId: input.bundle.sessionId,
    title: input.bundle.title,
    stepIndex: input.step.stepIndex,
    ...(input.step.stepLabel ? { stepLabel: input.step.stepLabel } : {}),
    sourceExcerpt: input.step.sourceExcerpt,
    evidence: {
      kind: input.evidence.kind,
      toolFamily: input.evidence.toolFamily ?? null,
      readsAsObservation: input.evidence.readsAsObservation,
      consequenceBaseline: input.evidence.consequenceBaseline,
    },
    event: {
      type: sourceEvent?.type ?? "task.updated",
      status: sourceEvent?.status ?? null,
      title: sourceEvent?.title ?? null,
      summary: sourceEvent?.summary ?? null,
      toolFamily: sourceEvent?.toolFamily ?? null,
    },
    semantic: {
      intentFrame: interpretation?.intentFrame ?? null,
      activityClass: interpretation?.activityClass ?? null,
      toolFamily: interpretation?.toolFamily ?? null,
      consequence: interpretation?.consequence ?? null,
      confidence: interpretation?.confidence ?? null,
      abstained: interpretation?.abstained === true,
    },
    judgment: {
      decisionKind: input.decision?.decisionKind ?? null,
      plannedLane: input.decision?.plannedLane ?? null,
      resultLane: input.decision?.resultLane ?? null,
      reasonCodes: input.decision?.decisionRecordReasonCodes ?? [],
    },
    eventShape,
  };
}
