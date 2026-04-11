import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { AUTORESEARCH_SERVICE_STATUS_SCHEMA_VERSION } from "./artifact-versions.js";
export { AUTORESEARCH_SERVICE_STATUS_SCHEMA_VERSION } from "./artifact-versions.js";

export type AutoresearchServicePhase =
  | "starting"
  | "running"
  | "restarting"
  | "completed"
  | "error";

export type AutoresearchServiceStatus = {
  schemaVersion: typeof AUTORESEARCH_SERVICE_STATUS_SCHEMA_VERSION;
  serviceId: string;
  generatedAt: string;
  updatedAt: string;
  phase: AutoresearchServicePhase;
  dataset: string;
  split: string;
  sourceRepo: string;
  branch?: string;
  commit?: string;
  currentOffset: number;
  limit: number;
  maxSlices: number;
  windowCount: number;
  completedWindows: number;
  reviewConcurrency: number;
  restartCount: number;
  maxRestarts: number;
  campaignStallThresholdSeconds: number;
  serviceStallThresholdSeconds: number;
  currentCampaignId?: string;
  currentCampaignRoot?: string;
  currentCampaignStatusPath?: string;
  currentReportPath?: string;
  currentReportMarkdownPath?: string;
  selectedProposalPath?: string;
  selectedPatchPath?: string;
  lastProgressAt?: string;
  note?: string;
};

export async function writeAutoresearchServiceStatus(
  filePath: string,
  status: AutoresearchServiceStatus,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(status, null, 2)}\n`, "utf8");
}
