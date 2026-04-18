import type {
  SourceEvent,
  SourceHumanInputRequestedEvent,
  SourceTaskUpdatedEvent,
} from "@tomismeta/aperture-core";

import type {
  CodexItemCompletedNotification,
  CodexItemStartedNotification,
  CodexPermissionsRequestApprovalParams,
  JsonRpcId,
} from "./protocol.js";

export type CodexMappingContext = {
  sourceLabel?: string;
};

export type CodexMappedRequest = {
  interactionId: string;
  taskId: string;
  events: SourceEvent[];
};

export type ContextItem = NonNullable<
  NonNullable<SourceHumanInputRequestedEvent["context"]>["items"]
>[number];
export type HumanInputSemanticHints = NonNullable<SourceHumanInputRequestedEvent["semanticHints"]>;
export type TaskUpdateSemanticHints = NonNullable<SourceTaskUpdatedEvent["semanticHints"]>;

export function contextItem(
  id: string,
  label: string,
  value: string | null | undefined,
): ContextItem | null {
  return value ? { id, label, value } : null;
}

export function createContextItem(id: string, label: string, value: string): ContextItem {
  return { id, label, value };
}

export function explicitRequestSemanticHints(
  kind: "approval" | "choice" | "form",
  activityClass: SourceHumanInputRequestedEvent["activityClass"],
  whyNow: string,
): HumanInputSemanticHints {
  return {
    intentFrame: requestIntentFrame(kind),
    ...(activityClass !== undefined ? { activityClass } : {}),
    whyNow,
    confidence: "high",
  };
}

export function taskUpdateSemanticHints(
  activityClass: NonNullable<SourceTaskUpdatedEvent["activityClass"]>,
  whyNow?: string,
): TaskUpdateSemanticHints {
  return {
    activityClass,
    ...(whyNow !== undefined ? { whyNow } : {}),
    confidence: "high",
  };
}

export function questionRequestWhyNow(sourceLabel: string): string {
  return `${sourceLabel} asked for input before continuing.`;
}

export function codexSource(threadId: string, context: CodexMappingContext) {
  return {
    id: `codex:${encodeURIComponent(threadId)}`,
    kind: "codex",
    ...(context.sourceLabel ? { label: context.sourceLabel } : {}),
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function withOptionalSummary(summary: string | undefined): { summary?: string } {
  return summary ? { summary } : {};
}

export function isCommandExecutionItem(
  item: CodexItemCompletedNotification["item"],
): item is Extract<CodexItemCompletedNotification["item"], { type: "commandExecution" }> {
  return (
    item.type === "commandExecution"
    && typeof item.command === "string"
    && typeof item.status === "string"
  );
}

export function isFileChangeItem(
  item: CodexItemCompletedNotification["item"],
): item is Extract<CodexItemCompletedNotification["item"], { type: "fileChange" }> {
  return item.type === "fileChange" && Array.isArray(item.changes) && typeof item.status === "string";
}

export function isEnteredReviewModeItem(
  item: CodexItemStartedNotification["item"],
): item is Extract<CodexItemStartedNotification["item"], { type: "enteredReviewMode" }> {
  return item.type === "enteredReviewMode" && typeof item.review === "string";
}

export function isExitedReviewModeItem(
  item: CodexItemCompletedNotification["item"],
): item is Extract<CodexItemCompletedNotification["item"], { type: "exitedReviewMode" }> {
  return item.type === "exitedReviewMode" && typeof item.review === "string";
}

export function codexThreadTaskId(threadId: string): string {
  return `codex:thread:${encodeURIComponent(threadId)}`;
}

export function codexTurnTaskId(threadId: string, turnId: string): string {
  return `codex:thread:${encodeURIComponent(threadId)}:turn:${encodeURIComponent(turnId)}`;
}

export function codexTaskId(threadId: string, turnId?: string | null): string {
  return turnId ? codexTurnTaskId(threadId, turnId) : codexThreadTaskId(threadId);
}

export function codexInteractionId(
  kind:
    | "commandApproval"
    | "fileChangeApproval"
    | "userInput"
    | "execCommandApproval"
    | "applyPatchApproval"
    | "permissionsApproval",
  requestId: JsonRpcId,
  threadId: string,
  turnId: string,
  itemId: string,
  extra?: string,
): string {
  return [
    "codex",
    kind,
    encodeURIComponent(String(requestId)),
    encodeURIComponent(threadId),
    encodeURIComponent(turnId),
    encodeURIComponent(itemId),
    ...(extra ? [encodeURIComponent(extra)] : []),
  ].join(":");
}

export function codexMcpElicitationInteractionId(
  requestId: JsonRpcId,
  threadId: string,
  turnId: string | null,
  serverName: string,
  mode: "form" | "url",
  extra?: string,
): string {
  return [
    "codex",
    "mcpElicitation",
    encodeURIComponent(String(requestId)),
    encodeURIComponent(threadId),
    encodeURIComponent(turnId ?? "_"),
    encodeURIComponent(serverName),
    encodeURIComponent(mode),
    ...(extra ? [encodeURIComponent(extra)] : []),
  ].join(":");
}

export function codexEventId(requestId: JsonRpcId, type: SourceEvent["type"], itemId: string): string {
  return `codex:${encodeURIComponent(String(requestId))}:${encodeURIComponent(itemId)}:${type}`;
}

export function codexItemEventId(
  notification: CodexItemStartedNotification | CodexItemCompletedNotification,
  type: SourceEvent["type"],
  suffix: string,
): string {
  return `codex:${encodeURIComponent(notification.threadId)}:${encodeURIComponent(notification.turnId)}:${encodeURIComponent(notification.item.id)}:${type}:${suffix}`;
}

export function describeThreadStatus(status: { type: string; activeFlags?: string[] }): string {
  if (status.type !== "active" || !status.activeFlags || status.activeFlags.length === 0) {
    return status.type;
  }
  return `${status.type}: ${status.activeFlags.join(", ")}`;
}

export function describeAdditionalPermissions(
  permissions: CodexPermissionsRequestApprovalParams["permissions"],
): string {
  const parts: string[] = [];
  if (permissions.network?.enabled) {
    parts.push("network access");
  }
  if (permissions.fileSystem?.read?.length) {
    parts.push(`read access to ${permissions.fileSystem.read.join(", ")}`);
  }
  if (permissions.fileSystem?.write?.length) {
    parts.push(`write access to ${permissions.fileSystem.write.join(", ")}`);
  }
  if (permissions.macos) {
    parts.push("macOS permissions");
  }
  return parts.length > 0
    ? `Codex requested ${parts.join(" and ")}.`
    : "Codex requested additional permissions before continuing.";
}

export function slugifyOption(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "option";
}

function requestIntentFrame(
  kind: "approval" | "choice" | "form",
): "approval_request" | "question_request" | "form_request" {
  switch (kind) {
    case "approval":
      return "approval_request";
    case "choice":
      return "question_request";
    case "form":
      return "form_request";
  }
}
