import type { TaskFailureEvidenceKind } from "@tomismeta/aperture-core/internal";

const SEMANTIC_REVIEW_TASK_FAILURE_EVIDENCE_KIND_RECORD = {
  routine_bash_success_observation: true,
  observational_payload: true,
  routine_search_output: true,
  expected_diagnostic_failure: true,
  terminal_failure: true,
  unclassified_failure: true,
} as const satisfies Record<TaskFailureEvidenceKind, true>;

export const SEMANTIC_REVIEW_TASK_FAILURE_EVIDENCE_KINDS = Object.keys(
  SEMANTIC_REVIEW_TASK_FAILURE_EVIDENCE_KIND_RECORD,
) as TaskFailureEvidenceKind[];

export type SemanticReviewTaskFailureEvidenceKind = TaskFailureEvidenceKind;
export type SemanticReviewTaskFailureConsequenceBaseline = "low" | "medium" | "high";

export type SemanticReviewTaskFailureEvidenceExample = {
  bundlePath: string;
  sessionId: string;
  title: string;
  stepIndex: number;
  stepLabel?: string;
  sourceExcerpt: string | null;
  evidence: {
    kind: SemanticReviewTaskFailureEvidenceKind;
    toolFamily: string | null;
    readsAsObservation: boolean;
    consequenceBaseline: SemanticReviewTaskFailureConsequenceBaseline;
  };
  event: {
    type: string;
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
    abstained: boolean;
  };
  judgment: {
    decisionKind: string | null;
    plannedLane: string | null;
    resultLane: string | null;
    reasonCodes: string[];
  };
};

export type SemanticReviewTaskFailureEvidenceSummary = {
  failedTaskUpdateCount: number;
  readsAsObservationCount: number;
  consequenceBaselineCounts: Record<SemanticReviewTaskFailureConsequenceBaseline, number>;
  countsByKind: Record<SemanticReviewTaskFailureEvidenceKind, number>;
  countsByToolFamily: Record<string, number>;
  missingToolFamilyCount: number;
  retainedExamplesByKind: Record<
    SemanticReviewTaskFailureEvidenceKind,
    SemanticReviewTaskFailureEvidenceExample[]
  >;
};
