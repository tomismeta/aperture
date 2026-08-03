import {
  ApertureCore,
  type AttentionFrame,
  type AttentionResponse,
  type AttentionSignal,
} from "@tomismeta/aperture-core";
import {
  buildAttentionJudgmentInput,
  subscribeInternalTrace,
  type ApertureTrace,
} from "@tomismeta/aperture-core/internal";
import { normalizeSourceEvent } from "@tomismeta/aperture-core/semantic";

import type {
  ReplayObservationStep,
  ReplayDecisionSnapshot,
  ReplayNormalizedEventSnapshot,
  ReplayScenario,
  ReplaySemanticSnapshot,
  ReplayViewSnapshot,
} from "./scenario.js";
import { buildDecisionSnapshot } from "./replay-decision-snapshot.js";
import { sourceEventWithRehydratedSourceQuality } from "./source-event-quality.js";

export type ReplayRunOptions = {
  initialTimeMs?: number;
  rehydrateSourceQuality?: boolean;
  stepTimeSource?: (input: {
    step: ReplayObservationStep;
    stepIndex: number;
    previousTimeMs: number;
  }) => number;
};

export type ReplayStepResult = {
  stepIndex: number;
  step: ReplayObservationStep;
  frame: AttentionFrame | null;
};

export type ReplayRunResult = {
  scenario: ReplayScenario;
  steps: ReplayStepResult[];
  traces: ApertureTrace[];
  signals: AttentionSignal[];
  responses: AttentionResponse[];
  views: ReplayViewSnapshot[];
  semantics: ReplaySemanticSnapshot[];
  normalizedEvents: ReplayNormalizedEventSnapshot[];
  decisions: ReplayDecisionSnapshot[];
};

export function runReplayScenario(
  scenario: ReplayScenario,
  options: ReplayRunOptions = {},
): ReplayRunResult {
  let currentTimeMs = options.initialTimeMs ?? Date.now();
  const usesReplayClock =
    options.initialTimeMs !== undefined || options.stepTimeSource !== undefined;
  const coreOptions = !usesReplayClock
    ? scenario.core
    : {
        ...(scenario.core ?? {}),
        timeSource: () => currentTimeMs,
      };
  const core = new ApertureCore(coreOptions);
  const traces: ApertureTrace[] = [];
  const signals: AttentionSignal[] = [];
  const responses: AttentionResponse[] = [];
  const steps: ReplayStepResult[] = [];
  const views: ReplayViewSnapshot[] = [];
  const semantics: ReplaySemanticSnapshot[] = [];
  const normalizedEvents: ReplayNormalizedEventSnapshot[] = [];
  const decisions: ReplayDecisionSnapshot[] = [];

  subscribeInternalTrace(core, (trace) => {
    traces.push(trace);
  });
  core.onSignal((signal) => {
    signals.push(signal);
  });
  core.onResponse((response) => {
    responses.push(response);
  });

  scenario.steps.forEach((step, stepIndex) => {
    const replayStep =
      options.rehydrateSourceQuality === true && step.kind === "publishSource"
        ? { ...step, event: sourceEventWithRehydratedSourceQuality(step.event) }
        : step;

    if (options.stepTimeSource !== undefined) {
      currentTimeMs = options.stepTimeSource({
        step: replayStep,
        stepIndex,
        previousTimeMs: currentTimeMs,
      });
    }

    let frame: AttentionFrame | null = null;
    const traceCountBeforeStep = traces.length;

    switch (replayStep.kind) {
      case "publish":
        frame = core.publish(replayStep.event);
        break;
      case "publishSource": {
        const normalized = normalizeSourceEvent(replayStep.event);
        if (!normalized.semantic) {
          throw new Error(
            "Normalized source events must preserve semantic interpretation for replay capture.",
          );
        }
        const judgmentInput = buildAttentionJudgmentInput(normalized);
        if (!judgmentInput.ontology) {
          throw new Error("Normalized source events must compile attention ontology for replay.");
        }
        semantics.push({
          stepIndex,
          stepKind: replayStep.kind,
          ...(step.label ? { stepLabel: step.label } : {}),
          interpretation: normalized.semantic,
          ontology: judgmentInput.ontology,
        });
        normalizedEvents.push({
          stepIndex,
          stepKind: replayStep.kind,
          ...(step.label ? { stepLabel: step.label } : {}),
          event: normalized,
        });
        frame = core.publish(normalized);
        break;
      }
      case "submit":
        core.submit(replayStep.response);
        break;
      case "signal":
        core.recordSignal(replayStep.signal);
        break;
      case "markViewed":
        core.markViewed(replayStep.taskId, replayStep.interactionId, {
          ...(replayStep.surface !== undefined ? { surface: replayStep.surface } : {}),
        });
        break;
      case "markTimedOut":
        core.markTimedOut(replayStep.taskId, replayStep.interactionId, {
          ...(replayStep.surface !== undefined ? { surface: replayStep.surface } : {}),
          ...(replayStep.timeoutMs !== undefined ? { timeoutMs: replayStep.timeoutMs } : {}),
        });
        break;
      case "markContextExpanded":
        core.markContextExpanded(replayStep.taskId, replayStep.interactionId, {
          ...(replayStep.surface !== undefined ? { surface: replayStep.surface } : {}),
          ...(replayStep.section !== undefined ? { section: replayStep.section } : {}),
        });
        break;
      case "markContextSkipped":
        core.markContextSkipped(replayStep.taskId, replayStep.interactionId, {
          ...(replayStep.surface !== undefined ? { surface: replayStep.surface } : {}),
          ...(replayStep.section !== undefined ? { section: replayStep.section } : {}),
        });
        break;
    }

    steps.push({
      stepIndex,
      step: replayStep,
      frame,
    });

    const attentionView = core.getAttentionView();
    views.push({
      stepIndex,
      stepKind: replayStep.kind,
      nowInteractionId: attentionView.now?.interactionId ?? null,
      nextInteractionIds: attentionView.next.map((queued) => queued.interactionId),
      ambientInteractionIds: attentionView.ambient.map((ambient) => ambient.interactionId),
      attentionView,
    });

    if (replayStep.kind === "publish" || replayStep.kind === "publishSource") {
      const newTraces = traces.slice(traceCountBeforeStep);
      const snapshot = buildDecisionSnapshot(replayStep, stepIndex, newTraces.at(-1));
      if (snapshot) {
        decisions.push(snapshot);
      }
    }
  });

  return {
    scenario,
    steps,
    traces,
    signals,
    responses,
    views,
    semantics,
    normalizedEvents,
    decisions,
  };
}
