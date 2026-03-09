import type { Frame } from "./frame.js";
import type { InteractionCandidate, InteractionPriority } from "./interaction-candidate.js";

export function scoreCandidate(candidate: InteractionCandidate): number {
  return (
    priorityWeight(candidate.priority) * 100 +
    consequenceWeight(candidate.consequence) * 10 +
    toneWeight(candidate.tone) +
    (candidate.blocking ? 1000 : 0) +
    (candidate.attentionScoreOffset ?? 0)
  );
}

export function scoreFrame(frame: Frame): number {
  return (
    priorityWeight(priorityForFrame(frame)) * 100 +
    consequenceWeight(frame.consequence) * 10 +
    toneWeight(frame.tone) +
    (isBlockingFrame(frame) ? 1000 : 0) +
    readFrameAttentionOffset(frame)
  );
}

export function priorityForFrame(frame: Frame): InteractionPriority {
  if (frame.mode === "status") {
    if (frame.tone === "critical" || frame.consequence === "high") {
      return "high";
    }
    if (frame.tone === "focused" || frame.consequence === "medium") {
      return "normal";
    }
    return "background";
  }

  return "high";
}

export function readFrameAttentionOffset(frame: Frame): number {
  const attention = frame.metadata?.attention;
  if (
    attention &&
    typeof attention === "object" &&
    "scoreOffset" in attention &&
    typeof attention.scoreOffset === "number"
  ) {
    return attention.scoreOffset;
  }

  return 0;
}

export function isBlockingFrame(frame: Frame): boolean {
  return frame.mode !== "status" && frame.responseSpec?.kind !== "none";
}

function priorityWeight(priority: InteractionPriority): number {
  switch (priority) {
    case "background":
      return 0;
    case "normal":
      return 1;
    case "high":
      return 2;
  }
}

function consequenceWeight(consequence: Frame["consequence"]): number {
  switch (consequence) {
    case "low":
      return 0;
    case "medium":
      return 1;
    case "high":
      return 2;
  }
}

function toneWeight(tone: Frame["tone"]): number {
  switch (tone) {
    case "ambient":
      return 0;
    case "focused":
      return 1;
    case "critical":
      return 2;
  }
}
