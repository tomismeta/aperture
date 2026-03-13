import type {
  Frame,
  FrameAction,
  FrameContext,
  FrameProvenance,
  FrameResponseSpec,
  SourceRef,
} from "./index.js";

export type InteractionPriority = "background" | "normal" | "high";

export type InteractionCandidate = {
  taskId: string;
  interactionId: string;
  source?: SourceRef;
  toolFamily?: string;
  mode: Frame["mode"];
  tone: Frame["tone"];
  consequence: Frame["consequence"];
  title: string;
  summary?: string;
  context?: FrameContext;
  provenance?: FrameProvenance;
  responseSpec: FrameResponseSpec;
  priority: InteractionPriority;
  blocking: boolean;
  timestamp: string;
  attentionScoreOffset?: number;
  attentionRationale?: string[];
  episodeId?: string;
  episodeKey?: string;
  episodeState?: "emerging" | "actionable" | "batched" | "waiting" | "stale" | "resolved";
  episodeSize?: number;
  episodeEvidenceScore?: number;
  episodeEvidenceReasons?: string[];
};

export type ApprovalCandidate = InteractionCandidate & {
  mode: "approval";
  responseSpec: {
    kind: "approval";
    actions: FrameAction[];
    requireReason?: boolean;
  };
};
