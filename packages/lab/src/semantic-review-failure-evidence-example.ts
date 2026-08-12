import type { TaskFailureSemanticEvidence } from "@tomismeta/aperture-core/internal";

import type { OfflineReviewPreparedStep } from "./offline-review.js";
import type { ReplayDecisionSnapshot, ReplaySemanticSnapshot } from "./scenario.js";
import type { ReplaySessionBundle } from "./session-bundle.js";
import { readFailureEvidenceEventShape } from "./semantic-review-failure-event-shapes.js";
import type { SemanticReviewTaskFailureEvidenceExample } from "./semantic-review-failure-evidence-types.js";

export function buildFailureEvidenceExample(input: {
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
      failureDetail: input.evidence.failureDetail ?? null,
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
