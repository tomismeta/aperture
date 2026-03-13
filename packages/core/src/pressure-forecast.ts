import type { AttentionView, Frame } from "./frame.js";
import type { SignalSummary } from "./signal-summary.js";

export type PressureForecast = {
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

export function forecastPressure(
  summary?: SignalSummary,
  attentionView?: AttentionView,
): PressureForecast {
  const recentDemand =
    (summary?.counts.presented ?? 0)
    + (summary?.counts.deferred ?? 0)
    + (summary?.counts.returned ?? 0);
  const interruptiveVisible = countInterruptiveVisible(attentionView);
  const averageResponseLatencyMs = summary?.averageResponseLatencyMs ?? null;
  const deferredCount = summary?.counts.deferred ?? 0;
  const suppressedCount = summary?.deferred.suppressed ?? 0;
  const reasons: string[] = [];
  let score = 0;

  if (interruptiveVisible >= 2) {
    score += 2;
    reasons.push("multiple interruptive frames are already visible");
  } else if (interruptiveVisible >= 1) {
    score += 1;
    reasons.push("interruptive work is already visible");
  }

  if (recentDemand >= 8) {
    score += 2;
    reasons.push("incoming demand is arriving quickly");
  } else if (recentDemand >= 5) {
    score += 1;
    reasons.push("incoming demand is climbing");
  }

  if (averageResponseLatencyMs !== null && averageResponseLatencyMs >= 15_000) {
    score += 2;
    reasons.push("recent response latency is slow");
  } else if (averageResponseLatencyMs !== null && averageResponseLatencyMs >= 8_000) {
    score += 1;
    reasons.push("recent response latency is rising");
  }

  if (suppressedCount >= 2 || deferredCount >= 4) {
    score += 2;
    reasons.push("recent deferrals suggest operator capacity is tightening");
  } else if (suppressedCount >= 1 || deferredCount >= 2) {
    score += 1;
    reasons.push("recent deferrals suggest operator capacity is tightening");
  }

  if ((summary?.counts.presented ?? 0) >= 4 && (summary?.responseRate ?? 0) <= 0.3) {
    score += 1;
    reasons.push("presented work is being cleared slowly");
  }

  return {
    level: score >= 5 ? "high" : score >= 2 ? "elevated" : "steady",
    overloadRisk: score >= 6 ? "high" : score >= 3 ? "rising" : "low",
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

export function idlePressureForecast(): PressureForecast {
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
    .filter((frame): frame is Frame => frame !== null)
    .filter(isInterruptive)
    .length;
}

function isInterruptive(frame: Frame): boolean {
  return frame.mode !== "status" || frame.consequence === "high" || frame.tone === "critical";
}
