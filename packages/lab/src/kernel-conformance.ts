import { loadGoldenScenarios } from "./golden.js";
import { KERNEL_PROFILE } from "./kernel-profile.js";
import {
  assertKernelConformanceReportPassed,
  buildKernelConformanceReportForProfile,
  KERNEL_CONFORMANCE_REPORT_SCHEMA_VERSION,
  type KernelConformanceReportForProfile,
  type KernelConformanceScenarioResult,
} from "./kernel-conformance-support.js";
import type { ReplayScenario } from "./scenario.js";

const KERNEL_SCENARIO_PREFIX = "golden:kernel:";

export {
  assertKernelConformanceReportPassed,
  KERNEL_CONFORMANCE_REPORT_SCHEMA_VERSION,
  type KernelConformanceScenarioResult,
};

export type KernelConformanceReport = KernelConformanceReportForProfile<typeof KERNEL_PROFILE>;

export async function buildKernelConformanceReport(
  scenarios?: ReplayScenario[],
): Promise<KernelConformanceReport> {
  return buildKernelConformanceReportForProfile(
    KERNEL_PROFILE,
    KERNEL_SCENARIO_PREFIX,
    scenarios ?? (await loadGoldenScenarios()),
  );
}
