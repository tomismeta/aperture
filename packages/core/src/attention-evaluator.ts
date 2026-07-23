import type { AttentionFrame } from "./frame.js";

import {
  buildAttentionEvidenceInput,
  resolveAttentionEvidenceContext,
  type AttentionEvidenceContext,
  type AttentionEvidenceInput,
} from "./attention-evidence.js";
import type { AttentionClaim } from "./attention-claim.js";
import {
  buildAttentionDecisionExplanation,
  type AttentionCandidateDecision,
  type AttentionDecision,
  type AttentionDecisionExplanation,
  type AttentionDecisionRecord,
} from "./attention-decision-record.js";
import type { AttentionEvaluationConfig } from "./attention-evaluator-config.js";
import {
  normalizePublicEvaluationInput,
  type AttentionEvaluationInput,
  type InternalAttentionEvaluationInput,
} from "./attention-evaluator-input.js";
import { normalizeAttentionEvaluationConfig } from "./attention-evaluator-runtime-config.js";
import {
  AttentionPolicy,
  type AttentionPolicyCriterionExplanation,
  type AttentionPolicyGateExplanation,
} from "./attention-policy.js";
import { AttentionPlanner, type AttentionPlanningExplanation } from "./attention-planner.js";
import { AttentionValue, type AttentionValueBreakdown } from "./attention-value.js";
import { priorityForFrame, scoreAttentionFrame } from "./frame-score.js";
import type { AttentionCandidate } from "./interaction-candidate.js";
import type { AmbiguityDefaults } from "./policy-config.js";
import { parseTimestamp } from "./time.js";

export type AttentionDecisionContext = AttentionEvidenceContext | AttentionEvidenceInput;

type AttentionEvaluatorOptions = {
  ambiguityDefaults?: AmbiguityDefaults;
};

export class AttentionEvaluator {
  private readonly policyGates: AttentionPolicy;
  private readonly utilityScore: AttentionValue;
  private readonly queuePlanner: AttentionPlanner;
  private readonly ambiguityDefaults: AmbiguityDefaults | undefined;

  constructor(
    policyGates: AttentionPolicy = new AttentionPolicy(),
    utilityScore: AttentionValue = new AttentionValue(),
    queuePlanner: AttentionPlanner = new AttentionPlanner(),
    options: AttentionEvaluatorOptions = {},
  ) {
    this.policyGates = policyGates;
    this.utilityScore = utilityScore;
    this.queuePlanner = queuePlanner;
    this.ambiguityDefaults = options.ambiguityDefaults;
  }

  evaluate(input: InternalAttentionEvaluationInput): AttentionDecisionRecord {
    return this.explain(input).record;
  }

  explain(input: InternalAttentionEvaluationInput): AttentionDecisionExplanation {
    const current = input.current ?? null;
    const candidate = input.candidate;
    const evidence = this.resolveEvidenceContext(current, input.context ?? {}, input.evaluatedAt);
    const gateExplanation = this.policyGates.explainGates(candidate);
    const policy = gateExplanation.verdict;
    const utility = this.utilityScore.scoreCandidate(candidate);
    const currentScore = evidence.currentFrame
      ? scoreAttentionFrame(evidence.currentFrame, { now: input.evaluatedAt })
      : null;
    const pressureForecast = evidence.pressureForecast;

    if (policy.autoApprove) {
      return this.explainAutoApproval(
        candidate,
        evidence,
        gateExplanation,
        utility,
        currentScore,
        input.evaluatedAt,
        input.recordClaim,
      );
    }

    const criterionExplanation = this.policyGates.explainInterruptCriterion(
      candidate,
      policy,
      evidence,
      utility.total,
      currentScore,
      this.ambiguityDefaults !== undefined ? { ambiguityDefaults: this.ambiguityDefaults } : {},
    );
    const criterion = criterionExplanation.verdict;

    if (criterion.peripheralResolution) {
      return buildAttentionDecisionExplanation({
        decision: {
          kind: criterion.peripheralResolution,
          candidate,
        },
        candidate,
        evidence,
        policy,
        policyGateEvaluations: gateExplanation.evaluations,
        utility,
        criterion,
        policyCriterionEvaluations: criterionExplanation.evaluations,
        candidateScore: utility.total,
        currentScore,
        currentPriority: evidence.currentFrame ? priorityForFrame(evidence.currentFrame) : null,
        ambiguity: criterion.ambiguity,
        reasons: [...policy.rationale, ...criterion.rationale],
        continuityEvaluations: [],
        evaluatedAt: input.evaluatedAt,
        ...(input.recordClaim !== undefined ? { recordClaim: input.recordClaim } : {}),
      });
    }

    const planning = this.queuePlanner.explain(evidence.currentFrame, candidate, {
      ...evidence,
      policyVerdict: policy,
      utility,
      pressureForecast,
      candidateScore: utility.total,
      currentScore,
      referenceTimestamp: input.evaluatedAt,
    });

    return this.explainPlanning(
      candidate,
      evidence,
      gateExplanation,
      criterionExplanation,
      utility,
      planning,
      input.evaluatedAt,
      input.recordClaim,
    );
  }

