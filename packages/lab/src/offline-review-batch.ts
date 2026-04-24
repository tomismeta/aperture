import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { OFFLINE_REVIEW_BATCH_REPORT_SCHEMA_VERSION } from "./artifact-versions.js";
import {
  ALL_OFFLINE_REVIEW_FOCUS_AREAS,
  DEFAULT_OFFLINE_REVIEW_RESULTS_DIR,
  type OfflineReviewFocusArea,
  type OfflineReviewRecommendation,
  type OfflineReviewRecommendationItem,
} from "./offline-review.js";
import {
  type WorkflowTargetMetadataRollup,
  hasWorkflowTargetMetadataRollup,
} from "./workflow-metadata.js";
export { OFFLINE_REVIEW_BATCH_REPORT_SCHEMA_VERSION } from "./artifact-versions.js";
export const DEFAULT_OFFLINE_REVIEW_BATCHES_DIR = path.join(
  DEFAULT_OFFLINE_REVIEW_RESULTS_DIR,
  "batches",
);

export type OfflineReviewBatchEntry = {
  sessionId: string;
  status: "clean" | "disagreement" | "error";
  disagreementCount: number;
  actionableCount: number;
  reviewer?: string;
  model?: string;
  requestPath?: string;
  promptPath?: string;
  rawResponsePath?: string;
  responseArtifactPath?: string;
  reportPath?: string;
  recommendationPath?: string;
  runPath?: string;
  error?: string;
  focusAreaCounts: Record<OfflineReviewFocusArea, number>;
  recommendationCounts: Record<OfflineReviewRecommendation, number>;
  workflow?: WorkflowTargetMetadataRollup;
  topRecommendations: Array<{
    focusArea: OfflineReviewFocusArea;
    disagreementCount: number;
    recommendation: OfflineReviewRecommendation;
    owner: string;
    summary: string;
  }>;
};

export type OfflineReviewBatchReport = {
  schemaVersion: typeof OFFLINE_REVIEW_BATCH_REPORT_SCHEMA_VERSION;
  generatedAt: string;
  reviewer: {
    provider?: string;
    command: string;
  };
  input: {
    dataset?: string;
    split?: string;
    offset?: number;
    limit?: number;
    imported: boolean;
    bundles: string[];
  };
  summary: {
    bundleCount: number;
    statusCounts: Record<"clean" | "disagreement" | "error", number>;
    disagreementCount: number;
    actionableCount: number;
    focusAreaCounts: Record<OfflineReviewFocusArea, number>;
    recommendationCounts: Record<OfflineReviewRecommendation, number>;
    workflow?: WorkflowTargetMetadataRollup;
  };
  entries: OfflineReviewBatchEntry[];
};

export function createOfflineReviewBatchReport(
  entries: OfflineReviewBatchEntry[],
  options: {
    generatedAt?: string;
    reviewerCommand: string;
    reviewerProvider?: string;
    dataset?: string;
    split?: string;
    offset?: number;
    limit?: number;
    imported: boolean;
    bundles: string[];
  },
): OfflineReviewBatchReport {
  const statusCounts = {
    clean: 0,
    disagreement: 0,
    error: 0,
  } satisfies Record<"clean" | "disagreement" | "error", number>;
  const focusAreaCounts = createFocusAreaCounts();
  const recommendationCounts = {
    promote: 0,
    inspect: 0,
    ignore: 0,
  } satisfies Record<OfflineReviewRecommendation, number>;
  const workflow = mergeWorkflowRollups(entries.map((entry) => entry.workflow));

  let disagreementCount = 0;
  let actionableCount = 0;

  for (const entry of entries) {
    statusCounts[entry.status] += 1;
    disagreementCount += entry.disagreementCount;
    actionableCount += entry.actionableCount;

    for (const focusArea of Object.keys(entry.focusAreaCounts) as OfflineReviewFocusArea[]) {
      focusAreaCounts[focusArea] += entry.focusAreaCounts[focusArea];
    }
    for (const recommendation of Object.keys(
      entry.recommendationCounts,
    ) as OfflineReviewRecommendation[]) {
      recommendationCounts[recommendation] += entry.recommendationCounts[recommendation];
    }
  }

  return {
    schemaVersion: OFFLINE_REVIEW_BATCH_REPORT_SCHEMA_VERSION,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    reviewer: {
      ...(options.reviewerProvider ? { provider: options.reviewerProvider } : {}),
      command: options.reviewerCommand,
    },
    input: {
      ...(options.dataset ? { dataset: options.dataset } : {}),
      ...(options.split ? { split: options.split } : {}),
      ...(options.offset !== undefined ? { offset: options.offset } : {}),
      ...(options.limit !== undefined ? { limit: options.limit } : {}),
      imported: options.imported,
      bundles: options.bundles,
    },
    summary: {
      bundleCount: entries.length,
      statusCounts,
      disagreementCount,
      actionableCount,
      focusAreaCounts,
      recommendationCounts,
      ...(hasWorkflowTargetMetadataRollup(workflow) ? { workflow } : {}),
    },
    entries,
  };
}

export function defaultOfflineReviewBatchPath(
  reportOrTimestamp: OfflineReviewBatchReport | string,
  outputDirectory = DEFAULT_OFFLINE_REVIEW_BATCHES_DIR,
): string {
  const generatedAt =
    typeof reportOrTimestamp === "string" ? reportOrTimestamp : reportOrTimestamp.generatedAt;
  const safeTimestamp = generatedAt.replace(/[:.]/g, "-");
  return path.join(outputDirectory, `offline-review-batch-${safeTimestamp}.json`);
}

