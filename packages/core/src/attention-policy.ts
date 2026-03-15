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
import { evaluateSourceTrustCriterionRule } from "./policy/source-trust-criterion-rule.js";
import type { PolicyCriterionRule, PolicyCriterionRuleInput } from "./policy/policy-criterion-rule.js";
import type { PolicyGateRule, PolicyGateRuleInput } from "./policy/policy-gate-rule.js";
import type { MemoryProfile, UserProfile } from "./profile-store.js";

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
  memoryProfile?: MemoryProfile;
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
  evaluateSourceTrustCriterionRule,
  evaluateNoActiveFrameCriterionRule,
  evaluateSmallScoreGapCriterionRule,
];

export class AttentionPolicy {
  private readonly judgmentConfig: JudgmentConfig | undefined;
  private readonly userProfile: UserProfile | undefined;
  private readonly memoryProfile: MemoryProfile | undefined;

  constructor(options: AttentionPolicyOptions = {}) {
    this.judgmentConfig = options.judgmentConfig;
    this.userProfile = options.userProfile;
    this.memoryProfile = options.memoryProfile;
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
    const sourceTrustAdjustment = this.readSourceTrustAdjustment(candidate);
    const input = this.buildPolicyCriterionInput(
      candidate,
      policyVerdict,
      evidence,
      candidateScore,
      currentScore,
      criterion,
      sourceTrustAdjustment,
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

  private readSourceTrustAdjustment(candidate: AttentionCandidate): number {
    const sourceKey = candidate.source?.kind ?? candidate.source?.id;
    if (!sourceKey) {
      return 0;
    }

    return this.memoryProfile?.sourceTrust?.[sourceKey]?.[candidate.consequence]?.trustAdjustment ?? 0;
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
    sourceTrustAdjustment: number,
    peripheralResolution: "queue" | "ambient",
  ): PolicyCriterionRuleInput {
    return {
      candidate,
      policyVerdict,
      evidence,
      candidateScore,
      currentScore,
      criterion,
      sourceTrustAdjustment,
      peripheralResolution,
    };
  }
}
