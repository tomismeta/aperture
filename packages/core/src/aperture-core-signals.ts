import type { AttentionResponse } from "./frame-response.js";
import type { AttentionFrame, AttentionView } from "./frame.js";
import type { AttentionCandidate } from "./interaction-candidate.js";
import type { AttentionSignal } from "./interaction-signal.js";
import {
  signalMetadataForCandidate,
  signalMetadataForFrame,
} from "./memory-aggregator.js";

export function buildResponseSignal(
  frame: AttentionFrame,
  response: AttentionResponse,
  timestamp: string,
): AttentionSignal {
  const latencyMs = calculateLatency(frame, timestamp);
  const base = {
    taskId: frame.taskId,
    interactionId: frame.interactionId,
    timestamp,
    frameId: frame.id,
    ...(frame.source !== undefined ? { source: frame.source } : {}),
    metadata: signalMetadataForFrame(frame),
  };

  if (response.response.kind === "dismissed") {
    return {
      kind: "dismissed",
      ...base,
      ...(latencyMs !== undefined ? { latencyMs } : {}),
    };
  }

  return {
    kind: "responded",
    ...base,
    responseKind: response.response.kind,
    ...(latencyMs !== undefined ? { latencyMs } : {}),
  };
}

export function buildAutoResponseSignal(
  candidate: AttentionCandidate,
  response: AttentionResponse,
  timestamp: string,
): AttentionSignal {
  return {
    kind: "responded",
    taskId: candidate.taskId,
    interactionId: candidate.interactionId,
    timestamp,
    ...(candidate.source !== undefined ? { source: candidate.source } : {}),
    responseKind: response.response.kind === "dismissed"
      ? "acknowledged"
      : response.response.kind,
    metadata: {
      ...signalMetadataForCandidate(candidate),
      autoResolved: true,
    },
  };
}

export function buildDeferredSignal(
  frame: AttentionFrame,
  reason: "next" | "suppressed",
  sourceFrame: Pick<AttentionFrame, "taskId" | "interactionId" | "source"> = frame,
): AttentionSignal {
  return {
    kind: "deferred",
    taskId: sourceFrame.taskId,
    interactionId: sourceFrame.interactionId,
    timestamp: frame.timing.updatedAt,
    frameId: frame.id,
    ...(sourceFrame.source !== undefined ? { source: sourceFrame.source } : {}),
    reason,
    metadata: signalMetadataForFrame(frame),
  };
}

export function buildAttentionTransitionSignals(
  previousAttentionView: AttentionView,
  nextAttentionView: AttentionView,
  timestamp: string,
): AttentionSignal[] {
  const previous = previousAttentionView.now;
  const next = nextAttentionView.now;
  if (!next) {
    return [];
  }

  return [
    ...buildAttentionShiftSignals(previous, next, timestamp),
    ...buildReturnSignals(previousAttentionView, next, timestamp),
  ];
}

export function buildObservationSignal(
  kind: "viewed" | "timed_out" | "context_expanded" | "context_skipped",
  taskId: string,
  interactionId: string,
  timestamp: string,
  frame: AttentionFrame | null,
  options: { surface?: string; section?: string; timeoutMs?: number } = {},
): Extract<
  AttentionSignal,
  { kind: "viewed" | "timed_out" | "context_expanded" | "context_skipped" }
> {
  return {
    kind,
    taskId,
    interactionId,
    timestamp,
    ...(frame?.id !== undefined ? { frameId: frame.id } : {}),
    ...(frame?.source !== undefined ? { source: frame.source } : {}),
    ...(frame ? { metadata: signalMetadataForFrame(frame) } : {}),
    ...(options.surface !== undefined ? { surface: options.surface } : {}),
    ...(kind === "context_expanded" && options.section !== undefined ? { section: options.section } : {}),
    ...(kind === "context_skipped" && options.section !== undefined ? { section: options.section } : {}),
    ...(kind === "timed_out" && options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  };
}

function buildAttentionShiftSignals(
  previous: AttentionFrame | null,
  next: AttentionFrame,
  timestamp: string,
): AttentionSignal[] {
  if (!previous || sameFrame(previous, next)) {
    return [];
  }

  const destinationSignal: AttentionSignal = {
    kind: "attention_shifted",
    taskId: next.taskId,
    interactionId: next.interactionId,
    timestamp,
    frameId: next.id,
    ...(next.source !== undefined ? { source: next.source } : {}),
    fromInteractionId: previous.interactionId,
    toInteractionId: next.interactionId,
  };

  if (previous.taskId === next.taskId) {
    return [destinationSignal];
  }

  return [
    destinationSignal,
    {
      kind: "attention_shifted",
      taskId: previous.taskId,
      interactionId: previous.interactionId,
      timestamp,
      frameId: previous.id,
      ...(previous.source !== undefined ? { source: previous.source } : {}),
      fromInteractionId: previous.interactionId,
      toInteractionId: next.interactionId,
    },
  ];
}

function buildReturnSignals(
  previousAttentionView: AttentionView,
  next: AttentionFrame,
  timestamp: string,
): AttentionSignal[] {
  const from = previousAttentionView.next.some((frame) => sameFrame(frame, next))
    ? "next"
    : previousAttentionView.ambient.some((frame) => sameFrame(frame, next))
      ? "ambient"
      : null;

  if (!from) {
    return [];
  }

  return [{
    kind: "returned",
    taskId: next.taskId,
    interactionId: next.interactionId,
    timestamp,
    frameId: next.id,
    ...(next.source !== undefined ? { source: next.source } : {}),
    from,
    metadata: signalMetadataForFrame(next),
  }];
}

function calculateLatency(frame: AttentionFrame, timestamp: string): number | undefined {
  const startedAt = Date.parse(frame.timing.updatedAt);
  const completedAt = Date.parse(timestamp);

  if (Number.isNaN(startedAt) || Number.isNaN(completedAt)) {
    return undefined;
  }

  return Math.max(0, completedAt - startedAt);
}

function sameFrame(left: AttentionFrame, right: AttentionFrame): boolean {
  return left.id === right.id || (left.taskId === right.taskId && left.interactionId === right.interactionId);
}
