import { KERNEL_DECISION_RECORD_PROJECTION_VERSION } from "./artifact-versions.js";
import { compareKernelCanonicalKey, digestKernelCanonicalJson } from "./kernel-canonical-json.js";
import {
  buildKernelDecisionRecordProjectionFromSnapshot,
  fingerprintKernelDecisionRecordProjection,
  type KernelDecisionRecordProjection,
} from "./kernel-decision-contract.js";
import { runJudgmentBench, type JudgmentBenchScenarioResult } from "./judgment-bench.js";
import type { ReplayRunResult } from "./runner.js";
import type { ReplayDecisionSnapshot, ReplayScenario } from "./scenario.js";
import { validateReplayDecisionSnapshot } from "./validation-replay-decision.js";

export const KERNEL_CONFORMANCE_REPORT_SCHEMA_VERSION = 1 as const;

type KernelProfileLike = {
  scenarioIds: readonly string[];
};

export type KernelConformanceCoverage = {
  missingScenarioIds: string[];
  unexpectedScenarioIds: string[];
  duplicateScenarioIds: string[];
};

export type KernelConformanceReportForProfile<Profile extends KernelProfileLike> = {
  schemaVersion: typeof KERNEL_CONFORMANCE_REPORT_SCHEMA_VERSION;
  profile: Profile;
  scenarioIds: string[];
  coverage: KernelConformanceCoverage;
  scenarios: KernelConformanceScenarioResult[];
  suiteDigest: string;
  passed: boolean;
  failures: string[];
};

export type KernelConformanceScenarioResult = {
  id: string;
  inputDigest: string;
  outputDigest: string;
  decisionFingerprints: string[];
  assertions: {
    total: number;
    passed: number;
    failed: number;
    failures: Array<{ name: string; expected: unknown; actual: unknown }>;
  };
  projectionValidationFailures: string[];
};

export async function buildKernelConformanceReportForProfile<Profile extends KernelProfileLike>(
  profile: Profile,
  scenarioPrefix: string,
  scenarios: ReplayScenario[],
): Promise<KernelConformanceReportForProfile<Profile>> {
  const coverage = assessScenarioCoverage(scenarios, profile.scenarioIds, scenarioPrefix);
  const byId = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
  const profileScenarios = profile.scenarioIds.flatMap((id) => {
    const scenario = byId.get(id);
    return scenario ? [scenario] : [];
  });
  const bench = await runJudgmentBench(profileScenarios);
  const results = bench.scenarios.map(buildScenarioResult);
  const failures = collectKernelConformanceFailures(coverage, results);
  const suiteDigest = digestKernelCanonicalJson({
    profile,
    scenarios: results.map((result) => ({
      id: result.id,
      inputDigest: result.inputDigest,
      outputDigest: result.outputDigest,
      decisionFingerprints: result.decisionFingerprints,
    })),
  });

  return {
    schemaVersion: KERNEL_CONFORMANCE_REPORT_SCHEMA_VERSION,
    profile,
    scenarioIds: [...profile.scenarioIds],
    coverage,
    scenarios: results,
    suiteDigest,
    passed: failures.length === 0,
    failures,
  };
}

export function assertKernelConformanceReportPassed(report: {
  passed: boolean;
  failures: string[];
}): void {
  if (report.passed) {
    return;
  }

  throw new Error(`Kernel conformance failed: ${report.failures.join(", ") || "unknown failure"}`);
}

function assessScenarioCoverage(
  scenarios: ReplayScenario[],
  scenarioIds: readonly string[],
  scenarioPrefix: string,
): KernelConformanceCoverage {
  const profileIds = new Set<string>(scenarioIds);
  const scopedIds = scenarios
    .map((scenario) => scenario.id)
    .filter((id) => id.startsWith(scenarioPrefix));

  return {
    missingScenarioIds: scenarioIds.filter((id) => !scopedIds.includes(id)),
    unexpectedScenarioIds: scopedIds.filter((id) => !profileIds.has(id)),
    duplicateScenarioIds: collectDuplicateIds(scopedIds),
  };
}

function collectKernelConformanceFailures(
  coverage: KernelConformanceCoverage,
  results: KernelConformanceScenarioResult[],
): string[] {
  return [
    ...coverage.missingScenarioIds.map((id) => `missing_scenario:${id}`),
    ...coverage.unexpectedScenarioIds.map((id) => `unexpected_scenario:${id}`),
    ...coverage.duplicateScenarioIds.map((id) => `duplicate_scenario:${id}`),
    ...results.flatMap((result) =>
      result.assertions.failures.map((failure) => `assertion_failed:${result.id}:${failure.name}`),
    ),
    ...results.flatMap((result) =>
      result.projectionValidationFailures.map((failure) => `${result.id}:${failure}`),
    ),
  ];
}

