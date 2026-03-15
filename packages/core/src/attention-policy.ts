import type { AttentionDecisionAmbiguity } from "./attention-ambiguity.js";
import type { AttentionEvidenceContext } from "./attention-evidence.js";
import type { AttentionCandidate } from "./interaction-candidate.js";
import { inferToolFamily } from "./interaction-taxonomy.js";
import { JUDGMENT_DEFAULTS } from "./judgment-defaults.js";
import type { AmbiguityDefaults, JudgmentConfig } from "./judgment-config.js";
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
    const configured = this.configuredVerdict(candidate);
    if (configured) {
      return configured;
    }

    if (candidate.blocking) {
      return {
        autoApprove: false,
        mayInterrupt: true,
        requiresOperatorResponse: true,
        minimumPresentation: "active",
        rationale: ["blocking interactions require explicit operator attention"],
      };
    }

    if (candidate.priority === "background") {
      return {
        autoApprove: false,
        mayInterrupt: false,
        requiresOperatorResponse: false,
        minimumPresentation: "ambient",
        rationale: ["background work should remain peripheral by default"],
      };
    }

    if (
      candidate.mode === "status" &&
      candidate.consequence !== "high" &&
      candidate.tone !== "critical"
    ) {
      return {
        autoApprove: false,
        mayInterrupt: false,
        requiresOperatorResponse: false,
        minimumPresentation: "ambient",
        rationale: ["non-critical status work should start in the periphery"],
      };
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

    if (
      candidate.blocking
      || candidate.episodeState === "actionable"
      || policyVerdict.autoApprove
      || !policyVerdict.mayInterrupt
      || policyVerdict.requiresOperatorResponse
      || policyVerdict.minimumPresentation === "active"
    ) {
      return {
        criterion,
        peripheralResolution: null,
        ambiguity: null,
        rationale: [],
      };
    }

    const peripheralResolution = this.readPeripheralResolution(policyVerdict);
    if (!evidence.currentFrame) {
      if (candidateScore >= criterion.activationThreshold) {
        return {
          criterion,
          peripheralResolution: null,
          ambiguity: null,
          rationale: [],
        };
      }

      return {
        criterion,
        peripheralResolution,
        ambiguity: {
          kind: "interrupt",
          reason: "low_signal",
          resolution: peripheralResolution,
        },
        rationale: ["uncertain interruptive work stays peripheral until its signal is stronger"],
      };
    }

    if (currentScore === null || candidateScore <= currentScore) {
      return {
        criterion,
        peripheralResolution: null,
        ambiguity: null,
        rationale: [],
      };
    }

    if (candidateScore >= currentScore + criterion.promotionMargin) {
      return {
        criterion,
        peripheralResolution: null,
        ambiguity: null,
        rationale: [],
      };
    }

    return {
      criterion,
      peripheralResolution,
      ambiguity: {
        kind: "interrupt",
        reason: "small_score_gap",
        resolution: peripheralResolution,
      },
      rationale: ["small score gaps resolve to the periphery instead of stealing focus immediately"],
    };
  }

  private configuredVerdict(candidate: AttentionCandidate): AttentionPolicyVerdict | null {
    const toolFamily = inferToolFamily(candidate);
    const toolOverride = toolFamily
      ? this.userProfile?.overrides?.tools?.[toolFamily]
      : undefined;
    const policyRule = this.matchPolicyRule(candidate);
    const requireContextExpansion =
      toolOverride?.requireContextExpansion === true
      || policyRule?.requireContextExpansion === true;
    const autoApprove =
      policyRule?.autoApprove === true
      && candidate.mode === "approval"
      && candidate.responseSpec.kind === "approval"
      && !requireContextExpansion;

    const minimumPresentation = readAttentionPresentationFloor(toolOverride?.defaultPresentation)
      ?? policyRule?.minimumPresentation
      ?? (requireContextExpansion ? "active" : undefined);
    const mayInterrupt = policyRule?.mayInterrupt;
    const requiresOperatorResponse =
      !autoApprove
      && (
      candidate.blocking
      || minimumPresentation === "active"
      || requireContextExpansion
      );

    if (
      minimumPresentation === undefined
      && mayInterrupt === undefined
      && !toolOverride
      && !autoApprove
    ) {
      return null;
    }

    const rationale: string[] = [];
    if (toolFamily && toolOverride) {
      rationale.push(`user override applies for ${toolFamily} interactions`);
    }
    if (policyRule) {
      rationale.push("configured judgment policy applies to this interaction");
    }

    if (autoApprove) {
      rationale.push("configured judgment policy auto-approves this bounded approval");
      return {
        autoApprove: true,
        mayInterrupt: false,
        requiresOperatorResponse: false,
        minimumPresentation: "ambient",
        rationale,
      };
    }

    if (requiresOperatorResponse) {
      rationale.push("operator-response work cannot remain passive without auto-resolution");
      return {
        autoApprove: false,
        mayInterrupt: true,
        requiresOperatorResponse: true,
        minimumPresentation: "active",
        rationale,
      };
    }

    return {
      autoApprove: false,
      mayInterrupt: mayInterrupt ?? false,
      requiresOperatorResponse,
      minimumPresentation: minimumPresentation ?? (candidate.blocking ? "active" : "queue"),
      rationale,
    };
  }

  private matchPolicyRule(candidate: AttentionCandidate) {
    const policy = this.judgmentConfig?.policy;
    if (!policy) {
      return undefined;
    }

    const tags = policyTagsForCandidate(candidate);
    for (const tag of tags) {
      const rule = policy[tag];
      if (rule) {
        return rule;
      }
    }

    return undefined;
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
}

function policyTagsForCandidate(candidate: AttentionCandidate): string[] {
  const tags: string[] = [];
  const toolFamily = inferToolFamily(candidate);
  const value = [
    candidate.title,
    candidate.summary ?? "",
    ...(candidate.context?.items?.flatMap((item) => [item.label, item.value ?? ""]) ?? []),
  ]
    .join(" ")
    .toLowerCase();

  if (candidate.consequence === "low" && toolFamily === "read") {
    tags.push("lowRiskRead");
  }

  if (candidate.consequence === "low" && toolFamily === "web") {
    tags.push("lowRiskWeb");
  }

  if (value.includes(".env") && (toolFamily === "write" || toolFamily === "edit" || toolFamily === "bash")) {
    tags.push("envWrite");
  }

  if (toolFamily === "write" || toolFamily === "edit") {
    tags.push("fileWrite");
  }

  if (toolFamily === "bash" && candidate.consequence === "high") {
    tags.push("destructiveBash");
  }

  return tags;
}

function readAttentionPresentationFloor(value: unknown): AttentionPresentationFloor | undefined {
  switch (value) {
    case "ambient":
    case "queue":
    case "active":
      return value;
    default:
      return undefined;
  }
}
