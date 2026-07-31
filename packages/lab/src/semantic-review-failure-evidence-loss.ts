import type { OfflineReviewPreparedStep } from "./offline-review.js";
import type {
  SemanticReviewTaskFailureEvidenceExample,
  SemanticReviewTaskFailureEvidenceLossKind,
} from "./semantic-review-failure-evidence-types.js";
import { isClippedSourceEventSummary } from "./source-event-summary.js";

export function createFailureEvidenceLossCounts(): Record<
  SemanticReviewTaskFailureEvidenceLossKind,
  number
> {
  return { clipped_summary: 0 };
}

export function createFailureEvidenceLossExampleBuckets(): Record<
  SemanticReviewTaskFailureEvidenceLossKind,
  SemanticReviewTaskFailureEvidenceExample[]
> {
  return { clipped_summary: [] };
}

export function readFailureEvidenceLossKind(
  sourceEvent: OfflineReviewPreparedStep["sourceEvent"],
): SemanticReviewTaskFailureEvidenceLossKind | null {
  if (sourceEvent?.status !== "failed") {
    return null;
  }

  if (sourceEvent.metadata?.truncated === true) {
    return "clipped_summary";
  }

  if (!sourceEvent.summary) {
    return null;
  }

  return isClippedSourceEventSummary(sourceEvent.summary) ? "clipped_summary" : null;
}
