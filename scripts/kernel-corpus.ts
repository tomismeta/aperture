import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  assertKernelConformanceReportPassed,
  assertKernelCorpusScorecardComparisonPassed,
  assertKernelCorpusScorecardPassed,
  buildKernelCorpusConformanceReport,
  buildKernelCorpusScorecardComparison,
  buildKernelCorpusScorecard,
  loadGoldenScenarios,
  parseHistoricalKernelCorpusScorecard,
  parseKernelCorpusScorecard,
  serializeKernelCanonicalJson,
  type KernelCorpusScorecard,
} from "../packages/lab/src/index.js";
import { isDirectExecution } from "./direct-execution.js";

const DEFAULT_REPORT_PATH = "packages/lab/conformance/kernel-corpus-v3.json";
const DEFAULT_SCORECARD_PATH = "packages/lab/conformance/kernel-corpus-scorecard-v7.json";
const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");
const execFileAsync = promisify(execFile);

export type KernelCorpusCommandOptions = {
  args?: readonly string[];
  reportPath?: string;
  scorecardPath?: string;
  baseScorecard?: KernelCorpusScorecard | null;
  baseScorecardRef?: string | false;
  historicalBaseScorecard?: KernelCorpusScorecard | null;
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
  const baseScorecard =
    options.baseScorecard !== undefined
      ? options.baseScorecard
      : await readComparisonBaseScorecard(
          scorecardPath,
          options.baseScorecardRef ?? process.env.APERTURE_KERNEL_CORPUS_BASE_REF ?? "origin/main",
          options.historicalBaseScorecard,
          expectedScorecard,
        );
  let stale = false;
  try {
    assertKernelCorpusScorecardComparisonPassed(comparison);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    stale = true;
  }
  if (baseScorecard) {
    if (baseScorecard.proof.releaseEligible) {
      try {
        assertKernelCorpusScorecardComparisonPassed(
          buildKernelCorpusScorecardComparison(baseScorecard, scorecard),
        );
      } catch (error) {
        process.stderr.write(
          `Kernel corpus scorecard regressed versus protected base: ${error instanceof Error ? error.message : String(error)}\n`,
        );
        stale = true;
      }
    }
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

async function readProtectedBaseScorecard(
  scorecardPath: string,
  baseRef: string | false,
): Promise<KernelCorpusScorecard | null> {
  if (baseRef === false || baseRef.length === 0) {
    return null;
  }

  const relativeScorecardPath = path.relative(repoRoot, scorecardPath);
  if (relativeScorecardPath.startsWith("..") || path.isAbsolute(relativeScorecardPath)) {
    return null;
  }

  try {
    const { stdout } = await execFileAsync("git", ["show", `${baseRef}:${relativeScorecardPath}`]);
    return parseHistoricalKernelCorpusScorecard(String(stdout));
  } catch (error) {
    if (isProtectedBaseUnavailable(error)) {
      return null;
    }
    throw error;
  }
}

async function readComparisonBaseScorecard(
  scorecardPath: string,
  baseRef: string | false,
  historicalBaseScorecard: KernelCorpusScorecard | null | undefined,
  currentScorecardSource: string,
): Promise<KernelCorpusScorecard | null> {
  return (
    (await readProtectedBaseScorecard(scorecardPath, baseRef)) ??
    (historicalBaseScorecard !== undefined
      ? historicalBaseScorecard
      : await readHistoricalBranchScorecard(scorecardPath, currentScorecardSource)) ??
    (await readVersionedProtectedBaseScorecard(scorecardPath, baseRef))
  );
}

async function readVersionedProtectedBaseScorecard(
  scorecardPath: string,
  baseRef: string | false,
): Promise<KernelCorpusScorecard | null> {
  const match = path.basename(scorecardPath).match(/^(.*)-v(\d+)\.json$/);
  if (!match || baseRef === false) return null;
  const version = Number(match[2]);
  if (!Number.isInteger(version) || version <= 1) return null;
  const relativeScorecardPath = path.relative(repoRoot, scorecardPath);
  const protectedPath = path.join(
    path.dirname(relativeScorecardPath),
    `${match[1]}-v${version - 1}.json`,
  );
  try {
    const { stdout } = await execFileAsync("git", ["show", `${baseRef}:${protectedPath}`]);
    return parseHistoricalKernelCorpusScorecard(String(stdout));
  } catch (error) {
    if (isProtectedBaseUnavailable(error)) return null;
    throw error;
  }
}

async function readHistoricalBranchScorecard(
  scorecardPath: string,
  currentScorecardSource: string,
): Promise<KernelCorpusScorecard | null> {
  const relativeScorecardPath = path.relative(repoRoot, scorecardPath);
  if (relativeScorecardPath.startsWith("..") || path.isAbsolute(relativeScorecardPath)) {
    return null;
  }

  try {
    const { stdout: revisions } = await execFileAsync("git", [
      "rev-list",
      "--max-count=20",
      "HEAD",
      "--",
      relativeScorecardPath,
    ]);
    for (const revision of String(revisions).trim().split(/\s+/).filter(Boolean)) {
      const { stdout } = await execFileAsync("git", [
        "show",
        `${revision}:${relativeScorecardPath}`,
      ]);
      const candidateSource = String(stdout);
      if (candidateSource !== currentScorecardSource) {
        return parseHistoricalKernelCorpusScorecard(candidateSource);
      }
    }
    return null;
  } catch (error) {
    if (isProtectedBaseUnavailable(error)) {
      return null;
    }
    throw error;
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

function isProtectedBaseUnavailable(error: unknown): boolean {
  return (
    error instanceof Error &&
    ("code" in error || "stderr" in error) &&
    /(?:invalid object name|exists on disk, but not in|path .* does not exist|unknown revision|bad revision|not a git repository)/i.test(
      String((error as { stderr?: unknown }).stderr ?? error.message),
    )
  );
}

if (isDirectExecution(import.meta.url)) {
  void main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
