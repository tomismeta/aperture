import type { HumanInputRequest, SourceRef, TaskStatus } from "./events.js";
import type { ConsequenceLevel, FrameContext, FrameProvenance } from "./frame.js";

export type ConformedEvent =
  | ConformedTaskStartedEvent
  | ConformedTaskUpdatedEvent
  | ConformedHumanInputRequestedEvent
  | ConformedTaskCompletedEvent
  | ConformedTaskCancelledEvent;

type ConformedEventBase = {
  id: string;
  taskId: string;
  timestamp: string;
  source?: SourceRef;
};

export type ConformedTaskStartedEvent = ConformedEventBase & {
  type: "task.started";
  title: string;
  summary?: string;
};

export type ConformedTaskUpdatedEvent = ConformedEventBase & {
  type: "task.updated";
  title: string;
  summary?: string;
  status: TaskStatus;
  progress?: number;
};

export type ConformedHumanInputRequestedEvent = ConformedEventBase & {
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

export type ConformedTaskCompletedEvent = ConformedEventBase & {
  type: "task.completed";
  summary?: string;
};

export type ConformedTaskCancelledEvent = ConformedEventBase & {
  type: "task.cancelled";
  reason?: string;
};
