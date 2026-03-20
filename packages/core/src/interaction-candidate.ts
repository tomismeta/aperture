import type {
  AttentionAction,
  AttentionContext,
  AttentionFrame,
  AttentionProvenance,
  AttentionResponseSpec,
} from "./frame.js";
import type { AttentionActivityClass, SourceRef } from "./events.js";
import type { SemanticRelationHint } from "./semantic-types.js";

export type AttentionPriority = "background" | "normal" | "high";

export type AttentionCandidate = {
  taskId: string;
  interactionId: string;
  source?: SourceRef;
  toolFamily?: string;
  activityClass?: AttentionActivityClass;
  mode: AttentionFrame["mode"];
  tone: AttentionFrame["tone"];
  consequence: AttentionFrame["consequence"];
  title: string;
  summary?: string;
  context?: AttentionContext;
  provenance?: AttentionProvenance;
  relationHints?: SemanticRelationHint[];
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
