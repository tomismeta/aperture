import type { SemanticReviewTaskFailureDetail } from "./semantic-review-failure-evidence-types.js";

export function createFailureDetailCounts(): Record<SemanticReviewTaskFailureDetail, number> {
  return {
    outcome_only: 0,
    diagnostic: 0,
    indeterminate: 0,
    absent_evidence: 0,
    source_window_limit: 0,
  };
}
