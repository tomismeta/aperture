import { loadGoldenScenarios } from "./golden.js";
import { KERNEL_CORPUS_PROFILE } from "./kernel-corpus-profile.js";
import {
  assessKernelCorpusQuality,
  type KernelCorpusDimensionCoverage,
} from "./kernel-corpus-quality.js";
import {
  buildKernelConformanceReportForProfile,
  type KernelConformanceScenarioResult,
  type KernelConformanceReportForProfile,
} from "./kernel-conformance-support.js";
import type { ReplayScenario } from "./scenario.js";

const KERNEL_CORPUS_SCENARIO_PREFIX = "golden:kernel-corpus:";

export type KernelCorpusConformanceReport = KernelConformanceReportForProfile<
  typeof KERNEL_CORPUS_PROFILE
> & {
  dimensionCoverage: KernelCorpusDimensionCoverage;
  dimensionIntegrityFailures: string[];
  scenarioQualityFailures: string[];
  determinism: KernelCorpusDeterminismReport;
};

export type { KernelCorpusDimensionCoverage };

export type KernelCorpusDeterminismReport = {
  repeatedRuns: 2;
  stable: boolean;
  failures: string[];
};

export async function buildKernelCorpusConformanceReport(
  scenarios?: ReplayScenario[],
): Promise<KernelCorpusConformanceReport> {
  const loadedScenarios = scenarios ?? (await loadGoldenScenarios());
  const report = await buildKernelConformanceReportForProfile(
    KERNEL_CORPUS_PROFILE,
    KERNEL_CORPUS_SCENARIO_PREFIX,
    loadedScenarios,
  );
  const repeat = await buildKernelConformanceReportForProfile(
    KERNEL_CORPUS_PROFILE,
    KERNEL_CORPUS_SCENARIO_PREFIX,
    loadedScenarios,
  );
  const quality = assessKernelCorpusQuality(loadedScenarios, report.scenarios);
  const determinism = compareKernelCorpusReports(report, repeat);
  const dimensionFailures = [
    ...quality.dimensionCoverage.missingDimensionIds.map((id) => `missing_dimension:${id}`),
    ...quality.dimensionCoverage.dimensions.flatMap((dimension) =>
      dimension.missingScenarioIds.map((id) => `missing_dimension_scenario:${dimension.id}:${id}`),
    ),
  ];
  const failures = [
    ...report.failures,
    ...dimensionFailures,
    ...quality.dimensionIntegrityFailures,
    ...quality.scenarioQualityFailures,
    ...determinism.failures,
  ];

  return {
    ...report,
    dimensionCoverage: quality.dimensionCoverage,
    dimensionIntegrityFailures: quality.dimensionIntegrityFailures,
    scenarioQualityFailures: quality.scenarioQualityFailures,
    determinism,
    failures,
    passed: failures.length === 0,
  };
}

function compareKernelCorpusReports(
  left: KernelConformanceReportForProfile<typeof KERNEL_CORPUS_PROFILE>,
  right: KernelConformanceReportForProfile<typeof KERNEL_CORPUS_PROFILE>,
): KernelCorpusDeterminismReport {
  const failures: string[] = [];
  const rightById = new Map(right.scenarios.map((scenario) => [scenario.id, scenario]));

  if (left.suiteDigest !== right.suiteDigest) {
    failures.push("non_deterministic_suite_digest");
  }
  for (const leftScenario of left.scenarios) {
    const rightScenario = rightById.get(leftScenario.id);
    if (!rightScenario) {
      failures.push(`non_deterministic_missing_scenario:${leftScenario.id}`);
      continue;
    }
    failures.push(...compareScenarioResult(leftScenario, rightScenario));
  }

  return {
    repeatedRuns: 2,
    stable: failures.length === 0,
    failures,
  };
}

function compareScenarioResult(
  left: KernelConformanceScenarioResult,
  right: KernelConformanceScenarioResult,
): string[] {
  const failures: string[] = [];
  if (left.inputDigest !== right.inputDigest) {
    failures.push(`non_deterministic_input_digest:${left.id}`);
  }
  if (left.outputDigest !== right.outputDigest) {
    failures.push(`non_deterministic_output_digest:${left.id}`);
  }
  if (left.decisionFingerprints.join("\n") !== right.decisionFingerprints.join("\n")) {
    failures.push(`non_deterministic_decision_fingerprint:${left.id}`);
  }
  return failures;
}
