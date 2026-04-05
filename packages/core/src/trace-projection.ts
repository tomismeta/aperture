import type { ApertureTrace as PublicApertureTrace } from "./trace.js";
import { isCandidateTrace, type ApertureTrace as InternalApertureTrace } from "./trace-types.js";

export function toPublicApertureTrace(trace: InternalApertureTrace): PublicApertureTrace {
  if (trace.evaluation.kind === "noop") {
    return {
      timestamp: trace.timestamp,
      event: trace.event,
      eventTransition: trace.eventTransition,
      evaluation: { kind: "noop" },
    };
  }

  if (trace.evaluation.kind === "clear") {
    return {
      timestamp: trace.timestamp,
      event: trace.event,
      eventTransition: trace.eventTransition,
      evaluation: {
        kind: "clear",
        taskId: trace.evaluation.taskId,
      },
    };
  }

  if (!isCandidateTrace(trace)) {
    throw new Error("Unexpected internal trace variant");
  }

  return {
    timestamp: trace.timestamp,
    event: trace.event,
    eventTransition: trace.eventTransition,
    evaluation: { kind: "candidate" },
    candidateTransition: trace.candidateTransition,
    frameTransition: trace.frameTransition,
    ...(trace.semantic !== undefined ? { semantic: trace.semantic } : {}),
    policyRules: {
      gateEvaluations: trace.policyRules.gateEvaluations.map((evaluation) => ({
        rule: evaluation.rule,
        kind: evaluation.kind,
        rationale: [...evaluation.rationale],
      })),
      criterion: trace.policyRules.criterion
        ? {
            criterion: {
              activationThreshold: trace.policyRules.criterion.criterion.activationThreshold,
              promotionMargin: trace.policyRules.criterion.criterion.promotionMargin,
            },
            peripheralResolution: trace.policyRules.criterion.peripheralResolution,
            ambiguity: trace.policyRules.criterion.ambiguity
              ? {
                  kind: trace.policyRules.criterion.ambiguity.kind,
                  reason: trace.policyRules.criterion.ambiguity.reason,
                  resolution: trace.policyRules.criterion.ambiguity.resolution,
                }
              : null,
            rationale: [...trace.policyRules.criterion.rationale],
          }
        : null,
      criterionEvaluations: trace.policyRules.criterionEvaluations.map((evaluation) => ({
        rule: evaluation.rule,
        kind: evaluation.kind,
        rationale: [...evaluation.rationale],
      })),
    },
    coordination: {
      kind: trace.coordination.kind,
      resultLane: trace.coordination.resultLane,
      candidateScore: trace.coordination.candidateScore,
      currentScore: trace.coordination.currentScore,
      currentPriority: trace.coordination.currentPriority,
      ambiguity: trace.coordination.ambiguity
        ? {
            kind: trace.coordination.ambiguity.kind,
            reason: trace.coordination.ambiguity.reason,
            resolution: trace.coordination.ambiguity.resolution,
          }
        : null,
      reasons: [...trace.coordination.reasons],
      continuityEvaluations: trace.coordination.continuityEvaluations.map((evaluation) => ({
        rule: evaluation.rule,
        kind: evaluation.kind,
        rationale: [...evaluation.rationale],
      })),
    },
  };
}
