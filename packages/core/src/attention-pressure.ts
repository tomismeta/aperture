import type { AttentionFrame, AttentionView } from "./frame.js";
import { JUDGMENT_DEFAULTS } from "./judgment-defaults.js";
import type { AttentionSignalSummary } from "./signal-summary.js";

type PressureReferenceTime = number | string | Date;

export type AttentionPressure = {
  level: "steady" | "elevated" | "high";
  overloadRisk: "low" | "rising" | "high";
  score: number;
  metrics: {
    recentDemand: number;
    interruptiveVisible: number;
    averageResponseLatencyMs: number | null;
    deferredCount: number;
    suppressedCount: number;
  };
  reasons: string[];
};

export function forecastAttentionPressure(
  summary?: AttentionSignalSummary,
  attentionView?: AttentionView,
  now?: PressureReferenceTime,
): AttentionPressure {
  const interruptiveVisible = countInterruptiveVisible(attentionView);
  const reasons: string[] = [];
  let score = 0;
  const defaults = JUDGMENT_DEFAULTS.pressureForecast;
  const lastSignalAgeMs = getLastSignalAgeMs(summary, now);
  const demandFresh = lastSignalAgeMs === null || lastSignalAgeMs <= defaults.freshness.demandMs;
  const residualFresh = lastSignalAgeMs === null || lastSignalAgeMs <= defaults.freshness.residualMs;
  const recentDemand = demandFresh
    ? (summary?.counts.presented ?? 0) + (summary?.counts.deferred ?? 0) + (summary?.counts.returned ?? 0)
    : 0;
  const averageResponseLatencyMs = residualFresh ? summary?.averageResponseLatencyMs ?? null : null;
  const deferredCount = residualFresh ? summary?.counts.deferred ?? 0 : 0;
  const suppressedCount = residualFresh ? summary?.deferred.suppressed ?? 0 : 0;
  const responseRate = residualFresh ? summary?.responseRate ?? 0 : 0;
  const presentedCount = residualFresh ? summary?.counts.presented ?? 0 : 0;

  if (interruptiveVisible >= defaults.visibleInterruptiveBoost.highCount) {
    score += 2;
    reasons.push("multiple interruptive frames are already visible");
  } else if (interruptiveVisible >= defaults.visibleInterruptiveBoost.elevatedCount) {
    score += 1;
    reasons.push("interruptive work is already visible");
  }

  if (recentDemand >= defaults.recentDemand.highCount) {
    score += 2;
    reasons.push("incoming demand is arriving quickly");
  } else if (recentDemand >= defaults.recentDemand.elevatedCount) {
    score += 1;
    reasons.push("incoming demand is climbing");
  }

  if (averageResponseLatencyMs !== null && averageResponseLatencyMs >= defaults.responseLatencyMs.high) {
    score += 2;
    reasons.push("recent response latency is slow");
  } else if (averageResponseLatencyMs !== null && averageResponseLatencyMs >= defaults.responseLatencyMs.elevated) {
    score += 1;
    reasons.push("recent response latency is rising");
  }

  if (
    suppressedCount >= defaults.deferredPressure.highSuppressedCount
    || deferredCount >= defaults.deferredPressure.highDeferredCount
  ) {
    score += 2;
    reasons.push("recent deferrals suggest operator capacity is tightening");
  } else if (
    suppressedCount >= defaults.deferredPressure.elevatedSuppressedCount
    || deferredCount >= defaults.deferredPressure.elevatedDeferredCount
  ) {
    score += 1;
    reasons.push("recent deferrals suggest operator capacity is tightening");
  }

  if (
    presentedCount >= defaults.slowClearance.presentedCount
    && responseRate <= defaults.slowClearance.responseRate
  ) {
    score += 1;
    reasons.push("presented work is being cleared slowly");
  }

  return {
    level:
      score >= defaults.scoreBands.highLevel
        ? "high"
        : score >= defaults.scoreBands.elevatedLevel
          ? "elevated"
          : "steady",
    overloadRisk:
      score >= defaults.scoreBands.highRisk
        ? "high"
        : score >= defaults.scoreBands.risingRisk
          ? "rising"
          : "low",
    score,
    metrics: {
      recentDemand,
      interruptiveVisible,
      averageResponseLatencyMs,
      deferredCount,
      suppressedCount,
    },
    reasons,
  };
}

function getLastSignalAgeMs(
  summary: AttentionSignalSummary | undefined,
  now: PressureReferenceTime | undefined,
): number | null {
  const lastSignalAt = summary?.lastSignalAt;
  if (!lastSignalAt || now === undefined) {
    return null;
  }

  const lastSignalMs = Date.parse(lastSignalAt);
  const referenceMs = toTimestampMs(now);
  if (Number.isNaN(lastSignalMs) || referenceMs === null) {
    return null;
  }

  return Math.max(0, referenceMs - lastSignalMs);
}

function toTimestampMs(value: PressureReferenceTime): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }

  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

export function idleAttentionPressure(): AttentionPressure {
  return {
    level: "steady",
    overloadRisk: "low",
    score: 0,
    metrics: {
      recentDemand: 0,
      interruptiveVisible: 0,
      averageResponseLatencyMs: null,
      deferredCount: 0,
      suppressedCount: 0,
    },
    reasons: [],
  };
}

function countInterruptiveVisible(attentionView?: AttentionView): number {
  if (!attentionView) {
    return 0;
  }

  return [attentionView.active, ...attentionView.queued]
    .filter((frame): frame is AttentionFrame => frame !== null)
    .filter(isInterruptive)
    .length;
}

function isInterruptive(frame: AttentionFrame): boolean {
  return frame.mode !== "status" || frame.consequence === "high" || frame.tone === "critical";
}
