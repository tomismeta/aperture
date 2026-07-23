import type { AttentionFrame } from "./frame.js";

import type { AttentionDecisionAmbiguity } from "./attention-ambiguity.js";
import type { AttentionBurden } from "./attention-burden.js";
import type { AttentionResponse } from "./frame-response.js";
import { priorityForFrame, scoreAttentionFrame } from "./frame-score.js";
import type { AttentionCandidate, AttentionPriority } from "./interaction-candidate.js";
import {
  buildAttentionEvidenceInput,
  resolveAttentionEvidenceContext,
  type AttentionEvidenceContext,
  type AttentionEvidenceInput,
} from "./attention-evidence.js";
import {
  AttentionPolicy,
  type AttentionLane,
  type AttentionInterruptCriterionVerdict,
  type AttentionPolicyVerdict,
} from "./attention-policy.js";
import type { PolicyCriterionRuleEvaluation } from "./policy/policy-criterion-rule.js";
import type { PolicyGateRuleEvaluation } from "./policy/policy-gate-rule.js";
import type { AttentionPressure } from "./attention-pressure.js";
import { AttentionPlanner } from "./attention-planner.js";
import type { ContinuityRuleEvaluation } from "./continuity/continuity-rule.js";
import { AttentionValue, type AttentionValueBreakdown } from "./attention-value.js";
import type { AmbiguityDefaults } from "./policy-config.js";

export type AttentionDecision =
  | { kind: "auto_approve"; candidate: AttentionCandidate; response: AttentionResponse }
  | { kind: "activate"; candidate: AttentionCandidate }
  | { kind: "queue"; candidate: AttentionCandidate }
  | { kind: "ambient"; candidate: AttentionCandidate }
  | { kind: "clear" };

export type AttentionDecisionPlannedLane = "now" | "next" | "ambient" | "none";

export type AttentionDecisionReasonCode =
  | `route:${AttentionDecision["kind"]}`
  | `lane:${AttentionDecisionPlannedLane}`
  | `policy:minimum_lane:${AttentionLane}`
  | `policy_gate:${string}:${PolicyGateRuleEvaluation["kind"]}`
  | `policy_criterion:${string}:${PolicyCriterionRuleEvaluation["kind"]}`
  | `criterion:peripheral_resolution:${NonNullable<AttentionInterruptCriterionVerdict["peripheralResolution"]>}`
  | `criterion:ambiguity:${NonNullable<AttentionDecisionAmbiguity["reason"]>}`
  | `continuity:${ContinuityRuleEvaluation["rule"]}:override`
  | `pressure:level:${AttentionPressure["level"]}`
  | `pressure:overload:${AttentionPressure["overloadRisk"]}`
  | `evidence:operator_presence:${AttentionEvidenceContext["operatorPresence"]}`
  | "evidence:current_frame:present"
  | "evidence:current_frame:absent"
  | "evidence:current_episode:present"
  | "evidence:current_episode:absent"
  | "policy:auto_approve"
  | "policy:may_interrupt"
  | "policy:peripheral_only"
  | "policy:requires_operator_response";

export type AttentionDecisionRecord = {
  decision: AttentionDecision;
  candidate: AttentionCandidate;
  evidenceSnapshot: {
    pressureForecast: AttentionPressure;
    attentionBurden: AttentionBurden;
    operatorPresence: AttentionEvidenceContext["operatorPresence"];
    currentFrameId: string | null;
    currentEpisodeId: string | null;
  };
  policy: {
    verdict: AttentionPolicyVerdict;
    gateEvaluations: PolicyGateRuleEvaluation[];
    criterion: AttentionInterruptCriterionVerdict | null;
    criterionEvaluations: PolicyCriterionRuleEvaluation[];
  };
  value: {
    breakdown: AttentionValueBreakdown;
    candidateScore: number;
    currentScore: number | null;
    currentPriority: AttentionPriority | null;
  };
  planning: {
    route: AttentionDecision["kind"];
    plannedLane: AttentionDecisionPlannedLane;
    ambiguity: AttentionDecisionAmbiguity | null;
    reasons: string[];
    reasonCodes: AttentionDecisionReasonCode[];
    continuityEvaluations: ContinuityRuleEvaluation[];
  };
};

export type AttentionDecisionExplanation = {
  decision: AttentionDecision;
  policy: AttentionPolicyVerdict;
  policyGateEvaluations: PolicyGateRuleEvaluation[];
  utility: AttentionValueBreakdown;
  criterion: AttentionInterruptCriterionVerdict | null;
  policyCriterionEvaluations: PolicyCriterionRuleEvaluation[];
  pressureForecast: AttentionPressure;
  attentionBurden: AttentionBurden;
  candidateScore: number;
  currentScore: number | null;
  currentPriority: AttentionPriority | null;
  ambiguity: AttentionDecisionAmbiguity | null;
  reasons: string[];
  reasonCodes: AttentionDecisionReasonCode[];
  continuityEvaluations: ContinuityRuleEvaluation[];
  record: AttentionDecisionRecord;
};

