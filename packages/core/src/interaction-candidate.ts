import type {
  AttentionAction,
  AttentionContext,
  AttentionFrame,
  AttentionProvenance,
  AttentionResponseSpec,
} from "./frame.js";
import type { SourceRef } from "./events.js";

export type AttentionPriority = "background" | "normal" | "high";
export type InteractionPriority = AttentionPriority;

export type AttentionCandidate = {
  taskId: string;
  interactionId: string;
  source?: SourceRef;
  toolFamily?: string;
  mode: AttentionFrame["mode"];
  tone: AttentionFrame["tone"];
  consequence: AttentionFrame["consequence"];
  title: string;
  summary?: string;
  context?: AttentionContext;
  provenance?: AttentionProvenance;
  responseSpec: AttentionResponseSpec;
  priority: AttentionPriority;
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
export type InteractionCandidate = AttentionCandidate;

export type ApprovalCandidate = AttentionCandidate & {
  mode: "approval";
  responseSpec: {
    kind: "approval";
    actions: AttentionAction[];
    requireReason?: boolean;
  };
};
