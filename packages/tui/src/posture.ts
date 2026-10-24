import type { AttentionPressure, Posture } from "./types.js";

export function computePosture(pressure: AttentionPressure): Posture {
  switch (pressure.level) {
    case "high":
      return "busy";
    case "elevated":
      return "elevated";
    default:
      return "calm";
  }
}
