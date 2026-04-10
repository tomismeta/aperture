import type { AttentionResponse, AttentionSignal } from "@tomismeta/aperture-core";
import type { ApertureTrace } from "../../core/src/internal-contract.js";

import { loadGoldenScenarios } from "./golden.js";
import { runReplayScenario } from "./runner.js";
import type { ReplayRunResult } from "./runner.js";
import type { ReplayScenario } from "./scenario.js";

export type DeterminismAuditRun = {
  scenarios: DeterminismScenarioResult[];
  summary: {
    totalScenarios: number;
    stableScenarios: number;
    driftedScenarios: number;
    determinismScore: number;
  };
};

export type DeterminismScenarioResult = {
  scenario: ReplayScenario;
  stable: boolean;
  normalizedLeft: NormalizedReplayRun;
  normalizedRight: NormalizedReplayRun;
  driftAreas: string[];
};

export type NormalizedReplayRun = {
  finalView: {
    nowInteractionId: string | null;
    nextInteractionIds: string[];
    ambientInteractionIds: string[];
  };
  traces: NormalizedTrace[];
  semantics: NormalizedSemantic[];
  decisions: NormalizedDecision[];
  signals: NormalizedSignal[];
  responses: NormalizedResponse[];
};

type NormalizedTrace =
  | {
      eventType: string;
      evaluationKind: "noop";
    }
  | {
      eventType: string;
      evaluationKind: "clear";
      taskId: string;
    }
  | {
      eventType: string;
      evaluationKind: "candidate";
      interactionId: string;
      decisionKind: string;
      resultLane: string;
      reasons: string[];
      policyRationale: string[];
      criterionRationale: string[];
      continuityRules: Array<{ rule: string; kind: string; rationale: string[] }>;
      heuristicRationale: string[];
    };

type CandidateTrace = Extract<ApertureTrace, { evaluation: { kind: "candidate" } }>;

type NormalizedSignal = {
  kind: string;
  taskId: string;
  interactionId: string;
  reason?: string;
  responseKind?: string;
  from?: string;
  fromInteractionId?: string;
  toInteractionId?: string;
  surface?: string;
};

type NormalizedResponse = {
  taskId: string;
  interactionId: string;
  responseKind: string;
};

type NormalizedSemantic = {
  stepIndex: number;
  stepLabel?: string;
  intentFrame: string;
  activityClass?: string;
  toolFamily?: string;
  consequence?: string;
  whyNow?: string;
  confidence: string;
  abstained: boolean;
  relationKinds: string[];
  factors: string[];
  reasons: string[];
  provenance: Record<string, string>;
  ontology?: {
    ask: string;
    activity: string;
    consequence?: string;
    blocking: string;
    episode: string;
    confidence: string;
    source: string;
  };
};

type NormalizedDecision = {
  stepIndex: number;
  stepLabel?: string;
  evaluationKind: "candidate" | "clear" | "noop";
  decisionKind?: string;
  resultLane?: string;
  interactionId?: string;
  semanticConfidence?: string;
  semanticAbstained?: boolean;
  semanticInfluence: string[];
  semanticImpactDecisionBearing: string[];
  semanticImpactExplanatory: string[];
  ambiguity?: {
    reason: string;
    resolution: string;
  } | null;
};

export async function runDeterminismAudit(
  scenarios?: ReplayScenario[],
): Promise<DeterminismAuditRun> {
  const loadedScenarios = scenarios ?? await loadGoldenScenarios();
  const results = loadedScenarios.map((scenario) => compareScenarioDeterminism(scenario));
  const stableScenarios = results.filter((result) => result.stable).length;

  return {
    scenarios: results,
    summary: {
      totalScenarios: results.length,
      stableScenarios,
      driftedScenarios: results.length - stableScenarios,
      determinismScore: results.length === 0 ? 1 : stableScenarios / results.length,
    },
  };
}

export function compareScenarioDeterminism(
  scenario: ReplayScenario,
): DeterminismScenarioResult {
  const left = normalizeReplayRun(runReplayScenario(scenario));
  const right = normalizeReplayRun(runReplayScenario(scenario));
  const driftAreas = collectDriftAreas(left, right);

  return {
    scenario,
    stable: driftAreas.length === 0,
    normalizedLeft: left,
    normalizedRight: right,
    driftAreas,
  };
}

