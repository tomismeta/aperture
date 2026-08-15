import { mkdir } from "node:fs/promises";
import path from "node:path";

import {
  buildObservationKernelV6HoldoutReport,
  runObservationKernelV6Holdout,
  writeObservationKernelV6HoldoutReport,
} from "../packages/lab/src/observation-kernel-v6-holdout.js";
import { isDirectExecution } from "./direct-execution.js";

const FIRST_RUN_PATH = "packages/lab/conformance/observation-kernel-holdout-v6-first-run.json";
const REPORT_PATH = "packages/lab/conformance/observation-kernel-holdout-v6-report.json";

export async function runObservationKernelV6HoldoutCommand(): Promise<void> {
  const firstRun = runObservationKernelV6Holdout();
  await mkdir(path.dirname(FIRST_RUN_PATH), { recursive: true });
  await writeObservationKernelV6HoldoutReport(firstRun, FIRST_RUN_PATH);

  const repeatRun = runObservationKernelV6Holdout();
  const report = buildObservationKernelV6HoldoutReport(firstRun, repeatRun);
  await writeObservationKernelV6HoldoutReport(report, REPORT_PATH);
  if (!report.passed) {
    throw new Error(
      `Observation Kernel V6 holdout failed: ${report.failures.join(", ") || "unknown failure"}`,
    );
  }
}

if (isDirectExecution(import.meta.url)) {
  void runObservationKernelV6HoldoutCommand().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
