import type { HumanInputRequest, SourceRef, TaskStatus } from "./events.js";
import type { ConsequenceLevel, FrameContext, FrameProvenance } from "./frame.js";

export type AdapterEvent =
  | AdapterTaskStartedEvent
  | AdapterTaskUpdatedEvent
  | AdapterHumanInputRequestedEvent
  | AdapterTaskCompletedEvent
  | AdapterTaskCancelledEvent;

type AdapterEventBase = {
  id: string;
  taskId: string;
  timestamp: string;
  source?: SourceRef;
};

export type AdapterTaskStartedEvent = AdapterEventBase & {
  type: "task.started";
  title: string;
  summary?: string;
};

export type AdapterTaskUpdatedEvent = AdapterEventBase & {
  type: "task.updated";
  title: string;
  summary?: string;
  status: TaskStatus;
  progress?: number;
};

export type AdapterHumanInputRequestedEvent = AdapterEventBase & {
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

export type AdapterTaskCompletedEvent = AdapterEventBase & {
  type: "task.completed";
  summary?: string;
};

export type AdapterTaskCancelledEvent = AdapterEventBase & {
  type: "task.cancelled";
  reason?: string;
};
