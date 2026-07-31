import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertKernelConformanceReportPassed,
  assertKernelCorpusScorecardComparisonPassed,
  assertKernelCorpusScorecardPassed,
  buildKernelCorpusConformanceReport,
  buildKernelCorpusScorecardComparison,
  buildKernelCorpusScorecard,
  loadGoldenScenarios,
  parseKernelCorpusScorecard,
  serializeKernelCanonicalJson,
  type KernelCorpusScorecard,
} from "../packages/lab/src/index.js";

const DEFAULT_REPORT_PATH = "packages/lab/conformance/kernel-corpus-v2.json";
const DEFAULT_SCORECARD_PATH = "packages/lab/conformance/kernel-corpus-scorecard-v2.json";
const scriptPath = fileURLToPath(import.meta.url);

export type KernelCorpusCommandOptions = {
  args?: readonly string[];
  reportPath?: string;
  scorecardPath?: string;
};

export async function runKernelCorpusCommand(
  options: KernelCorpusCommandOptions = {},
): Promise<void> {
  const args = options.args ?? process.argv.slice(2);
  const reportPath = path.resolve(options.reportPath ?? DEFAULT_REPORT_PATH);
  const scorecardPath = path.resolve(options.scorecardPath ?? DEFAULT_SCORECARD_PATH);
  const scenarios = await loadGoldenScenarios();
  const report = await buildKernelCorpusConformanceReport(scenarios);
  const scorecard = buildKernelCorpusScorecard(report, scenarios);
  assertKernelConformanceReportPassed(report);
  assertKernelCorpusScorecardPassed(scorecard);
  const expected = `${serializeKernelCanonicalJson(report)}\n`;
  const expectedScorecard = `${serializeKernelCanonicalJson(scorecard)}\n`;
  const allowScorecardRegression = args.includes("--allow-scorecard-regression");

  if (args.includes("--write")) {
    const baselineScorecard = await readScorecardBaseline(scorecardPath, allowScorecardRegression);
    if (baselineScorecard && !allowScorecardRegression) {
      const comparison = buildKernelCorpusScorecardComparison(baselineScorecard, scorecard);
      assertKernelCorpusScorecardComparisonPassed(comparison);
    }
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, expected, "utf8");
    await writeFile(scorecardPath, expectedScorecard, "utf8");
    return;
  }

  const actual = await readFile(reportPath, "utf8");
  const actualScorecard = await readFile(scorecardPath, "utf8");
  const baselineScorecard = parseKernelCorpusScorecard(actualScorecard);
  const comparison = buildKernelCorpusScorecardComparison(baselineScorecard, scorecard);
  let stale = false;
  try {
    assertKernelCorpusScorecardComparisonPassed(comparison);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    stale = true;
  }
  if (actual !== expected) {
    process.stderr.write(`Kernel corpus report is stale. Run: pnpm kernel:corpus:write\n`);
    stale = true;
  }
  if (actualScorecard !== expectedScorecard) {
    process.stderr.write(`Kernel corpus scorecard is stale. Run: pnpm kernel:corpus:write\n`);
    stale = true;
  }
  if (stale) {
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  await runKernelCorpusCommand();
}

async function readScorecardBaseline(
  scorecardPath: string,
  allowMissing: boolean,
): Promise<KernelCorpusScorecard | null> {
  try {
    return parseKernelCorpusScorecard(await readFile(scorecardPath, "utf8"));
  } catch (error) {
    if (allowMissing && (isFileNotFoundError(error) || isScorecardParseError(error))) {
      return null;
    }
    if (isFileNotFoundError(error)) {
      throw new Error(
        "Kernel corpus scorecard baseline is missing. Restore the committed scorecard or rerun with --allow-scorecard-regression for an intentional baseline migration.",
      );
    }
    throw error;
  }
}

function isFileNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isScorecardParseError(error: unknown): boolean {
  return (
    error instanceof SyntaxError ||
    (error instanceof Error && error.message === "Invalid kernel corpus scorecard.")
  );
}

if (process.argv[1] === scriptPath) {
  void main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
