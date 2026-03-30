import { appendFile, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { type AutoresearchCampaignStatus } from "./autoresearch-campaign.js";
import { type AutoresearchCampaignProvider } from "./autoresearch-campaign-command.js";
import { acquireAutoresearchProcessLock } from "./autoresearch-lock.js";
import {
  AUTORESEARCH_SERVICE_STATUS_SCHEMA_VERSION,
  writeAutoresearchServiceStatus,
  type AutoresearchServiceStatus,
} from "./autoresearch-service.js";
import { parseRequiredJsonText, readJsonFile, tryReadJsonFile } from "./json-utils.js";
import { type AutoresearchProposalRun } from "./autoresearch-proposal.js";
import { type PublicTrajectoryDataset, type PublicTrajectorySplit } from "./public-trajectories.js";
import {
  captureGitHeadSnapshot,
  ensureCleanRepo,
  listWorkingTreeFiles,
  restoreGitHeadSnapshot,
  runGit,
} from "./autoresearch-workspace.js";

export type AutoresearchServiceProvider = AutoresearchCampaignProvider;

export type AutoresearchServiceCommandOptions = {
  provider: AutoresearchServiceProvider;
  dataset: PublicTrajectoryDataset;
  split: PublicTrajectorySplit;
  offset: number;
  limit: number;
  maxSlices: number;
  windowCount: number;
  reviewerProvider: AutoresearchServiceProvider;
  optimizerProvider: AutoresearchServiceProvider;
  reviewConcurrency: number;
  minSessionCount: number;
  maxReports: number;
  maxRestarts: number;
  restartBackoffSeconds: number;
  campaignStallThresholdSeconds: number;
  serviceStallThresholdSeconds: number;
  serviceId?: string;
  serviceRoot?: string;
  sourceRepo: string;
};

export type AutoresearchServiceCommandResult = {
  status: "proposal_ready" | "completed" | "error";
  finalStatus: string;
  serviceId: string;
  serviceRoot: string;
  statusPath: string;
  logPath: string;
  completedWindows: number;
  windowCount: number;
  nextOffset: number;
  restartCount: number;
  currentReportPath?: string;
  currentReportMarkdownPath?: string;
  selectedProposalPath?: string;
  selectedPatchPath?: string;
};

type CampaignPayload = {
  status: string;
  campaignId?: string;
  campaignRoot?: string;
  logPath?: string;
  statusPath?: string;
  summaryPath?: string;
  completedWindows?: number;
  windowCount?: number;
  nextOffset?: number;
  currentReportPath?: string;
  currentReportMarkdownPath?: string;
  selectedProposalPath?: string;
  selectedPatchPath?: string;
};

const SERVICE_LOCK_FILE_NAME = "current-service.lock.json";

export async function runAutoresearchServiceCommand(
  options: AutoresearchServiceCommandOptions,
): Promise<AutoresearchServiceCommandResult> {
  const sourceRepo = await realpath(options.sourceRepo);

  const generatedAt = new Date().toISOString();
  const serviceId = options.serviceId ?? `fstop-service-${safeTimestamp(generatedAt)}`;
  const serviceRoot = options.serviceRoot
    ? path.resolve(options.serviceRoot)
    : path.join(sourceRepo, ".aperture", "lab", "service");
  const serviceLockPath = path.join(path.dirname(serviceRoot), SERVICE_LOCK_FILE_NAME);
  const statusPath = path.join(serviceRoot, "status.json");
  const logPath = path.join(serviceRoot, "service.log");
  const currentCampaignStatusPath = path.join(sourceRepo, ".aperture", "lab", "current-campaign", "status.json");
  const currentCampaignRootPath = path.join(sourceRepo, ".aperture", "lab", "current-campaign");

  await mkdir(serviceRoot, { recursive: true });
  const releaseLock = await acquireAutoresearchProcessLock(serviceLockPath, {
    kind: "service",
    id: serviceId,
    root: serviceRoot,
    pid: process.pid,
    createdAt: generatedAt,
    sourceRepo,
  });

  try {
    await ensureCleanRepo(sourceRepo);

    const branch = await runGit(sourceRepo, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const commit = await runGit(sourceRepo, ["rev-parse", "HEAD"]);
    const sourceSnapshot = await captureGitHeadSnapshot(sourceRepo);

    let offset = options.offset;
    let completedWindows = 0;
    let restartCount = 0;
    let finalStatus = "no_proposal";
    let currentReportPath: string | undefined;
    let currentReportMarkdownPath: string | undefined;
    let selectedProposalPath: string | undefined;
    let selectedPatchPath: string | undefined;
    let bestProposalScore: number | undefined;
    let lastProgressAt = generatedAt;

    await logLine(
      logPath,
      [
        "service_start",
        `dataset=${options.dataset}`,
        `split=${options.split}`,
        `offset=${options.offset}`,
        `limit=${options.limit}`,
        `max_slices=${options.maxSlices}`,
        `windows=${options.windowCount}`,
        `max_restarts=${options.maxRestarts}`,
        `review_concurrency=${options.reviewConcurrency}`,
      ].join(" "),
    );

    await writeServiceStatus(statusPath, {
      serviceId,
      generatedAt,
      phase: "starting",
      dataset: options.dataset,
      split: options.split,
      sourceRepo,
      branch,
      commit,
      currentOffset: offset,
      limit: options.limit,
      maxSlices: options.maxSlices,
      windowCount: options.windowCount,
      completedWindows,
      reviewConcurrency: options.reviewConcurrency,
      restartCount,
      maxRestarts: options.maxRestarts,
      campaignStallThresholdSeconds: options.campaignStallThresholdSeconds,
      serviceStallThresholdSeconds: options.serviceStallThresholdSeconds,
      note: "Service booting.",
    });

    for (let windowIndex = 0; windowIndex < options.windowCount; windowIndex += 1) {
    let attemptsForWindow = 0;

    while (true) {
      attemptsForWindow += 1;
      await writeServiceStatus(statusPath, {
        serviceId,
        generatedAt,
        phase: attemptsForWindow === 1 ? "running" : "restarting",
        dataset: options.dataset,
        split: options.split,
        sourceRepo,
        branch,
        commit,
        currentOffset: offset,
        limit: options.limit,
        maxSlices: options.maxSlices,
        windowCount: options.windowCount,
        completedWindows,
        reviewConcurrency: options.reviewConcurrency,
        restartCount,
        maxRestarts: options.maxRestarts,
        campaignStallThresholdSeconds: options.campaignStallThresholdSeconds,
        serviceStallThresholdSeconds: options.serviceStallThresholdSeconds,
        ...(lastProgressAt ? { lastProgressAt } : {}),
        ...(currentReportPath ? { currentReportPath } : {}),
        ...(currentReportMarkdownPath ? { currentReportMarkdownPath } : {}),
        ...(selectedProposalPath ? { selectedProposalPath } : {}),
        ...(selectedPatchPath ? { selectedPatchPath } : {}),
        note: attemptsForWindow === 1
          ? `Launching campaign window ${windowIndex}.`
          : `Restarting campaign window ${windowIndex} after failure.`,
      });
      await logLine(logPath, `campaign_launch window=${windowIndex} offset=${offset} attempt=${attemptsForWindow}`);

      try {
        await restoreGitHeadSnapshot(sourceSnapshot, sourceRepo);
        const payload = await executeCampaignWindow({
          sourceRepo,
          offset,
          options,
          currentCampaignStatusPath,
          onStatus: async (campaignStatus) => {
            await restoreLeakedSourceRepoChanges(sourceRepo, sourceSnapshot, logPath);
            lastProgressAt = campaignStatus.lastProgressAt;
            currentReportPath = campaignStatus.currentReportPath ?? currentReportPath;
            currentReportMarkdownPath = campaignStatus.currentReportMarkdownPath ?? currentReportMarkdownPath;
            await writeServiceStatus(statusPath, {
              serviceId,
              generatedAt,
              phase: "running",
              dataset: options.dataset,
              split: options.split,
              sourceRepo,
              branch,
              commit,
              currentOffset: offset,
              limit: options.limit,
              maxSlices: options.maxSlices,
              windowCount: options.windowCount,
              completedWindows,
              reviewConcurrency: options.reviewConcurrency,
              restartCount,
              maxRestarts: options.maxRestarts,
              campaignStallThresholdSeconds: options.campaignStallThresholdSeconds,
              serviceStallThresholdSeconds: options.serviceStallThresholdSeconds,
              currentCampaignId: campaignStatus.campaignId,
              currentCampaignRoot: currentCampaignRootPath,
              currentCampaignStatusPath,
              ...(currentReportPath ? { currentReportPath } : {}),
              ...(currentReportMarkdownPath ? { currentReportMarkdownPath } : {}),
              lastProgressAt,
              note: `Campaign window ${windowIndex} running.`,
            });
          },
        });

        if (payload.status === "error") {
          throw new Error("Campaign returned error status.");
        }

        offset = payload.nextOffset ?? offset + options.limit * options.maxSlices;
        if (payload.selectedProposalPath) {
          const candidateScore = await readProposalScore(payload.selectedProposalPath);
          if (bestProposalScore === undefined || candidateScore >= bestProposalScore) {
            bestProposalScore = candidateScore;
            selectedProposalPath = payload.selectedProposalPath;
            selectedPatchPath = payload.selectedPatchPath ?? selectedPatchPath;
            currentReportPath = payload.currentReportPath ?? currentReportPath;
            currentReportMarkdownPath = payload.currentReportMarkdownPath ?? currentReportMarkdownPath;
            finalStatus = "proposal_ready";
          }
        } else {
          currentReportPath = payload.currentReportPath ?? currentReportPath;
          currentReportMarkdownPath = payload.currentReportMarkdownPath ?? currentReportMarkdownPath;
          if (finalStatus !== "proposal_ready") {
            finalStatus = payload.status;
          }
        }
        completedWindows += 1;

        await logLine(logPath, `campaign_finish window=${windowIndex} status=${payload.status} next_offset=${offset}`);

        await writeServiceStatus(statusPath, {
          serviceId,
          generatedAt,
          phase: "running",
          dataset: options.dataset,
          split: options.split,
          sourceRepo,
          branch,
          commit,
          currentOffset: offset,
          limit: options.limit,
          maxSlices: options.maxSlices,
          windowCount: options.windowCount,
          completedWindows,
          reviewConcurrency: options.reviewConcurrency,
          restartCount,
          maxRestarts: options.maxRestarts,
          campaignStallThresholdSeconds: options.campaignStallThresholdSeconds,
          serviceStallThresholdSeconds: options.serviceStallThresholdSeconds,
          ...(payload.campaignId ? { currentCampaignId: payload.campaignId } : {}),
          currentCampaignRoot: payload.campaignRoot ?? currentCampaignRootPath,
          ...(payload.statusPath ? { currentCampaignStatusPath: payload.statusPath } : {}),
          ...(currentReportPath ? { currentReportPath } : {}),
          ...(currentReportMarkdownPath ? { currentReportMarkdownPath } : {}),
          ...(selectedProposalPath ? { selectedProposalPath } : {}),
          ...(selectedPatchPath ? { selectedPatchPath } : {}),
          note: payload.selectedProposalPath
            ? `Completed campaign window ${windowIndex} with a proposal candidate.`
            : `Completed campaign window ${windowIndex}.`,
        });

        break;
      } catch (error) {
        await restoreGitHeadSnapshot(sourceSnapshot, sourceRepo).catch(async (restoreError) => {
          await logLine(
            logPath,
            `source_repo_restore_error window=${windowIndex} offset=${offset} message=${sanitizeLogField(
              restoreError instanceof Error ? restoreError.message : String(restoreError),
            )}`,
          );
        });
        restartCount += 1;
        const message = error instanceof Error ? error.message : String(error);
        await logLine(
          logPath,
          `campaign_error window=${windowIndex} offset=${offset} attempt=${attemptsForWindow} restart_count=${restartCount} message=${sanitizeLogField(message)}`,
        );

        if (restartCount > options.maxRestarts) {
          finalStatus = "error";
          await writeServiceStatus(statusPath, {
            serviceId,
            generatedAt,
            phase: "error",
            dataset: options.dataset,
            split: options.split,
            sourceRepo,
            branch,
            commit,
            currentOffset: offset,
            limit: options.limit,
            maxSlices: options.maxSlices,
            windowCount: options.windowCount,
            completedWindows,
            reviewConcurrency: options.reviewConcurrency,
            restartCount,
            maxRestarts: options.maxRestarts,
            campaignStallThresholdSeconds: options.campaignStallThresholdSeconds,
            serviceStallThresholdSeconds: options.serviceStallThresholdSeconds,
            ...(currentReportPath ? { currentReportPath } : {}),
            ...(currentReportMarkdownPath ? { currentReportMarkdownPath } : {}),
            ...(selectedProposalPath ? { selectedProposalPath } : {}),
            ...(selectedPatchPath ? { selectedPatchPath } : {}),
            note: `Restart limit exceeded: ${message}`,
          });
          return {
            status: "error",
            finalStatus,
            serviceId,
            serviceRoot,
            statusPath,
            logPath,
            completedWindows,
            windowCount: options.windowCount,
            nextOffset: offset,
            restartCount,
            ...(currentReportPath ? { currentReportPath } : {}),
            ...(currentReportMarkdownPath ? { currentReportMarkdownPath } : {}),
            ...(selectedProposalPath ? { selectedProposalPath } : {}),
            ...(selectedPatchPath ? { selectedPatchPath } : {}),
          };
        }

        await writeServiceStatus(statusPath, {
          serviceId,
          generatedAt,
          phase: "restarting",
          dataset: options.dataset,
          split: options.split,
          sourceRepo,
          branch,
          commit,
          currentOffset: offset,
          limit: options.limit,
          maxSlices: options.maxSlices,
          windowCount: options.windowCount,
          completedWindows,
          reviewConcurrency: options.reviewConcurrency,
          restartCount,
          maxRestarts: options.maxRestarts,
          campaignStallThresholdSeconds: options.campaignStallThresholdSeconds,
          serviceStallThresholdSeconds: options.serviceStallThresholdSeconds,
          ...(currentReportPath ? { currentReportPath } : {}),
          ...(currentReportMarkdownPath ? { currentReportMarkdownPath } : {}),
          ...(selectedProposalPath ? { selectedProposalPath } : {}),
          ...(selectedPatchPath ? { selectedPatchPath } : {}),
          note: `Restarting after failure: ${message}`,
        });
        await sleep(options.restartBackoffSeconds * 1000);
      }
    }

  }

    await restoreGitHeadSnapshot(sourceSnapshot, sourceRepo).catch(async (restoreError) => {
      await logLine(
        logPath,
        `source_repo_restore_error window=final offset=${offset} message=${sanitizeLogField(
          restoreError instanceof Error ? restoreError.message : String(restoreError),
        )}`,
      );
    });

    const status: AutoresearchServiceCommandResult["status"] = selectedProposalPath
      ? "proposal_ready"
      : "completed";
    await writeServiceStatus(statusPath, {
      serviceId,
      generatedAt,
      phase: "completed",
      dataset: options.dataset,
      split: options.split,
      sourceRepo,
      branch,
      commit,
      currentOffset: offset,
      limit: options.limit,
      maxSlices: options.maxSlices,
      windowCount: options.windowCount,
      completedWindows,
      reviewConcurrency: options.reviewConcurrency,
      restartCount,
      maxRestarts: options.maxRestarts,
      campaignStallThresholdSeconds: options.campaignStallThresholdSeconds,
      serviceStallThresholdSeconds: options.serviceStallThresholdSeconds,
      ...(currentReportPath ? { currentReportPath } : {}),
      ...(currentReportMarkdownPath ? { currentReportMarkdownPath } : {}),
      ...(selectedProposalPath ? { selectedProposalPath } : {}),
      ...(selectedPatchPath ? { selectedPatchPath } : {}),
      note: selectedProposalPath
        ? "Completed all windows with a selected proposal candidate."
        : "Service completed without proposal.",
    });
    await logLine(
      logPath,
      `service_complete status=${finalStatus} completed_windows=${completedWindows} next_offset=${offset} restarts=${restartCount}`,
    );

    return {
      status,
      finalStatus,
      serviceId,
      serviceRoot,
      statusPath,
      logPath,
      completedWindows,
      windowCount: options.windowCount,
      nextOffset: offset,
      restartCount,
      ...(currentReportPath ? { currentReportPath } : {}),
      ...(currentReportMarkdownPath ? { currentReportMarkdownPath } : {}),
      ...(selectedProposalPath ? { selectedProposalPath } : {}),
      ...(selectedPatchPath ? { selectedPatchPath } : {}),
    };
  } finally {
    await releaseLock();
  }
}

async function readProposalScore(proposalPath: string): Promise<number> {
  const proposal = await readJsonFile<AutoresearchProposalRun>(proposalPath);
  const statusScore = proposal.status === "proposed" ? 1_000_000 : 0;
  return statusScore
    + proposal.summary.selectedSignalCount * 10_000
    + proposal.summary.promotedCaseCount * 1_000
    + proposal.summary.actionableCount;
}

async function executeCampaignWindow(options: {
  sourceRepo: string;
  offset: number;
  options: AutoresearchServiceCommandOptions;
  currentCampaignStatusPath: string;
  onStatus: (status: AutoresearchCampaignStatus) => Promise<void>;
}): Promise<CampaignPayload> {
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let stalled = false;
  let lastObservedProgressAt: string | undefined;
  const tsxCli = path.join(options.sourceRepo, "node_modules", "tsx", "dist", "cli.mjs");
  const fstopCli = path.join(options.sourceRepo, "scripts", "fstop.ts");
  const child = spawn(process.execPath, [
    tsxCli,
    fstopCli,
    "campaign",
    "--provider",
    options.options.provider,
    "--dataset",
    options.options.dataset,
    "--split",
    options.options.split,
    "--offset",
    String(options.offset),
    "--limit",
    String(options.options.limit),
    "--max-slices",
    String(options.options.maxSlices),
    "--window-count",
    "1",
    "--reviewer-provider",
    options.options.reviewerProvider,
    "--optimizer-provider",
    options.options.optimizerProvider,
    "--review-concurrency",
    String(options.options.reviewConcurrency),
    "--min-session-count",
    String(options.options.minSessionCount),
    "--max-reports",
    String(options.options.maxReports),
    "--stall-threshold-seconds",
    String(options.options.campaignStallThresholdSeconds),
    "--json",
  ], {
    cwd: options.sourceRepo,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (child.stdout) {
    child.stdout.on("data", (chunk) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
  }
  if (child.stderr) {
    child.stderr.on("data", (chunk) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
  }

  const poll = setInterval(async () => {
    const status = await readCampaignStatus(options.currentCampaignStatusPath);
    if (!status) {
      return;
    }

    lastObservedProgressAt = status.lastProgressAt;
    await options.onStatus(status);
    const ageSeconds = calculateAgeSeconds(status.lastProgressAt);
    if (status.stalled || ageSeconds >= options.options.serviceStallThresholdSeconds) {
      stalled = true;
      child.kill("SIGTERM");
    }
  }, 5000);

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  }).finally(() => {
    clearInterval(poll);
  });

  if (stalled) {
    throw new Error(
      `Campaign stalled after ${options.options.serviceStallThresholdSeconds}s without progress${lastObservedProgressAt ? ` (last progress: ${lastObservedProgressAt})` : ""}.`,
    );
  }

  if (exitCode !== 0) {
    const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
    throw new Error(`lab:fstop:campaign failed with exit code ${exitCode}${stderr ? `: ${stderr}` : ""}`);
  }

  const outputText = Buffer.concat(stdoutChunks).toString("utf8").trim();
  return parseRequiredJsonText<CampaignPayload>(outputText, "lab:fstop:campaign");
}

async function restoreLeakedSourceRepoChanges(
  sourceRepo: string,
  sourceSnapshot: Awaited<ReturnType<typeof captureGitHeadSnapshot>>,
  logPath: string,
): Promise<void> {
  const leakedFiles = await listWorkingTreeFiles(sourceRepo);
  if (leakedFiles.length === 0) {
    return;
  }

  await restoreGitHeadSnapshot(sourceSnapshot, sourceRepo);
  await logLine(
    logPath,
    `source_repo_leak_restored files=${sanitizeLogField(leakedFiles.join(","))}`,
  );
}

async function readCampaignStatus(
  filePath: string,
): Promise<AutoresearchCampaignStatus | undefined> {
  return await tryReadJsonFile<AutoresearchCampaignStatus>(filePath);
}

async function writeServiceStatus(
  filePath: string,
  status: Omit<AutoresearchServiceStatus, "schemaVersion" | "updatedAt">,
): Promise<void> {
  await writeAutoresearchServiceStatus(filePath, {
    schemaVersion: AUTORESEARCH_SERVICE_STATUS_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    ...status,
  });
}

function calculateAgeSeconds(timestamp: string): number {
  const value = Date.parse(timestamp);
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.round((Date.now() - value) / 1000));
}

async function logLine(filePath: string, line: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await appendFile(filePath, `[${new Date().toISOString()}] ${line}\n`, "utf8");
}

function sanitizeLogField(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function safeTimestamp(value: string): string {
  return value.replace(/[:.]/g, "-");
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
