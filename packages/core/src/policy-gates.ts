import type { InteractionCandidate } from "./interaction-candidate.js";
import { inferToolFamily } from "./interaction-taxonomy.js";
import type { JudgmentConfig } from "./judgment-config.js";
import type { UserProfile } from "./profile-store.js";

export type MinimumPresentation = "ambient" | "queue" | "active";

export type PolicyVerdict = {
  mayInterrupt: boolean;
  requiresOperatorResponse: boolean;
  minimumPresentation: MinimumPresentation;
  rationale: string[];
};

type PolicyGatesOptions = {
  judgmentConfig?: JudgmentConfig;
  userProfile?: UserProfile;
};

export class PolicyGates {
  private readonly judgmentConfig: JudgmentConfig | undefined;
  private readonly userProfile: UserProfile | undefined;

  constructor(options: PolicyGatesOptions = {}) {
    this.judgmentConfig = options.judgmentConfig;
    this.userProfile = options.userProfile;
  }

  evaluate(candidate: InteractionCandidate): PolicyVerdict {
    const configured = this.configuredVerdict(candidate);
    if (configured) {
      return configured;
    }

    if (candidate.blocking) {
      return {
        mayInterrupt: true,
        requiresOperatorResponse: true,
        minimumPresentation: "active",
        rationale: ["blocking interactions require explicit operator attention"],
      };
    }

    if (candidate.priority === "background") {
      return {
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
        mayInterrupt: false,
        requiresOperatorResponse: false,
        minimumPresentation: "ambient",
        rationale: ["non-critical status work should start in the periphery"],
      };
    }

    return {
      mayInterrupt: true,
      requiresOperatorResponse: false,
      minimumPresentation: "queue",
      rationale: ["urgent non-blocking work may compete for interruptive attention"],
    };
  }

  private configuredVerdict(candidate: InteractionCandidate): PolicyVerdict | null {
    const toolFamily = inferToolFamily(candidate);
    const toolOverride = toolFamily
      ? this.userProfile?.overrides?.tools?.[toolFamily]
      : undefined;
    const policyRule = this.matchPolicyRule(candidate);

    const minimumPresentation = readMinimumPresentation(toolOverride?.defaultPresentation)
      ?? policyRule?.minimumPresentation
      ?? (toolOverride?.requireContextExpansion ? "active" : undefined);
    const mayInterrupt = policyRule?.mayInterrupt;
    const requiresOperatorResponse =
      candidate.blocking
      || minimumPresentation === "active"
      || toolOverride?.requireContextExpansion === true;

    if (minimumPresentation === undefined && mayInterrupt === undefined && !toolOverride) {
      return null;
    }

    const rationale: string[] = [];
    if (toolFamily && toolOverride) {
      rationale.push(`user override applies for ${toolFamily} interactions`);
    }
    if (policyRule) {
      rationale.push("configured judgment policy applies to this interaction");
    }

    return {
      mayInterrupt: mayInterrupt ?? minimumPresentation === "active",
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
  const value = `${candidate.title} ${candidate.summary ?? ""} ${candidate.context?.items?.map((item) => item.value ?? "").join(" ") ?? ""}`.toLowerCase();

  if (candidate.consequence === "low" && value.includes("read")) {
    tags.push("lowRiskRead");
  }

  if (value.includes(".env")) {
    tags.push("envWrite");
  }

  if ((value.includes("shell command") || value.includes("run")) && candidate.consequence === "high") {
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
