import type {
  SourceEvent,
  SourceHumanInputRequestedEvent,
  SourceTaskUpdatedEvent,
} from "@tomismeta/aperture-core";

import type { OpencodeMessagePartUpdatedEvent, OpencodeSseMessage } from "./types.js";
import {
  createOpencodeInstanceKey,
  normalizeTaskStatus,
  opencodeSource,
  opencodeTaskId,
  readString,
  type OpencodeMappingContext,
} from "./mapping-shared.js";

type HumanInputSemanticHints = NonNullable<SourceHumanInputRequestedEvent["semanticHints"]>;
type TaskUpdateSemanticHints = NonNullable<SourceTaskUpdatedEvent["semanticHints"]>;

export function mapSessionStatus(
  event: Extract<OpencodeSseMessage, { type: "session.status" }>,
  context: OpencodeMappingContext,
): SourceEvent[] {
  const instanceKey = createOpencodeInstanceKey(context);
  const sessionId = readString(event.properties.sessionID);
  const status = normalizeTaskStatus(readSessionStatus(event.properties.status));
  if (!sessionId || !status) {
    return [];
  }

  const reason = reasonText(event);
  const update: SourceEvent = {
    id: `opencode:${instanceKey}:event:session.status:${encodeURIComponent(sessionId)}:${encodeURIComponent(status)}:${Date.now()}`,
    type: "task.updated",
    taskId: opencodeTaskId(instanceKey, sessionId),
    timestamp: new Date().toISOString(),
    source: opencodeSource(context),
    activityClass: "session_status",
    semanticHints: sessionStatusSemanticHints(reason),
    title: `OpenCode session ${status}`,
    status,
  };
  if (reason) {
    update.summary = reason;
  }
  return [update];
}

export function mapMessagePartUpdated(
  event: OpencodeMessagePartUpdatedEvent,
  context: OpencodeMappingContext,
): SourceEvent[] {
  const part = event.properties.part;
  const sessionId = readString(event.properties.sessionID) ?? readString(part?.sessionID);
  const partType = readString(part?.type);
  const state = readPartState(part);
  const instanceKey = createOpencodeInstanceKey(context);
  if (!sessionId || !partType) {
    return [];
  }

  if (partType === "text") {
    const text = readString(part?.text);
    if (text && context.messageRole === "assistant" && looksLikeFollowUpQuestion(text)) {
      const partId =
        readString(part?.id) ?? readString(event.properties.partID) ?? `${Date.now()}`;
      const whyNow = followUpWhyNow("OpenCode");
      return [
        {
          id: `opencode:${instanceKey}:event:message.part.updated:${encodeURIComponent(partId)}:follow-up`,
          type: "human.input.requested",
          taskId: opencodeTaskId(instanceKey, sessionId),
          interactionId: opencodeFollowUpInteractionId(instanceKey, sessionId, partId),
          timestamp: new Date().toISOString(),
          source: opencodeSource(context),
          activityClass: "follow_up",
          title: "OpenCode is waiting for your reply",
          summary: text,
          request: {
            kind: "form",
            fields: [
              {
                id: "reply",
                label: "Reply",
                type: "textarea",
                required: true,
              },
            ],
          },
          semanticHints: followUpRequestSemanticHints(whyNow),
          provenance: {
            whyNow,
          },
          riskHint: "medium",
          context: {
            items: [
              { id: "sessionId", label: "Session ID", value: sessionId },
              { id: "partId", label: "Part ID", value: partId },
            ],
          },
        },
      ];
    }
  }

  if (!state) {
    return [];
  }

  if (state === "error" || state === "failed") {
    return [
      {
        id: `opencode:${instanceKey}:event:message.part.updated:${encodeURIComponent(readString(event.properties.partID) ?? `${Date.now()}`)}`,
        type: "task.updated",
        taskId: opencodeTaskId(instanceKey, sessionId),
        timestamp: new Date().toISOString(),
        source: opencodeSource(context),
        activityClass: "tool_failure",
        semanticHints: taskActivitySemanticHints("tool_failure"),
        title: "OpenCode tool step failed",
        summary: `${partType} reported ${state}.`,
        status: "failed",
      },
    ];
  }

  return [];
}

function followUpRequestSemanticHints(whyNow: string): HumanInputSemanticHints {
  return {
    intentFrame: "question_request",
    activityClass: "follow_up",
    whyNow,
    confidence: "high",
  };
}

function followUpWhyNow(sourceLabel: string): string {
  return `${sourceLabel} asked a follow-up question and is waiting for a reply.`;
}

function sessionStatusSemanticHints(whyNow: string | undefined): TaskUpdateSemanticHints {
  return {
    activityClass: "session_status",
    ...(whyNow !== undefined ? { whyNow } : {}),
    confidence: "high",
  };
}

function taskActivitySemanticHints(
  activityClass: NonNullable<SourceTaskUpdatedEvent["activityClass"]>,
): TaskUpdateSemanticHints {
  return {
    activityClass,
    confidence: "high",
  };
}

function reasonText(
  event: { properties: { reason?: unknown; status?: unknown } },
): string | undefined {
  return readString(event.properties.reason) ?? readStatusReason(event.properties.status);
}

function readSessionStatus(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object") {
    const status = value as Record<string, unknown>;
    return readString(status.type);
  }
  return undefined;
}

function readStatusReason(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const status = value as Record<string, unknown>;
  return readString(status.reason) ?? readString(status.message);
}

function readPartState(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const part = value as Record<string, unknown>;
  if (typeof part.state === "string") {
    return part.state;
  }
  if (part.state && typeof part.state === "object") {
    return readString((part.state as Record<string, unknown>).status);
  }
  return readString(part.status);
}

function opencodeFollowUpInteractionId(
  instanceKey: string,
  sessionId: string,
  partId: string,
): string {
  return `opencode:${instanceKey}:followup:${encodeURIComponent(sessionId)}|${encodeURIComponent(partId)}`;
}

function looksLikeFollowUpQuestion(value: string): boolean {
  const lines = value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const lastLine = lines.at(-1) ?? value.trim();
  return /\?\s*$/.test(lastLine);
}
