import assert from "node:assert/strict";

import {
  evaluateApertureKernelEvent,
  type ApertureKernelEvent,
  type ApertureKernelResult,
} from "@tomismeta/aperture-core/kernel";

type RecordLogEvent = {
  recordId: string;
  streamId: string;
  recordedAt: string;
  recordType: "work-state" | "work-note";
  data: {
    phase?: "active" | "complete" | "failed" | "waiting";
    label?: string;
    message?: string;
    capability?: string;
  };
};

type QueueMessage = {
  messageId: string;
  partitionKey: string;
  sentAt: string;
  topic: "execution.changed" | "execution.telemetry";
  payload: {
    state?: "blocked" | "done" | "failed" | "running";
    headline?: string;
    detail?: string;
  };
  attributes?: { capabilityFamily?: string };
};

type KernelWorkStatus = Extract<ApertureKernelEvent, { kind: "work.updated" }>["status"];

const RECORD_PHASE_STATUS = {
  active: "running",
  complete: "completed",
  failed: "failed",
  waiting: "waiting",
} as const satisfies Record<NonNullable<RecordLogEvent["data"]["phase"]>, KernelWorkStatus>;

const QUEUE_STATE_STATUS = {
  blocked: "blocked",
  done: "completed",
  failed: "failed",
  running: "running",
} as const satisfies Record<NonNullable<QueueMessage["payload"]["state"]>, KernelWorkStatus>;

function adaptRecordLogEvent(event: RecordLogEvent): ApertureKernelEvent | null {
  if (event.recordType !== "work-state" || event.data.phase === undefined) return null;
  return {
    id: event.recordId,
    workId: event.streamId,
    occurredAt: event.recordedAt,
    kind: "work.updated",
    title: event.data.label ?? "Work update",
    summary: event.data.message,
    status: RECORD_PHASE_STATUS[event.data.phase],
    ...(event.data.capability === undefined
      ? {}
      : { facts: { capabilityFamily: event.data.capability } }),
  };
}

function adaptQueueMessage(message: QueueMessage): ApertureKernelEvent | null {
  if (message.topic !== "execution.changed" || message.payload.state === undefined) return null;
  return {
    id: message.messageId,
    workId: message.partitionKey,
    occurredAt: message.sentAt,
    kind: "work.updated",
    title: message.payload.headline ?? "Work update",
    summary: message.payload.detail,
    status: QUEUE_STATE_STATUS[message.payload.state],
    ...(message.attributes?.capabilityFamily === undefined
      ? {}
      : { facts: { capabilityFamily: message.attributes.capabilityFamily } }),
  };
}

function semanticProjection(result: ApertureKernelResult) {
  return {
    observation: result.observation,
    judgment: result.observationJudgment,
    reasonCodes: result.explanation.reasonCodes.filter(
      (code) => code.startsWith("kernel:observe:") || code.startsWith("kernel:judge:"),
    ),
  };
}

const recordEvent: RecordLogEvent = {
  recordId: "record:17",
  streamId: "stream:release",
  recordedAt: "2026-08-12T18:30:00.000Z",
  recordType: "work-state",
  data: {
    phase: "failed",
    label: "Command status",
    message: "Your command ran successfully and did not produce any output.",
    capability: "exec_command",
  },
};

const queueMessage: QueueMessage = {
  messageId: "message:91",
  partitionKey: "partition:release",
  sentAt: "2026-08-12T18:30:00.000Z",
  topic: "execution.changed",
  payload: {
    state: "failed",
    headline: "Command status",
    detail: "Your command ran successfully and did not produce any output.",
  },
  attributes: { capabilityFamily: "exec_command" },
};

const recordKernelEvent = adaptRecordLogEvent(recordEvent);
const queueKernelEvent = adaptQueueMessage(queueMessage);
assert.ok(recordKernelEvent);
assert.ok(queueKernelEvent);

const recordResult = evaluateApertureKernelEvent(recordKernelEvent);
const queueResult = evaluateApertureKernelEvent(queueKernelEvent);

assert.deepEqual(semanticProjection(recordResult), semanticProjection(queueResult));
assert.equal(recordResult.observation?.kind, "outcome");
assert.equal(recordResult.observation?.polarity, "success");
assert.equal(recordResult.observationJudgment?.statusConflictKind, "command_success_observation");
assert.equal(
  adaptRecordLogEvent({ ...recordEvent, recordType: "work-note" }),
  null,
  "host adapters own filtering before kernel invocation",
);

console.log("host-neutral kernel embedder example passed");
