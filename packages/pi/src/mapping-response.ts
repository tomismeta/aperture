import type { AttentionResponse } from "@tomismeta/aperture-core";

import { parsePiInteractionId, type PiResponseAction } from "./mapping-shared.js";

export function mapPiResponse(response: AttentionResponse): PiResponseAction | null {
  const parsed = parsePiInteractionId(response.interactionId);
  if (!parsed) {
    return null;
  }

  switch (response.response.kind) {
    case "approved":
      return {
        kind: "tool.allow",
        toolCallId: parsed.toolCallId,
      };
    case "rejected":
      return {
        kind: "tool.block",
        toolCallId: parsed.toolCallId,
        reason: response.response.reason ?? "Rejected by operator.",
      };
    case "dismissed":
      return {
        kind: "tool.block",
        toolCallId: parsed.toolCallId,
        reason: "Dismissed by operator.",
      };
    default:
      return null;
  }
}
