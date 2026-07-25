import type { ReplayScenario, ReplayScenarioExpectations } from "./scenario.js";
import { runReplayScenario, type ReplayRunResult } from "./runner.js";
import { scoreReplayRun } from "./scorecard.js";
import type {
  CreateScenarioOptions,
  CreateSessionBundleOptions,
  ReplaySessionBundle,
} from "./session-bundle-model.js";
import { SESSION_BUNDLE_SCHEMA_VERSION } from "./session-bundle-model.js";

export function createSessionBundle(
  result: ReplayRunResult,
  options: CreateSessionBundleOptions = {},
): ReplaySessionBundle {
  const scorecard = scoreReplayRun(result);

  return {
    schemaVersion: SESSION_BUNDLE_SCHEMA_VERSION,
    sessionId: options.sessionId ?? result.scenario.id,
    title: result.scenario.title,
    ...(result.scenario.description !== undefined
      ? { description: result.scenario.description }
      : {}),
    ...(result.scenario.doctrineTags !== undefined
      ? { doctrineTags: result.scenario.doctrineTags }
      : {}),
    ...(options.source !== undefined ? { source: options.source } : {}),
    exportedAt: options.exportedAt ?? new Date().toISOString(),
    ...(result.scenario.core !== undefined ? { core: result.scenario.core } : {}),
    steps: result.scenario.steps,
    normalizedEvents: result.normalizedEvents,
    traces: result.traces,
    signals: result.signals,
    responses: result.responses,
    viewSnapshots: result.views,
    semanticSnapshots: result.semantics,
    decisionSnapshots: result.decisions,
    outcomes: scorecard.outcomes,
  };
}

export function createSessionBundleFromScenario(
  scenario: ReplayScenario,
  options: CreateSessionBundleOptions = {},
): ReplaySessionBundle {
  if (!options.replayTimeSource) {
    return createSessionBundle(runReplayScenario(scenario), options);
  }
  const replayScenario: ReplayScenario = {
    ...scenario,
    core: {
      ...(scenario.core ?? {}),
      timeSource: options.replayTimeSource,
    },
  };
  return createSessionBundle({ ...runReplayScenario(replayScenario), scenario }, options);
}

export function createScenarioFromSessionBundle(
  bundle: ReplaySessionBundle,
  options: CreateScenarioOptions = {},
): ReplayScenario {
  const doctrineTags = uniqueStrings([
    ...(bundle.doctrineTags ?? []),
    ...(options.doctrineTags ?? []),
  ]);
  const source = options.source ?? bundle.source;
  const includeOutcomeExpectations = options.includeOutcomeExpectations ?? true;
  const provenance = options.provenance;

  return {
    id: options.id ?? `bundle:${bundle.sessionId}`,
    title: options.title ?? bundle.title,
    ...(options.description !== undefined
      ? { description: options.description }
      : bundle.description !== undefined
        ? { description: bundle.description }
        : {}),
    ...(doctrineTags.length > 0 ? { doctrineTags } : {}),
    ...(source !== undefined ? { source } : {}),
    ...(provenance !== undefined ? { provenance } : {}),
    ...(options.core !== undefined
      ? { core: options.core }
      : bundle.core !== undefined
        ? { core: bundle.core }
        : {}),
    ...(includeOutcomeExpectations ? { expectations: expectationsFromBundle(bundle) } : {}),
    steps: bundle.steps,
  };
}

export function sessionBundleToScenario(bundle: ReplaySessionBundle): ReplayScenario {
  return createScenarioFromSessionBundle(bundle, {
    includeOutcomeExpectations: false,
  });
}

export function runSessionBundle(bundle: ReplaySessionBundle): ReplayRunResult {
  return runReplayScenario(sessionBundleToScenario(bundle));
}

function expectationsFromBundle(bundle: ReplaySessionBundle): ReplayScenarioExpectations {
  return {
    finalNowInteractionId: bundle.outcomes.finalNowInteractionId,
    nextInteractionIds: bundle.outcomes.finalNextInteractionIds,
    ambientInteractionIds: bundle.outcomes.finalAmbientInteractionIds,
    resultLaneCounts: {
      now: bundle.outcomes.finalNowInteractionId ? 1 : 0,
      next: bundle.outcomes.finalNextCount,
      ambient: bundle.outcomes.finalAmbientCount,
    },
  };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}
