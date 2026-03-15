import type { AttentionOperatorPresence } from "./attention-evidence.js";
import { JUDGMENT_DEFAULTS } from "./judgment-defaults.js";
import type { AttentionPressure } from "./attention-pressure.js";
import type { AttentionSignalSummary } from "./signal-summary.js";
import type { AttentionState } from "./attention-state.js";

export type AttentionBurden = {
  level: "light" | "elevated" | "high";
  thresholdOffset: number;
  metrics: {
    recentDecisions: number;
    deferredCount: number;
    averageResponseLatencyMs: number | null;
    interruptiveVisible: number;
    pressureLevel: AttentionPressure["level"];
    attentionState: AttentionState;
  };
  reasons: string[];
};

export function deriveAttentionBurden(
  summary: AttentionSignalSummary | undefined,
  pressure: AttentionPressure | undefined,
  attentionState: AttentionState | undefined,
  operatorPresence: AttentionOperatorPresence = "present",
): AttentionBurden {
  if (operatorPresence === "absent") {
    return idleAttentionBurden();
  }

  const defaults = JUDGMENT_DEFAULTS.attentionBudget;
  const recentDecisions =
    (summary?.counts.responded ?? 0)
    + (summary?.counts.dismissed ?? 0)
    + (summary?.counts.deferred ?? 0)
    + (summary?.counts.contextExpanded ?? 0)
    + (summary?.counts.contextSkipped ?? 0);
  const deferredCount = summary?.counts.deferred ?? 0;
  const averageResponseLatencyMs = summary?.averageResponseLatencyMs ?? null;
  const interruptiveVisible = pressure?.metrics.interruptiveVisible ?? 0;
  const resolvedAttentionState = attentionState ?? "monitoring";
  const pressureLevel = pressure?.level ?? "steady";
  const reasons: string[] = [];
  let score = 0;

  if (pressureLevel === "high") {
    score += 2;
    reasons.push("current pressure is already high");
  } else if (pressureLevel === "elevated") {
    score += 1;
    reasons.push("current pressure is elevated");
  }

  if (resolvedAttentionState === "overloaded") {
    score += 2;
    reasons.push("recent operator behavior indicates overload");
  } else if (resolvedAttentionState === "hesitating" || resolvedAttentionState === "avoiding") {
    score += 1;
    reasons.push("recent operator behavior suggests attention is already strained");
  }

  if (recentDecisions >= defaults.recentDecisions.highCount) {
    score += 2;
    reasons.push("recent decision volume is high");
  } else if (recentDecisions >= defaults.recentDecisions.elevatedCount) {
    score += 1;
    reasons.push("recent decision volume is climbing");
  }

  if (averageResponseLatencyMs !== null && averageResponseLatencyMs >= defaults.responseLatencyMs.high) {
    score += 2;
    reasons.push("recent decision latency is slow");
  } else if (
    averageResponseLatencyMs !== null
    && averageResponseLatencyMs >= defaults.responseLatencyMs.elevated
  ) {
    score += 1;
    reasons.push("recent decision latency is rising");
  }

  if (deferredCount >= defaults.deferredCount.high) {
    score += 2;
    reasons.push("recent deferrals are accumulating");
  } else if (deferredCount >= defaults.deferredCount.elevated) {
    score += 1;
    reasons.push("recent deferrals suggest active burden");
  }

  if (interruptiveVisible >= defaults.interruptiveVisible.high) {
    score += 2;
    reasons.push("multiple interruptive frames are already visible");
  } else if (interruptiveVisible >= defaults.interruptiveVisible.elevated) {
    score += 1;
    reasons.push("interruptive work is already visible");
  }

  return {
    level:
      score >= defaults.scoreBands.highScore
        ? "high"
        : score >= defaults.scoreBands.elevatedScore
          ? "elevated"
          : "light",
    thresholdOffset:
      score >= defaults.scoreBands.highScore
        ? defaults.thresholdOffset.high
        : score >= defaults.scoreBands.elevatedScore
          ? defaults.thresholdOffset.elevated
          : 0,
    metrics: {
      recentDecisions,
      deferredCount,
      averageResponseLatencyMs,
      interruptiveVisible,
      pressureLevel,
      attentionState: resolvedAttentionState,
    },
    reasons,
  };
}

export function idleAttentionBurden(): AttentionBurden {
  return {
    level: "light",
    thresholdOffset: 0,
    metrics: {
      recentDecisions: 0,
      deferredCount: 0,
      averageResponseLatencyMs: null,
      interruptiveVisible: 0,
      pressureLevel: "steady",
      attentionState: "monitoring",
    },
    reasons: [],
  };
}
