import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  DEFAULT_OFFLINE_REVIEW_RECOMMENDATIONS_DIR,
  DEFAULT_OFFLINE_REVIEW_RESULTS_DIR,
  type OfflineReviewFocusArea,
  type OfflineReviewRecommendation,
  type OfflineReviewRecommendationItem,
} from "./offline-review.js";

export const OFFLINE_REVIEW_BATCH_REPORT_SCHEMA_VERSION = 1 as const;
export const DEFAULT_OFFLINE_REVIEW_BATCHES_DIR = path.join(
  DEFAULT_OFFLINE_REVIEW_RESULTS_DIR,
  "batches",
);

export type OfflineReviewBatchEntry = {
  sessionId: string;
  status: "clean" | "disagreement";
  disagreementCount: number;
  actionableCount: number;
  reviewer?: string;
  model?: string;
  requestPath: string;
  promptPath: string;
  rawResponsePath: string;
  responseArtifactPath: string;
  reportPath: string;
  recommendationPath: string;
  runPath: string;
  focusAreaCounts: Record<OfflineReviewFocusArea, number>;
  recommendationCounts: Record<OfflineReviewRecommendation, number>;
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
    statusCounts: Record<"clean" | "disagreement", number>;
    disagreementCount: number;
    actionableCount: number;
    focusAreaCounts: Record<OfflineReviewFocusArea, number>;
    recommendationCounts: Record<OfflineReviewRecommendation, number>;
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
  } satisfies Record<"clean" | "disagreement", number>;
  const focusAreaCounts = createFocusAreaCounts();
  const recommendationCounts = {
    promote: 0,
    inspect: 0,
    ignore: 0,
  } satisfies Record<OfflineReviewRecommendation, number>;

  let disagreementCount = 0;
  let actionableCount = 0;

  for (const entry of entries) {
    statusCounts[entry.status] += 1;
    disagreementCount += entry.disagreementCount;
    actionableCount += entry.actionableCount;

    for (const focusArea of Object.keys(entry.focusAreaCounts) as OfflineReviewFocusArea[]) {
      focusAreaCounts[focusArea] += entry.focusAreaCounts[focusArea];
    }
    for (const recommendation of Object.keys(entry.recommendationCounts) as OfflineReviewRecommendation[]) {
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
    },
    entries,
  };
}

export function defaultOfflineReviewBatchPath(
  reportOrTimestamp: OfflineReviewBatchReport | string,
  outputDirectory = DEFAULT_OFFLINE_REVIEW_BATCHES_DIR,
): string {
  const generatedAt = typeof reportOrTimestamp === "string"
    ? reportOrTimestamp
    : reportOrTimestamp.generatedAt;
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
    `- promote: ${report.summary.recommendationCounts.promote}`,
    `- inspect: ${report.summary.recommendationCounts.inspect}`,
    `- ignore: ${report.summary.recommendationCounts.ignore}`,
    "",
    "## Focus Areas",
    "",
  ];

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
    lines.push(`- reviewer: ${entry.reviewer ?? "unknown"}${entry.model ? ` (${entry.model})` : ""}`);
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
  return {
    title: 0,
    summary: 0,
    status: 0,
    intentFrame: 0,
    toolFamily: 0,
    consequence: 0,
  };
}