  clear(): AttentionDecision {
    return this.queuePlanner.clear();
  }

  private explainAutoApproval(
    candidate: AttentionCandidate,
    evidence: AttentionEvidenceContext,
    gateExplanation: AttentionPolicyGateExplanation,
    utility: AttentionValueBreakdown,
    currentScore: number | null,
    evaluatedAt: string,
    recordClaim: AttentionClaim | undefined,
  ): AttentionDecisionExplanation {
    const policy = gateExplanation.verdict;
    return buildAttentionDecisionExplanation({
      decision: {
        kind: "auto_approve",
        candidate,
        response: {
          taskId: candidate.taskId,
          interactionId: candidate.interactionId,
          response: { kind: "approved" },
        },
      },
      candidate,
      evidence,
      policy,
      policyGateEvaluations: gateExplanation.evaluations,
      utility,
      criterion: null,
      policyCriterionEvaluations: [],
      candidateScore: utility.total,
      currentScore,
      currentPriority: null,
      ambiguity: null,
      reasons: [
        ...policy.rationale,
        "bounded approval work is auto-resolved instead of entering the attention surface",
      ],
      continuityEvaluations: [],
      evaluatedAt,
      ...(recordClaim !== undefined ? { recordClaim } : {}),
    });
  }

  private explainPlanning(
    candidate: AttentionCandidate,
    evidence: AttentionEvidenceContext,
    gateExplanation: AttentionPolicyGateExplanation,
    criterionExplanation: AttentionPolicyCriterionExplanation,
    utility: AttentionValueBreakdown,
    planning: AttentionPlanningExplanation,
    evaluatedAt: string,
    recordClaim: AttentionClaim | undefined,
  ): AttentionDecisionExplanation {
    return buildAttentionDecisionExplanation({
      decision: assertCandidateDecision(planning.decision),
      candidate,
      evidence,
      policy: gateExplanation.verdict,
      policyGateEvaluations: gateExplanation.evaluations,
      utility,
      criterion: criterionExplanation.verdict,
      policyCriterionEvaluations: criterionExplanation.evaluations,
      candidateScore: utility.total,
      currentScore: planning.currentScore,
      currentPriority: planning.currentPriority,
      ambiguity: null,
      reasons: planning.reasons,
      continuityEvaluations: planning.continuityEvaluations ?? [],
      evaluatedAt,
      ...(recordClaim !== undefined ? { recordClaim } : {}),
    });
  }

  private resolveEvidenceContext(
    current: AttentionFrame | null,
    context: AttentionDecisionContext,
    referenceTimestamp: string,
  ): AttentionEvidenceContext {
    return resolveAttentionEvidenceContext(
      current,
      buildAttentionEvidenceInput(context),
      parseTimestamp(referenceTimestamp) ?? 0,
    );
  }
}

export function evaluateAttention(input: AttentionEvaluationInput): AttentionDecisionRecord {
  return buildAttentionEvaluator(input.config).evaluate(normalizePublicEvaluationInput(input));
}

export function explainAttention(input: AttentionEvaluationInput): AttentionDecisionExplanation {
  return buildAttentionEvaluator(input.config).explain(normalizePublicEvaluationInput(input));
}

export function buildAttentionEvaluator(
  config: AttentionEvaluationConfig = {},
): AttentionEvaluator {
  const runtimeConfig = normalizeAttentionEvaluationConfig(config);
  const policyConfig = runtimeConfig.policyConfig;
  const plannerDefaults = runtimeConfig.plannerDefaults;
  const memoryProfile = runtimeConfig.memoryProfile;
  const apertureProfile = runtimeConfig.apertureProfile;

  return new AttentionEvaluator(
    new AttentionPolicy({
      ...(apertureProfile !== undefined ? { apertureProfile } : {}),
      ...(policyConfig !== undefined ? { policyConfig } : {}),
      ...(memoryProfile !== undefined ? { memoryProfile } : {}),
    }),
    new AttentionValue({
      ...(memoryProfile !== undefined ? { memoryProfile } : {}),
    }),
    new AttentionPlanner({
      ...(plannerDefaults !== undefined
        ? { plannerDefaults }
        : policyConfig?.plannerDefaults !== undefined
          ? { plannerDefaults: policyConfig.plannerDefaults }
          : {}),
    }),
    {
      ...(runtimeConfig.ambiguityDefaults !== undefined
        ? { ambiguityDefaults: runtimeConfig.ambiguityDefaults }
        : {}),
    },
  );
}

function assertCandidateDecision(decision: AttentionDecision): AttentionCandidateDecision {
  if (decision.kind === "clear") {
    throw new Error("Attention claim evaluation cannot produce a clear transition.");
  }

  return decision;
}
