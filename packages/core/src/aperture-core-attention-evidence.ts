import type { AttentionEvidenceContext, AttentionOperatorPresence } from "./attention-evidence.js";
import {
  buildAttentionEvidenceInput,
  resolveAttentionEvidenceContext,
} from "./attention-evidence.js";
import { deriveAttentionState } from "./attention-state.js";
import type { AttentionFrame, AttentionTaskView, AttentionView } from "./frame.js";
import type { AttentionCandidate } from "./interaction-candidate.js";
import { EpisodeTracker } from "./episode-tracker.js";
import { AttentionSignalStore, summarizeAttentionSignals } from "./attention-signal-store.js";
import type { AttentionSignal } from "./interaction-signal.js";
import type { AttentionSurfaceCapabilities } from "./surface-capabilities.js";
import type { AttentionSignalSummary } from "./signal-summary.js";
import type { CoreClock } from "./time.js";

type ApertureCoreEvidenceRuntime = {
  signals: AttentionSignalStore;
  episodes: EpisodeTracker;
  clock: CoreClock;
  getTaskView(taskId: string): AttentionTaskView;
  getAttentionView(): AttentionView;
  getOperatorPresence(): AttentionOperatorPresence;
  getSurfaceCapabilities(): AttentionSurfaceCapabilities;
};

export class ApertureCoreAttentionEvidence {
  private readonly runtime: ApertureCoreEvidenceRuntime;

  constructor(runtime: ApertureCoreEvidenceRuntime) {
    this.runtime = runtime;
  }

  assemble(taskId: string, currentFrame: AttentionFrame | null): AttentionEvidenceContext {
    const taskSignalSummary = this.runtime.signals.summarize(taskId);
    const globalSignalSummary = this.runtime.signals.summarize();
    const taskAttentionState = deriveAttentionState(taskSignalSummary);
    const globalAttentionState = deriveAttentionState(globalSignalSummary);
    const currentTaskView = this.runtime.getTaskView(taskId);
    const attentionView = this.runtime.getAttentionView();
    const operatorPresence = this.runtime.getOperatorPresence();
    return resolveAttentionEvidenceContext(
      currentFrame,
      buildAttentionEvidenceInput({
        currentFrame,
        currentTaskView,
        currentEpisode: this.runtime.episodes.readFrameEpisode(currentFrame),
        attentionView,
        taskSignalSummary,
        continuitySignalSummary: taskSignalSummary,
        globalSignalSummary,
        taskAttentionState,
        globalAttentionState,
        surfaceCapabilities: this.runtime.getSurfaceCapabilities(),
        operatorPresence,
      }),
      this.runtime.clock.nowMs(),
    );
  }

  augmentContinuitySignalSummary(
    taskId: string,
    candidate: AttentionCandidate,
    evidence: AttentionEvidenceContext,
  ): AttentionEvidenceContext {
    const continuitySignalSummary = this.resolveContinuitySignalSummary(
      taskId,
      candidate,
      evidence.taskSignalSummary,
    );
    if (continuitySignalSummary === evidence.taskSignalSummary) {
      return evidence;
    }

    return {
      ...evidence,
      continuitySignalSummary,
    };
  }

  private resolveContinuitySignalSummary(
    taskId: string,
    candidate: AttentionCandidate,
    taskSignalSummary: AttentionSignalSummary,
  ): AttentionSignalSummary {
    if (!candidate.episodeId) {
      return taskSignalSummary;
    }

    const taskSignals = this.runtime.signals.list(taskId);
    const relatedEpisodeSignals = this.runtime.signals
      .list()
      .filter(
        (signal) => signal.taskId !== taskId && readSignalEpisodeId(signal) === candidate.episodeId,
      );

    if (relatedEpisodeSignals.length === 0) {
      return taskSignalSummary;
    }

    return summarizeAttentionSignals(
      [...taskSignals, ...relatedEpisodeSignals].sort((left, right) =>
        left.timestamp.localeCompare(right.timestamp),
      ),
    );
  }
}

function readSignalEpisodeId(signal: AttentionSignal): string | null {
  const episode = signal.metadata?.episode;
  if (!episode || typeof episode !== "object" || Array.isArray(episode)) {
    return null;
  }
  const id = (episode as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}