export type AttentionDecisionContext = AttentionEvidenceContext | AttentionEvidenceInput;

type JudgmentCoordinatorOptions = {
  ambiguityDefaults?: AmbiguityDefaults;
};

export class JudgmentCoordinator {
  private readonly policyGates: AttentionPolicy;
  private readonly utilityScore: AttentionValue;
  private readonly queuePlanner: AttentionPlanner;
  private readonly ambiguityDefaults: AmbiguityDefaults | undefined;

  constructor(
    policyGates: AttentionPolicy = new AttentionPolicy(),
    utilityScore: AttentionValue = new AttentionValue(),
    queuePlanner: AttentionPlanner = new AttentionPlanner(),
    options: JudgmentCoordinatorOptions = {},
  ) {
    this.policyGates = policyGates;
    this.utilityScore = utilityScore;
    this.queuePlanner = queuePlanner;
    this.ambiguityDefaults = options.ambiguityDefaults;
  }

  coordinate(
    current: AttentionFrame | null,
    candidate: AttentionCandidate,
    context: AttentionDecisionContext = {},
  ): AttentionDecision {
    return this.explain(current, candidate, context).decision;
  }

  explain(
    current: AttentionFrame | null,
    candidate: AttentionCandidate,
    context: AttentionDecisionContext = {},
  ): AttentionDecisionExplanation {
    const evidence = this.resolveEvidenceContext(current, context, candidate.timestamp);
    const gateExplanation = this.policyGates.explainGates(candidate);
    const policy = gateExplanation.verdict;
    const utility = this.utilityScore.scoreCandidate(candidate);
    const currentScore = evidence.currentFrame
      ? scoreAttentionFrame(evidence.currentFrame, { now: candidate.timestamp })
      : null;
    const pressureForecast = evidence.pressureForecast;

    if (policy.autoApprove) {
      const reasons = [
        ...policy.rationale,
        "bounded approval work is auto-resolved instead of entering the attention surface",
      ];
      const decision: AttentionDecision = {
        kind: "auto_approve",
        candidate,
        response: {
          taskId: candidate.taskId,
          interactionId: candidate.interactionId,
          response: { kind: "approved" },
        },
      };
      return buildAttentionDecisionExplanation({
        decision,
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
        reasons,
        continuityEvaluations: [],
      });
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
      const reasons = [...policy.rationale, ...criterion.rationale];
      const decision: AttentionDecision = {
        kind: criterion.peripheralResolution,
        candidate,
      };
      return buildAttentionDecisionExplanation({
        decision,
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
        reasons,
        continuityEvaluations: [],
      });
    }

    const planning = this.queuePlanner.explain(evidence.currentFrame, candidate, {
      ...evidence,
      policyVerdict: policy,
      utility,
      pressureForecast,
      candidateScore: utility.total,
      currentScore,
    });

    return buildAttentionDecisionExplanation({
      decision: planning.decision,
      candidate,
      evidence,
      policy,
      policyGateEvaluations: gateExplanation.evaluations,
      utility,
      criterion,
      policyCriterionEvaluations: criterionExplanation.evaluations,
      candidateScore: utility.total,
      currentScore: planning.currentScore,
      currentPriority: planning.currentPriority,
      ambiguity: null,
      reasons: planning.reasons,
      continuityEvaluations: planning.continuityEvaluations ?? [],
    });
  }

  clear(): AttentionDecision {
    return this.queuePlanner.clear();
  }

  private resolveEvidenceContext(
    current: AttentionFrame | null,
    context: AttentionDecisionContext,
    referenceTimestamp: string,
  ): AttentionEvidenceContext {
    return resolveAttentionEvidenceContext(
      current,
      buildAttentionEvidenceInput(context),
      parseReferenceTime(referenceTimestamp),
    );
  }
}

