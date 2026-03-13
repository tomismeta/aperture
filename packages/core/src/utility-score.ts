import type { Frame } from "./frame.js";
import { readFrameAttentionOffset, scoreCandidate, scoreFrame } from "./frame-score.js";
import type { InteractionCandidate } from "./interaction-candidate.js";
import type { MemoryProfile } from "./profile-store.js";

export type UtilityBreakdown = {
  total: number;
  components: {
    priority: number;
    consequence: number;
    tone: number;
    blocking: number;
    learnedAdjustment: number;
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
    const components = {
      priority: priorityWeight(candidate.priority) * 100,
      consequence: consequenceWeight(candidate.consequence) * 10,
      tone: toneWeight(candidate.tone),
      blocking: candidate.blocking ? 1000 : 0,
      learnedAdjustment: (candidate.attentionScoreOffset ?? 0) + sourceTrustAdjustment,
    };

    const rationale = candidate.attentionRationale ? [...candidate.attentionRationale] : [];
    if (sourceTrustAdjustment !== 0) {
      rationale.push("durable source trust adjusts this interaction's utility");
    }

    return {
      total: components.priority + components.consequence + components.tone + components.blocking + components.learnedAdjustment,
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
