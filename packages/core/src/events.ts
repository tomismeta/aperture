export type ApertureEvent =
  | TaskStartedEvent
  | TaskUpdatedEvent
  | HumanInputRequestedEvent
  | TaskCompletedEvent
  | TaskCancelledEvent;

export type TaskStatus = "running" | "blocked" | "waiting" | "completed" | "failed";

export type AttentionActivityClass =
  | "permission_request"
  | "question_request"
  | "follow_up"
  | "tool_completion"
  | "tool_failure"
  | "session_status"
  | "status_update";

export type SourceRef = {
  id: string;
  kind?: string;
  label?: string;
};

type EventBase = {
  id: string;
  taskId: string;
  timestamp: string;
  source?: SourceRef;
};

export type TaskStartedEvent = EventBase & {
  type: "task.started";
  title: string;
  summary?: string;
};

export type TaskUpdatedEvent = EventBase & {
  type: "task.updated";
  toolFamily?: string;
  activityClass?: AttentionActivityClass;
  title: string;
  summary?: string;
  status: TaskStatus;
  progress?: number;
};

export type HumanInputRequestKind = "approval" | "choice" | "form";

export type HumanInputRequestedEvent = EventBase & {
  type: "human.input.requested";
  interactionId: string;
  toolFamily?: string;
  activityClass?: AttentionActivityClass;
  title: string;
  summary: string;
  tone?: "ambient" | "focused" | "critical";
  consequence?: "low" | "medium" | "high";
  request: HumanInputRequest;
  context?: {
    stage?: string;
    progress?: number;
    items?: Array<{ id: string; label: string; value?: string }>;
  };
  provenance?: {
    whyNow?: string;
    factors?: string[];
  };
};

export type HumanInputRequest =
  | {
      kind: "approval";
      requireReason?: boolean;
    }
  | {
      kind: "choice";
      selectionMode: "single" | "multiple";
      allowTextResponse?: boolean;
      options: Array<{
        id: string;
        label: string;
        summary?: string;
      }>;
    }
  | {
      kind: "form";
      fields: Array<{
        id: string;
        label: string;
        type: "text" | "textarea" | "number" | "select" | "boolean";
        required?: boolean;
        options?: Array<{ value: string; label: string }>;
      }>;
    };

export type TaskCompletedEvent = EventBase & {
  type: "task.completed";
  summary?: string;
};

export type TaskCancelledEvent = EventBase & {
  type: "task.cancelled";
  reason?: string;
};
