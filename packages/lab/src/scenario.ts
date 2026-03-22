import type {
  ApertureCoreOptions,
  ApertureEvent,
  AttentionResponse,
  AttentionSignal,
  AttentionView,
  SourceEvent,
} from "@tomismeta/aperture-core";
import type {
  SemanticActivityClass,
  SemanticConfidence,
  SemanticConsequenceLevel,
  SemanticIntentFrame,
  SemanticRelationHint,
  SemanticInterpretation,
} from "../../core/src/semantic.js";

type ReplayDecisionAmbiguity = {
  kind: "interrupt";
  reason: "low_signal" | "small_score_gap";
  resolution: "queue" | "ambient";
};

export type ReplayCaptureMetadata = {
  eventTransport?: string;
  semanticCapture?: string;
  responseBridge?: string;
  notes?: string[];
};

export type ReplayArtifactSource = {
  id: string;
  kind?: string;
  label?: string;
  redacted?: boolean;
  capture?: ReplayCaptureMetadata;
};

export type ReplayScenarioProvenance = {
  promotedAt?: string;
  promotedFromBundleSessionId?: string;
  promotedFromPath?: string;
};

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
  source?: ReplayArtifactSource;
  provenance?: ReplayScenarioProvenance;
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
  decisionReadings?: ReplayDecisionExpectation[];
  traceExpectations?: ReplayTraceExpectation;
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

export type ReplayNormalizedEventSnapshot = {
  stepIndex: number;
  stepKind: Extract<ReplayObservationStep["kind"], "publishSource">;
  stepLabel?: string;
  event: ApertureEvent;
};

export type ReplayDecisionSnapshot = {
  stepIndex: number;
  stepKind: ReplayObservationStep["kind"];
  stepLabel?: string;
  evaluationKind: "candidate" | "clear" | "noop";
  decisionKind?: "auto_approve" | "activate" | "queue" | "ambient" | "clear";
  resultBucket?: "active" | "queued" | "ambient" | "none";
  interactionId?: string;
  semanticConfidence?: SemanticConfidence;
  semanticAbstained?: boolean;
  ambiguity?: ReplayDecisionAmbiguity | null;
};

export type ReplaySemanticExpectation = {
  stepIndex?: number;
  stepLabel?: string;
  intentFrame?: SemanticIntentFrame;
  activityClass?: SemanticActivityClass;
  toolFamily?: string | null;
  consequence?: SemanticConsequenceLevel;
  confidence?: SemanticConfidence;
  abstained?: boolean;
  relationKindsInclude?: SemanticRelationHint["kind"][];
  relationKindsExact?: SemanticRelationHint["kind"][];
  whyNowIncludes?: string;
  reasonsInclude?: string[];
  factorsInclude?: string[];
};

export type ReplayDecisionExpectation = {
  stepIndex?: number;
  stepLabel?: string;
  evaluationKind?: "candidate" | "clear" | "noop";
  decisionKind?: "auto_approve" | "activate" | "queue" | "ambient" | "clear";
  resultBucket?: "active" | "queued" | "ambient" | "none";
  semanticConfidence?: SemanticConfidence;
  semanticAbstained?: boolean;
  ambiguityReason?: ReplayDecisionAmbiguity["reason"] | null;
  ambiguityResolution?: ReplayDecisionAmbiguity["resolution"] | null;
};

export type ReplayTraceExpectation = {
  ambiguousDecisions?: number;
  ambiguousQueued?: number;
  ambiguousAmbient?: number;
  ambiguousLowConfidence?: number;
  ambiguousAbstained?: number;
  ambiguousQueuedThenActivated?: number;
  ambiguousAmbientThenActivated?: number;
};
