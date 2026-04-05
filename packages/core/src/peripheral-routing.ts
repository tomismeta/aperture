import type { AttentionCandidate } from "./interaction-candidate.js";

export function hasBlockedLikeStatusSemantics(candidate: AttentionCandidate): boolean {
  return candidate.mode === "status" && candidate.semanticOntology?.blocking === "blocking" && !candidate.blocking;
}

export function resolvePeripheralResolutionFloor(
  candidate: AttentionCandidate,
  fallback: "queue" | "ambient",
): "queue" | "ambient" {
  if (fallback === "ambient" && hasBlockedLikeStatusSemantics(candidate)) {
    return "queue";
  }

  return fallback;
}