export function normalizeReplayRun(run: ReplayRunResult): NormalizedReplayRun {
  const finalView = run.views.at(-1);

  return {
    finalView: {
      nowInteractionId: finalView?.nowInteractionId ?? null,
      nextInteractionIds: finalView?.nextInteractionIds ?? [],
      ambientInteractionIds: finalView?.ambientInteractionIds ?? [],
    },
    traces: run.traces.map(normalizeTrace),
    semantics: run.semantics.map((semantic) => ({
      stepIndex: semantic.stepIndex,
      ...(semantic.stepLabel ? { stepLabel: semantic.stepLabel } : {}),
      intentFrame: semantic.interpretation.intentFrame,
      ...(semantic.interpretation.activityClass ? { activityClass: semantic.interpretation.activityClass } : {}),
      ...(semantic.interpretation.toolFamily ? { toolFamily: semantic.interpretation.toolFamily } : {}),
      ...(semantic.interpretation.consequence ? { consequence: semantic.interpretation.consequence } : {}),
      ...(semantic.interpretation.whyNow ? { whyNow: semantic.interpretation.whyNow } : {}),
      confidence: semantic.interpretation.confidence,
      abstained: semantic.interpretation.abstained === true,
      relationKinds: semantic.interpretation.relationHints.map((hint) => hint.kind),
      factors: semantic.interpretation.factors,
      reasons: semantic.interpretation.reasons,
      provenance: semantic.interpretation.provenance ?? {},
      ...(semantic.ontology ? { ontology: semantic.ontology } : {}),
    })),
    decisions: run.decisions.map((decision) => ({
      stepIndex: decision.stepIndex,
      ...(decision.stepLabel ? { stepLabel: decision.stepLabel } : {}),
      evaluationKind: decision.evaluationKind,
      ...(decision.decisionKind ? { decisionKind: decision.decisionKind } : {}),
      ...(decision.resultLane ? { resultLane: decision.resultLane } : {}),
      ...(decision.interactionId ? { interactionId: decision.interactionId } : {}),
      ...(decision.semanticConfidence ? { semanticConfidence: decision.semanticConfidence } : {}),
      ...(decision.semanticAbstained === true ? { semanticAbstained: true } : {}),
      semanticInfluence: decision.semanticInfluence ?? [],
      semanticImpactDecisionBearing: decision.semanticImpactDecisionBearing ?? [],
      semanticImpactExplanatory: decision.semanticImpactExplanatory ?? [],
      ...(decision.ambiguity
        ? {
            ambiguity: {
              reason: decision.ambiguity.reason,
              resolution: decision.ambiguity.resolution,
            },
          }
        : {}),
    })),
    signals: run.signals.map(normalizeSignal),
    responses: run.responses.map(normalizeResponse),
  };
}

function collectDriftAreas(
  left: NormalizedReplayRun,
  right: NormalizedReplayRun,
): string[] {
  const drift: string[] = [];
  if (!sameValue(left.finalView, right.finalView)) {
    drift.push("finalView");
  }
  if (!sameValue(left.traces, right.traces)) {
    drift.push("traces");
  }
  if (!sameValue(left.semantics, right.semantics)) {
    drift.push("semantics");
  }
  if (!sameValue(left.decisions, right.decisions)) {
    drift.push("decisions");
  }
  if (!sameValue(left.signals, right.signals)) {
    drift.push("signals");
  }
  if (!sameValue(left.responses, right.responses)) {
    drift.push("responses");
  }
  return drift;
}

function normalizeTrace(trace: ApertureTrace): NormalizedTrace {
  switch (trace.evaluation.kind) {
    case "noop":
      return {
        eventType: trace.event.type,
        evaluationKind: "noop",
      };
    case "clear":
      return {
        eventType: trace.event.type,
        evaluationKind: "clear",
        taskId: trace.evaluation.taskId,
      };
    case "candidate":
      return normalizeCandidateTrace(trace as CandidateTrace);
  }
}

function normalizeCandidateTrace(trace: CandidateTrace): NormalizedTrace {
  return {
    eventType: trace.event.type,
    evaluationKind: "candidate",
    interactionId: trace.evaluation.adjusted.interactionId,
    decisionKind: trace.coordination.kind,
    resultLane: trace.coordination.resultLane,
    reasons: trace.coordination.reasons,
    policyRationale: trace.policy.rationale,
    criterionRationale: trace.policyRules.criterion?.rationale ?? [],
    continuityRules: trace.coordination.continuityEvaluations.map((evaluation) => ({
      rule: evaluation.rule,
      kind: evaluation.kind,
      rationale: evaluation.rationale,
    })),
    heuristicRationale: trace.heuristics.rationale,
  };
}

function normalizeSignal(signal: AttentionSignal): NormalizedSignal {
  return {
    kind: signal.kind,
    taskId: signal.taskId,
    interactionId: signal.interactionId,
    ...("reason" in signal && signal.reason !== undefined ? { reason: signal.reason } : {}),
    ...("responseKind" in signal && signal.responseKind !== undefined ? { responseKind: signal.responseKind } : {}),
    ...("from" in signal && signal.from !== undefined ? { from: signal.from } : {}),
    ...("fromInteractionId" in signal && signal.fromInteractionId !== undefined
      ? { fromInteractionId: signal.fromInteractionId }
      : {}),
    ...("toInteractionId" in signal && signal.toInteractionId !== undefined
      ? { toInteractionId: signal.toInteractionId }
      : {}),
    ...("surface" in signal && signal.surface !== undefined ? { surface: signal.surface } : {}),
  };
}

function normalizeResponse(response: AttentionResponse): NormalizedResponse {
  return {
    taskId: response.taskId,
    interactionId: response.interactionId,
    responseKind: response.response.kind,
  };
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
