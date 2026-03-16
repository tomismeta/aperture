import { idleAttentionBurden, type AttentionBurden } from "./attention-burden.js";
import { deriveAttentionBurden } from "./attention-burden.js";
import type { AttentionState } from "./attention-state.js";
import type { EpisodeSummary } from "./episode-tracker.js";
import type { AttentionFrame, AttentionTaskView, AttentionView } from "./frame.js";
import {
  forecastAttentionPressure,
  idleAttentionPressure,
  type AttentionPressure,
} from "./attention-pressure.js";
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
    taskSignalSummary: input.taskSignalSummary ?? emptyAttentionSignalSummary(),
    globalSignalSummary: input.globalSignalSummary ?? emptyAttentionSignalSummary(),
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

export function resolveAttentionEvidenceContext(
  currentFrame: AttentionFrame | null,
  input: AttentionEvidenceInput = {},
): AttentionEvidenceContext {
  if (isAttentionEvidenceContext(input)) {
    if (input.currentFrame === currentFrame) {
      return input;
    }

    return createAttentionEvidenceContext({
      ...input,
      currentFrame,
    });
  }

  const globalSignalSummary = input.globalSignalSummary ?? emptyAttentionSignalSummary();
  const pressureForecast = input.pressureForecast ?? forecastAttentionPressure(globalSignalSummary, input.attentionView);
  const operatorPresence = input.operatorPresence ?? "present";

  return createAttentionEvidenceContext({
    ...input,
    currentFrame,
    globalSignalSummary,
    pressureForecast,
    attentionBurden:
      input.attentionBurden
      ?? deriveAttentionBurden(
        globalSignalSummary,
        pressureForecast,
        input.globalAttentionState,
        operatorPresence,
      ),
    operatorPresence,
  });
}

export function isAttentionEvidenceContext(
  input: AttentionEvidenceInput,
): input is AttentionEvidenceContext {
  return (
    "currentFrame" in input
    && "currentTaskView" in input
    && "currentEpisode" in input
    && "attentionView" in input
    && "taskSignalSummary" in input
    && "globalSignalSummary" in input
    && "taskAttentionState" in input
    && "globalAttentionState" in input
    && "pressureForecast" in input
    && "attentionBurden" in input
    && "surfaceCapabilities" in input
    && "operatorPresence" in input
  );
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

export function emptyAttentionSignalSummary(): AttentionSignalSummary {
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
