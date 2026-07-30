import type { AttentionBurden } from "./attention-burden.js";
import type {
  AttentionClaim,
  AttentionClaimContext,
  AttentionClaimEpisode,
  AttentionClaimJudgment,
  AttentionClaimProvenance,
  AttentionClaimResponseSpec,
} from "./attention-claim.js";
import type { AttentionEvidenceInput } from "./attention-evidence.js";
import type { AttentionOperatorPresence } from "./attention-decision-record.js";
import type { AttentionEvaluationConfig } from "./attention-evaluator-config.js";
import type { AttentionPressure } from "./attention-pressure.js";
import type { EpisodeSummary } from "./episode-tracker.js";
import type { SourceRef } from "./events.js";
import type { AttentionFrame } from "./frame.js";
import type { AttentionCandidate } from "./interaction-candidate.js";
import { formatTimestamp, parseTimestamp } from "./time.js";

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

export function normalizePublicEvaluationInput(
  input: AttentionEvaluationInput,
): InternalAttentionEvaluationInput {
  assertPublicCurrentFrameBoundary(input);
  const claim = normalizeAttentionClaim(input.claim);
  assertValidClaimTimestamp(claim.timestamp);

  const evaluatedAt = normalizeEvaluationTimestamp(claim.timestamp, input.now);
  const publicContext = normalizeEvaluationContext(input.context);

  return {
    candidate: buildCandidateFromClaim(claim),
    current: publicContext.current,
    context: publicContext.context,
    evaluatedAt,
    recordClaim: claim,
  };
}

function normalizeAttentionClaim(claim: AttentionClaim): AttentionClaim {
  return {
    taskId: claim.taskId,
    interactionId: claim.interactionId,
    ...(claim.source !== undefined ? { source: claim.source } : {}),
    ...(claim.toolFamily !== undefined ? { toolFamily: claim.toolFamily } : {}),
    ...(claim.activityClass !== undefined ? { activityClass: claim.activityClass } : {}),
    mode: claim.mode,
    tone: claim.tone,
    consequence: claim.consequence,
    title: claim.title,
    ...(claim.summary !== undefined ? { summary: claim.summary } : {}),
    ...(claim.context !== undefined ? { context: claim.context } : {}),
    ...(claim.provenance !== undefined ? { provenance: claim.provenance } : {}),
    ...(claim.judgment !== undefined ? { judgment: claim.judgment } : {}),
    ...(claim.relationHints !== undefined ? { relationHints: claim.relationHints } : {}),
    responseSpec: claim.responseSpec,
    priority: claim.priority,
    blocking: claim.blocking,
    timestamp: claim.timestamp,
    ...(claim.scoreAdjustment !== undefined ? { scoreAdjustment: claim.scoreAdjustment } : {}),
    ...(claim.scoreRationale !== undefined ? { scoreRationale: claim.scoreRationale } : {}),
    ...(claim.episode !== undefined
      ? {
          episode: {
            ...claim.episode,
            evidenceReasons: [...claim.episode.evidenceReasons],
          },
        }
      : {}),
  };
}

function assertPublicCurrentFrameBoundary(input: AttentionEvaluationInput): void {
  if ("current" in (input as Record<string, unknown>)) {
    throw new TypeError(
      "Use context.current for attention evaluation; top-level current is not supported.",
    );
  }

  const context = input.context as Record<string, unknown> | undefined;
  if (context !== undefined && "currentFrame" in context) {
    throw new TypeError(
      "Use context.current for attention evaluation; context.currentFrame is internal-only.",
    );
  }
}

function assertValidClaimTimestamp(timestamp: string): void {
  if (parseTimestamp(timestamp) === null) {
    throw new RangeError("Attention claim timestamp must be a valid timestamp.");
  }
}

function normalizeEvaluationTimestamp(
  claimTimestamp: string,
  now: AttentionEvaluationClock | undefined,
): string {
  if (now === undefined) {
    return claimTimestamp;
  }

  if (typeof now === "number") {
    if (!Number.isFinite(now)) {
      throw new RangeError("Attention evaluation clock must be finite.");
    }

    return formatTimestamp(now);
  }

  if (parseTimestamp(now) === null) {
    throw new RangeError("Attention evaluation clock must be a valid timestamp.");
  }

  return now;
}