function buildScenarioResult(result: JudgmentBenchScenarioResult): KernelConformanceScenarioResult {
  const failedAssertions = result.assertions.filter((assertion) => !assertion.passed);
  const projectionValidationFailures = collectProjectionValidationFailures(result.run);
  const decisionFingerprints = result.run.decisions.flatMap((decision) =>
    decision.decisionRecordFingerprint ? [decision.decisionRecordFingerprint] : [],
  );

  return {
    id: result.scenario.id,
    inputDigest: digestKernelCanonicalJson(buildScenarioInput(result.scenario)),
    outputDigest: digestKernelCanonicalJson(buildScenarioOutput(result.run)),
    decisionFingerprints,
    assertions: {
      total: result.assertions.length,
      passed: result.assertions.length - failedAssertions.length,
      failed: failedAssertions.length,
      failures: failedAssertions.map((assertion) => ({
        name: assertion.name,
        expected: assertion.expected,
        actual: assertion.actual,
      })),
    },
    projectionValidationFailures,
  };
}

function buildScenarioInput(scenario: ReplayScenario): unknown {
  return {
    id: scenario.id,
    core: scenario.core ?? null,
    expectations: scenario.expectations ?? null,
    steps: scenario.steps,
  };
}

function buildScenarioOutput(run: ReplayRunResult): unknown {
  const finalView = run.views.at(-1);

  return {
    finalView: {
      nowInteractionId: finalView?.nowInteractionId ?? null,
      nextInteractionIds: finalView?.nextInteractionIds ?? [],
      ambientInteractionIds: finalView?.ambientInteractionIds ?? [],
    },
    semantics: run.semantics.map((semantic) => ({
      stepIndex: semantic.stepIndex,
      stepLabel: semantic.stepLabel ?? null,
      intentFrame: semantic.interpretation.intentFrame,
      activityClass: semantic.interpretation.activityClass ?? null,
      toolFamily: semantic.interpretation.toolFamily ?? null,
      consequence: semantic.interpretation.consequence ?? null,
      confidence: semantic.interpretation.confidence,
      abstained: semantic.interpretation.abstained === true,
      relationHints: semantic.interpretation.relationHints
        .map(normalizeRelationHint)
        .sort(
          (left, right) =>
            compareKernelCanonicalKey(left.kind, right.kind) ||
            compareKernelCanonicalKey(left.target ?? "", right.target ?? ""),
        ),
      ontology: semantic.ontology ?? null,
    })),
    decisions: run.decisions.map(buildDecisionOutput),
  };
}

function normalizeRelationHint(hint: { kind: string; target?: string }): {
  kind: string;
  target: string | null;
} {
  return {
    kind: hint.kind,
    target: hint.target ?? null,
  };
}

function buildDecisionOutput(decision: ReplayDecisionSnapshot): unknown {
  const projection = buildKernelDecisionRecordProjectionFromSnapshot(decision);

  return {
    stepIndex: decision.stepIndex,
    stepLabel: decision.stepLabel ?? null,
    evaluationKind: decision.evaluationKind,
    decisionKind: decision.decisionKind ?? null,
    realizedLane: decision.resultLane ?? null,
    interactionId: decision.interactionId ?? null,
    semanticConfidence: decision.semanticConfidence ?? null,
    semanticAbstained: decision.semanticAbstained === true,
    ambiguity: decision.ambiguity ?? null,
    projection: projection === null ? null : buildProjectionOutput(projection),
    fingerprint: projection === null ? null : fingerprintKernelDecisionRecordProjection(projection),
  };
}

function buildProjectionOutput(projection: KernelDecisionRecordProjection): unknown {
  const shared = {
    schema: projection.schema,
    version: projection.version,
    route: projection.route,
    evidence: projection.evidence,
    value: projection.value,
    reasonCodes: projection.reasonCodes,
  };

  return "plannedLane" in projection
    ? { ...shared, plannedLane: projection.plannedLane, realizedLane: projection.realizedLane }
    : { ...shared, lane: projection.lane };
}

function collectProjectionValidationFailures(run: ReplayRunResult): string[] {
  return run.decisions.flatMap((decision, index) => {
    if (decision.evaluationKind !== "candidate") {
      return [];
    }

    const failures: string[] = [];
    if (decision.decisionRecordProjectionVersion !== KERNEL_DECISION_RECORD_PROJECTION_VERSION) {
      failures.push(`decisions[${index}].missing_projection_version`);
    }
    if (validateReplayDecisionSnapshot(decision) === null) {
      failures.push(`decisions[${index}].invalid_projection_snapshot`);
    }
    if (!decision.decisionRecordFingerprint) {
      failures.push(`decisions[${index}].missing_fingerprint`);
    }
    return failures;
  });
}

function collectDuplicateIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      duplicates.add(id);
    }
    seen.add(id);
  }
  return [...duplicates].sort(compareKernelCanonicalKey);
}
