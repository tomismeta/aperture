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
  ReplayDecisionSnapshot,
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
  decisions: ReplayDecisionSnapshot[];
};

export function runReplayScenario(scenario: ReplayScenario): ReplayRunResult {
  const core = new ApertureCore(scenario.core);
  const traces: ApertureTrace[] = [];
  const signals: AttentionSignal[] = [];
  const responses: AttentionResponse[] = [];
  const steps: ReplayStepResult[] = [];
  const views: ReplayViewSnapshot[] = [];
  const semantics: ReplaySemanticSnapshot[] = [];
  const decisions: ReplayDecisionSnapshot[] = [];

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
    const traceCountBeforeStep = traces.length;

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

    if (step.kind === "publish" || step.kind === "publishSource") {
      const newTraces = traces.slice(traceCountBeforeStep);
      const snapshot = buildDecisionSnapshot(step, stepIndex, newTraces.at(-1));
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
    decisions,
  };
}

function buildDecisionSnapshot(
  step: ReplayObservationStep,
  stepIndex: number,
  trace: ApertureTrace | undefined,
): ReplayDecisionSnapshot | null {
  if (!trace) {
    return null;
  }

  if (!isCandidateTrace(trace)) {
    return {
      stepIndex,
      stepKind: step.kind,
      ...(step.label ? { stepLabel: step.label } : {}),
      evaluationKind: trace.evaluation.kind,
      ...(trace.evaluation.kind === "clear" ? { decisionKind: "clear" } : {}),
    };
  }

  return {
    stepIndex,
    stepKind: step.kind,
    ...(step.label ? { stepLabel: step.label } : {}),
    evaluationKind: "candidate",
    decisionKind: trace.coordination.kind,
    resultBucket: trace.coordination.resultBucket,
    interactionId: trace.evaluation.adjusted.interactionId,
    ...(trace.evaluation.adjusted.semanticConfidence !== undefined
      ? { semanticConfidence: trace.evaluation.adjusted.semanticConfidence }
      : {}),
    ...(trace.evaluation.adjusted.semanticAbstained === true ? { semanticAbstained: true } : {}),
    ambiguity: trace.coordination.ambiguity,
  };
}

function isCandidateTrace(
  trace: ApertureTrace,
): trace is Extract<ApertureTrace, { evaluation: { kind: "candidate" } }> {
  return trace.evaluation.kind === "candidate";
}
