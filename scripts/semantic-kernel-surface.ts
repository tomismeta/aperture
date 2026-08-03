import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { serializeKernelCanonicalJson } from "../packages/lab/src/kernel-canonical-json.js";
import {
  assertSemanticKernelSurfaceReportPassed,
  buildSemanticKernelSurfaceComparison,
  buildSemanticKernelSurfaceReport,
  parseSemanticKernelSurfaceReport,
  readProtectedSemanticKernelSurfaceReport,
} from "./semantic-kernel-surface-support.js";

const DEFAULT_REPORT_PATH = "packages/lab/conformance/semantic-kernel-surface-v1.json";

async function main(): Promise<void> {
  const reportPath = path.resolve(DEFAULT_REPORT_PATH);
  const report = await buildSemanticKernelSurfaceReport();
  assertSemanticKernelSurfaceReportPassed(report);
  const expected = `${serializeKernelCanonicalJson(report)}\n`;
  const allowSurfaceRegression = process.argv.includes("--allow-surface-regression");

  if (process.argv.includes("--write")) {
    if (!allowSurfaceRegression) {
      await assertNoSurfaceRegressionBeforeWrite(reportPath, report);
    }
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, expected, "utf8");
    return;
  }

  const actual = await readFile(reportPath, "utf8");
  const baseline = parseSemanticKernelSurfaceReport(actual);
  const committedComparison = buildSemanticKernelSurfaceComparison(baseline, report);
  const protectedBaseline = await readProtectedSemanticKernelSurfaceReport(reportPath);
  const protectedComparison =
    protectedBaseline === null
      ? { passed: true, failures: [] }
      : buildSemanticKernelSurfaceComparison(protectedBaseline, report);

  let stale = false;
  if (!committedComparison.passed) {
    process.stderr.write(
      `Semantic kernel surface regressed versus committed baseline: ${committedComparison.failures.join(", ")}\n`,
    );
    stale = true;
  }
  if (!protectedComparison.passed) {
    process.stderr.write(
      `Semantic kernel surface regressed versus protected base: ${protectedComparison.failures.join(", ")}\n`,
    );
    stale = true;
  }
  if (actual !== expected) {
    process.stderr.write(
      "Semantic kernel surface report is stale. Run: pnpm kernel:surface:write\n",
    );
    stale = true;
  }
  if (stale) {
    process.exitCode = 1;
  }
}

async function assertNoSurfaceRegressionBeforeWrite(
  reportPath: string,
  report: Awaited<ReturnType<typeof buildSemanticKernelSurfaceReport>>,
): Promise<void> {
  const baselines = [
    await readExistingSemanticKernelSurfaceReport(reportPath),
    await readProtectedSemanticKernelSurfaceReport(reportPath),
  ].filter((baseline) => baseline !== null);
  const failures = baselines.flatMap(
    (baseline) => buildSemanticKernelSurfaceComparison(baseline, report).failures,
  );

  if (failures.length > 0) {
    throw new Error(
      `Semantic kernel surface write would record a regression: ${failures.join(", ")}. Pass --allow-surface-regression if this is intentional.`,
    );
  }
}

async function readExistingSemanticKernelSurfaceReport(
  reportPath: string,
): Promise<ReturnType<typeof parseSemanticKernelSurfaceReport> | null> {
  try {
    return parseSemanticKernelSurfaceReport(await readFile(reportPath, "utf8"));
  } catch (error) {
    if (isMissingReport(error)) {
      return null;
    }
    throw error;
  }
}

function isMissingReport(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