function buildCandidateFromClaim(claim: AttentionClaim): AttentionCandidate {
  return {
    taskId: claim.taskId,
    interactionId: claim.interactionId,
    ...(claim.source !== undefined ? { source: claim.source } : {}),
    ...(claim.toolFamily !== undefined ? { toolFamily: claim.toolFamily } : {}),
    ...(claim.activityClass !== undefined ? { activityClass: claim.activityClass } : {}),
    mode: claim.mode,
    tone: claim.tone,
    consequence: claim.consequence,
    title: claim.title,
    ...(claim.summary !== undefined ? { summary: claim.summary } : {}),
    ...(claim.context !== undefined ? { context: claim.context } : {}),
    ...(claim.provenance !== undefined ? { provenance: claim.provenance } : {}),
    judgmentInput: buildJudgmentInputFromClaim(claim.judgment),
    ...(claim.relationHints !== undefined ? { relationHints: claim.relationHints } : {}),
    responseSpec: claim.responseSpec,
    priority: claim.priority,
    blocking: claim.blocking,
    timestamp: claim.timestamp,
    ...(claim.scoreAdjustment !== undefined ? { attentionScoreOffset: claim.scoreAdjustment } : {}),
    ...(claim.scoreRationale !== undefined ? { attentionRationale: claim.scoreRationale } : {}),
    ...(claim.episode !== undefined
      ? {
          episodeId: claim.episode.id,
          episodeKey: claim.episode.key,
          episodeState: claim.episode.state,
          episodeSize: claim.episode.size,
          episodeEvidenceScore: claim.episode.evidenceScore,
          episodeEvidenceReasons: [...claim.episode.evidenceReasons],
        }
      : {}),
  };
}

function buildJudgmentInputFromClaim(
  judgment: AttentionClaimJudgment | undefined,
): AttentionCandidate["judgmentInput"] {
  const observationalStatusConflict = judgment?.observationalStatusConflict;

  return {
    ...(judgment?.ontology !== undefined ? { ontology: judgment.ontology } : {}),
    ...(judgment?.semanticEvidence !== undefined
      ? {
          semanticEvidence: {
            confidence: judgment.semanticEvidence.confidence,
            source: judgment.semanticEvidence.source,
            strength: judgment.semanticEvidence.strength,
            abstained: judgment.semanticEvidence.abstained ?? false,
          },
        }
      : {}),
    ...(judgment?.relationEvidence !== undefined
      ? { relationEvidence: judgment.relationEvidence }
      : {}),
    blockedLikeStatus: judgment?.blockedLikeStatus ?? false,
    ...(judgment?.routineObservationalStatusConflict === true ||
    observationalStatusConflict !== undefined
      ? { routineObservationalStatusConflict: true }
      : {}),
    ...(observationalStatusConflict !== undefined ? { observationalStatusConflict } : {}),
  };
}

function normalizeEvaluationContext(context: AttentionEvaluationContext | undefined): {
  current: AttentionFrame | null;
  context: AttentionEvidenceInput;
} {
  const current =
    context?.current === undefined || context.current === null
      ? null
      : buildFrameFromEvaluationFrame(context.current);

  return {
    current,
    context: {
      ...(context?.currentEpisode !== undefined && context.currentEpisode !== null
        ? { currentEpisode: buildEpisodeSummary(context.currentEpisode) }
        : {}),
      ...(context?.pressure !== undefined ? { pressureForecast: context.pressure } : {}),
      ...(context?.burden !== undefined ? { attentionBurden: context.burden } : {}),
      ...(context?.operatorPresence !== undefined
        ? { operatorPresence: context.operatorPresence }
        : {}),
    },
  };
}

function buildFrameFromEvaluationFrame(frame: AttentionEvaluationFrame): AttentionFrame {
  assertValidClaimTimestamp(frame.timestamp);
  if (frame.updatedAt !== undefined) {
    assertValidClaimTimestamp(frame.updatedAt);
  }
  if (frame.expiresAt !== undefined) {
    assertValidClaimTimestamp(frame.expiresAt);
  }

  const metadata = buildFrameMetadata(frame);

  return {
    id: frame.id,
    taskId: frame.taskId,
    interactionId: frame.interactionId,
    ...(frame.source !== undefined ? { source: frame.source } : {}),
    version: 1,
    mode: frame.mode,
    tone: frame.tone,
    consequence: frame.consequence,
    title: frame.title,
    ...(frame.summary !== undefined ? { summary: frame.summary } : {}),
    ...(frame.context !== undefined ? { context: frame.context } : {}),
    ...(frame.responseSpec !== undefined ? { responseSpec: frame.responseSpec } : {}),
    ...(frame.provenance !== undefined ? { provenance: frame.provenance } : {}),
    timing: {
      createdAt: frame.timestamp,
      updatedAt: frame.updatedAt ?? frame.timestamp,
      ...(frame.expiresAt !== undefined ? { expiresAt: frame.expiresAt } : {}),
    },
    ...(metadata !== undefined ? { metadata } : {}),
  };
}

function buildFrameMetadata(frame: AttentionEvaluationFrame): Record<string, unknown> | undefined {
  const metadata: Record<string, unknown> = {};

  if (frame.scoreAdjustment !== undefined) {
    metadata.attention = { scoreOffset: frame.scoreAdjustment };
  }
  if (frame.episode !== undefined) {
    metadata.episode = buildEpisodeSummary(frame.episode);
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function buildEpisodeSummary(episode: AttentionClaimEpisode): EpisodeSummary {
  return {
    id: episode.id,
    key: episode.key,
    state: episode.state,
    size: episode.size,
    evidenceScore: episode.evidenceScore,
    evidenceReasons: [...episode.evidenceReasons],
    lastInteractionId: episode.lastInteractionId,
    updatedAt: episode.updatedAt,
  };
}
