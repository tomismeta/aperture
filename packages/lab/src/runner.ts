import {
  ApertureCore,
  type AttentionFrame,
  type AttentionResponse,
  type AttentionSignal,
} from "@tomismeta/aperture-core";
import type { ApertureTrace } from "../../core/src/trace.js";
import { interpretSourceEvent } from "../../core/src/semantic-interpreter.js";

import type {
  ReplayObservationStep,
  ReplayScenario,
  ReplaySemanticSnapshot,
  ReplayViewSnapshot,
} from "./scenario.js";

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
};

export function runReplayScenario(scenario: ReplayScenario): ReplayRunResult {
  const core = new ApertureCore(scenario.core);
  const traces: ApertureTrace[] = [];
  const signals: AttentionSignal[] = [];
  const responses: AttentionResponse[] = [];
  const steps: ReplayStepResult[] = [];
  const views: ReplayViewSnapshot[] = [];
  const semantics: ReplaySemanticSnapshot[] = [];

  core.onTrace((trace) => {
    traces.push(trace);
  });
  core.onSignal((signal) => {
    signals.push(signal);
  });
  core.onResponse((response) => {
    responses.push(response);
  });

  scenario.steps.forEach((step, stepIndex) => {
    let frame: AttentionFrame | null = null;

    switch (step.kind) {
      case "publish":
        frame = core.publish(step.event);
        break;
      case "publishSource":
        semantics.push({
          stepIndex,
          stepKind: step.kind,
          ...(step.label ? { stepLabel: step.label } : {}),
          interpretation: interpretSourceEvent(step.event),
        });
        frame = core.publishSourceEvent(step.event);
        break;
      case "submit":
        core.submit(step.response);
        break;
      case "signal":
        core.recordSignal(step.signal);
        break;
      case "markViewed":
        core.markViewed(step.taskId, step.interactionId, {
          ...(step.surface !== undefined ? { surface: step.surface } : {}),
        });
        break;
      case "markTimedOut":
        core.markTimedOut(step.taskId, step.interactionId, {
          ...(step.surface !== undefined ? { surface: step.surface } : {}),
          ...(step.timeoutMs !== undefined ? { timeoutMs: step.timeoutMs } : {}),
        });
        break;
      case "markContextExpanded":
        core.markContextExpanded(step.taskId, step.interactionId, {
          ...(step.surface !== undefined ? { surface: step.surface } : {}),
          ...(step.section !== undefined ? { section: step.section } : {}),
        });
        break;
      case "markContextSkipped":
        core.markContextSkipped(step.taskId, step.interactionId, {
          ...(step.surface !== undefined ? { surface: step.surface } : {}),
          ...(step.section !== undefined ? { section: step.section } : {}),
        });
        break;
    }

    steps.push({
      stepIndex,
      step,
      frame,
    });

    const attentionView = core.getAttentionView();
    views.push({
      stepIndex,
      stepKind: step.kind,
      activeInteractionId: attentionView.active?.interactionId ?? null,
      queuedInteractionIds: attentionView.queued.map((queued) => queued.interactionId),
      ambientInteractionIds: attentionView.ambient.map((ambient) => ambient.interactionId),
      attentionView,
    });
  });

  return {
    scenario,
    steps,
    traces,
    signals,
    responses,
    views,
    semantics,
  };
}
