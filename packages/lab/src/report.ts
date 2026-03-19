import type { JudgmentBenchRun } from "./judgment-bench.js";

export function renderJudgmentBenchMarkdown(run: JudgmentBenchRun): string {
  const scorePercent = formatPercent(run.summary.benchmarkScore);
  const lines: string[] = [
    "# JudgmentBench Summary",
    "",
    `Generated: ${run.generatedAt}`,
    "",
    `Benchmark score: **${scorePercent}**`,
    "",
    "## Overview",
    "",
    `- Scenarios: ${run.summary.totalScenarios}`,
    `- Passed scenarios: ${run.summary.passedScenarios}`,
    `- Failed scenarios: ${run.summary.failedScenarios}`,
    `- Assertions: ${run.summary.passedAssertions}/${run.summary.totalAssertions} passed`,
    `- Active buckets: ${run.summary.totalActiveBuckets}`,
    `- Queued buckets: ${run.summary.totalQueuedBuckets}`,
    `- Ambient buckets: ${run.summary.totalAmbientBuckets}`,
    "",
    "## Doctrine Health",
    "",
  ];

  if (run.doctrineHealth.length === 0) {
    lines.push("- No doctrine tags recorded yet.", "");
  } else {
    for (const doctrine of run.doctrineHealth) {
      lines.push(
        `- ${doctrine.doctrine}: ${formatPercent(doctrine.healthScore)} (${doctrine.passedScenarios}/${doctrine.scenarios} scenarios)`,
      );
    }
    lines.push("");
  }

  lines.push("## Scenario Results", "");

  for (const result of run.scenarios) {
    lines.push(`### ${result.scenario.title}`);
    lines.push("");
    lines.push(`- Status: ${result.passed ? "pass" : "fail"}`);
    if (result.scenario.doctrineTags && result.scenario.doctrineTags.length > 0) {
      lines.push(`- Doctrines: ${result.scenario.doctrineTags.join(", ")}`);
    }
    lines.push(`- Active: ${result.scorecard.outcomes.finalActiveInteractionId ?? "none"}`);
    lines.push(`- Queued: ${result.scorecard.outcomes.finalQueuedInteractionIds.join(", ") || "none"}`);
    lines.push(`- Ambient: ${result.scorecard.outcomes.finalAmbientInteractionIds.join(", ") || "none"}`);
    lines.push(
      `- Buckets: active=${result.scorecard.buckets.active}, queued=${result.scorecard.buckets.queued}, ambient=${result.scorecard.buckets.ambient}`,
    );
    if (result.assertions.length > 0) {
      lines.push(`- Assertions: ${result.assertions.filter((assertion) => assertion.passed).length}/${result.assertions.length} passed`);
    }
    if (!result.passed) {
      for (const assertion of result.assertions.filter((assertion) => !assertion.passed)) {
        lines.push(
          `  - Failed ${assertion.name}: expected ${formatValue(assertion.expected)}, got ${formatValue(assertion.actual)}`,
        );
      }
    }
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}
