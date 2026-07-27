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
import {
  SEMANTIC_REVIEW_TASK_FAILURE_EVIDENCE_KINDS,
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
    retainedExamplesByKind: createFailureEvidenceExampleBuckets(),
  };
}

export function addFailureEvidenceExample(
  accumulator: SemanticReviewTaskFailureEvidenceAccumulator,
  limits: {
    maxExamplesPerKind: number;
    maxExamplesPerSessionPerKind: number;
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

  const bucket = accumulator.retainedExamplesByKind[input.evidence.kind];
  accumulator.retainedExamplesByKind[input.evidence.kind] = retainFailureEvidenceExamples(
    bucket,
    buildFailureEvidenceExample(input),
    limits,
  );
}

export function finalizeFailureEvidenceSummary(
  accumulator: SemanticReviewTaskFailureEvidenceAccumulator,
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
    retainedExamplesByKind: accumulator.retainedExamplesByKind,
  };
}

function createFailureEvidenceKindCounts(): Record<SemanticReviewTaskFailureEvidenceKind, number> {
  const counts = {} as Record<SemanticReviewTaskFailureEvidenceKind, number>;
  for (const kind of SEMANTIC_REVIEW_TASK_FAILURE_EVIDENCE_KINDS) {
    counts[kind] = 0;
  }
  return counts;
}

function createFailureEvidenceExampleBuckets(): Record<
  SemanticReviewTaskFailureEvidenceKind,
  SemanticReviewTaskFailureEvidenceExample[]
> {
  const buckets = {} as Record<
    SemanticReviewTaskFailureEvidenceKind,
    SemanticReviewTaskFailureEvidenceExample[]
  >;
  for (const kind of SEMANTIC_REVIEW_TASK_FAILURE_EVIDENCE_KINDS) {
    buckets[kind] = [];
  }
  return buckets;
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
  };
}

function retainFailureEvidenceExamples(
  bucket: SemanticReviewTaskFailureEvidenceExample[],
  example: SemanticReviewTaskFailureEvidenceExample,
  limits: {
    maxExamplesPerKind: number;
    maxExamplesPerSessionPerKind: number;
  },
): SemanticReviewTaskFailureEvidenceExample[] {
  const retained: SemanticReviewTaskFailureEvidenceExample[] = [];
  const perSession = new Map<string, number>();

  for (const entry of [...bucket, example].sort(compareFailureEvidenceExamples)) {
    const sessionCount = perSession.get(entry.sessionId) ?? 0;
    if (sessionCount >= limits.maxExamplesPerSessionPerKind) {
      continue;
    }
    retained.push(entry);
    perSession.set(entry.sessionId, sessionCount + 1);
    if (retained.length >= limits.maxExamplesPerKind) {
      break;
    }
  }

  return retained;
}

function compareFailureEvidenceExamples(
  left: SemanticReviewTaskFailureEvidenceExample,
  right: SemanticReviewTaskFailureEvidenceExample,
): number {
  return (
    left.bundlePath.localeCompare(right.bundlePath) ||
    left.stepIndex - right.stepIndex ||
    left.sessionId.localeCompare(right.sessionId)
  );
}
