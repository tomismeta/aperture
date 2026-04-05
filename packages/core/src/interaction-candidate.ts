import type {
  AttentionAction,
  AttentionContext,
  AttentionFrame,
  AttentionProvenance,
  AttentionResponseSpec,
} from "./frame.js";
import type { AttentionActivityClass, SourceRef } from "./events.js";
import type { AttentionJudgmentInput } from "./judgment-input.js";
import type { SemanticRelationHint } from "./semantic-types.js";

export type AttentionPriority = "background" | "normal" | "high";

/**
 * Attention claim handed into judgment.
 *
 * This is the first fully core-owned routing artifact. It combines:
 *
 * - canonical event facts
 * - frame-facing interaction shape
 * - compiled semantic judgment input
 * - continuity metadata
 *
 * After this point, routing should build on candidate + evidence rather than
 * reaching back into source-native shapes.
 */
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
  judgmentInput: AttentionJudgmentInput;
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
