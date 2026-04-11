import type { SourceEvent } from "@tomismeta/aperture-core";

import type { OpencodeSseMessage } from "./types.js";
import { mapMessagePartUpdated, mapSessionStatus } from "./mapping-lifecycle.js";
import { mapPermissionAsked, mapQuestionAsked } from "./mapping-requests.js";
import type { OpencodeMappingContext } from "./mapping-shared.js";
export {
  mapOpencodeNativeResolution,
  mapOpencodeResponse,
  type OpencodeNativeResolution,
} from "./mapping-response.js";
export {
  createOpencodeInstanceKey,
  opencodeInteractionId,
  opencodeTaskId,
  parseOpencodeInteractionId,
  type OpencodeMappingContext,
  type OpencodeResponseAction,
} from "./mapping-shared.js";

export function mapOpencodeEvent(
  event: OpencodeSseMessage,
  context: OpencodeMappingContext,
): SourceEvent[] {
  switch (event.type) {
    case "permission.asked":
      return [
        mapPermissionAsked(
          event as Extract<OpencodeSseMessage, { type: "permission.asked" }>,
          context,
        ),
      ];
    case "question.asked":
      return [
        mapQuestionAsked(
          event as Extract<OpencodeSseMessage, { type: "question.asked" }>,
          context,
        ),
      ];
    case "session.status":
      return mapSessionStatus(
        event as Extract<OpencodeSseMessage, { type: "session.status" }>,
        context,
      );
    case "message.part.updated":
      return mapMessagePartUpdated(
        event as Extract<OpencodeSseMessage, { type: "message.part.updated" }>,
        context,
      );
    case "permission.replied":
    case "question.replied":
    case "question.rejected":
    case "server.connected":
    case "server.heartbeat":
      return [];
    default:
      return [];
  }
}
