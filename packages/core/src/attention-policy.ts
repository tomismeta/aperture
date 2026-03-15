import type { AttentionDecisionAmbiguity } from "./attention-ambiguity.js";
import type { AttentionEvidenceContext } from "./attention-evidence.js";
import type { AttentionCandidate } from "./interaction-candidate.js";
import { JUDGMENT_DEFAULTS } from "./judgment-defaults.js";
import type { AmbiguityDefaults, JudgmentConfig } from "./judgment-config.js";
import { evaluateBackgroundPolicyGateRule } from "./policy/background-policy-gate-rule.js";
import { evaluateBlockingPolicyGateRule } from "./policy/blocking-policy-gate-rule.js";
import { evaluateConfiguredPolicyGateRule } from "./policy/configured-policy-gate-rule.js";
import { evaluateInterruptiveDefaultPolicyGateRule } from "./policy/interruptive-default-policy-gate-rule.js";
import { evaluateInterruptEligibilityCriterionRule } from "./policy/interrupt-eligibility-criterion-rule.js";
import { evaluateNoActiveFrameCriterionRule } from "./policy/no-active-frame-criterion-rule.js";
import { evaluateOperatorAbsenceCriterionRule } from "./policy/operator-absence-criterion-rule.js";
import { evaluatePeripheralStatusPolicyGateRule } from "./policy/peripheral-status-policy-gate-rule.js";
import { evaluateSmallScoreGapCriterionRule } from "./policy/small-score-gap-criterion-rule.js";
import type { PolicyCriterionRule, PolicyCriterionRuleInput } from "./policy/policy-criterion-rule.js";
import type { PolicyGateRule, PolicyGateRuleInput } from "./policy/policy-gate-rule.js";
import type { UserProfile } from "./profile-store.js";

export type AttentionPresentationFloor = "ambient" | "queue" | "active";

export type AttentionPolicyVerdict = {
  autoApprove: boolean;
  mayInterrupt: boolean;
  requiresOperatorResponse: boolean;
  minimumPresentation: AttentionPresentationFloor;
  rationale: string[];
};

export type AttentionInterruptCriterion = {
  activationThreshold: number;
  promotionMargin: number;
};

export type AttentionInterruptCriterionVerdict = {
  criterion: AttentionInterruptCriterion;
  peripheralResolution: "queue" | "ambient" | null;
  ambiguity: AttentionDecisionAmbiguity | null;
  rationale: string[];
};

type AttentionPolicyOptions = {
  judgmentConfig?: JudgmentConfig;
  userProfile?: UserProfile;
};

const POLICY_GATE_RULES: readonly PolicyGateRule[] = [
  evaluateConfiguredPolicyGateRule,
  evaluateBlockingPolicyGateRule,
  evaluateBackgroundPolicyGateRule,
  evaluatePeripheralStatusPolicyGateRule,
  evaluateInterruptiveDefaultPolicyGateRule,
];

const POLICY_CRITERION_RULES: readonly PolicyCriterionRule[] = [
  evaluateOperatorAbsenceCriterionRule,
  evaluateInterruptEligibilityCriterionRule,
  evaluateNoActiveFrameCriterionRule,
  evaluateSmallScoreGapCriterionRule,
];

export class AttentionPolicy {
  private readonly judgmentConfig: JudgmentConfig | undefined;
  private readonly userProfile: UserProfile | undefined;

  constructor(options: AttentionPolicyOptions = {}) {
    this.judgmentConfig = options.judgmentConfig;
    this.userProfile = options.userProfile;
  }

  evaluate(candidate: AttentionCandidate): AttentionPolicyVerdict {
    return this.evaluateGates(candidate);
  }

  evaluateGates(candidate: AttentionCandidate): AttentionPolicyVerdict {
    const input = this.buildPolicyGateInput(candidate);
    for (const rule of POLICY_GATE_RULES) {
      const evaluation = rule(input);
      if (evaluation.kind === "verdict") {
        return evaluation.verdict;
      }
    }

    return {
      autoApprove: false,
      mayInterrupt: true,
      requiresOperatorResponse: false,
      minimumPresentation: "queue",
      rationale: ["urgent non-blocking work may compete for interruptive attention"],
    };
  }

  evaluateInterruptCriterion(
    candidate: AttentionCandidate,
    policyVerdict: AttentionPolicyVerdict,
    evidence: AttentionEvidenceContext,
    candidateScore: number,
    currentScore: number | null,
    options: { ambiguityDefaults?: AmbiguityDefaults } = {},
  ): AttentionInterruptCriterionVerdict {
    const criterion = this.readInterruptCriterion(options.ambiguityDefaults);
    const peripheralResolution = this.readPeripheralResolution(policyVerdict);
    const input = this.buildPolicyCriterionInput(
      candidate,
      policyVerdict,
      evidence,
      candidateScore,
      currentScore,
      criterion,
      peripheralResolution,
    );

    for (const rule of POLICY_CRITERION_RULES) {
      const evaluation = rule(input);
      if (evaluation.kind === "verdict") {
        return evaluation.verdict;
      }
    }

    return {
      criterion,
      peripheralResolution: null,
      ambiguity: null,
      rationale: [],
    };
  }

  private readInterruptCriterion(ambiguityDefaults?: AmbiguityDefaults): AttentionInterruptCriterion {
    return {
      activationThreshold:
        ambiguityDefaults?.nonBlockingActivationThreshold
        ?? this.judgmentConfig?.ambiguityDefaults?.nonBlockingActivationThreshold
        ?? JUDGMENT_DEFAULTS.ambiguity.nonBlockingActivationThreshold,
      promotionMargin:
        ambiguityDefaults?.promotionMargin
        ?? this.judgmentConfig?.ambiguityDefaults?.promotionMargin
        ?? JUDGMENT_DEFAULTS.ambiguity.promotionMargin,
    };
  }

  private readPeripheralResolution(policyVerdict: AttentionPolicyVerdict): "queue" | "ambient" {
    return policyVerdict.minimumPresentation === "ambient" ? "ambient" : "queue";
  }

  private buildPolicyGateInput(candidate: AttentionCandidate): PolicyGateRuleInput {
    return {
      candidate,
      ...(this.judgmentConfig !== undefined ? { judgmentConfig: this.judgmentConfig } : {}),
      ...(this.userProfile !== undefined ? { userProfile: this.userProfile } : {}),
    };
  }

  private buildPolicyCriterionInput(
    candidate: AttentionCandidate,
    policyVerdict: AttentionPolicyVerdict,
    evidence: AttentionEvidenceContext,
    candidateScore: number,
    currentScore: number | null,
    criterion: AttentionInterruptCriterion,
    peripheralResolution: "queue" | "ambient",
  ): PolicyCriterionRuleInput {
    return {
      candidate,
      policyVerdict,
      evidence,
      candidateScore,
      currentScore,
      criterion,
      peripheralResolution,
    };
  }
}
