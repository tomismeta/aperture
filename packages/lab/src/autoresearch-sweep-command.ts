import { access, copyFile, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { acquireAutoresearchProcessLock } from "./autoresearch-lock.js";
import {
  ensureCleanRepo,
} from "./autoresearch-workspace.js";
import {
  runAutoresearchServiceCommand,
  type AutoresearchServiceCommandOptions,
  type AutoresearchServiceCommandResult,
} from "./autoresearch-service-command.js";
import {
  type PublicTrajectoryDataset,
  type PublicTrajectorySplit,
} from "./public-trajectories-types.js";

export type AutoresearchSweepPreset = "pre-release";

export type AutoresearchSweepLane = {
  dataset: PublicTrajectoryDataset;
  split: PublicTrajectorySplit;
  label?: string;
};

export type AutoresearchSweepCommandOptions = Omit<
  AutoresearchServiceCommandOptions,
  "dataset" | "split" | "serviceId" | "serviceRoot"
> & {
  preset?: AutoresearchSweepPreset;
  lanes?: AutoresearchSweepLane[];
  sweepId?: string;
  sweepRoot?: string;
};

export type AutoresearchSweepLaneResult = {
  label: string;
  dataset: PublicTrajectoryDataset;
  split: PublicTrajectorySplit;
  status: "proposal_ready" | "completed" | "error";
  finalStatus?: string;
  laneRoot: string;
  serviceStatusPath?: string;
  serviceLogPath?: string;
  reportPath?: string;
  reportMarkdownPath?: string;
  proposalPath?: string;
  proposalMarkdownPath?: string;
  patchPath?: string;
  campaignStatusPath?: string;
  campaignLogPath?: string;
  campaignSummaryPath?: string;
  error?: string;
};

export type AutoresearchSweepCommandResult = {
  status: "completed" | "error";
  sweepId: string;
  sweepRoot: string;
  statusPath: string;
  logPath: string;
  laneCount: number;
  completedLanes: number;
  currentLane?: string;
  lanes: AutoresearchSweepLaneResult[];
  error?: string;
};

type AutoresearchSweepStatus = {
  schemaVersion: 1;
  updatedAt: string;
  generatedAt: string;
  sweepId: string;
  phase: "running" | "completed" | "error";
  sourceRepo: string;
  laneCount: number;
  completedLanes: number;
  currentLane?: string;
  currentLaneIndex?: number;
  currentServiceStatusPath?: string;
  note?: string;
  lanes: AutoresearchSweepLaneResult[];
  error?: string;
};

const SWEEP_STATUS_SCHEMA_VERSION = 1;
const SWEEP_LOCK_FILE_NAME = "current-sweep.lock.json";

export function resolveAutoresearchSweepLanes(options: {
  preset?: AutoresearchSweepPreset;
  lanes?: AutoresearchSweepLane[];
}): AutoresearchSweepLane[] {
  const resolved: AutoresearchSweepLane[] = [];
  if (options.preset === "pre-release") {
    resolved.push(
      { dataset: "swe-smith", split: "xml" },
      { dataset: "open-agent-sessions", split: "approved" },
    );
  }
  if (options.lanes) {
    resolved.push(...options.lanes);
  }
  return resolved.map((lane, index) => ({
    ...lane,
    label: lane.label ?? defaultLaneLabel(index, lane),
  }));
}

export async function runAutoresearchSweepCommand(
  options: AutoresearchSweepCommandOptions,
): Promise<AutoresearchSweepCommandResult> {
  const sourceRepo = await realpath(options.sourceRepo);
  const lanes = resolveAutoresearchSweepLanes(options);
  if (lanes.length === 0) {
    throw new Error("F-Stop sweep requires at least one lane. Use --preset or --lane.");
  }

  const generatedAt = new Date().toISOString();
  const sweepId = options.sweepId ?? `fstop-sweep-${safeTimestamp(generatedAt)}`;
  const sweepRoot = options.sweepRoot
    ? path.resolve(options.sweepRoot)
    : path.join(sourceRepo, ".aperture", "fstop-sweeps", sweepId);
  const sweepLockPath = path.join(path.dirname(sweepRoot), SWEEP_LOCK_FILE_NAME);
  const statusPath = path.join(sweepRoot, "status.json");
  const logPath = path.join(sweepRoot, "sweep.log");
  const runtimeRoot = path.join(sourceRepo, ".aperture", "lab");

  await mkdir(sweepRoot, { recursive: true });
  const releaseLock = await acquireAutoresearchProcessLock(sweepLockPath, {
    kind: "sweep",
    id: sweepId,
    root: sweepRoot,
    pid: process.pid,
    createdAt: generatedAt,
    sourceRepo,
  });

  try {
    await ensureCleanRepo(sourceRepo);

    const laneResults: AutoresearchSweepLaneResult[] = [];
    let completedLanes = 0;

    await writeSweepStatus(statusPath, {
      generatedAt,
      sweepId,
      phase: "running",
      sourceRepo,
      laneCount: lanes.length,
      completedLanes,
      lanes: laneResults,
      note: "Sweep booting.",
    });

    for (const [laneIndex, lane] of lanes.entries()) {
      const label = lane.label ?? defaultLaneLabel(laneIndex, lane);
      const laneRoot = path.join(sweepRoot, label);
      await mkdir(laneRoot, { recursive: true });

      await logLine(
        logPath,
        `lane_start label=${label} dataset=${lane.dataset} split=${lane.split}`,
      );
      await writeSweepStatus(statusPath, {
        generatedAt,
        sweepId,
        phase: "running",
        sourceRepo,
        laneCount: lanes.length,
        completedLanes,
        currentLane: label,
        currentLaneIndex: laneIndex,
        currentServiceStatusPath: path.join(runtimeRoot, "service", "status.json"),
        lanes: laneResults,
        note: `Running ${label}.`,
      });

    await rm(runtimeRoot, { recursive: true, force: true });
    await ensureCleanRepo(sourceRepo);

    try {
      const result = await runAutoresearchServiceCommand({
        provider: options.provider,
        dataset: lane.dataset,
        split: lane.split,
        offset: options.offset,
        limit: options.limit,
        maxSlices: options.maxSlices,
        windowCount: options.windowCount,
        reviewerProvider: options.reviewerProvider,
        optimizerProvider: options.optimizerProvider,
        reviewConcurrency: options.reviewConcurrency,
        minSessionCount: options.minSessionCount,
        maxReports: options.maxReports,
        maxRestarts: options.maxRestarts,
        restartBackoffSeconds: options.restartBackoffSeconds,
        campaignStallThresholdSeconds: options.campaignStallThresholdSeconds,
        serviceStallThresholdSeconds: options.serviceStallThresholdSeconds,
        sourceRepo,
        serviceId: `${sweepId}-${label}`,
      });
      const preserved = await preserveAutoresearchSweepLaneArtifacts({
        laneRoot,
        sourceRepo,
        result,
      });
      const laneResult: AutoresearchSweepLaneResult = {
        label,
        dataset: lane.dataset,
        split: lane.split,
        status: result.status,
        finalStatus: result.finalStatus,
        laneRoot,
        ...preserved,
      };
      await writeLaneResult(laneRoot, laneResult);
      laneResults.push(laneResult);
      completedLanes += 1;
      await logLine(logPath, `lane_finish label=${label} status=${result.status} final_status=${result.finalStatus}`);
    } catch (error) {
      const preserved = await preserveAutoresearchSweepLaneArtifacts({
        laneRoot,
        sourceRepo,
      });
      const laneResult: AutoresearchSweepLaneResult = {
        label,
        dataset: lane.dataset,
        split: lane.split,
        status: "error",
        laneRoot,
        error: error instanceof Error ? error.message : String(error),
        ...preserved,
      };
      await writeLaneResult(laneRoot, laneResult);
      laneResults.push(laneResult);
      await logLine(logPath, `lane_error label=${label} error=${sanitizeLogField(laneResult.error)}`);
      await writeSweepStatus(statusPath, {
        generatedAt,
        sweepId,
        phase: "error",
        sourceRepo,
        laneCount: lanes.length,
        completedLanes,
        currentLane: label,
        currentLaneIndex: laneIndex,
        currentServiceStatusPath: path.join(runtimeRoot, "service", "status.json"),
        lanes: laneResults,
        note: `Lane failed: ${label}.`,
        ...(laneResult.error ? { error: laneResult.error } : {}),
      });
      await rm(runtimeRoot, { recursive: true, force: true });
      return {
        status: "error",
        sweepId,
        sweepRoot,
        statusPath,
        logPath,
        laneCount: lanes.length,
        completedLanes,
        currentLane: label,
        lanes: laneResults,
        ...(laneResult.error ? { error: laneResult.error } : {}),
      };
    }

    await rm(runtimeRoot, { recursive: true, force: true });
  }

    await writeSweepStatus(statusPath, {
      generatedAt,
      sweepId,
      phase: "completed",
      sourceRepo,
      laneCount: lanes.length,
      completedLanes,
      lanes: laneResults,
      note: "Sweep completed.",
    });
    await logLine(logPath, `sweep_finish lanes=${lanes.length}`);

    return {
      status: "completed",
      sweepId,
      sweepRoot,
      statusPath,
      logPath,
      laneCount: lanes.length,
      completedLanes,
      lanes: laneResults,
    };
  } finally {
    await releaseLock();
  }
}

export async function preserveAutoresearchSweepLaneArtifacts(options: {
  laneRoot: string;
  sourceRepo: string;
  result?: Pick<
    AutoresearchServiceCommandResult,
    "serviceRoot" | "statusPath" | "logPath" | "currentReportPath" | "currentReportMarkdownPath" | "selectedProposalPath" | "selectedPatchPath"
  >;
}): Promise<Omit<AutoresearchSweepLaneResult, "label" | "dataset" | "split" | "status" | "finalStatus" | "laneRoot" | "error">> {
  const runtimeRoot = path.join(options.sourceRepo, ".aperture", "lab");
  const serviceRoot = options.result?.serviceRoot ?? path.join(runtimeRoot, "service");
  const preserved: Partial<Omit<AutoresearchSweepLaneResult, "label" | "dataset" | "split" | "status" | "finalStatus" | "laneRoot" | "error">> = {};

  assignIfDefined(preserved, "serviceStatusPath", await copyIfPresent(
    options.result?.statusPath ?? path.join(serviceRoot, "status.json"),
    path.join(options.laneRoot, "service-status.json"),
  ));
  assignIfDefined(preserved, "serviceLogPath", await copyIfPresent(
    options.result?.logPath ?? path.join(serviceRoot, "service.log"),
    path.join(options.laneRoot, "service.log"),
  ));
  assignIfDefined(preserved, "reportPath", await copyIfPresent(
    options.result?.currentReportPath ?? path.join(runtimeRoot, "current-campaign", "current-report.json"),
    path.join(options.laneRoot, "report.json"),
  ));
  assignIfDefined(preserved, "reportMarkdownPath", await copyIfPresent(
    options.result?.currentReportMarkdownPath ?? path.join(runtimeRoot, "current-campaign", "current-report.md"),
    path.join(options.laneRoot, "report.md"),
  ));
  assignIfDefined(preserved, "proposalPath", await copyIfPresent(
    options.result?.selectedProposalPath,
    path.join(options.laneRoot, "proposal.json"),
  ));
  assignIfDefined(
    preserved,
    "proposalMarkdownPath",
    preserved.proposalPath
      ? await copyAdjacentMarkdown(options.result?.selectedProposalPath, path.join(options.laneRoot, "proposal.md"))
      : undefined,
  );
  assignIfDefined(preserved, "patchPath", await copyIfPresent(
    options.result?.selectedPatchPath,
    path.join(options.laneRoot, "patch.diff"),
  ));

  const campaignRoot = options.result?.currentReportPath
    ? deriveCampaignRoot(options.result.currentReportPath)
    : path.join(runtimeRoot, "current-campaign");
  assignIfDefined(preserved, "campaignStatusPath", await copyIfPresent(
    path.join(campaignRoot, "status.json"),
    path.join(options.laneRoot, "campaign-status.json"),
  ));
  assignIfDefined(preserved, "campaignLogPath", await copyIfPresent(
    path.join(campaignRoot, "campaign.log"),
    path.join(options.laneRoot, "campaign.log"),
  ));
  assignIfDefined(preserved, "campaignSummaryPath", await copyIfPresent(
    path.join(campaignRoot, "summary.jsonl"),
    path.join(options.laneRoot, "campaign-summary.jsonl"),
  ));

  return preserved;
}

async function writeLaneResult(
  laneRoot: string,
  result: AutoresearchSweepLaneResult,
): Promise<void> {
  await mkdir(laneRoot, { recursive: true });
  await writeFile(
    path.join(laneRoot, "lane-result.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8",
  );
}

async function writeSweepStatus(
  filePath: string,
  status: Omit<AutoresearchSweepStatus, "schemaVersion" | "updatedAt">,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify({
    schemaVersion: SWEEP_STATUS_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    ...status,
  }, null, 2)}\n`, "utf8");
}

async function copyIfPresent(sourcePath: string | undefined, destinationPath: string): Promise<string | undefined> {
  if (!sourcePath || !(await pathExists(sourcePath))) {
    return undefined;
  }
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await copyFile(sourcePath, destinationPath);
  return destinationPath;
}

async function copyAdjacentMarkdown(sourceJsonPath: string | undefined, destinationPath: string): Promise<string | undefined> {
  if (!sourceJsonPath || !sourceJsonPath.endsWith(".json")) {
    return undefined;
  }
  const sourceMarkdownPath = sourceJsonPath.replace(/\.json$/i, ".md");
  return await copyIfPresent(sourceMarkdownPath, destinationPath);
}

function deriveCampaignRoot(reportPath: string): string {
  return path.dirname(path.dirname(path.dirname(reportPath)));
}

function defaultLaneLabel(index: number, lane: Pick<AutoresearchSweepLane, "dataset" | "split">): string {
  return `${String(index + 1).padStart(2, "0")}-${lane.dataset}-${lane.split}`;
}

function assignIfDefined<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) {
    target[key] = value;
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function logLine(logPath: string, message: string): Promise<void> {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  await mkdir(path.dirname(logPath), { recursive: true });
  await writeFile(logPath, line, { flag: "a", encoding: "utf8" });
  process.stderr.write(line);
}

function sanitizeLogField(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function safeTimestamp(iso: string): string {
  return iso.replace(/[:.]/g, "-");
}
