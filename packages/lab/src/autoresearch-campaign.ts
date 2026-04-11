import { appendFile, mkdir, writeFile } from "node:fs/promises";

import {
  AUTORESEARCH_CAMPAIGN_SCHEMA_VERSION,
  AUTORESEARCH_RUN_STATUS_SCHEMA_VERSION,
} from "./artifact-versions.js";
export {
  AUTORESEARCH_CAMPAIGN_SCHEMA_VERSION,
  AUTORESEARCH_RUN_STATUS_SCHEMA_VERSION,
} from "./artifact-versions.js";

export type AutoresearchGateName = "judgment:battle" | "release:check";
export type AutoresearchRunStatusPhase = "running" | "gating" | "completed" | "error";

export type AutoresearchRunStatusSnapshot = {
  schemaVersion: typeof AUTORESEARCH_RUN_STATUS_SCHEMA_VERSION;
  generatedAt: string;
  updatedAt: string;
  lastProgressAt: string;
  phase: AutoresearchRunStatusPhase;
  dataset: string;
  split: string;
  provider: string;
  reviewerProvider: string;
  optimizerProvider: string;
  reviewConcurrency: number;
  offset: number;
  limit: number;
  maxSlices: number;
  attemptedSlices: number;
  completedSlices: number;
  remainingSlices: number;
  windowPercent: number;
  windowPercentIncludingInflight: number;
  currentSlice?: {
    index: number;
    offset: number;
    limit: number;
  };
  currentGate?: AutoresearchGateName;
  currentSliceStartedAt?: string;
  activeSliceElapsedSeconds?: number;
  finalStatus?: string;
  selectedProposalPath?: string;
  selectedPatchPath?: string;
  runPath?: string;
  runMarkdownPath?: string;
  note?: string;
};

export type AutoresearchCampaignPhase = "running" | "completed" | "error";

export type AutoresearchCampaignStatus = {
  schemaVersion: typeof AUTORESEARCH_CAMPAIGN_SCHEMA_VERSION;
  campaignId: string;
  generatedAt: string;
  updatedAt: string;
  lastProgressAt: string;
  phase: AutoresearchCampaignPhase;
  dataset: string;
  split: string;
  branch: string;
  commit: string;
  offset: number;
  limit: number;
  maxSlices: number;
  windowCount: number;
  completedWindows: number;
  campaignPercent: number;
  reviewConcurrency: number;
  stallThresholdSeconds?: number;
  stalled?: boolean;
  runIndex?: number;
  runId?: string;
  runPath?: string;
  runLogPath?: string;
  runOutputPath?: string;
  runStatusPath?: string;
  currentReportPath?: string;
  currentReportMarkdownPath?: string;
  currentRunProgress?: {
    phase: AutoresearchRunStatusPhase;
    attemptedSlices: number;
    completedSlices: number;
    remainingSlices: number;
    windowPercent: number;
    windowPercentIncludingInflight: number;
    lastProgressAt: string;
    heartbeatAgeSeconds?: number;
    finalStatus?: string;
    currentSlice?: {
      index: number;
      offset: number;
      limit: number;
    };
    currentGate?: AutoresearchGateName;
    currentSliceStartedAt?: string;
    activeSliceElapsedSeconds?: number;
  };
  note?: string;
};

export type AutoresearchCampaignSummaryRow = {
  runIndex: number;
  runId: string;
  startOffset: number;
  finishedAt: string;
  branch: string;
  commit: string;
  status: string;
  runPath?: string;
  runMarkdownPath?: string;
  selectedProposalPath?: string;
  selectedPatchPath?: string;
};

export function calculateAutoresearchWindowPercent(
  completedSlices: number,
  maxSlices: number,
): number {
  if (maxSlices <= 0) {
    return 100;
  }

  const ratio = Math.max(0, Math.min(1, completedSlices / maxSlices));
  return Math.round(ratio * 100);
}

export function calculateAutoresearchWindowPercentIncludingInflight(
  completedSlices: number,
  maxSlices: number,
  hasInflightSlice: boolean,
): number {
  return calculateAutoresearchWindowPercent(
    completedSlices + (hasInflightSlice ? 1 : 0),
    maxSlices,
  );
}

export function calculateAutoresearchCampaignPercent(options: {
  completedWindows: number;
  windowCount: number;
  currentWindowPercent?: number;
}): number {
  if (options.windowCount <= 0) {
    return 100;
  }

  const clampedCompleted = Math.max(0, Math.min(options.windowCount, options.completedWindows));
  const clampedCurrent = Math.max(0, Math.min(100, options.currentWindowPercent ?? 0));
  const progress = (clampedCompleted + clampedCurrent / 100) / options.windowCount;
  return Math.round(Math.max(0, Math.min(1, progress)) * 100);
}

export async function writeAutoresearchRunStatusSnapshot(
  filePath: string,
  snapshot: AutoresearchRunStatusSnapshot,
): Promise<void> {
  await mkdir(parentDirectory(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
}

export async function writeAutoresearchCampaignStatus(
  filePath: string,
  status: AutoresearchCampaignStatus,
): Promise<void> {
  await mkdir(parentDirectory(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(status, null, 2)}\n`, "utf8");
}

export async function appendAutoresearchCampaignSummary(
  filePath: string,
  row: AutoresearchCampaignSummaryRow,
): Promise<void> {
  await mkdir(parentDirectory(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(row)}\n`, "utf8");
}

function parentDirectory(filePath: string): string {
  const slashIndex = filePath.lastIndexOf("/");
  return slashIndex >= 0 ? filePath.slice(0, slashIndex) : ".";
}
