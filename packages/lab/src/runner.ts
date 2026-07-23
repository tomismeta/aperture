import {
  ApertureCore,
  type AttentionFrame,
  type AttentionResponse,
  type AttentionSignal,
} from "@tomismeta/aperture-core";
import {
  subscribeInternalTrace,
  isCandidateTrace,
  type ApertureTrace,
} from "@tomismeta/aperture-core/internal";
import {
  normalizeSourceEvent,
  readSemanticOntologyDiagnostic,
} from "@tomismeta/aperture-core/semantic";

import type {
  ReplayObservationStep,
  ReplayDecisionSnapshot,
  ReplayNormalizedEventSnapshot,
  ReplayScenario,
  ReplaySemanticSnapshot,
  ReplayViewSnapshot,
} from "./scenario.js";
import type { ReplayCandidateTrace } from "./replay-trace.js";

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

export function runReplayScenario(scenario: ReplayScenario): ReplayRunResult {
  const core = new ApertureCore(scenario.core);
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
    let frame: AttentionFrame | null = null;
    const traceCountBeforeStep = traces.length;

    switch (step.kind) {
      case "publish":
        frame = core.publish(step.event);
        break;
      case "publishSource": {
        const normalized = normalizeSourceEvent(step.event);
        if (!normalized.semantic) {
          throw new Error(
            "Normalized source events must preserve semantic interpretation for replay capture.",
          );
        }
        semantics.push({
          stepIndex,
          stepKind: step.kind,
          ...(step.label ? { stepLabel: step.label } : {}),
          interpretation: normalized.semantic,
          ontology: readSemanticOntologyDiagnostic(step.event, normalized.semantic),
        });
        normalizedEvents.push({
          stepIndex,
          stepKind: step.kind,
          ...(step.label ? { stepLabel: step.label } : {}),
          event: normalized,
        });
        frame = core.publish(normalized);
        break;
      }
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
      nowInteractionId: attentionView.now?.interactionId ?? null,
      nextInteractionIds: attentionView.next.map((queued) => queued.interactionId),
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
    normalizedEvents,
    decisions,
  };
}

export function buildDecisionSemanticSnapshot(
  trace: ReplayCandidateTrace,
): Pick<ReplayDecisionSnapshot, "semanticConfidence" | "semanticAbstained"> {
  const adjusted = trace.evaluation.adjusted as {
    judgmentInput?: {
      semanticEvidence?: {
        confidence?: ReplayDecisionSnapshot["semanticConfidence"];
        abstained?: boolean;
      };
    };
    semanticConfidence?: ReplayDecisionSnapshot["semanticConfidence"];
    semanticAbstained?: boolean;
  };
  const semanticEvidence = adjusted.judgmentInput?.semanticEvidence;
  const confidence =
    semanticEvidence?.confidence ?? adjusted.semanticConfidence ?? trace.semantic?.confidence;
  const abstained =
    semanticEvidence?.abstained ?? adjusted.semanticAbstained ?? trace.semantic?.abstained;

  return {
    ...(confidence !== undefined ? { semanticConfidence: confidence } : {}),
    ...(abstained === true ? { semanticAbstained: true } : {}),
  };
}

export function buildDecisionRecordSnapshot(
  trace: ReplayCandidateTrace,
): Pick<
  ReplayDecisionSnapshot,
  | "decisionRecordRoute"
  | "plannedLane"
  | "decisionRecordCurrentFrameId"
  | "decisionRecordCurrentEpisodeId"
  | "decisionRecordOperatorPresence"
  | "decisionRecordCandidateScore"
  | "decisionRecordValueComponents"
  | "decisionRecordReasons"
  | "decisionRecordReasonCodes"
> {
  const record = trace.decisionRecord;
  if (!record) {
    return {};
  }

  return {
    decisionRecordRoute: record.planning.route,
    plannedLane: record.planning.plannedLane,
    decisionRecordCurrentFrameId: record.evidenceSnapshot.currentFrameId,
    decisionRecordCurrentEpisodeId: record.evidenceSnapshot.currentEpisodeId,
    decisionRecordOperatorPresence: record.evidenceSnapshot.operatorPresence,
    decisionRecordCandidateScore: record.value.candidateScore,
    decisionRecordValueComponents: record.value.breakdown.components,
    decisionRecordReasons: record.planning.reasons,
    ...(record.planning.reasonCodes !== undefined
      ? { decisionRecordReasonCodes: record.planning.reasonCodes }
      : {}),
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
    resultLane: trace.coordination.resultLane,
    interactionId: trace.evaluation.adjusted.interactionId,
    ...buildDecisionSemanticSnapshot(trace),
    ...buildDecisionRecordSnapshot(trace),
    ...(trace.semantic?.influence !== undefined
      ? { semanticInfluence: trace.semantic.influence }
      : {}),
    ...(trace.semantic?.impact.decisionBearing !== undefined
      ? { semanticImpactDecisionBearing: trace.semantic.impact.decisionBearing }
      : {}),
    ...(trace.semantic?.impact.explanatory !== undefined
      ? { semanticImpactExplanatory: trace.semantic.impact.explanatory }
      : {}),
    ambiguity: trace.coordination.ambiguity,
  };
}
