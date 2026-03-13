import type { Frame } from "./frame.js";
import { readFrameAttentionOffset, scoreCandidate, scoreFrame } from "./frame-score.js";
import type { InteractionCandidate } from "./interaction-candidate.js";
import { inferToolFamily } from "./interaction-taxonomy.js";
import type { MemoryProfile } from "./profile-store.js";

export type UtilityBreakdown = {
  total: number;
  components: {
    priority: number;
    consequence: number;
    tone: number;
    blocking: number;
    heuristics: number;
    sourceTrust: number;
    responseAffinity: number;
    contextCost: number;
    deferralAffinity: number;
  };
  rationale: string[];
};

export type FrameUtilityBreakdown = {
  total: number;
  components: {
    attentionAdjustment: number;
  };
};

type UtilityFrameOptions = {
  now?: string;
};

type UtilityScoreOptions = {
  memoryProfile?: MemoryProfile;
};

export class UtilityScore {
  private readonly memoryProfile: MemoryProfile | undefined;

  constructor(options: UtilityScoreOptions = {}) {
    this.memoryProfile = options.memoryProfile;
  }

  scoreCandidate(candidate: InteractionCandidate): UtilityBreakdown {
    const sourceTrustAdjustment = this.sourceTrustAdjustment(candidate);
    const responseAffinity = this.responseAffinityAdjustment(candidate);
    const contextCost = this.contextCostAdjustment(candidate);
    const deferralAffinity = this.deferralAffinityAdjustment(candidate);
    const components = {
      priority: priorityWeight(candidate.priority) * 100,
      consequence: consequenceWeight(candidate.consequence) * 10,
      tone: toneWeight(candidate.tone),
      blocking: candidate.blocking ? 1000 : 0,
      heuristics: candidate.attentionScoreOffset ?? 0,
      sourceTrust: sourceTrustAdjustment,
      responseAffinity,
      contextCost,
      deferralAffinity,
    };

    const rationale = candidate.attentionRationale ? [...candidate.attentionRationale] : [];
    if (sourceTrustAdjustment !== 0) {
      rationale.push("durable source trust adjusts this interaction's utility");
    }
    if (responseAffinity > 0) {
      rationale.push("memory suggests this kind of interaction usually resolves quickly");
    }
    if (contextCost < 0) {
      rationale.push("memory suggests this interaction usually needs extra context before action");
    }
    if (deferralAffinity > 0) {
      rationale.push("memory suggests deferred interactions of this kind are usually resumed");
    }

    return {
      total:
        components.priority
        + components.consequence
        + components.tone
        + components.blocking
        + components.heuristics
        + components.sourceTrust
        + components.responseAffinity
        + components.contextCost
        + components.deferralAffinity,
      components,
      rationale,
    };
  }

  scoreFrame(frame: Frame, options: UtilityFrameOptions = {}): FrameUtilityBreakdown {
    return {
      total: scoreFrame(frame, options),
      components: {
        attentionAdjustment: readFrameAttentionOffset(frame),
      },
    };
  }

  private sourceTrustAdjustment(candidate: InteractionCandidate): number {
    const sourceKey = candidate.source?.kind ?? candidate.source?.id;
    if (!sourceKey) {
      return 0;
    }

    return this.memoryProfile?.sourceTrust?.[sourceKey]?.[candidate.consequence]?.trustAdjustment ?? 0;
  }

  private responseAffinityAdjustment(candidate: InteractionCandidate): number {
    const toolFamily = inferToolFamily(candidate);
    if (!toolFamily) {
      return 0;
    }

    const memory = this.memoryProfile?.toolFamilies?.[toolFamily];
    if (!memory || memory.avgResponseLatencyMs === undefined) {
      return 0;
    }

    if (memory.avgResponseLatencyMs <= 2_000) {
      return 8;
    }

    if (memory.avgResponseLatencyMs <= 5_000) {
      return 4;
    }

    return 0;
  }

  private contextCostAdjustment(candidate: InteractionCandidate): number {
    const toolFamily = inferToolFamily(candidate);
    if (!toolFamily) {
      return 0;
    }

    const rate = this.memoryProfile?.toolFamilies?.[toolFamily]?.contextExpansionRate;
    if (rate === undefined) {
      return 0;
    }

    if (rate >= 0.6) {
      return -6;
    }

    if (rate >= 0.3) {
      return -3;
    }

    return 0;
  }

  private deferralAffinityAdjustment(candidate: InteractionCandidate): number {
    const toolFamily = inferToolFamily(candidate);
    if (!toolFamily) {
      return 0;
    }

    const rate = this.memoryProfile?.toolFamilies?.[toolFamily]?.returnAfterDeferralRate;
    if (rate === undefined) {
      return 0;
    }

    if (rate >= 0.6) {
      return 6;
    }

    if (rate >= 0.3) {
      return 3;
    }

    return 0;
  }
}

function priorityWeight(priority: InteractionCandidate["priority"]): number {
  switch (priority) {
    case "background":
      return 0;
    case "normal":
      return 1;
    case "high":
      return 2;
  }
}

function consequenceWeight(consequence: InteractionCandidate["consequence"]): number {
  switch (consequence) {
    case "low":
      return 0;
    case "medium":
      return 1;
    case "high":
      return 2;
  }
}

function toneWeight(tone: InteractionCandidate["tone"]): number {
  switch (tone) {
    case "ambient":
      return 0;
    case "focused":
      return 1;
    case "critical":
      return 2;
  }
}
