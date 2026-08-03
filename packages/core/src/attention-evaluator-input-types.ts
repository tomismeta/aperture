import type { AttentionBurden } from "./attention-burden.js";
import type {
  AttentionClaim,
  AttentionClaimContext,
  AttentionClaimEpisode,
  AttentionClaimProvenance,
  AttentionClaimResponseSpec,
} from "./attention-claim.js";
import type { AttentionEvidenceInput } from "./attention-evidence.js";
import type { AttentionOperatorPresence } from "./attention-decision-record.js";
import type { AttentionEvaluationConfig } from "./attention-evaluator-config.js";
import type { AttentionPressure } from "./attention-pressure.js";
import type { SourceRef } from "./events.js";
import type { AttentionFrame } from "./frame.js";
import type { AttentionCandidate } from "./interaction-candidate.js";

export type AttentionEvaluationClock = string | number;

export type AttentionEvaluationFrame = {
  id: string;
  taskId: string;
  interactionId: string;
  source?: SourceRef;
  mode: AttentionClaim["mode"];
  tone: AttentionClaim["tone"];
  consequence: AttentionClaim["consequence"];
  title: string;
  summary?: string;
  context?: AttentionClaimContext;
  responseSpec?: AttentionClaimResponseSpec;
  provenance?: AttentionClaimProvenance;
  timestamp: string;
  updatedAt?: string;
  expiresAt?: string;
  scoreAdjustment?: number;
  episode?: AttentionClaimEpisode;
};

export type AttentionEvaluationContext = {
  current?: AttentionEvaluationFrame | null;
  currentEpisode?: AttentionClaimEpisode | null;
  pressure?: AttentionPressure;
  burden?: AttentionBurden;
  operatorPresence?: AttentionOperatorPresence;
};

export type AttentionEvaluationInput = {
  claim: AttentionClaim;
  context?: AttentionEvaluationContext;
  config?: AttentionEvaluationConfig;
  now?: AttentionEvaluationClock;
};

export type InternalAttentionEvaluationInput = {
  candidate: AttentionCandidate;
  current?: AttentionFrame | null;
  context?: AttentionEvidenceInput;
  evaluatedAt: string;
  recordClaim?: AttentionClaim;
};
