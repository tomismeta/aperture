import type { AttentionDecisionAmbiguity } from "./attention-ambiguity.js";
import type { AttentionEvidenceContext } from "./attention-evidence.js";
import type { AttentionCandidate } from "./interaction-candidate.js";
import { JUDGMENT_DEFAULTS } from "./judgment-defaults.js";
import type { AmbiguityDefaults, PolicyConfig } from "./policy-config.js";
import { evaluateBackgroundPolicyGateRule } from "./policy/background-policy-gate-rule.js";
import { evaluateBlockingPolicyGateRule } from "./policy/blocking-policy-gate-rule.js";
import { evaluateConfiguredPolicyGateRule } from "./policy/configured-policy-gate-rule.js";
import { evaluateInterruptiveDefaultPolicyGateRule } from "./policy/interruptive-default-policy-gate-rule.js";
import { evaluateAttentionBudgetCriterionRule } from "./policy/attention-budget-criterion-rule.js";
import { evaluateInterruptEligibilityCriterionRule } from "./policy/interrupt-eligibility-criterion-rule.js";
import { evaluateNoActiveFrameCriterionRule } from "./policy/no-active-frame-criterion-rule.js";
import { evaluateOperatorAbsenceCriterionRule } from "./policy/operator-absence-criterion-rule.js";
import { evaluatePeripheralStatusPolicyGateRule } from "./policy/peripheral-status-policy-gate-rule.js";
import { evaluateSemanticUncertaintyCriterionRule } from "./policy/semantic-uncertainty-criterion-rule.js";
import { evaluateSmallScoreGapCriterionRule } from "./policy/small-score-gap-criterion-rule.js";
import { evaluateSourceTrustCriterionRule } from "./policy/source-trust-criterion-rule.js";
import { resolvePeripheralResolutionFloor } from "./judgment-input.js";
import type {
  PolicyCriterionRule,
  PolicyCriterionRuleEvaluation,
  PolicyCriterionRuleInput,
} from "./policy/policy-criterion-rule.js";
import type {
  PolicyGateRule,
  PolicyGateRuleEvaluation,
  PolicyGateRuleInput,
} from "./policy/policy-gate-rule.js";
import type { MemoryProfile, ApertureProfile } from "./profile-store.js";

export type AttentionLane = "now" | "next" | "ambient";

