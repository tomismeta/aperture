import type {
  AttentionConsequenceLevel as ConsequenceLevel,
  AttentionResponse as FrameResponse,
  SourceEvent,
  SourceRef,
  TaskStatus,
} from "@tomismeta/aperture-core";

export { executePaperclipAction, streamPaperclipLiveEvents, type PaperclipClientOptions } from "./client.js";

export type PaperclipLiveEventType =
  | "heartbeat.run.queued"
  | "heartbeat.run.status"
  | "heartbeat.run.event"
  | "heartbeat.run.log"
  | "agent.status"
  | "activity.logged";

export type PaperclipLiveEvent = {
  id: number | string;
  companyId: string;
  type: PaperclipLiveEventType;
  createdAt: string;
  payload: Record<string, unknown>;
};

export type PaperclipAction =
  | {
      kind: "approval.approve";
      approvalId: string;
      method: "POST";
      path: string;
      body?: {
        decisionNote?: string;
      };
    }
  | {
      kind: "approval.reject";
      approvalId: string;
      method: "POST";
      path: string;
      body?: {
        decisionNote?: string;
      };
    }
  | {
      kind: "approval.request_revision";
      approvalId: string;
      method: "POST";
      path: string;
      body?: {
        decisionNote?: string;
      };
    };

export function mapPaperclipLiveEvent(event: PaperclipLiveEvent): SourceEvent[] {
  switch (event.type) {
    case "heartbeat.run.queued":
      return mapHeartbeatQueued(event);
    case "heartbeat.run.status":
      return mapHeartbeatStatus(event);
    case "activity.logged":
      return mapActivity(event);
    case "heartbeat.run.event":
    case "heartbeat.run.log":
    case "agent.status":
      return [];
  }
}

export function mapPaperclipFrameResponse(response: FrameResponse): PaperclipAction | null {
  const approvalId = approvalIdFromTaskId(response.taskId);
  if (!approvalId) {
    return null;
  }

  switch (response.response.kind) {
    case "acknowledged":
      return null;
    case "approved":
      return {
        kind: "approval.approve",
        approvalId,
        method: "POST",
        path: `/api/approvals/${approvalId}/approve`,
        ...(response.response.reason !== undefined
          ? {
              body: {
                decisionNote: response.response.reason,
              },
            }
          : {}),
      };
    case "rejected":
      return {
        kind: "approval.reject",
        approvalId,
        method: "POST",
        path: `/api/approvals/${approvalId}/reject`,
        ...(response.response.reason !== undefined
          ? {
              body: {
                decisionNote: response.response.reason,
              },
            }
          : {}),
      };
    case "dismissed":
      return {
        kind: "approval.request_revision",
        approvalId,
        method: "POST",
        path: `/api/approvals/${approvalId}/request-revision`,
      };
    case "option_selected":
    case "form_submitted":
    case "text_submitted":
      return null;
  }
}

function mapHeartbeatQueued(event: PaperclipLiveEvent): SourceEvent[] {
  const payload = event.payload;
  const runId = readString(payload.runId);
  if (!runId) {
    return [];
  }

  return [
    {
      id: liveEventId(event, "task.started"),
      type: "task.started",
      taskId: runTaskId(runId),
      timestamp: event.createdAt,
      source: sourceRef(payload.agentId, "run"),
      title: "Paperclip run queued",
      summary: readString(payload.triggerDetail) ?? "A Paperclip run is queued.",
    },
  ];
}

function mapHeartbeatStatus(event: PaperclipLiveEvent): SourceEvent[] {
  const payload = event.payload;
  const runId = readString(payload.runId);
  const status = readString(payload.status);
  if (!runId || !status) {
    return [];
  }

  const taskId = runTaskId(runId);
  const source = sourceRef(payload.agentId, "run");
  const summary = readString(payload.error) ?? readString(payload.triggerDetail) ?? undefined;

  switch (status) {
    case "queued":
      return [
        {
          id: liveEventId(event, "task.started"),
          type: "task.started",
          taskId,
          timestamp: event.createdAt,
          source,
          title: "Paperclip run queued",
          ...(summary !== undefined ? { summary } : {}),
        },
      ];
    case "running":
      return [
        {
          id: liveEventId(event, "task.updated"),
          type: "task.updated",
          taskId,
          timestamp: event.createdAt,
          source,
          title: "Paperclip run active",
          ...(summary !== undefined ? { summary } : {}),
          status: "running",
        },
      ];
    case "failed":
      return [
        {
          id: liveEventId(event, "task.updated"),
          type: "task.updated",
          taskId,
          timestamp: event.createdAt,
          source,
          title: "Paperclip run failed",
          ...(summary !== undefined ? { summary } : {}),
          status: "failed",
        },
      ];
    case "succeeded":
      return [
        {
          id: liveEventId(event, "task.completed"),
          type: "task.completed",
          taskId,
          timestamp: event.createdAt,
          source,
          ...(summary !== undefined ? { summary } : {}),
        },
      ];
    case "cancelled":
    case "timed_out":
      return [
        {
          id: liveEventId(event, "task.cancelled"),
          type: "task.cancelled",
          taskId,
          timestamp: event.createdAt,
          source,
          reason: status,
        },
      ];
    default:
      return [];
  }
}

function mapActivity(event: PaperclipLiveEvent): SourceEvent[] {
  const payload = event.payload;
  const entityType = readString(payload.entityType);
  const entityId = readString(payload.entityId);
  const action = readString(payload.action);
  const details = readRecord(payload.details);

  if (!entityType || !entityId || !action) {
    return [];
  }

  if (entityType === "approval") {
    return mapApprovalActivity(event, entityId, action, details);
  }

  if (entityType === "issue") {
    return mapIssueActivity(event, entityId, action, details);
  }

  return [];
}

