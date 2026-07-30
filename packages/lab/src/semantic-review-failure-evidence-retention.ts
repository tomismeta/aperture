import {
  SEMANTIC_REVIEW_TASK_FAILURE_EVIDENCE_KINDS,
  type SemanticReviewTaskFailureEvidenceExample,
  type SemanticReviewTaskFailureEvidenceKind,
} from "./semantic-review-failure-evidence-types.js";

export function createFailureEvidenceExampleBuckets(): Record<
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

export function createFailureEvidenceKindCounts(): Record<
  SemanticReviewTaskFailureEvidenceKind,
  number
> {
  const counts = {} as Record<SemanticReviewTaskFailureEvidenceKind, number>;
  for (const kind of SEMANTIC_REVIEW_TASK_FAILURE_EVIDENCE_KINDS) {
    counts[kind] = 0;
  }
  return counts;
}

export function finalizeRetainedUnclassifiedExamplesByEventShape(input: {
  counts: Map<string, number>;
  examplesByShape: Map<string, SemanticReviewTaskFailureEvidenceExample[]>;
  maxEventShapes: number;
}): Record<string, SemanticReviewTaskFailureEvidenceExample[]> {
  const shapes = [...input.counts.entries()]
    .sort(([leftShape, leftCount], [rightShape, rightCount]) => {
      return rightCount - leftCount || leftShape.localeCompare(rightShape);
    })
    .slice(0, input.maxEventShapes)
    .map(([shape]) => shape);

  return Object.fromEntries(shapes.map((shape) => [shape, input.examplesByShape.get(shape) ?? []]));
}

export function retainFailureEvidenceExamples(
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
