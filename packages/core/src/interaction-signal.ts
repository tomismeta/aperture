import type { SourceRef } from "./events.js";
import type { FrameResponse } from "./frame-response.js";

export type InteractionSignal =
  | InteractionPresentedSignal
  | InteractionRespondedSignal
  | InteractionDismissedSignal
  | InteractionDeferredSignal
  | InteractionContextExpandedSignal
  | InteractionReturnedSignal
  | InteractionAttentionShiftedSignal;

type InteractionSignalBase = {
  taskId: string;
  interactionId: string;
  timestamp: string;
  frameId?: string;
  source?: SourceRef;
  surface?: string;
  metadata?: Record<string, unknown>;
};

export type InteractionPresentedSignal = InteractionSignalBase & {
  kind: "presented";
};

export type InteractionRespondedSignal = InteractionSignalBase & {
  kind: "responded";
  responseKind: Exclude<FrameResponse["response"]["kind"], "dismissed">;
  latencyMs?: number;
};

export type InteractionDismissedSignal = InteractionSignalBase & {
  kind: "dismissed";
  latencyMs?: number;
};

export type InteractionDeferredSignal = InteractionSignalBase & {
  kind: "deferred";
  reason?: "queued" | "suppressed" | "manual";
};

export type InteractionContextExpandedSignal = InteractionSignalBase & {
  kind: "context_expanded";
  section?: string;
};

export type InteractionReturnedSignal = InteractionSignalBase & {
  kind: "returned";
  from: "queued" | "ambient";
};

export type InteractionAttentionShiftedSignal = InteractionSignalBase & {
  kind: "attention_shifted";
  fromInteractionId: string;
  toInteractionId: string;
};
