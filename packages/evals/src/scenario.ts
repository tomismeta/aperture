import type {
  ApertureCoreOptions,
  ApertureEvent,
  AttentionResponse,
  AttentionSignal,
  AttentionView,
  SourceEvent,
} from "@tomismeta/aperture-core";

export type ReplayObservationStep =
  | {
      kind: "publish";
      event: ApertureEvent;
      label?: string;
    }
  | {
      kind: "publishSource";
      event: SourceEvent;
      label?: string;
    }
  | {
      kind: "submit";
      response: AttentionResponse;
      label?: string;
    }
  | {
      kind: "signal";
      signal: AttentionSignal;
      label?: string;
    }
  | {
      kind: "markViewed";
      taskId: string;
      interactionId: string;
      surface?: string;
      label?: string;
    }
  | {
      kind: "markTimedOut";
      taskId: string;
      interactionId: string;
      surface?: string;
      timeoutMs?: number;
      label?: string;
    }
  | {
      kind: "markContextExpanded";
      taskId: string;
      interactionId: string;
      surface?: string;
      section?: string;
      label?: string;
    }
  | {
      kind: "markContextSkipped";
      taskId: string;
      interactionId: string;
      surface?: string;
      section?: string;
      label?: string;
    };

export type ReplayScenario = {
  id: string;
  title: string;
  description?: string;
  core?: ApertureCoreOptions;
  steps: ReplayObservationStep[];
};

export type ReplayViewSnapshot = {
  stepIndex: number;
  stepKind: ReplayObservationStep["kind"];
  activeInteractionId: string | null;
  queuedInteractionIds: string[];
  ambientInteractionIds: string[];
  attentionView: AttentionView;
};
