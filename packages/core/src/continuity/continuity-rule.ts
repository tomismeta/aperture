import type { AttentionEvidenceContext } from "../attention-evidence.js";
import type { AttentionCandidate, AttentionPriority } from "../interaction-candidate.js";
import type { PlannerDefaults } from "../judgment-config.js";
import type {
  AttentionPlanDecision,
  AttentionPlanningContext,
  AttentionPlanningExplanation,
} from "../attention-planner.js";
import type { AttentionPolicyVerdict } from "../attention-policy.js";
import type { AttentionSurfaceCapabilities } from "../surface-capabilities.js";

export type ContinuityRuleName =
  | "same_interaction"
  | "visible_episode"
  | "same_episode"
  | "minimum_dwell"
  | "burst_dampening"
  | "deferral_escalation"
  | "conflicting_interrupt"
  | "decision_stream_continuity"
  | "context_patience";

export type ContinuityRuleInput = {
  candidate: AttentionCandidate;
  context: AttentionPlanningContext;
  evidence: AttentionEvidenceContext;
  routed: AttentionPlanningExplanation;
  plannerDefaults: PlannerDefaults | undefined;
  helpers: {
    peripheralDecision: (
      candidate: AttentionCandidate,
      policyVerdict: AttentionPolicyVerdict,
      surfaceCapabilities?: AttentionSurfaceCapabilities,
    ) => Extract<AttentionPlanDecision, { kind: "queue" | "ambient" }>;
    batchedDecision: (
      candidate: AttentionCandidate,
      policyVerdict: AttentionPolicyVerdict,
      attentionView: AttentionEvidenceContext["attentionView"],
      surfaceCapabilities?: AttentionSurfaceCapabilities,
    ) => Extract<AttentionPlanDecision, { kind: "queue" | "ambient" }>;
  };
};

export type ContinuityRuleEvaluation =
  | {
      rule: ContinuityRuleName;
      kind: "noop";
      rationale: string[];
    }
  | {
      rule: ContinuityRuleName;
      kind: "override";
      decision: AttentionPlanDecision;
      currentPriority: AttentionPriority | null;
      currentScore: number | null;
      rationale: string[];
    };

export type ContinuityRule = (input: ContinuityRuleInput) => ContinuityRuleEvaluation;

export function noopContinuityRule(
  rule: ContinuityRuleName,
  rationale: string[] = [],
): ContinuityRuleEvaluation {
  return {
    rule,
    kind: "noop",
    rationale,
  };
}

export function overrideContinuityRule(
  rule: ContinuityRuleName,
  decision: AttentionPlanDecision,
  currentPriority: AttentionPriority | null,
  currentScore: number | null,
  rationale: string[],
): ContinuityRuleEvaluation {
  return {
    rule,
    kind: "override",
    decision,
    currentPriority,
    currentScore,
    rationale,
  };
}
