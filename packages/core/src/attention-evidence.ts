import { idleAttentionBurden, type AttentionBurden } from "./attention-burden.js";
import type { AttentionState } from "./attention-state.js";
import type { EpisodeSummary } from "./episode-tracker.js";
import type { AttentionFrame, AttentionTaskView, AttentionView } from "./frame.js";
import { idleAttentionPressure, type AttentionPressure } from "./attention-pressure.js";
import type { AttentionSignalSummary } from "./signal-summary.js";
import {
  baseAttentionSurfaceCapabilities,
  type AttentionSurfaceCapabilities,
} from "./surface-capabilities.js";

export type AttentionOperatorPresence = "present" | "absent";

export type AttentionEvidenceContext = {
  currentFrame: AttentionFrame | null;
  currentTaskView: AttentionTaskView;
  currentEpisode: EpisodeSummary | null;
  attentionView: AttentionView;
  taskSignalSummary: AttentionSignalSummary;
  globalSignalSummary: AttentionSignalSummary;
  taskAttentionState: AttentionState;
  globalAttentionState: AttentionState;
  pressureForecast: AttentionPressure;
  attentionBurden: AttentionBurden;
  surfaceCapabilities: AttentionSurfaceCapabilities;
  operatorPresence: AttentionOperatorPresence;
};

export type AttentionEvidenceInput = Partial<AttentionEvidenceContext>;

export function createAttentionEvidenceContext(
  input: AttentionEvidenceInput = {},
): AttentionEvidenceContext {
  return {
    currentFrame: input.currentFrame ?? null,
    currentTaskView: input.currentTaskView ?? emptyTaskView(),
    currentEpisode: input.currentEpisode ?? null,
    attentionView: input.attentionView ?? emptyAttentionView(),
    taskSignalSummary: input.taskSignalSummary ?? emptySignalSummary(),
    globalSignalSummary: input.globalSignalSummary ?? emptySignalSummary(),
    taskAttentionState: input.taskAttentionState ?? "monitoring",
    globalAttentionState: input.globalAttentionState ?? "monitoring",
    pressureForecast: input.pressureForecast ?? idleAttentionPressure(),
    attentionBurden: input.attentionBurden ?? idleAttentionBurden(),
    surfaceCapabilities: input.surfaceCapabilities
      ? {
          topology: { ...input.surfaceCapabilities.topology },
          responses: { ...input.surfaceCapabilities.responses },
        }
      : {
          topology: { ...baseAttentionSurfaceCapabilities.topology },
          responses: { ...baseAttentionSurfaceCapabilities.responses },
        },
    operatorPresence: input.operatorPresence ?? "present",
  };
}

function emptyTaskView(): AttentionTaskView {
  return {
    active: null,
    queued: [],
    ambient: [],
  };
}

function emptyAttentionView(): AttentionView {
  return {
    active: null,
    queued: [],
    ambient: [],
  };
}

function emptySignalSummary(): AttentionSignalSummary {
  return {
    recentSignals: 0,
    lifetimeSignals: 0,
    counts: {
      presented: 0,
      viewed: 0,
      responded: 0,
      dismissed: 0,
      deferred: 0,
      contextExpanded: 0,
      contextSkipped: 0,
      timedOut: 0,
      returned: 0,
      attentionShifted: 0,
    },
    deferred: {
      queued: 0,
      suppressed: 0,
      manual: 0,
    },
    responseRate: 0,
    dismissalRate: 0,
    averageResponseLatencyMs: null,
    averageDismissalLatencyMs: null,
    lastSignalAt: null,
  };
}
