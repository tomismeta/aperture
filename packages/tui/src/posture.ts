import { forecastAttentionPressure } from "../../core/src/attention-pressure.js";
import type { SignalSummary, AttentionView, Posture } from "./types.js";

export function computePosture(
  summary: SignalSummary,
  view: AttentionView,
): Posture {
  const pressure = forecastAttentionPressure(summary, view, Date.now());

  switch (pressure.level) {
    case "high":
      return "busy";
    case "elevated":
      return "elevated";
    default:
      return "calm";
  }
}