function mapApprovalActivity(
  event: PaperclipLiveEvent,
  approvalId: string,
  action: string,
  details: Record<string, unknown> | null,
): SourceEvent[] {
  const taskId = approvalTaskId(approvalId);
  const approvalType = readString(details?.type);
  const issueIds = readStringArray(details?.issueIds) ?? readStringArray(details?.linkedIssueIds) ?? [];
  const source = sourceRef(readString(details?.requestedByAgentId), "approval");

  if (action === "approval.created" || action === "approval.resubmitted") {
    const consequence = approvalConsequence(approvalType);

    return [
      {
        id: liveEventId(event, "human.input.requested"),
        type: "human.input.requested",
        taskId,
        interactionId: approvalInteractionId(approvalId),
        timestamp: event.createdAt,
        source,
        title: approvalTitle(approvalType),
        summary: "A Paperclip approval is waiting for operator review.",
        request: {
          kind: "approval",
        },
        riskHint: consequence,
        ...(issueIds.length > 0
          ? {
              context: {
                items: issueIds.map((issueId, index) => ({
                  id: `issue:${index}`,
                  label: "Linked issue",
                  value: issueId,
                })),
              },
            }
          : {}),
        provenance: {
          whyNow: "Paperclip emitted an approval requiring human review.",
          factors: [action, ...(approvalType ? [approvalType] : [])],
        },
      },
    ];
  }

  if (action === "approval.approved") {
    return [
      {
        id: liveEventId(event, "task.completed"),
        type: "task.completed",
        taskId,
        timestamp: event.createdAt,
        source,
        summary: "Paperclip approval completed.",
      },
    ];
  }

  if (action === "approval.rejected" || action === "approval.revision_requested") {
    return [
      {
        id: liveEventId(event, "task.cancelled"),
        type: "task.cancelled",
        taskId,
        timestamp: event.createdAt,
        source,
        reason: action,
      },
    ];
  }

  return [];
}

function mapIssueActivity(
  event: PaperclipLiveEvent,
  issueId: string,
  action: string,
  details: Record<string, unknown> | null,
): SourceEvent[] {
  const source = sourceRef(readString(event.payload.agentId), "issue");
  const description = readString(details?.description);
  const title =
    readString(details?.title) ??
    readString(details?.issueTitle) ??
    readString(details?.identifier) ??
    "Paperclip issue";

  if (action === "issue.created") {
    return [
      {
        id: liveEventId(event, "task.started"),
        type: "task.started",
        taskId: issueTaskId(issueId),
        timestamp: event.createdAt,
        source,
        title,
      },
    ];
  }

  if (action !== "issue.updated") {
    return [];
  }

  const rawStatus = readString(details?.status);
  if (!rawStatus) {
    return [];
  }

  if (rawStatus === "done") {
    return [
      {
        id: liveEventId(event, "task.completed"),
        type: "task.completed",
        taskId: issueTaskId(issueId),
        timestamp: event.createdAt,
        source,
      },
    ];
  }

  if (rawStatus === "cancelled") {
    return [
      {
        id: liveEventId(event, "task.cancelled"),
        type: "task.cancelled",
        taskId: issueTaskId(issueId),
        timestamp: event.createdAt,
        source,
        reason: "cancelled",
      },
    ];
  }

  const status = mapIssueStatus(rawStatus);
  if (!status) {
    return [];
  }

  return [
    {
      id: liveEventId(event, "task.updated"),
      type: "task.updated",
      taskId: issueTaskId(issueId),
      timestamp: event.createdAt,
      source,
      title,
      ...(description !== null ? { summary: description } : {}),
      status,
    },
  ];
}

function mapIssueStatus(status: string): TaskStatus | null {
  switch (status) {
    case "backlog":
    case "todo":
      return "waiting";
    case "in_progress":
    case "in_review":
      return "running";
    case "blocked":
      return "blocked";
    default:
      return null;
  }
}

function approvalConsequence(type: string | null): ConsequenceLevel {
  if (type === "hire_agent" || type === "approve_ceo_strategy") {
    return "high";
  }

  return "medium";
}

function approvalTitle(type: string | null): string {
  switch (type) {
    case "hire_agent":
      return "Approve agent hire";
    case "approve_ceo_strategy":
      return "Approve CEO strategy";
    default:
      return "Review Paperclip approval";
  }
}

function sourceRef(agentId: unknown, label: string): SourceRef {
  const resolvedAgentId = readString(agentId);
  return {
    id: resolvedAgentId ?? "paperclip",
    kind: "paperclip",
    label: resolvedAgentId ? `Paperclip ${label}` : "Paperclip",
  };
}

function approvalTaskId(approvalId: string): string {
  return `paperclip:approval:${approvalId}`;
}

function approvalInteractionId(approvalId: string): string {
  return `paperclip:approval:${approvalId}:review`;
}

function issueTaskId(issueId: string): string {
  return `paperclip:issue:${issueId}`;
}

function runTaskId(runId: string): string {
  return `paperclip:run:${runId}`;
}

function liveEventId(event: PaperclipLiveEvent, suffix: string): string {
  return `paperclip:${String(event.id)}:${suffix}`;
}

function approvalIdFromTaskId(taskId: string): string | null {
  const prefix = "paperclip:approval:";
  return taskId.startsWith(prefix) ? taskId.slice(prefix.length) : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const strings = value.filter((item): item is string => typeof item === "string" && item.length > 0);
  return strings.length > 0 ? strings : [];
}
