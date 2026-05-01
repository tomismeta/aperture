import type { AttentionResponse } from "@tomismeta/aperture-core";

import type { OpencodePermissionDecision, OpencodeSseMessage } from "./types.js";
import {
  createOpencodeInstanceKey,
  opencodeInteractionId,
  opencodeTaskId,
  parseOpencodeInteractionId,
  parseOpencodeTaskSessionId,
  readString,
  type OpencodeMappingContext,
  type OpencodeResponseAction,
} from "./mapping-shared.js";

export type OpencodeNativeResolution = {
  response: AttentionResponse;
};

export function mapOpencodeNativeResolution(
  event: OpencodeSseMessage,
  context: OpencodeMappingContext,
): OpencodeNativeResolution | null {
  const instanceKey = createOpencodeInstanceKey(context);
  switch (event.type) {
    case "permission.replied": {
      const requestId =
        readString(event.properties.requestID) ?? readString(event.properties.id);
      if (!requestId) {
        return null;
      }
      const taskId = opencodeTaskId(
        instanceKey,
        readString(event.properties.sessionID),
        requestId,
      );
      const interactionId = opencodeInteractionId(instanceKey, "permission", requestId);
      const reply = normalizePermissionDecision(event.properties.reply);
      return {
        response: {
          taskId,
          interactionId,
          response:
            reply === "reject"
              ? rejectedResponse(readString(event.properties.message))
              : { kind: "approved" },
        },
      };
    }
    case "question.replied": {
      const requestId =
        readString(event.properties.requestID) ?? readString(event.properties.id);
      if (!requestId) {
        return null;
      }
      const taskId = opencodeTaskId(
        instanceKey,
        readString(event.properties.sessionID),
        requestId,
      );
      const interactionId = opencodeInteractionId(instanceKey, "question", requestId);
      return {
        response: {
          taskId,
          interactionId,
          response: { kind: "acknowledged" },
        },
      };
    }
    case "question.rejected": {
      const requestId =
        readString(event.properties.requestID) ?? readString(event.properties.id);
      if (!requestId) {
        return null;
      }
      const taskId = opencodeTaskId(
        instanceKey,
        readString(event.properties.sessionID),
        requestId,
      );
      const interactionId = opencodeInteractionId(instanceKey, "question", requestId);
      return {
        response: {
          taskId,
          interactionId,
          response: rejectedResponse(readString(event.properties.message)),
        },
      };
    }
    default:
      return null;
  }
}

export function mapOpencodeResponse(
  response: AttentionResponse,
): OpencodeResponseAction | null {
  const parsed = parseOpencodeInteractionId(response.interactionId);
  if (!parsed) {
    return null;
  }

  if (parsed.kind === "permission") {
    switch (response.response.kind) {
      case "approved":
        return {
          kind: "permission.reply",
          requestId: parsed.requestId,
          ...(parseOpencodeTaskSessionId(response.taskId)
            ? { sessionId: parseOpencodeTaskSessionId(response.taskId)! }
            : {}),
          body: { reply: "once" },
        };
      case "rejected":
        return {
          kind: "permission.reply",
          requestId: parsed.requestId,
          ...(parseOpencodeTaskSessionId(response.taskId)
            ? { sessionId: parseOpencodeTaskSessionId(response.taskId)! }
            : {}),
          body: {
            reply: "reject",
            message: response.response.reason ?? "Rejected in Aperture.",
          },
        };
      case "dismissed":
      case "acknowledged":
        return {
          kind: "permission.reply",
          requestId: parsed.requestId,
          ...(parseOpencodeTaskSessionId(response.taskId)
            ? { sessionId: parseOpencodeTaskSessionId(response.taskId)! }
            : {}),
          body: {
            reply: "reject",
            message: "Dismissed in Aperture.",
          },
        };
      case "option_selected":
      case "form_submitted":
      case "text_submitted":
        return null;
    }
  }

  if (parsed.kind === "followup") {
    switch (response.response.kind) {
      case "text_submitted": {
        const text = response.response.text.trim();
        if (text.length === 0) {
          return null;
        }
        return followUpSessionPrompt(parsed.sessionId, text);
      }
      case "form_submitted": {
        const text = extractFollowUpReplyText(response.response.values);
        return text ? followUpSessionPrompt(parsed.sessionId, text) : null;
      }
      case "approved":
      case "acknowledged":
      case "rejected":
      case "dismissed":
      case "option_selected":
        return null;
    }
  }

  switch (response.response.kind) {
    case "option_selected":
      return {
        kind: "question.reply",
        requestId: parsed.requestId,
        body: {
          answers: [response.response.optionIds],
        },
      };
    case "text_submitted":
      return {
        kind: "question.reply",
        requestId: parsed.requestId,
        body: {
          answers: [[response.response.text]],
        },
      };
    case "form_submitted":
      return {
        kind: "question.reply",
        requestId: parsed.requestId,
        body: {
          answers: Object.values(response.response.values).map((value) =>
            normalizeAnswerGroup(value),
          ),
        },
      };
    case "rejected":
    case "dismissed":
      return {
        kind: "question.reject",
        requestId: parsed.requestId,
        body: {
          ...(response.response.kind === "rejected" && response.response.reason
            ? { message: response.response.reason }
            : {}),
        },
      };
    case "approved":
    case "acknowledged":
      return null;
  }
}

function normalizePermissionDecision(value: unknown): OpencodePermissionDecision | null {
  return value === "once" || value === "always" || value === "reject" ? value : null;
}

function followUpSessionPrompt(
  sessionId: string,
  text: string,
): OpencodeResponseAction {
  return {
    kind: "session.prompt",
    sessionId,
    body: {
      parts: [
        {
          type: "text",
          text,
          metadata: {
            source: "aperture",
            interaction: "follow_up",
          },
        },
      ],
    },
  };
}

function normalizeAnswerGroup(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry));
  }
  if (value === null || value === undefined) {
    return [];
  }
  return [String(value)];
}

function extractFollowUpReplyText(values: Record<string, unknown>): string | null {
  const preferred = values.reply;
  if (typeof preferred === "string" && preferred.trim() !== "") {
    return preferred.trim();
  }

  for (const value of Object.values(values)) {
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
    if (Array.isArray(value)) {
      const joined = value
        .map((entry) => String(entry).trim())
        .filter((entry) => entry.length > 0)
        .join(", ");
      if (joined.length > 0) {
        return joined;
      }
    }
    if (value !== null && value !== undefined && typeof value !== "object") {
      const scalar = String(value).trim();
      if (scalar.length > 0) {
        return scalar;
      }
    }
  }

  return null;
}

function rejectedResponse(reason: string | undefined): AttentionResponse["response"] {
  return reason ? { kind: "rejected", reason } : { kind: "rejected" };
}