export function renderOfflineReviewBatchMarkdown(report: OfflineReviewBatchReport): string {
  const lines: string[] = [
    "# Offline Review Batch",
    "",
    `Generated: ${report.generatedAt}`,
    `Reviewer: ${report.reviewer.provider ?? "custom"} (${report.reviewer.command})`,
    `Bundles: ${report.summary.bundleCount}`,
    `Disagreements: ${report.summary.disagreementCount}`,
    `Actionable: ${report.summary.actionableCount}`,
    "",
    "## Summary",
    "",
    `- clean: ${report.summary.statusCounts.clean}`,
    `- disagreement: ${report.summary.statusCounts.disagreement}`,
    `- error: ${report.summary.statusCounts.error}`,
    `- promote: ${report.summary.recommendationCounts.promote}`,
    `- inspect: ${report.summary.recommendationCounts.inspect}`,
    `- ignore: ${report.summary.recommendationCounts.ignore}`,
    "",
  ];

  appendWorkflowRollupLines(lines, report.summary.workflow, "Workflow");

  lines.push("## Focus Areas", "");

  for (const focusArea of Object.keys(report.summary.focusAreaCounts) as OfflineReviewFocusArea[]) {
    lines.push(`- ${focusArea}: ${report.summary.focusAreaCounts[focusArea]}`);
  }

  lines.push("", "## Entries", "");

  for (const entry of report.entries) {
    lines.push(`### ${entry.sessionId}`);
    lines.push("");
    lines.push(`- status: ${entry.status}`);
    lines.push(`- disagreements: ${entry.disagreementCount}`);
    lines.push(`- actionable: ${entry.actionableCount}`);
    if (entry.status === "error") {
      lines.push(`- error: ${entry.error ?? "unknown error"}`);
    } else {
      lines.push(
        `- reviewer: ${entry.reviewer ?? "unknown"}${entry.model ? ` (${entry.model})` : ""}`,
      );
    }
    appendWorkflowRollupLines(lines, entry.workflow, "workflow");
    for (const recommendation of entry.topRecommendations.slice(0, 3)) {
      lines.push(
        `- ${recommendation.focusArea}: ${recommendation.disagreementCount} (${recommendation.recommendation})`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

export async function writeOfflineReviewBatchReport(
  outputPath: string,
  report: OfflineReviewBatchReport,
): Promise<void> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

export function summarizeRecommendationItems(
  items: OfflineReviewRecommendationItem[],
): Array<OfflineReviewBatchEntry["topRecommendations"][number]> {
  return items
    .map((item) => ({
      focusArea: item.focusArea,
      disagreementCount: item.disagreementCount,
      recommendation: item.recommendation,
      owner: item.owner,
      summary: item.summary,
    }))
    .sort((left, right) => right.disagreementCount - left.disagreementCount);
}

function createFocusAreaCounts(): Record<OfflineReviewFocusArea, number> {
  return Object.fromEntries(
    ALL_OFFLINE_REVIEW_FOCUS_AREAS.map((focusArea) => [focusArea, 0]),
  ) as Record<OfflineReviewFocusArea, number>;
}

function mergeWorkflowRollups(
  values: Iterable<WorkflowTargetMetadataRollup | undefined>,
): WorkflowTargetMetadataRollup {
  const automationModes = new Set<string>();
  const surfaces = new Set<string>();
  const runners = new Set<string>();
  const placements = new Set<string>();
  const environments = new Set<string>();
  const approvalStates = new Set<string>();
  const models = new Set<string>();
  const usageTotals = {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
  };

  for (const value of values) {
    if (!value) {
      continue;
    }

    for (const entry of value.automationModes) {
      automationModes.add(entry);
    }
    for (const entry of value.surfaces) {
      surfaces.add(entry);
    }
    for (const entry of value.runners) {
      runners.add(entry);
    }
    for (const entry of value.placements) {
      placements.add(entry);
    }
    for (const entry of value.environments) {
      environments.add(entry);
    }
    for (const entry of value.approvalStates) {
      approvalStates.add(entry);
    }
    for (const entry of value.models) {
      models.add(entry);
    }

    usageTotals.inputTokens += value.usageTotals.inputTokens;
    usageTotals.cachedInputTokens += value.usageTotals.cachedInputTokens;
    usageTotals.outputTokens += value.usageTotals.outputTokens;
    usageTotals.costUsd += value.usageTotals.costUsd;
  }

  return {
    automationModes: [...automationModes].sort(),
    surfaces: [...surfaces].sort(),
    runners: [...runners].sort(),
    placements: [...placements].sort(),
    environments: [...environments].sort(),
    approvalStates: [...approvalStates].sort(),
    models: [...models].sort(),
    usageTotals,
  };
}

function appendWorkflowRollupLines(
  lines: string[],
  workflow: WorkflowTargetMetadataRollup | undefined,
  label: string,
): void {
  if (!workflow || !hasWorkflowTargetMetadataRollup(workflow)) {
    return;
  }

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
    lines.push(`- ${label}: ${contextParts.join("; ")}`);
  }

  const usageParts = [
    workflow.usageTotals.inputTokens > 0 ? `input=${formatCount(workflow.usageTotals.inputTokens)}` : null,
    workflow.usageTotals.cachedInputTokens > 0 ? `cache=${formatCount(workflow.usageTotals.cachedInputTokens)}` : null,
    workflow.usageTotals.outputTokens > 0 ? `output=${formatCount(workflow.usageTotals.outputTokens)}` : null,
    workflow.usageTotals.costUsd > 0 ? `cost=${formatUsd(workflow.usageTotals.costUsd)}` : null,
  ].filter((part): part is string => part !== null);
  if (usageParts.length > 0) {
    lines.push(`- ${label} usage: ${usageParts.join(", ")}`);
  }
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
