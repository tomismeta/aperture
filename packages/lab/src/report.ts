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
    `- Semantic readings: ${run.summary.totalSemanticReadings}`,
    `- Decision readings: ${run.summary.totalDecisionReadings}`,
    `- Ambiguous decisions: ${run.summary.totalAmbiguousDecisions}`,
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
    if (result.run.semantics.length > 0) {
      for (const semantic of result.run.semantics) {
        lines.push(
          `- Semantic (${semantic.stepLabel ?? `step ${semantic.stepIndex}`}): ${semantic.interpretation.intentFrame}, consequence=${semantic.interpretation.consequence ?? "none"}, confidence=${semantic.interpretation.confidence}`,
        );
        if (semantic.interpretation.relationHints.length > 0) {
          lines.push(
            `- Semantic relations (${semantic.stepLabel ?? `step ${semantic.stepIndex}`}): ${semantic.interpretation.relationHints.map((hint) => hint.kind).join(", ")}`,
          );
        }
      }
    }
    if (result.run.decisions.length > 0) {
      for (const decision of result.run.decisions) {
        lines.push(
          `- Decision (${decision.stepLabel ?? `step ${decision.stepIndex}`}): evaluation=${decision.evaluationKind}, decision=${decision.decisionKind ?? "none"}, bucket=${decision.resultBucket ?? "none"}, semanticConfidence=${decision.semanticConfidence ?? "none"}, semanticAbstained=${decision.semanticAbstained === true ? "true" : "false"}`,
        );
        if (decision.ambiguity) {
          lines.push(
            `- Decision ambiguity (${decision.stepLabel ?? `step ${decision.stepIndex}`}): ${decision.ambiguity.reason} -> ${decision.ambiguity.resolution}`,
          );
        }
      }
    }
    if (result.scorecard.explanation.targetInteractionId) {
      lines.push(`- Why target: ${result.scorecard.explanation.targetInteractionId} (${result.scorecard.explanation.targetBucket})`);
      if (result.scorecard.explanation.headline) {
        lines.push(`- Why headline: ${result.scorecard.explanation.headline}`);
      }
      const reasons = firstNonEmptyReasonGroup(result.scorecard.explanation);
      if (reasons.length > 0) {
        lines.push(`- Why reasons: ${reasons.join("; ")}`);
      }
    }
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

function firstNonEmptyReasonGroup(run: JudgmentBenchRun["scenarios"][number]["scorecard"]["explanation"]): string[] {
  return run.whyNow
    ? [run.whyNow]
    : run.continuityRationale.length > 0
      ? run.continuityRationale
      : run.coordinationReasons.length > 0
        ? run.coordinationReasons
        : run.policyRationale.length > 0
          ? run.policyRationale
          : run.plannerReasons.length > 0
            ? run.plannerReasons
            : run.attentionRationale;
}
