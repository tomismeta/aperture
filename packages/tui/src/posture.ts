import { forecastAttentionPressure } from "@tomismeta/aperture-core";
import type { SignalSummary, AttentionView, Posture } from "./types.js";

export function computePosture(
  summary: SignalSummary,
  view: AttentionView,
): Posture {
  const pressure = forecastAttentionPressure(summary, view);

  switch (pressure.level) {
    case "high":
      return "busy";
    case "elevated":
      return "elevated";
    default:
      return "calm";
  }
}
