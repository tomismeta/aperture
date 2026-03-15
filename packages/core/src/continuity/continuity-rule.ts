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
      rule: string;
      kind: "noop";
      rationale: string[];
    }
  | {
      rule: string;
      kind: "override";
      decision: AttentionPlanDecision;
      currentPriority: AttentionPriority | null;
      currentScore: number | null;
      rationale: string[];
    };

export type ContinuityRule = (input: ContinuityRuleInput) => ContinuityRuleEvaluation;

export function noopContinuityRule(rule: string, rationale: string[] = []): ContinuityRuleEvaluation {
  return {
    rule,
    kind: "noop",
    rationale,
  };
}

export function overrideContinuityRule(
  rule: string,
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
