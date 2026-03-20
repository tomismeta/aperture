import type { AttentionFrame } from "./frame.js";

import { scoreCandidate } from "./frame-score.js";
import type { AttentionCandidate } from "./interaction-candidate.js";

export class FramePlanner {
  plan(candidate: AttentionCandidate, current: AttentionFrame | null): AttentionFrame {
    const isUpdate = current?.interactionId === candidate.interactionId;
    const currentAttention = current?.metadata?.attention;
    const nextAttention = {
      ...(currentAttention && typeof currentAttention === "object" ? currentAttention : {}),
      score: scoreCandidate(candidate),
      scoreOffset: candidate.attentionScoreOffset ?? 0,
      rationale: candidate.attentionRationale ?? [],
    };
    const currentEpisode = current?.metadata?.episode;
    const toolFamily =
      candidate.toolFamily
      ?? (typeof current?.metadata?.toolFamily === "string" ? current.metadata.toolFamily : undefined);
    const nextEpisode =
      candidate.episodeId
        ? {
            ...(currentEpisode && typeof currentEpisode === "object" ? currentEpisode : {}),
            id: candidate.episodeId,
            key: candidate.episodeKey,
            state: candidate.episodeState,
            size: candidate.episodeSize ?? 1,
            evidenceScore: candidate.episodeEvidenceScore ?? 0,
            evidenceReasons: candidate.episodeEvidenceReasons ?? [],
            lastInteractionId: candidate.interactionId,
            updatedAt: candidate.timestamp,
          }
        : currentEpisode;
    const currentSemantic = current?.metadata?.semantic;
    const nextSemantic =
      candidate.relationHints?.length
        ? {
            ...(currentSemantic && typeof currentSemantic === "object" ? currentSemantic : {}),
            relationHints: candidate.relationHints,
          }
        : currentSemantic;

    return {
      id: isUpdate ? current.id : `frame:${candidate.interactionId}`,
      taskId: candidate.taskId,
      interactionId: candidate.interactionId,
      ...(candidate.source !== undefined ? { source: candidate.source } : {}),
      version: (current?.version ?? 0) + 1,
      mode: candidate.mode,
      tone: candidate.tone,
      consequence: candidate.consequence,
      title: candidate.title,
      responseSpec: candidate.responseSpec,
      timing: {
        createdAt: current?.timing.createdAt ?? candidate.timestamp,
        updatedAt: candidate.timestamp,
      },
      metadata: {
        ...(current?.metadata ?? {}),
        attention: nextAttention,
        ...(toolFamily !== undefined ? { toolFamily } : {}),
        ...(nextSemantic ? { semantic: nextSemantic } : {}),
        ...(nextEpisode ? { episode: nextEpisode } : {}),
      },
      ...(candidate.summary !== undefined ? { summary: candidate.summary } : {}),
      ...(candidate.context !== undefined ? { context: candidate.context } : {}),
      ...(candidate.provenance !== undefined ? { provenance: candidate.provenance } : {}),
    };
  }
}
