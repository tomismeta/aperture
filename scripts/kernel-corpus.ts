import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  assertKernelConformanceReportPassed,
  assertKernelCorpusScorecardPassed,
  buildKernelCorpusConformanceReport,
  buildKernelCorpusScorecard,
  loadGoldenScenarios,
  serializeKernelCanonicalJson,
} from "../packages/lab/src/index.js";

const DEFAULT_REPORT_PATH = "packages/lab/conformance/kernel-corpus-v2.json";
const DEFAULT_SCORECARD_PATH = "packages/lab/conformance/kernel-corpus-scorecard-v1.json";

async function main(): Promise<void> {
  const reportPath = path.resolve(DEFAULT_REPORT_PATH);
  const scorecardPath = path.resolve(DEFAULT_SCORECARD_PATH);
  const scenarios = await loadGoldenScenarios();
  const report = await buildKernelCorpusConformanceReport(scenarios);
  const scorecard = buildKernelCorpusScorecard(report, scenarios);
  assertKernelConformanceReportPassed(report);
  assertKernelCorpusScorecardPassed(scorecard);
  const expected = `${serializeKernelCanonicalJson(report)}\n`;
  const expectedScorecard = `${serializeKernelCanonicalJson(scorecard)}\n`;

  if (process.argv.includes("--write")) {
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, expected, "utf8");
    await writeFile(scorecardPath, expectedScorecard, "utf8");
    return;
  }

  const actual = await readFile(reportPath, "utf8");
  const actualScorecard = await readFile(scorecardPath, "utf8");
  let stale = false;
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

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
