import assert from "node:assert/strict";

import {
  evaluateApertureKernelEvent,
  type ApertureKernelEvent,
  type ApertureKernelResult,
  type SourceEvidence,
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
    result?: { kind: "search-results"; complete: boolean };
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
  attributes?: {
    capabilityFamily?: string;
    evidenceClass?: "search";
    complete?: boolean;
  };
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
  const status = RECORD_PHASE_STATUS[event.data.phase];
  const update = {
    id: event.recordId,
    workId: event.streamId,
    occurredAt: event.recordedAt,
    kind: "work.updated" as const,
    title: event.data.label ?? "Work update",
    summary: event.data.message,
    ...(event.data.capability === undefined
      ? {}
      : { facts: { capabilityFamily: event.data.capability } }),
  };
  const evidence = searchEvidence(event.data.result?.kind, event.data.result?.complete);
  return status === "failed"
    ? { ...update, status, ...(evidence === undefined ? {} : { evidence }) }
    : { ...update, status };
}

function adaptQueueMessage(message: QueueMessage): ApertureKernelEvent | null {
  if (message.topic !== "execution.changed" || message.payload.state === undefined) return null;
  const status = QUEUE_STATE_STATUS[message.payload.state];
  const update = {
    id: message.messageId,
    workId: message.partitionKey,
    occurredAt: message.sentAt,
    kind: "work.updated" as const,
    title: message.payload.headline ?? "Work update",
    summary: message.payload.detail,
    ...(message.attributes?.capabilityFamily === undefined
      ? {}
      : { facts: { capabilityFamily: message.attributes.capabilityFamily } }),
  };
  const evidence = searchEvidence(message.attributes?.evidenceClass, message.attributes?.complete);
  return status === "failed"
    ? {
        ...update,
        status,
        ...(evidence === undefined ? {} : { evidence }),
      }
    : { ...update, status };
}

function searchEvidence(
  kind: string | undefined,
  complete: boolean | undefined,
): SourceEvidence | undefined {
  return (kind === "search-results" || kind === "search") && complete === true
    ? { kind: "payload", subject: "search", channel: "search", complete: true }
    : undefined;
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
    message: "The source prose mentions a permission failure, but the result facts are complete.",
    capability: "catalog",
    result: { kind: "search-results", complete: true },
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
    detail: "The queue prose calls this a routine success.",
  },
  attributes: { capabilityFamily: "catalog", evidenceClass: "search", complete: true },
};

const recordKernelEvent = adaptRecordLogEvent(recordEvent);
const queueKernelEvent = adaptQueueMessage(queueMessage);
assert.ok(recordKernelEvent);
assert.ok(queueKernelEvent);

const recordResult = evaluateApertureKernelEvent(recordKernelEvent);
const queueResult = evaluateApertureKernelEvent(queueKernelEvent);

assert.deepEqual(semanticProjection(recordResult), semanticProjection(queueResult));
assert.equal(recordResult.observation?.kind, "payload");
assert.equal(recordResult.observation?.subject, "search");
assert.equal(recordResult.observation?.polarity, "neutral");
assert.equal(recordResult.observationJudgment?.statusConflictKind, "search_output_observation");
assert.equal(
  adaptRecordLogEvent({ ...recordEvent, recordType: "work-note" }),
  null,
  "host adapters own filtering before kernel invocation",
);

console.log("host-neutral kernel embedder example passed");
