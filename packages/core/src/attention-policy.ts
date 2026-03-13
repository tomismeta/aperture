import type { InteractionCandidate } from "./interaction-candidate.js";
import { inferToolFamily } from "./interaction-taxonomy.js";
import type { JudgmentConfig } from "./judgment-config.js";
import type { UserProfile } from "./profile-store.js";

export type MinimumPresentation = "ambient" | "queue" | "active";

export type AttentionPolicyVerdict = {
  autoApprove: boolean;
  mayInterrupt: boolean;
  requiresOperatorResponse: boolean;
  minimumPresentation: MinimumPresentation;
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

  evaluate(candidate: InteractionCandidate): AttentionPolicyVerdict {
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

  private configuredVerdict(candidate: InteractionCandidate): AttentionPolicyVerdict | null {
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

    const minimumPresentation = readMinimumPresentation(toolOverride?.defaultPresentation)
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

  private matchPolicyRule(candidate: InteractionCandidate) {
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
}

function policyTagsForCandidate(candidate: InteractionCandidate): string[] {
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

  if (value.includes(".env") && (toolFamily === "write" || toolFamily === "edit" || toolFamily === "bash")) {
    tags.push("envWrite");
  }

  if (toolFamily === "bash" && candidate.consequence === "high") {
    tags.push("destructiveBash");
  }

  return tags;
}

function readMinimumPresentation(value: unknown): MinimumPresentation | undefined {
  switch (value) {
    case "ambient":
    case "queue":
    case "active":
      return value;
    default:
      return undefined;
  }
}
