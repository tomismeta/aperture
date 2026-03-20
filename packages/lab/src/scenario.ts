import type {
  ApertureCoreOptions,
  ApertureEvent,
  AttentionResponse,
  AttentionSignal,
  AttentionView,
  SemanticActivityClass,
  SemanticConfidence,
  SemanticConsequenceLevel,
  SemanticIntentFrame,
  SemanticRequestExplicitness,
  SemanticInterpretation,
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
  doctrineTags?: string[];
  expectations?: ReplayScenarioExpectations;
  core?: ApertureCoreOptions;
  steps: ReplayObservationStep[];
};

export type ReplayScenarioExpectations = {
  finalActiveInteractionId?: string | null;
  queuedInteractionIds?: string[];
  ambientInteractionIds?: string[];
  resultBucketCounts?: {
    active?: number;
    queued?: number;
    ambient?: number;
  };
  semanticReadings?: ReplaySemanticExpectation[];
};

export type ReplayViewSnapshot = {
  stepIndex: number;
  stepKind: ReplayObservationStep["kind"];
  activeInteractionId: string | null;
  queuedInteractionIds: string[];
  ambientInteractionIds: string[];
  attentionView: AttentionView;
};

export type ReplaySemanticSnapshot = {
  stepIndex: number;
  stepKind: ReplayObservationStep["kind"];
  stepLabel?: string;
  interpretation: SemanticInterpretation;
};

export type ReplaySemanticExpectation = {
  stepIndex?: number;
  stepLabel?: string;
  intentFrame?: SemanticIntentFrame;
  activityClass?: SemanticActivityClass;
  toolFamily?: string | null;
  operatorActionRequired?: boolean;
  requestExplicitness?: SemanticRequestExplicitness;
  consequence?: SemanticConsequenceLevel;
  confidence?: SemanticConfidence;
  abstained?: boolean;
  whyNowIncludes?: string;
  reasonsInclude?: string[];
  factorsInclude?: string[];
};