export type AttentionPolicyVerdict = {
  autoApprove: boolean;
  mayInterrupt: boolean;
  requiresOperatorResponse: boolean;
  minimumLane: AttentionLane;
  // Some policy rules establish a true floor (for example, configured ambient/queue
  // policy) rather than a soft starting posture. Criterion should preserve those.
  minimumLaneIsSticky: boolean;
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

export type AttentionPolicyGateExplanation = {
  verdict: AttentionPolicyVerdict;
  evaluations: PolicyGateRuleEvaluation[];
};

export type AttentionPolicyCriterionExplanation = {
  verdict: AttentionInterruptCriterionVerdict;
  evaluations: PolicyCriterionRuleEvaluation[];
};

type AttentionPolicyOptions = {
  policyConfig?: PolicyConfig;
  apertureProfile?: ApertureProfile;
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
  // Order matters: early rules preserve hard boundaries like operator absence
  // and interrupt eligibility, mid-stage rules tune the criterion, and later
  // rules resolve ambiguity before threshold-based activation would fire.
  evaluateOperatorAbsenceCriterionRule,
  evaluateInterruptEligibilityCriterionRule,
  evaluateSourceTrustCriterionRule,
  evaluateAttentionBudgetCriterionRule,
  evaluateSemanticUncertaintyCriterionRule,
  evaluateNoActiveFrameCriterionRule,
  evaluateSmallScoreGapCriterionRule,
];

export class AttentionPolicy {
  private readonly policyConfig: PolicyConfig | undefined;
  private readonly apertureProfile: ApertureProfile | undefined;
  private readonly memoryProfile: MemoryProfile | undefined;

  constructor(options: AttentionPolicyOptions = {}) {
    this.policyConfig = options.policyConfig;
    this.apertureProfile = options.apertureProfile;
    this.memoryProfile = options.memoryProfile;
  }

  evaluateGates(candidate: AttentionCandidate): AttentionPolicyVerdict {
    return this.explainGates(candidate).verdict;
  }

  explainGates(candidate: AttentionCandidate): AttentionPolicyGateExplanation {
    const input = this.buildPolicyGateInput(candidate);
    const evaluations: PolicyGateRuleEvaluation[] = [];
    for (const rule of POLICY_GATE_RULES) {
      const evaluation = rule(input);
      evaluations.push(evaluation);
      if (evaluation.kind === "verdict") {
        return {
          verdict: evaluation.verdict,
          evaluations,
        };
      }
    }

    // Safety net if the policy gate rule list changes and no rule returns a verdict.
    const verdict: AttentionPolicyVerdict = {
      autoApprove: false,
      mayInterrupt: true,
      requiresOperatorResponse: false,
      minimumLane: "next",
      minimumLaneIsSticky: false,
      rationale: ["urgent non-blocking work may compete for interruptive attention"],
    };

    return {
      verdict,
      evaluations,
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
    return this.explainInterruptCriterion(
      candidate,
      policyVerdict,
      evidence,
      candidateScore,
      currentScore,
      options,
    ).verdict;
  }

  explainInterruptCriterion(
    candidate: AttentionCandidate,
    policyVerdict: AttentionPolicyVerdict,
    evidence: AttentionEvidenceContext,
    candidateScore: number,
    currentScore: number | null,
    options: { ambiguityDefaults?: AmbiguityDefaults } = {},
  ): AttentionPolicyCriterionExplanation {
    let criterion = this.readInterruptCriterion(options.ambiguityDefaults);
    const peripheralResolution = this.readPeripheralResolution(candidate, policyVerdict);
    const sourceTrustAdjustment = this.readSourceTrustAdjustment(candidate);
    const criterionRationale: string[] = [];
    const evaluations: PolicyCriterionRuleEvaluation[] = [];

    for (const rule of POLICY_CRITERION_RULES) {
      const evaluation = rule(
        this.buildPolicyCriterionInput(
          candidate,
          policyVerdict,
          evidence,
          candidateScore,
          currentScore,
          criterion,
          sourceTrustAdjustment,
          peripheralResolution,
        ),
      );
      evaluations.push(evaluation);
      if (evaluation.kind === "adjust") {
        criterion = evaluation.criterion;
        criterionRationale.push(...evaluation.rationale);
        continue;
      }

      if (evaluation.kind === "verdict") {
        return {
          verdict: {
            ...evaluation.verdict,
            rationale: [...criterionRationale, ...evaluation.verdict.rationale],
          },
          evaluations,
        };
      }
    }

    return {
      verdict: {
        criterion,
        peripheralResolution: null,
        ambiguity: null,
        rationale: criterionRationale,
      },
      evaluations,
    };
  }

  private readInterruptCriterion(
    ambiguityDefaults?: AmbiguityDefaults,
  ): AttentionInterruptCriterion {
    return {
      activationThreshold:
        ambiguityDefaults?.nonBlockingActivationThreshold ??
        this.policyConfig?.ambiguityDefaults?.nonBlockingActivationThreshold ??
        JUDGMENT_DEFAULTS.ambiguity.nonBlockingActivationThreshold,
      promotionMargin:
        ambiguityDefaults?.promotionMargin ??
        this.policyConfig?.ambiguityDefaults?.promotionMargin ??
        JUDGMENT_DEFAULTS.ambiguity.promotionMargin,
    };
  }

  private readPeripheralResolution(
    candidate: AttentionCandidate,
    policyVerdict: AttentionPolicyVerdict,
  ): "queue" | "ambient" {
    return resolvePeripheralResolutionFloor(
      candidate,
      policyVerdict.minimumLane === "ambient" ? "ambient" : "queue",
    );
  }

  private readSourceTrustAdjustment(candidate: AttentionCandidate): number {
    const sourceKey = candidate.source?.kind ?? candidate.source?.id;
    if (!sourceKey) {
      return 0;
    }

    return (
      this.memoryProfile?.sourceTrust?.[sourceKey]?.[candidate.consequence]?.trustAdjustment ?? 0
    );
  }

  private buildPolicyGateInput(candidate: AttentionCandidate): PolicyGateRuleInput {
    return {
      candidate,
      ...(this.policyConfig !== undefined ? { policyConfig: this.policyConfig } : {}),
      ...(this.apertureProfile !== undefined ? { apertureProfile: this.apertureProfile } : {}),
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
