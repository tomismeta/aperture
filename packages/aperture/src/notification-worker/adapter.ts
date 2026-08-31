import { createHash } from "node:crypto";

import type { SourceEvent } from "@tomismeta/aperture-core";

import type { NotificationUpsertInput } from "./protocol.js";

export const NOTIFICATION_PUBLIC_SUMMARY =
  "Desktop notification received from a reviewed agent application.";
export const NOTIFICATION_CORE_TITLE = "Reviewed agent application notification";
export function notificationCoreSummary(keyHash: string): string {
  return `Desktop notification event ${keyHash}`;
}

export type NotificationWorkerIdentity = {
  id: string;
  kind: string;
  label: string;
  applicationNames?: string[];
  desktopEntries?: string[];
};

export type MappedNotificationEvent = {
  key: string;
  occurredAt: string;
  taskId: string;
  interactionId: string;
  displayTitle: string;
  sourceEvent: SourceEvent;
};

export function mapNotificationToSourceEvent(
  input: NotificationUpsertInput,
  identities: NotificationWorkerIdentity[],
): MappedNotificationEvent | null {
  const identity = matchNotificationIdentity(input, identities);
  if (!identity) return null;

  const keyHash = createHash("sha256").update(input.key).digest("hex").slice(0, 24);
  const taskId = `desktop-notification:${identity.id}:${keyHash}`;
  const interactionId = `interaction:${taskId}:status`;
  const title = redactNotificationText(input.summary, 200);
  if (!title) return null;

  return {
    key: input.key,
    occurredAt: input.occurredAt,
    taskId,
    interactionId,
    displayTitle: title,
    sourceEvent: {
      id: `notification:${identity.id}:${keyHash}:${createHash("sha256")
        .update(`${input.type}:${input.occurredAt}:${input.summary}`)
        .digest("hex")
        .slice(0, 16)}`,
      taskId,
      timestamp: input.occurredAt,
      type: "task.updated",
      title: NOTIFICATION_CORE_TITLE,
      summary: notificationCoreSummary(keyHash),
      status: "waiting",
      activityClass: "status_update",
      source: {
        id: identity.id,
        kind: identity.kind,
        label: identity.label,
      },
      metadata: {
        notificationUrgency: input.urgency,
      },
    },
  };
}

export function matchNotificationIdentity(
  input: NotificationUpsertInput,
  identities: NotificationWorkerIdentity[],
): NotificationWorkerIdentity | null {
  const applicationName = input.application.name;
  const desktopEntry = input.application.desktopEntry ?? "";

  for (const identity of identities) {
    const names = identity.applicationNames ?? [];
    if (names.some((value) => value === applicationName)) return identity;
    const entries = identity.desktopEntries ?? [];
    if (desktopEntry && entries.some((value) => value === desktopEntry)) {
      return identity;
    }
  }
  return null;
}

export function redactNotificationText(value: string, maximum: number): string {
  const withoutControlCharacters = value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(
      /\b(api[_-]?key|access[_-]?token|auth[_-]?token|token|password|secret)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[redacted]",
    )
    .replace(/(?:\/Users|\/home)\/[A-Za-z0-9._-]+\/[A-Za-z0-9_./-]+/g, "[private-path]")
    .replace(/~\/[A-Za-z0-9_./-]+/g, "[private-path]")
    .replace(/https?:\/\/[^\s]+/gi, (rawUrl) => {
      try {
        const parsed = new URL(rawUrl);
        parsed.search = "";
        parsed.hash = "";
        return parsed.toString();
      } catch {
        return "[url]";
      }
    })
    .replace(/\s+/g, " ")
    .trim();
  const characters = Array.from(withoutControlCharacters);
  if (characters.length <= maximum) return withoutControlCharacters;
  return `${characters.slice(0, Math.max(0, maximum - 1)).join("")}…`;
}
