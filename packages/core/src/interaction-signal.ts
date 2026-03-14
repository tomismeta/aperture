import type { SourceRef } from "./events.js";
import type { AttentionResponse } from "./frame-response.js";

export type AttentionSignal =
  | AttentionPresentedSignal
  | AttentionViewedSignal
  | AttentionRespondedSignal
  | AttentionDismissedSignal
  | AttentionDeferredSignal
  | AttentionContextExpandedSignal
  | AttentionContextSkippedSignal
  | AttentionTimedOutSignal
  | AttentionReturnedSignal
  | AttentionAttentionShiftedSignal;

type AttentionSignalBase = {
  taskId: string;
  interactionId: string;
  timestamp: string;
  frameId?: string;
  source?: SourceRef;
  surface?: string;
  metadata?: Record<string, unknown>;
};

export type AttentionPresentedSignal = AttentionSignalBase & {
  kind: "presented";
};

export type AttentionViewedSignal = AttentionSignalBase & {
  kind: "viewed";
};

export type AttentionRespondedSignal = AttentionSignalBase & {
  kind: "responded";
  responseKind: Exclude<AttentionResponse["response"]["kind"], "dismissed">;
  latencyMs?: number;
};

export type AttentionDismissedSignal = AttentionSignalBase & {
  kind: "dismissed";
  latencyMs?: number;
};

export type AttentionDeferredSignal = AttentionSignalBase & {
  kind: "deferred";
  reason?: "queued" | "suppressed" | "manual";
};

export type AttentionContextExpandedSignal = AttentionSignalBase & {
  kind: "context_expanded";
  section?: string;
};

export type AttentionContextSkippedSignal = AttentionSignalBase & {
  kind: "context_skipped";
  section?: string;
};

export type AttentionTimedOutSignal = AttentionSignalBase & {
  kind: "timed_out";
  timeoutMs?: number;
};

export type AttentionReturnedSignal = AttentionSignalBase & {
  kind: "returned";
  from: "queued" | "ambient";
};

export type AttentionAttentionShiftedSignal = AttentionSignalBase & {
  kind: "attention_shifted";
  fromInteractionId: string;
  toInteractionId: string;
};
