import type { AttentionLane } from "./attention-policy.js";

export function readAttentionLane(value: unknown): AttentionLane | undefined {
  switch (value) {
    case "ambient":
      return "ambient";
    case "next":
    case "queue":
      return "next";
    case "now":
    case "active":
      return "now";
    default:
      return undefined;
  }
}
