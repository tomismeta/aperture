import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  renderJudgmentBenchMarkdown,
  runDeterminismAudit,
  runJudgmentBench,
  runPerturbedJudgmentBench,
} from "@aperture/lab";

const RESULTS_DIR = path.resolve(process.cwd(), "packages/lab/results");

type JudgmentBattleReport = {
  generatedAt: string;
  determinism: Awaited<ReturnType<typeof runDeterminismAudit>>;
  benchmark: Awaited<ReturnType<typeof runJudgmentBench>>;
  fuzz: Awaited<ReturnType<typeof runPerturbedJudgmentBench>>;
};

async function main(): Promise<void> {
  const determinism = await runDeterminismAudit();
  const benchmark = await runJudgmentBench();
  const fuzz = await runPerturbedJudgmentBench();

  const report: JudgmentBattleReport = {
    generatedAt: new Date().toISOString(),
    determinism,
    benchmark,
    fuzz,
  };

  await mkdir(RESULTS_DIR, { recursive: true });

  const timestamp = report.generatedAt.replaceAll(":", "-");
  const jsonPath = path.join(RESULTS_DIR, `judgmentbattle-${timestamp}.json`);
  const markdownPath = path.join(RESULTS_DIR, `judgmentbattle-${timestamp}.md`);
  const latestJsonPath = path.join(RESULTS_DIR, "latest-battle.json");
  const latestMarkdownPath = path.join(RESULTS_DIR, "latest-battle.md");
  const markdown = renderBattleMarkdown(report);

  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, markdown, "utf8");
  await writeFile(latestJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(latestMarkdownPath, markdown, "utf8");

  process.stdout.write(
    [
      "JudgmentBattle",
      `determinism: ${(determinism.summary.determinismScore * 100).toFixed(1)}% (${determinism.summary.stableScenarios}/${determinism.summary.totalScenarios} stable)`,
      `benchmark: ${(benchmark.summary.benchmarkScore * 100).toFixed(1)}% (${benchmark.summary.passedAssertions}/${benchmark.summary.totalAssertions} assertions)`,
      `fuzz: ${(fuzz.summary.benchmarkScore * 100).toFixed(1)}% (${fuzz.summary.passedAssertions}/${fuzz.summary.totalAssertions} assertions)`,
      `results: ${jsonPath}`,
      `summary: ${markdownPath}`,
    ].join("\n") + "\n",
  );

  const failed = determinism.summary.driftedScenarios > 0
    || benchmark.summary.failedAssertions > 0
    || fuzz.summary.failedAssertions > 0;

  if (failed) {
    process.exitCode = 1;
  }
}

function renderBattleMarkdown(report: JudgmentBattleReport): string {
  const failedDeterminism = report.determinism.scenarios.filter((scenario) => !scenario.stable);
  const failedBench = report.benchmark.scenarios.filter((scenario) => !scenario.passed);
  const failedFuzz = report.fuzz.scenarios.filter((scenario) => !scenario.passed);

  const lines = [
    "# Judgment Battle",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "## Summary",
    "",
    `- Determinism: ${formatPercent(report.determinism.summary.determinismScore)} (${report.determinism.summary.stableScenarios}/${report.determinism.summary.totalScenarios} stable)`,
    `- JudgmentBench: ${formatPercent(report.benchmark.summary.benchmarkScore)} (${report.benchmark.summary.passedAssertions}/${report.benchmark.summary.totalAssertions} assertions)`,
    `- JudgmentFuzz: ${formatPercent(report.fuzz.summary.benchmarkScore)} (${report.fuzz.summary.passedAssertions}/${report.fuzz.summary.totalAssertions} assertions)`,
    "",
    "## Failures",
    "",
  ];

  if (failedDeterminism.length === 0 && failedBench.length === 0 && failedFuzz.length === 0) {
    lines.push("- none", "");
  } else {
    for (const scenario of failedDeterminism) {
      lines.push(`- Determinism drift: ${scenario.scenario.id} -> ${scenario.driftAreas.join(", ")}`);
    }
    for (const scenario of failedBench) {
      lines.push(`- JudgmentBench failure: ${scenario.scenario.id}`);
    }
    for (const scenario of failedFuzz) {
      lines.push(`- JudgmentFuzz failure: ${scenario.scenario.id}`);
    }
    lines.push("");
  }

  lines.push("## Included Reports", "");
  lines.push("### JudgmentBench", "");
  lines.push(renderJudgmentBenchMarkdown(report.benchmark).trim(), "");
  lines.push("### JudgmentFuzz", "");
  lines.push(renderJudgmentBenchMarkdown(report.fuzz).trim(), "");

  return `${lines.join("\n")}\n`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
