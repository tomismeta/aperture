import type { AutoresearchFinalReport } from "./autoresearch-report.js";

export function renderAutoresearchFinalReportMarkdown(
  report: AutoresearchFinalReport,
): string {
  const lines: string[] = [
    "# Aperture Lab F-Stop Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Status: ${report.status}`,
    "",
    "## Recommendation",
    "",
    report.recommendation,
    "",
    "## Run Summary",
    "",
    `- bundles: ${report.runSummary.bundleCount}`,
    `- sessions: ${report.runSummary.sessionCount}`,
    `- replay steps: ${report.runSummary.replayStepCount}`,
    `- source-event steps: ${report.runSummary.sourceEventStepCount}`,
    `- submit steps: ${report.runSummary.submitStepCount}`,
  ];

  if (report.runSummary.cleanCount !== undefined) {
    lines.push(`- clean bundles: ${report.runSummary.cleanCount}`);
  }
  if (report.runSummary.disagreementBundleCount !== undefined) {
    lines.push(`- disagreement bundles: ${report.runSummary.disagreementBundleCount}`);
  }
  if (report.runSummary.errorCount !== undefined) {
    lines.push(`- error bundles: ${report.runSummary.errorCount}`);
  }
  if (report.runSummary.actionableCount !== undefined) {
    lines.push(`- actionable disagreements: ${report.runSummary.actionableCount}`);
  }
  if (report.runSummary.selectedSignalCount !== undefined) {
    lines.push(`- selected signals: ${report.runSummary.selectedSignalCount}`);
  }
  if (report.runSummary.promotedCaseCount !== undefined) {
    lines.push(`- promoted cases: ${report.runSummary.promotedCaseCount}`);
  }
  if (report.runSummary.workflow) {
    const workflow = report.runSummary.workflow;
    const contextParts = [
      formatWorkflowField("automation", workflow.automationModes),
      formatWorkflowField("surfaces", workflow.surfaces),
      formatWorkflowField("runners", workflow.runners),
      formatWorkflowField("placements", workflow.placements),
      formatWorkflowField("environments", workflow.environments),
      formatWorkflowField("approval states", workflow.approvalStates),
      formatWorkflowField("models", workflow.models),
    ].filter((part): part is string => part !== null);
    if (contextParts.length > 0) {
      lines.push(`- workflow: ${contextParts.join("; ")}`);
    }

    const usageParts = [
      workflow.usageTotals.inputTokens > 0 ? `input=${formatCount(workflow.usageTotals.inputTokens)}` : null,
      workflow.usageTotals.cachedInputTokens > 0 ? `cache=${formatCount(workflow.usageTotals.cachedInputTokens)}` : null,
      workflow.usageTotals.outputTokens > 0 ? `output=${formatCount(workflow.usageTotals.outputTokens)}` : null,
      workflow.usageTotals.costUsd > 0 ? `cost=${formatUsd(workflow.usageTotals.costUsd)}` : null,
    ].filter((part): part is string => part !== null);
    if (usageParts.length > 0) {
      lines.push(`- workflow usage: ${usageParts.join(", ")}`);
    }
  }

  lines.push("", "## Major Disagreements", "");
  if (report.majorDisagreements.length === 0) {
    lines.push("- (none)");
  } else {
    for (const disagreement of report.majorDisagreements) {
      lines.push(
        `- ${disagreement.focusArea} (${disagreement.owner}): ${disagreement.apertureValue} -> ${disagreement.expectedValue} across ${disagreement.sessionCount} session(s)`,
      );
      if (disagreement.targets.length > 0) {
        lines.push(`  targets: ${disagreement.targets.join(", ")}`);
      }
    }
  }

  lines.push("", "## Intent Statements", "");
  if (report.intentStatements.length === 0) {
    lines.push("- (none)");
  } else {
    for (const intent of report.intentStatements) {
      lines.push(`- ${intent.statement}`);
      if (intent.targets.length > 0) {
        lines.push(`  targets: ${intent.targets.join(", ")}`);
      }
    }
  }

  lines.push("", "## Code Recommendations", "");
  if (report.codeRecommendations.length === 0) {
    lines.push("- (none)");
  } else {
    for (const recommendation of report.codeRecommendations) {
      lines.push(`- ${recommendation.summary}`);
      if (recommendation.recommendedFiles.length > 0) {
        lines.push(`  files: ${recommendation.recommendedFiles.join(", ")}`);
      }
      if (recommendation.patchPath) {
        lines.push(`  patch: ${recommendation.patchPath}`);
      }
    }
  }

  lines.push("", "## Attempts", "");
  if (report.attempts.length === 0) {
    lines.push("- (none)");
  } else {
    for (const attempt of report.attempts) {
      lines.push(
        `- offset=${attempt.offset}, limit=${attempt.limit}, status=${attempt.status}${attempt.actionableCount !== undefined ? `, actionable=${attempt.actionableCount}` : ""}${attempt.selectedSignalCount !== undefined ? `, signals=${attempt.selectedSignalCount}` : ""}${attempt.promotedCaseCount !== undefined ? `, promoted=${attempt.promotedCaseCount}` : ""}${attempt.optimizerStatus ? `, optimizer=${attempt.optimizerStatus}` : ""}`,
      );
    }
  }

  lines.push("", "## Retained Attempts", "");
  if (report.retainedAttempts.length === 0) {
    lines.push("- (none)");
  } else {
    for (const attempt of report.retainedAttempts) {
      lines.push(
        `- offset=${attempt.offset}, limit=${attempt.limit}, status=${attempt.status}, retained=${attempt.retainedOutcome}${attempt.actionableCount !== undefined ? `, actionable=${attempt.actionableCount}` : ""}${attempt.selectedSignalCount !== undefined ? `, signals=${attempt.selectedSignalCount}` : ""}${attempt.promotedCaseCount !== undefined ? `, promoted=${attempt.promotedCaseCount}` : ""}${attempt.optimizerStatus ? `, optimizer=${attempt.optimizerStatus}` : ""}`,
      );
      for (const signal of attempt.strongestSignals) {
        lines.push(
          `  signal: ${signal.focusArea} (${signal.owner}) ${signal.apertureValue} -> ${signal.expectedValue} across ${signal.sessionCount} session(s)`,
        );
        if (signal.targets.length > 0) {
          lines.push(`    targets: ${signal.targets.join(", ")}`);
        }
      }
      for (const intent of attempt.intentStatements.slice(0, 2)) {
        lines.push(`  intent: ${intent.statement}`);
      }
      for (const recommendation of attempt.codeRecommendations.slice(0, 2)) {
        lines.push(`  recommendation: ${recommendation.summary}`);
      }
      if (attempt.optimizerSummary) {
        lines.push(
          `  optimizer summary: ${attempt.optimizerSummary.status} mismatches ${attempt.optimizerSummary.beforeMismatchCount} -> ${attempt.optimizerSummary.afterMismatchCount}`,
        );
      }
    }
  }

  if (report.optimizer) {
    lines.push("", "## Optimizer", "");
    lines.push(`- status: ${report.optimizer.status}`);
    lines.push(`- mismatches: ${report.optimizer.beforeMismatchCount} -> ${report.optimizer.afterMismatchCount}`);
    lines.push(`- invariant mismatches: ${report.optimizer.beforeInvariantMismatchCount} -> ${report.optimizer.afterInvariantMismatchCount}`);
    lines.push(`- autoresearch evaluate: ${formatBoolean(report.optimizer.autoresearchEvaluate)}`);
    if (report.optimizer.judgmentBattle !== undefined) {
      lines.push(`- judgment battle: ${formatBoolean(report.optimizer.judgmentBattle)}`);
    }
    if (report.optimizer.releaseCheck !== undefined) {
      lines.push(`- release check: ${formatBoolean(report.optimizer.releaseCheck)}`);
    }
    if (report.optimizer.changedFiles.length > 0) {
      lines.push(`- changed files: ${report.optimizer.changedFiles.join(", ")}`);
    }
    if (report.optimizer.disallowedFiles.length > 0) {
      lines.push(`- disallowed files: ${report.optimizer.disallowedFiles.join(", ")}`);
    }
  }

  lines.push("", "## Artifacts", "");
  if (report.source.runnerRunPath) {
    lines.push(`- runner run: ${report.source.runnerRunPath}`);
  }
  if (report.source.proposalPath) {
    lines.push(`- proposal: ${report.source.proposalPath}`);
  }
  if (report.source.batchReportPath) {
    lines.push(`- batch report: ${report.source.batchReportPath}`);
  }
  if (report.source.optimizerRunPath) {
    lines.push(`- optimizer run: ${report.source.optimizerRunPath}`);
  }
  if (report.source.patchPath) {
    lines.push(`- patch: ${report.source.patchPath}`);
  }

  if (report.notes.length > 0) {
    lines.push("", "## Notes", "");
    lines.push(...report.notes.map((note) => `- ${note}`));
  }

  return lines.join("\n");
}

export function renderValue(value: string | string[] | boolean | null): string {
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (value === null) {
    return "null";
  }
  return value;
}

function formatBoolean(value: boolean): string {
  return value ? "pass" : "fail";
}

function formatWorkflowField(label: string, values: string[]): string | null {
  return values.length > 0 ? `${label}=${values.join(", ")}` : null;
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}
