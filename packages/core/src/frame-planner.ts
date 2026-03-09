import type { Frame } from "./index.js";

import { scoreCandidate } from "./frame-score.js";
import type { InteractionCandidate } from "./interaction-candidate.js";

export class FramePlanner {
  plan(candidate: InteractionCandidate, current: Frame | null): Frame {
    const isUpdate = current?.interactionId === candidate.interactionId;
    const currentAttention = current?.metadata?.attention;
    const nextAttention = {
      ...(currentAttention && typeof currentAttention === "object" ? currentAttention : {}),
      score: scoreCandidate(candidate),
      scoreOffset: candidate.attentionScoreOffset ?? 0,
      rationale: candidate.attentionRationale ?? [],
    };

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
      },
      ...(candidate.summary !== undefined ? { summary: candidate.summary } : {}),
      ...(candidate.context !== undefined ? { context: candidate.context } : {}),
      ...(candidate.provenance !== undefined ? { provenance: candidate.provenance } : {}),
    };
  }
}
