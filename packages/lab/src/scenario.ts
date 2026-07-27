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
  AttentionOntologyDiagnostic,
} from "@tomismeta/aperture-core/semantic";
import type { KernelDecisionRecordProjectionVersion } from "./artifact-versions.js";
import type { ReplaySemanticCalibrationFamily } from "./semantic-calibration.js";

export type ReplayDecisionPlannedLane = "now" | "next" | "ambient" | "none";
export type ReplayDecisionOperatorPresence = "present" | "absent";
export type ReplayDecisionRoute = "auto_approve" | "activate" | "queue" | "ambient" | "clear";
export type ReplayCoordinationRoute = ReplayDecisionRoute | "suppressed";
export type ReplayEpisodeState =
  | "emerging"
  | "actionable"
  | "batched"
  | "waiting"
  | "stale"
  | "resolved";
export type ReplayDecisionValueComponents = {
  [component: string]: number | undefined;
} & Partial<{
  priority: number;
  consequence: number;
  tone: number;
  blocking: number;
  heuristics: number;
  sourceTrust: number;
  consequenceCalibration: number;
  responseAffinity: number;
  contextCost: number;
  deferralAffinity: number;
}>;

type ReplayDecisionAmbiguity = {
  kind: "interrupt";
  reason: "low_signal" | "small_score_gap";
  resolution: "queue" | "ambient";
};

export type ReplaySemanticProvenanceExpectation = Partial<{
  intentFrame: "source" | "inferred" | "hint";
  activityClass: "source" | "inferred" | "hint";
  toolFamily: "source" | "inferred" | "hint";
  consequence: "source" | "inferred" | "hint";
  whyNow: "source" | "inferred" | "hint";
  relationHints: "source" | "inferred" | "hint";
  confidence: "source" | "inferred" | "hint";
  abstained: "source" | "inferred" | "hint";
}>;

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
  semanticFamilies?: ReplaySemanticCalibrationFamily[];
  source?: ReplayArtifactSource;
  provenance?: ReplayScenarioProvenance;
  expectations?: ReplayScenarioExpectations;
  core?: ApertureCoreOptions;
  steps: ReplayObservationStep[];
};

export type ReplayScenarioExpectations = {
  finalNowInteractionId?: string | null;
  nextInteractionIds?: string[];
  ambientInteractionIds?: string[];
  resultLaneCounts?: {
    now?: number;
    next?: number;
    ambient?: number;
  };
  semanticReadings?: ReplaySemanticExpectation[];
  decisionReadings?: ReplayDecisionExpectation[];
  explanationExpectation?: ReplayExplanationExpectation;
  traceExpectations?: ReplayTraceExpectation;
};

export type ReplayViewSnapshot = {
  stepIndex: number;
  stepKind: ReplayObservationStep["kind"];
  nowInteractionId: string | null;
  nextInteractionIds: string[];
  ambientInteractionIds: string[];
  attentionView: AttentionView;
};

export type ReplaySemanticSnapshot = {
  stepIndex: number;
  stepKind: ReplayObservationStep["kind"];
  stepLabel?: string;
  interpretation: SemanticInterpretation;
  ontology?: AttentionOntologyDiagnostic;
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
  decisionRecordProjectionVersion?: KernelDecisionRecordProjectionVersion;
  decisionKind?: ReplayCoordinationRoute;
  decisionRecordRoute?: ReplayDecisionRoute;
  plannedLane?: ReplayDecisionPlannedLane;
  resultLane?: "now" | "next" | "ambient" | "none";
  interactionId?: string;
  semanticConfidence?: SemanticConfidence;
  semanticAbstained?: boolean;
  semanticInfluence?: string[];
  semanticImpactDecisionBearing?: string[];
  semanticImpactExplanatory?: string[];
  ambiguity?: ReplayDecisionAmbiguity | null;
  episodeId?: string | null;
  episodeKey?: string | null;
  episodeState?: ReplayEpisodeState;
  episodeSize?: number;
  episodeEvidenceScore?: number;
  episodeEvidenceReasons?: string[];
  episodeObsolete?: boolean;
  decisionRecordCurrentFrameId?: string | null;
  decisionRecordCurrentEpisodeId?: string | null;
  decisionRecordOperatorPresence?: ReplayDecisionOperatorPresence;
  decisionRecordCandidateScore?: number;
  decisionRecordValueComponents?: ReplayDecisionValueComponents;
  decisionRecordReasons?: string[];
  decisionRecordReasonCodes?: string[];
  decisionRecordFingerprint?: string;
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
  relationHintsExact?: SemanticRelationHint[];
  whyNowIncludes?: string;
  reasonsInclude?: string[];
  factorsInclude?: string[];
  provenanceIncludes?: ReplaySemanticProvenanceExpectation;
  ontology?: Partial<AttentionOntologyDiagnostic>;
};

export type ReplayDecisionExpectation = {
  stepIndex?: number;
  stepLabel?: string;
  evaluationKind?: "candidate" | "clear" | "noop";
  decisionRecordProjectionVersion?: KernelDecisionRecordProjectionVersion;
  decisionKind?: ReplayCoordinationRoute;
  decisionRecordRoute?: ReplayDecisionRoute;
  plannedLane?: ReplayDecisionPlannedLane;
  resultLane?: "now" | "next" | "ambient" | "none";
  semanticConfidence?: SemanticConfidence;
  semanticAbstained?: boolean;
  semanticInfluenceIncludes?: string[];
  semanticImpactDecisionBearingIncludes?: string[];
  semanticImpactExplanatoryIncludes?: string[];
  ambiguityReason?: ReplayDecisionAmbiguity["reason"] | null;
  ambiguityResolution?: ReplayDecisionAmbiguity["resolution"] | null;
  episodeId?: string | null;
  episodeKey?: string | null;
  episodeState?: ReplayEpisodeState;
  episodeSize?: number;
  episodeEvidenceScore?: number;
  episodeEvidenceReasonsInclude?: string[];
  episodeObsolete?: boolean;
  decisionRecordCurrentFrameId?: string | null;
  decisionRecordCurrentEpisodeId?: string | null;
  decisionRecordOperatorPresence?: ReplayDecisionOperatorPresence;
  decisionRecordCandidateScore?: number;
  decisionRecordValueComponentsInclude?: ReplayDecisionValueComponents;
  decisionRecordReasonsInclude?: string[];
  decisionRecordReasonCodesInclude?: string[];
};

export type ReplayExplanationExpectation = {
  whyNowIncludes?: string;
  continuityRationaleIncludes?: string[];
};

export type ReplayTraceExpectation = {
  ambiguousDecisions?: number;
  ambiguousNext?: number;
  ambiguousAmbient?: number;
  ambiguousLowConfidence?: number;
  ambiguousAbstained?: number;
  ambiguousNextThenActivated?: number;
  ambiguousAmbientThenActivated?: number;
  actionableEpisodes?: number;
  actionableSurfaced?: number;
  actionableActivated?: number;
  deferredThenActivated?: number;
  suppressedThenActivated?: number;
  mergedEpisodeUpdates?: number;
};