function parseReferenceTime(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

type AttentionDecisionExplanationInput = {
  decision: AttentionDecision;
  candidate: AttentionCandidate;
  evidence: AttentionEvidenceContext;
  policy: AttentionPolicyVerdict;
  policyGateEvaluations: PolicyGateRuleEvaluation[];
  utility: AttentionValueBreakdown;
  criterion: AttentionInterruptCriterionVerdict | null;
  policyCriterionEvaluations: PolicyCriterionRuleEvaluation[];
  candidateScore: number;
  currentScore: number | null;
  currentPriority: AttentionPriority | null;
  ambiguity: AttentionDecisionAmbiguity | null;
  reasons: string[];
  continuityEvaluations: ContinuityRuleEvaluation[];
};

function buildAttentionDecisionExplanation(
  input: AttentionDecisionExplanationInput,
): AttentionDecisionExplanation {
  const record = buildAttentionDecisionRecord(input);

  return {
    decision: input.decision,
    policy: input.policy,
    policyGateEvaluations: input.policyGateEvaluations,
    utility: input.utility,
    criterion: input.criterion,
    policyCriterionEvaluations: input.policyCriterionEvaluations,
    pressureForecast: input.evidence.pressureForecast,
    attentionBurden: input.evidence.attentionBurden,
    candidateScore: input.candidateScore,
    currentScore: input.currentScore,
    currentPriority: input.currentPriority,
    ambiguity: input.ambiguity,
    reasons: input.reasons,
    reasonCodes: record.planning.reasonCodes,
    continuityEvaluations: input.continuityEvaluations,
    record,
  };
}

function buildAttentionDecisionRecord(
  input: AttentionDecisionExplanationInput,
): AttentionDecisionRecord {
  const plannedLane = plannedLaneForDecision(input.decision);
  const reasonCodes = buildAttentionDecisionReasonCodes(input, plannedLane);

  return {
    decision: input.decision,
    candidate: input.candidate,
    evidenceSnapshot: {
      pressureForecast: input.evidence.pressureForecast,
      attentionBurden: input.evidence.attentionBurden,
      operatorPresence: input.evidence.operatorPresence,
      currentFrameId: input.evidence.currentFrame?.id ?? null,
      currentEpisodeId: input.evidence.currentEpisode?.id ?? null,
    },
    policy: {
      verdict: input.policy,
      gateEvaluations: [...input.policyGateEvaluations],
      criterion: input.criterion,
      criterionEvaluations: [...input.policyCriterionEvaluations],
    },
    value: {
      breakdown: input.utility,
      candidateScore: input.candidateScore,
      currentScore: input.currentScore,
      currentPriority: input.currentPriority,
    },
    planning: {
      route: input.decision.kind,
      plannedLane,
      ambiguity: input.ambiguity,
      reasons: [...input.reasons],
      reasonCodes,
      continuityEvaluations: [...input.continuityEvaluations],
    },
  };
}

function buildAttentionDecisionReasonCodes(
  input: AttentionDecisionExplanationInput,
  plannedLane: AttentionDecisionPlannedLane,
): AttentionDecisionReasonCode[] {
  const codes = new Set<AttentionDecisionReasonCode>();

  codes.add(`route:${input.decision.kind}`);
  codes.add(`lane:${plannedLane}`);
  codes.add(`policy:minimum_lane:${input.policy.minimumLane}`);
  codes.add(`pressure:level:${input.evidence.pressureForecast.level}`);
  codes.add(`pressure:overload:${input.evidence.pressureForecast.overloadRisk}`);
  codes.add(`evidence:operator_presence:${input.evidence.operatorPresence}`);
  codes.add(
    input.evidence.currentFrame
      ? "evidence:current_frame:present"
      : "evidence:current_frame:absent",
  );
  codes.add(
    input.evidence.currentEpisode
      ? "evidence:current_episode:present"
      : "evidence:current_episode:absent",
  );

  if (input.policy.autoApprove) {
    codes.add("policy:auto_approve");
  }
  if (input.policy.mayInterrupt) {
    codes.add("policy:may_interrupt");
  } else {
    codes.add("policy:peripheral_only");
  }
  if (input.policy.requiresOperatorResponse) {
    codes.add("policy:requires_operator_response");
  }
  if (input.criterion?.peripheralResolution) {
    codes.add(`criterion:peripheral_resolution:${input.criterion.peripheralResolution}`);
  }
  if (input.ambiguity) {
    codes.add(`criterion:ambiguity:${input.ambiguity.reason}`);
  }

  for (const evaluation of input.policyGateEvaluations) {
    codes.add(`policy_gate:${evaluation.rule}:${evaluation.kind}`);
  }
  for (const evaluation of input.policyCriterionEvaluations) {
    codes.add(`policy_criterion:${evaluation.rule}:${evaluation.kind}`);
  }
  for (const evaluation of input.continuityEvaluations) {
    if (evaluation.kind === "override") {
      codes.add(`continuity:${evaluation.rule}:override`);
    }
  }

  return [...codes];
}

function plannedLaneForDecision(decision: AttentionDecision): AttentionDecisionPlannedLane {
  switch (decision.kind) {
    case "activate":
      return "now";
    case "queue":
      return "next";
    case "ambient":
      return "ambient";
    case "auto_approve":
    case "clear":
      return "none";
    default:
      return unreachableAttentionDecision(decision);
  }
}

function unreachableAttentionDecision(decision: never): never {
  throw new Error(`Unhandled attention decision in decision record: ${JSON.stringify(decision)}`);
}
