import { randomUUID } from "node:crypto";

import type { SourceEvent } from "@tomismeta/aperture-core";

import { assertSafeString } from "./work-event-safety.js";

export function mapWorkTextToSourceEvent(text: string): SourceEvent {
  const normalized = normalizeWorkText(text);
  if (normalized.length === 0) {
    throw new Error("Work text must not be empty.");
  }

  assertSafeString(normalized, "text");
  const taskId = `work:${randomUUID()}`;

  return {
    id: `evt:${randomUUID()}`,
    type: "task.updated",
    taskId,
    timestamp: new Date().toISOString(),
    title: summarizeWorkText(normalized),
    summary: normalized,
    status: "running",
  };
}

export function normalizeWorkText(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

export function summarizeWorkText(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  const firstSentence = collapsed.match(/^(.{1,96}?)(?:[.!?\n]|$)/)?.[1] ?? collapsed;
  if (firstSentence.length <= 96) {
    return firstSentence;
  }
  return `${firstSentence.slice(0, 93).trimEnd()}...`;
}
