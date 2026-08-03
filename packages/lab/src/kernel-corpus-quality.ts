import { KERNEL_DECISION_RECORD_PROJECTION_VERSION } from "./artifact-versions.js";
import {
  KERNEL_CORPUS_COVERAGE_DIMENSIONS,
  KERNEL_CORPUS_SCENARIO_IDS,
} from "./kernel-corpus-profile.js";
import { compareKernelCanonicalKey } from "./kernel-canonical-json.js";
import type { KernelConformanceScenarioResult } from "./kernel-conformance-support.js";
import type { ReplayScenario, ReplayScenarioExpectations } from "./scenario.js";

const MINIMUM_CORPUS_ASSERTIONS = 3;

export type KernelCorpusDimensionCoverage = {
  missingDimensionIds: string[];
  dimensions: Array<{
    id: string;
    scenarioIds: string[];
    presentScenarioIds: string[];
    missingScenarioIds: string[];
  }>;
};

export type KernelCorpusQualityReport = {
  dimensionCoverage: KernelCorpusDimensionCoverage;
  dimensionIntegrityFailures: string[];
  scenarioQualityFailures: string[];
};

export function assessKernelCorpusQuality(
  scenarios: ReplayScenario[],
  results: KernelConformanceScenarioResult[],
): KernelCorpusQualityReport {
  const byId = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
  const resultIds = results.map((result) => result.id);

  return {
    dimensionCoverage: assessKernelCorpusDimensionCoverage(resultIds),
    dimensionIntegrityFailures: collectDimensionIntegrityFailures(),
    scenarioQualityFailures: [
      ...results.flatMap(collectAssertionStrengthFailures),
      ...KERNEL_CORPUS_SCENARIO_IDS.flatMap((id) => {
        const scenario = byId.get(id);
        return scenario ? collectScenarioStructureFailures(scenario) : [];
      }),
    ],
  };
}

function collectAssertionStrengthFailures(result: KernelConformanceScenarioResult): string[] {
  return result.assertions.total >= MINIMUM_CORPUS_ASSERTIONS
    ? []
    : [`weak_scenario:${result.id}:minimum_assertions`];
}

function collectScenarioStructureFailures(scenario: ReplayScenario): string[] {
  const expectations = scenario.expectations;
  if (!expectations) {
    return [`weak_scenario:${scenario.id}:missing_expectations`];
  }

  return [
    ...collectFinalLaneExpectationFailures(scenario.id, expectations),
    ...collectSemanticCheckpointFailures(scenario.id, expectations),
    ...collectDecisionCheckpointFailures(scenario.id, expectations),
  ];
}

function collectFinalLaneExpectationFailures(
  id: string,
  expectations: ReplayScenarioExpectations,
): string[] {
  return hasOwn(expectations, "finalNowInteractionId") &&
    expectations.nextInteractionIds !== undefined &&
    expectations.ambientInteractionIds !== undefined
    ? []
    : [`weak_scenario:${id}:missing_final_lane_expectation`];
}

function collectSemanticCheckpointFailures(
  id: string,
  expectations: ReplayScenarioExpectations,
): string[] {
  return (expectations.semanticReadings ?? []).some(
    (reading) => reading.stepLabel !== undefined && reading.ontology !== undefined,
  )
    ? []
    : [`weak_scenario:${id}:missing_attention_ontology_checkpoint`];
}

function collectDecisionCheckpointFailures(
  id: string,
  expectations: ReplayScenarioExpectations,
): string[] {
  return (expectations.decisionReadings ?? []).some(
    (reading) =>
      reading.stepLabel !== undefined &&
      reading.decisionRecordProjectionVersion === KERNEL_DECISION_RECORD_PROJECTION_VERSION &&
      reading.decisionRecordRoute !== undefined &&
      reading.resultLane !== undefined &&
      (reading.decisionRecordReasonCodesInclude?.length ?? 0) > 0,
  )
    ? []
    : [`weak_scenario:${id}:missing_decision_projection_checkpoint`];
}

function assessKernelCorpusDimensionCoverage(scenarioIds: string[]): KernelCorpusDimensionCoverage {
  const presentIds = new Set(scenarioIds);
  const dimensions = KERNEL_CORPUS_COVERAGE_DIMENSIONS.map((dimension) => {
    const ids = [...dimension.scenarioIds];
    return {
      id: dimension.id,
      scenarioIds: ids,
      presentScenarioIds: ids.filter((id) => presentIds.has(id)),
      missingScenarioIds: ids.filter((id) => !presentIds.has(id)),
    };
  });

  return {
    missingDimensionIds: dimensions
      .filter((dimension) => dimension.presentScenarioIds.length === 0)
      .map((dimension) => dimension.id),
    dimensions,
  };
}

function collectDimensionIntegrityFailures(): string[] {
  const profileIds = new Set<string>(KERNEL_CORPUS_SCENARIO_IDS);
  const assignedIds = new Set<string>();
  const dimensionIds = KERNEL_CORPUS_COVERAGE_DIMENSIONS.map((dimension) => dimension.id);
  const failures = collectDuplicateValues(dimensionIds).map((id) => `duplicate_dimension:${id}`);

  for (const dimension of KERNEL_CORPUS_COVERAGE_DIMENSIONS) {
    for (const id of collectDuplicateValues([...dimension.scenarioIds])) {
      failures.push(`duplicate_dimension_scenario:${dimension.id}:${id}`);
    }
    for (const id of dimension.scenarioIds) {
      if (!profileIds.has(id)) {
        failures.push(`unexpected_dimension_scenario:${dimension.id}:${id}`);
        continue;
      }
      assignedIds.add(id);
    }
  }

  for (const id of KERNEL_CORPUS_SCENARIO_IDS) {
    if (!assignedIds.has(id)) {
      failures.push(`unassigned_corpus_scenario:${id}`);
    }
  }

  return failures.sort(compareKernelCanonicalKey);
}

function collectDuplicateValues(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  }
  return [...duplicates].sort(compareKernelCanonicalKey);
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}
