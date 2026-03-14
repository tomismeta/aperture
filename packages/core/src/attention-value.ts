import type { AttentionFrame } from "./frame.js";
import { readFrameAttentionOffset, scoreCandidate, scoreAttentionFrame } from "./frame-score.js";
import type { AttentionCandidate } from "./interaction-candidate.js";
import { inferToolFamily } from "./interaction-taxonomy.js";
import type { MemoryProfile } from "./profile-store.js";

export type AttentionValueBreakdown = {
  total: number;
  components: {
    priority: number;
    consequence: number;
    tone: number;
    blocking: number;
    heuristics: number;
    sourceTrust: number;
    consequenceCalibration: number;
    responseAffinity: number;
    contextCost: number;
    deferralAffinity: number;
  };
  rationale: string[];
};

export type AttentionFrameValueBreakdown = {
  total: number;
  components: {
    attentionAdjustment: number;
  };
};

type UtilityFrameOptions = {
  now?: string;
};

type AttentionValueOptions = {
  memoryProfile?: MemoryProfile;
};

export class AttentionValue {
  private readonly memoryProfile: MemoryProfile | undefined;

  constructor(options: AttentionValueOptions = {}) {
    this.memoryProfile = options.memoryProfile;
  }

  scoreCandidate(candidate: AttentionCandidate): AttentionValueBreakdown {
    const sourceTrustAdjustment = this.sourceTrustAdjustment(candidate);
    const consequenceCalibration = this.consequenceCalibrationAdjustment(candidate);
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
      consequenceCalibration,
      responseAffinity,
      contextCost,
      deferralAffinity,
    };

    const rationale = candidate.attentionRationale ? [...candidate.attentionRationale] : [];
    if (sourceTrustAdjustment !== 0) {
      rationale.push("durable source trust adjusts this interaction's utility");
    }
    if (consequenceCalibration > 0) {
      rationale.push("memory suggests this consequence band is often understated and deserves more attention");
    }
    if (consequenceCalibration < 0) {
      rationale.push("memory suggests this consequence band is often overstated and should be tempered");
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
        + components.consequenceCalibration
        + components.responseAffinity
        + components.contextCost
        + components.deferralAffinity,
      components,
      rationale,
    };
  }

  scoreAttentionFrame(
    frame: AttentionFrame,
    options: UtilityFrameOptions = {},
  ): AttentionFrameValueBreakdown {
    return {
      total: scoreAttentionFrame(frame, options),
      components: {
        attentionAdjustment: readFrameAttentionOffset(frame),
      },
    };
  }

  private sourceTrustAdjustment(candidate: AttentionCandidate): number {
    const sourceKey = candidate.source?.kind ?? candidate.source?.id;
    if (!sourceKey) {
      return 0;
    }

    return this.memoryProfile?.sourceTrust?.[sourceKey]?.[candidate.consequence]?.trustAdjustment ?? 0;
  }

  private responseAffinityAdjustment(candidate: AttentionCandidate): number {
    const toolFamily = inferToolFamily(candidate);
    if (!toolFamily) {
      return 0;
    }

    const memory = this.memoryProfile?.toolFamilies?.[toolFamily];
    if (!memory || memory.avgResponseLatencyMs === undefined || memory.presentations < 3 || memory.responses < 3) {
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

  private consequenceCalibrationAdjustment(candidate: AttentionCandidate): number {
    const profile = this.memoryProfile?.consequenceProfiles?.[candidate.consequence];
    const rejectionRate = profile?.rejectionRate;
    if (rejectionRate === undefined || (profile?.reviewedCount ?? 0) < 4) {
      return 0;
    }

    switch (candidate.consequence) {
      case "low":
        if (rejectionRate >= 0.5) {
          return 8;
        }
        if (rejectionRate >= 0.25) {
          return 4;
        }
        return 0;
      case "medium":
        if (rejectionRate >= 0.5) {
          return 4;
        }
        if (rejectionRate >= 0.25) {
          return 2;
        }
        return 0;
      case "high":
        if (rejectionRate >= 0.5) {
          return -4;
        }
        if (rejectionRate >= 0.25) {
          return -2;
        }
        return 0;
    }
  }

  private contextCostAdjustment(candidate: AttentionCandidate): number {
    const toolFamily = inferToolFamily(candidate);
    if (!toolFamily) {
      return 0;
    }

    const rate = this.memoryProfile?.toolFamilies?.[toolFamily]?.contextExpansionRate;
    if (rate === undefined || (this.memoryProfile?.toolFamilies?.[toolFamily]?.presentations ?? 0) < 3) {
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

  private deferralAffinityAdjustment(candidate: AttentionCandidate): number {
    const toolFamily = inferToolFamily(candidate);
    if (!toolFamily) {
      return 0;
    }

    const rate = this.memoryProfile?.toolFamilies?.[toolFamily]?.returnAfterDeferralRate;
    if (rate === undefined || (this.memoryProfile?.toolFamilies?.[toolFamily]?.presentations ?? 0) < 3) {
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

function priorityWeight(priority: AttentionCandidate["priority"]): number {
  switch (priority) {
    case "background":
      return 0;
    case "normal":
      return 1;
    case "high":
      return 2;
  }
}

function consequenceWeight(consequence: AttentionCandidate["consequence"]): number {
  switch (consequence) {
    case "low":
      return 0;
    case "medium":
      return 1;
    case "high":
      return 2;
  }
}

function toneWeight(tone: AttentionCandidate["tone"]): number {
  switch (tone) {
    case "ambient":
      return 0;
    case "focused":
      return 1;
    case "critical":
      return 2;
  }
}
