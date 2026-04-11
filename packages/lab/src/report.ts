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
    `- Ambiguous next: ${run.summary.totalAmbiguousNext}`,
    `- Ambiguous ambient: ${run.summary.totalAmbiguousAmbient}`,
    `- Ambiguous next -> now: ${run.summary.totalAmbiguousNextThenNow}`,
    `- Ambiguous ambient -> now: ${run.summary.totalAmbiguousAmbientThenNow}`,
    `- Now lanes: ${run.summary.totalNowLanes}`,
    `- Next lanes: ${run.summary.totalNextLanes}`,
    `- Ambient lanes: ${run.summary.totalAmbientLanes}`,
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

  lines.push("## Semantic Health", "");

  if (run.semanticHealth.length === 0) {
    lines.push("- No semantic calibration families recorded yet.", "");
  } else {
    for (const family of run.semanticHealth) {
      lines.push(
        `- ${family.family}: ${formatPercent(family.healthScore)} (${family.passedScenarios}/${family.scenarios} scenarios)`,
      );
    }
    lines.push("");
  }

  for (const result of run.scenarios) {
    lines.push(`### ${result.scenario.title}`);
    lines.push("");
    lines.push(`- Status: ${result.passed ? "pass" : "fail"}`);
    if (result.scenario.doctrineTags && result.scenario.doctrineTags.length > 0) {
      lines.push(`- Doctrines: ${result.scenario.doctrineTags.join(", ")}`);
    }
    if (result.scenario.semanticFamilies && result.scenario.semanticFamilies.length > 0) {
      lines.push(`- Semantic families: ${result.scenario.semanticFamilies.join(", ")}`);
    }
    lines.push(`- Now: ${result.scorecard.outcomes.finalNowInteractionId ?? "none"}`);
    lines.push(`- Next: ${result.scorecard.outcomes.finalNextInteractionIds.join(", ") || "none"}`);
    lines.push(`- Ambient: ${result.scorecard.outcomes.finalAmbientInteractionIds.join(", ") || "none"}`);
    lines.push(
      `- Lanes: now=${result.scorecard.lanes.now}, next=${result.scorecard.lanes.next}, ambient=${result.scorecard.lanes.ambient}`,
    );
    if (result.scorecard.trace.ambiguousDecisions > 0) {
      lines.push(
        `- Ambiguity trace: total=${result.scorecard.trace.ambiguousDecisions}, next=${result.scorecard.trace.ambiguousNext}, ambient=${result.scorecard.trace.ambiguousAmbient}, next->now=${result.scorecard.trace.ambiguousNextThenActivated}, ambient->now=${result.scorecard.trace.ambiguousAmbientThenActivated}`,
      );
    }
    if (
      result.scorecard.trace.actionableEpisodes > 0
      || result.scorecard.trace.deferredThenActivated > 0
      || result.scorecard.trace.suppressedThenActivated > 0
      || result.scorecard.trace.mergedEpisodeUpdates > 0
    ) {
      lines.push(
        `- Resurfacing trace: actionable=${result.scorecard.trace.actionableEpisodes}, surfaced=${result.scorecard.trace.actionableSurfaced}, now=${result.scorecard.trace.actionableActivated}, deferred->now=${result.scorecard.trace.deferredThenActivated}, suppressed->now=${result.scorecard.trace.suppressedThenActivated}, merged=${result.scorecard.trace.mergedEpisodeUpdates}`,
      );
    }
    if (result.run.semantics.length > 0) {
      for (const semantic of result.run.semantics) {
        lines.push(
          `- Semantic (${semantic.stepLabel ?? `step ${semantic.stepIndex}`}): ${semantic.interpretation.intentFrame}, consequence=${semantic.interpretation.consequence ?? "none"}, confidence=${semantic.interpretation.confidence}`,
        );
        if (semantic.ontology) {
          lines.push(
            `- Semantic ontology (${semantic.stepLabel ?? `step ${semantic.stepIndex}`}): ask=${semantic.ontology.ask}, activity=${semantic.ontology.activity}, blocking=${semantic.ontology.blocking}, episode=${semantic.ontology.episode}, source=${semantic.ontology.source}`,
          );
        }
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
          `- Decision (${decision.stepLabel ?? `step ${decision.stepIndex}`}): evaluation=${decision.evaluationKind}, decision=${decision.decisionKind ?? "none"}, lane=${decision.resultLane ?? "none"}, semanticConfidence=${decision.semanticConfidence ?? "none"}, semanticAbstained=${decision.semanticAbstained === true ? "true" : "false"}`,
        );
        if (decision.ambiguity) {
          lines.push(
            `- Decision ambiguity (${decision.stepLabel ?? `step ${decision.stepIndex}`}): ${decision.ambiguity.reason} -> ${decision.ambiguity.resolution}`,
          );
        }
      }
    }
    if (result.scorecard.explanation.targetInteractionId) {
      lines.push(`- Why target: ${result.scorecard.explanation.targetInteractionId} (${result.scorecard.explanation.targetLane})`);
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
      for (const failedAssertion of result.assertions.filter((assertion) => !assertion.passed)) {
        lines.push(
          `  - Failed ${failedAssertion.name}: expected ${formatValue(failedAssertion.expected)}, got ${formatValue(failedAssertion.actual)}`,
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
