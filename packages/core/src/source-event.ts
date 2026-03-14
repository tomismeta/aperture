import type { HumanInputRequest, SourceRef, TaskStatus } from "./events.js";
import type { ConsequenceLevel, FrameContext, FrameProvenance } from "./frame.js";

export type SourceEvent =
  | SourceTaskStartedEvent
  | SourceTaskUpdatedEvent
  | SourceHumanInputRequestedEvent
  | SourceTaskCompletedEvent
  | SourceTaskCancelledEvent;

type SourceEventBase = {
  id: string;
  taskId: string;
  timestamp: string;
  source?: SourceRef;
};

export type SourceTaskStartedEvent = SourceEventBase & {
  type: "task.started";
  title: string;
  summary?: string;
};

export type SourceTaskUpdatedEvent = SourceEventBase & {
  type: "task.updated";
  title: string;
  summary?: string;
  status: TaskStatus;
  progress?: number;
};

export type SourceHumanInputRequestedEvent = SourceEventBase & {
  type: "human.input.requested";
  interactionId: string;
  toolFamily?: string;
  title: string;
  summary: string;
  request: HumanInputRequest;
  context?: FrameContext;
  provenance?: FrameProvenance;
  riskHint?: ConsequenceLevel;
};

export type SourceTaskCompletedEvent = SourceEventBase & {
  type: "task.completed";
  summary?: string;
};

export type SourceTaskCancelledEvent = SourceEventBase & {
  type: "task.cancelled";
  reason?: string;
};
