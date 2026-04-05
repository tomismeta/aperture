import { createWriteStream } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { once } from "node:events";
import path from "node:path";
import { spawn } from "node:child_process";

import {
  appendAutoresearchCampaignSummary,
  type AutoresearchCampaignStatus,
  type AutoresearchCampaignSummaryRow,
  type AutoresearchRunStatusSnapshot,
  calculateAutoresearchCampaignPercent,
  writeAutoresearchCampaignStatus,
} from "./autoresearch-campaign.js";
import { finalizeCampaignRunArtifacts } from "./autoresearch-campaign-artifacts.js";
import { defaultAutoresearchRetainedBacklogPath } from "./autoresearch-backlog.js";
import {
  defaultAutoresearchFinalReportMarkdownPath,
  synthesizeAutoresearchFinalReport,
} from "./autoresearch-report.js";
import { type AutoresearchProposalRun } from "./autoresearch-proposal.js";
import { parseRequiredJsonText, readJsonFile, tryReadJsonFile } from "./json-utils.js";
import {
  ensureCleanRepo,
  ensureSymlink,
  prepareWorktreeWorkspace,
  runGit,
} from "./autoresearch-workspace.js";

export type AutoresearchCampaignProvider = "hermes" | "openclaw" | "generic";

export type AutoresearchCampaignCommandOptions = {
  provider: AutoresearchCampaignProvider;
  dataset: "swe-smith" | "dataclaw" | "open-agent-sessions";
  split: "tool" | "xml" | "ticks" | "train" | "approved";
  offset: number;
  limit: number;
  maxSlices: number;
  windowCount: number;
  reviewerProvider: AutoresearchCampaignProvider;
  optimizerProvider: AutoresearchCampaignProvider;
  reviewConcurrency: number;
  minSessionCount: number;
  maxReports: number;
  stallThresholdSeconds: number;
  campaignId?: string;
  campaignRoot?: string;
  sourceRepo: string;
};

export type AutoresearchCampaignCommandResult = {
  status: string;
  campaignId: string;
  campaignRoot: string;
  logPath: string;
  statusPath: string;
  summaryPath: string;
  completedWindows: number;
  windowCount: number;
  nextOffset: number;
  currentReportPath?: string;
  currentReportMarkdownPath?: string;
  selectedProposalPath?: string;
  selectedPatchPath?: string;
};

type RunPayload = {
  status?: string;
  runPath?: string;
  runMarkdownPath?: string;
  selectedProposalPath?: string;
  selectedBatchReportPath?: string;
  selectedOptimizerRunPath?: string;
  selectedPatchPath?: string;
};

type CampaignLock = {
  campaignId: string;
  campaignRoot: string;
  pid: number;
  createdAt: string;
};

const CAMPAIGN_LOCK_FILE_NAME = "current-campaign.lock.json";

export async function runAutoresearchCampaignCommand(
  options: AutoresearchCampaignCommandOptions,
): Promise<AutoresearchCampaignCommandResult> {
  await ensureCleanRepo(options.sourceRepo);

  const generatedAt = new Date().toISOString();
  const campaignId = options.campaignId ?? defaultCampaignId(generatedAt);
  const baseLabDirectory = path.resolve(options.sourceRepo, ".aperture", "lab");
  const campaignRoot = options.campaignRoot
    ? path.resolve(options.campaignRoot)
    : path.join(baseLabDirectory, "campaigns", campaignId);
  const symlinkRoot = options.campaignRoot
    ? path.dirname(campaignRoot)
    : baseLabDirectory;
  const runsDir = path.join(campaignRoot, "runs");
  const summaryPath = path.join(campaignRoot, "summary.jsonl");
  const statusPath = path.join(campaignRoot, "status.json");
  const logPath = path.join(campaignRoot, "campaign.log");
  const currentRunLinkPath = path.join(campaignRoot, "current-run");
  const currentReportJsonLinkPath = path.join(campaignRoot, "current-report.json");
  const currentReportMarkdownLinkPath = path.join(campaignRoot, "current-report.md");
  const currentCampaignLinkPath = path.join(symlinkRoot, "current-campaign");
  const latestCampaignLinkPath = path.join(symlinkRoot, "latest-campaign");
  const lockPath = path.join(symlinkRoot, CAMPAIGN_LOCK_FILE_NAME);

  await mkdir(runsDir, { recursive: true });
  const releaseLock = await acquireCampaignLock(lockPath, {
    campaignId,
    campaignRoot,
    pid: process.pid,
    createdAt: generatedAt,
  });

  try {
    await ensureSymlink(currentCampaignLinkPath, campaignRoot);
    await ensureSymlink(latestCampaignLinkPath, campaignRoot);

    const branch = await runGit(options.sourceRepo, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const commit = await runGit(options.sourceRepo, ["rev-parse", "HEAD"]);

    let offset = options.offset;
    let completedWindows = 0;
    let finalSelectedPatchPath: string | undefined;
    let finalSelectedProposalPath: string | undefined;
    let finalSelectedReportPath: string | undefined;
    let finalSelectedReportMarkdownPath: string | undefined;
    let bestProposalScore: number | undefined;
    let finalStatus = "no_proposal";
    let lastProgressAt = generatedAt;
    let currentReportPath: string | undefined;
    let currentReportMarkdownPath: string | undefined;

    await logLine(logPath, [
      `campaign_start`,
      `dataset=${options.dataset}`,
      `split=${options.split}`,
      `branch=${branch}`,
      `commit=${commit}`,
      `windows=${options.windowCount}`,
      `limit=${options.limit}`,
      `maxSlices=${options.maxSlices}`,
      `review_concurrency=${options.reviewConcurrency}`,
      `stall_seconds=${options.stallThresholdSeconds}`,
    ].join(" "));
    await writeCampaignStatus(statusPath, {
      campaignId,
      generatedAt,
      phase: "running",
      dataset: options.dataset,
      split: options.split,
      branch,
      commit,
      offset,
      limit: options.limit,
      maxSlices: options.maxSlices,
      windowCount: options.windowCount,
      completedWindows,
      campaignPercent: calculateAutoresearchCampaignPercent({
        completedWindows,
        windowCount: options.windowCount,
      }),
      lastProgressAt,
      reviewConcurrency: options.reviewConcurrency,
      stallThresholdSeconds: options.stallThresholdSeconds,
      ...(currentReportPath ? { currentReportPath } : {}),
      ...(currentReportMarkdownPath ? { currentReportMarkdownPath } : {}),
    });

    for (let runIndex = 0; runIndex < options.windowCount; runIndex += 1) {
      const runId = `run-${String(runIndex).padStart(2, "0")}-offset-${String(offset).padStart(4, "0")}`;
      const runRoot = path.join(runsDir, runId);
      const repoDir = path.join(runRoot, "repo");
      const outputPath = path.join(runRoot, "output.json");
      const runLogPath = path.join(runRoot, "run.log");
      const runStatusPath = path.join(runRoot, "status.json");
      const reportPath = path.join(runRoot, "report.json");
      const reportMarkdownPath = defaultAutoresearchFinalReportMarkdownPath(reportPath);
      await mkdir(runRoot, { recursive: true });
      await ensureSymlink(currentRunLinkPath, runRoot);

      await logLine(logPath, `run_start index=${runIndex} offset=${offset} run=${runId}`);
      await writeCampaignStatus(statusPath, {
        campaignId,
        generatedAt,
        phase: "running",
        dataset: options.dataset,
        split: options.split,
        branch,
        commit,
        offset,
        limit: options.limit,
        maxSlices: options.maxSlices,
        windowCount: options.windowCount,
        completedWindows,
        campaignPercent: calculateAutoresearchCampaignPercent({
          completedWindows,
          windowCount: options.windowCount,
        }),
        lastProgressAt,
        reviewConcurrency: options.reviewConcurrency,
        stallThresholdSeconds: options.stallThresholdSeconds,
        stalled: false,
        runIndex,
        runId,
        runPath: repoDir,
        runLogPath,
        runOutputPath: outputPath,
        runStatusPath,
        note: "Window started.",
        ...(currentReportPath ? { currentReportPath } : {}),
        ...(currentReportMarkdownPath ? { currentReportMarkdownPath } : {}),
      });

      let runPayload: RunPayload | undefined;
      let runStatus: AutoresearchRunStatusSnapshot | undefined;
      let runError: string | undefined;
      let stallLoggedForProgressAt: string | undefined;
      let latestRunReportPath: string | undefined;
      let latestRunReportMarkdownPath: string | undefined;

      try {
        await prepareWorktreeWorkspace({
          sourceRepo: options.sourceRepo,
          commit,
          repoDir,
        });
        runPayload = await executeCampaignRun({
          repoDir,
          outputPath,
          runLogPath,
          runStatusPath,
          options,
          offset,
          onProgress: async (snapshot) => {
            runStatus = snapshot;
            lastProgressAt = snapshot.lastProgressAt;
            const heartbeatAgeSeconds = calculateAgeSeconds(snapshot.lastProgressAt);
            const stalled = heartbeatAgeSeconds >= options.stallThresholdSeconds;
            if (stalled && stallLoggedForProgressAt !== snapshot.lastProgressAt) {
              stallLoggedForProgressAt = snapshot.lastProgressAt;
              await logLine(
                logPath,
                `run_stalled index=${runIndex} offset=${offset} run=${runId} heartbeat_age_seconds=${heartbeatAgeSeconds}`,
              );
            }

            await writeCampaignStatus(statusPath, {
              campaignId,
              generatedAt,
              phase: "running",
              dataset: options.dataset,
              split: options.split,
              branch,
              commit,
              offset,
              limit: options.limit,
              maxSlices: options.maxSlices,
              windowCount: options.windowCount,
              completedWindows,
              campaignPercent: calculateAutoresearchCampaignPercent({
                completedWindows,
                windowCount: options.windowCount,
                currentWindowPercent: snapshot.windowPercentIncludingInflight,
              }),
              lastProgressAt,
              reviewConcurrency: options.reviewConcurrency,
              stallThresholdSeconds: options.stallThresholdSeconds,
              stalled,
              ...(currentReportPath ? { currentReportPath } : {}),
              ...(currentReportMarkdownPath ? { currentReportMarkdownPath } : {}),
              runIndex,
              runId,
              runPath: repoDir,
              runLogPath,
              runOutputPath: outputPath,
              runStatusPath,
              currentRunProgress: {
                phase: snapshot.phase,
                attemptedSlices: snapshot.attemptedSlices,
                completedSlices: snapshot.completedSlices,
                remainingSlices: snapshot.remainingSlices,
                windowPercent: snapshot.windowPercent,
                windowPercentIncludingInflight: snapshot.windowPercentIncludingInflight,
                lastProgressAt: snapshot.lastProgressAt,
                heartbeatAgeSeconds,
                ...(snapshot.finalStatus ? { finalStatus: snapshot.finalStatus } : {}),
                ...(snapshot.currentSlice ? { currentSlice: snapshot.currentSlice } : {}),
                ...(snapshot.currentGate ? { currentGate: snapshot.currentGate } : {}),
                ...(snapshot.currentSliceStartedAt
                  ? { currentSliceStartedAt: snapshot.currentSliceStartedAt }
                  : {}),
                ...(snapshot.activeSliceElapsedSeconds !== undefined
                  ? { activeSliceElapsedSeconds: snapshot.activeSliceElapsedSeconds }
                  : {}),
              },
            });
          },
        });
      } catch (error) {
        runError = error instanceof Error ? error.message : String(error);
      }

      let persistedArtifacts:
        | Awaited<ReturnType<typeof finalizeCampaignRunArtifacts>>
        | undefined;

      try {
        const report = runPayload?.runPath || runPayload?.selectedProposalPath
          ? await synthesizeAutoresearchFinalReport({
              generatedAt: new Date().toISOString(),
              ...(runPayload?.runPath ? { runnerRunPath: runPayload.runPath } : {}),
              ...(runPayload?.selectedProposalPath ? { proposalPath: runPayload.selectedProposalPath } : {}),
              repoRoot: repoDir,
            })
          : undefined;

        persistedArtifacts = await finalizeCampaignRunArtifacts({
          sourceRepo: options.sourceRepo,
          runRoot,
          repoDir,
          outputPath,
          runStatusPath,
          ...(runPayload ? { payload: runPayload } : {}),
          ...(report ? { report, reportPath, reportMarkdownPath } : {}),
        });
        latestRunReportPath = persistedArtifacts.reportPath;
        latestRunReportMarkdownPath = persistedArtifacts.reportMarkdownPath;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        runError = runError ? `${runError}; ${message}` : message;
      }

      const effectiveStatus = runError ? "error" : (runPayload?.status ?? "error");
      if (persistedArtifacts?.selectedProposalPath) {
        const candidateScore = await readProposalScore(persistedArtifacts.selectedProposalPath);
        if (bestProposalScore === undefined || candidateScore >= bestProposalScore) {
          bestProposalScore = candidateScore;
          finalSelectedProposalPath = persistedArtifacts.selectedProposalPath;
          finalSelectedPatchPath = persistedArtifacts.selectedPatchPath ?? finalSelectedPatchPath;
          finalSelectedReportPath = latestRunReportPath ?? finalSelectedReportPath;
          finalSelectedReportMarkdownPath = latestRunReportMarkdownPath ?? finalSelectedReportMarkdownPath;
          finalStatus = "proposal_ready";
        }
      }
      currentReportPath = finalSelectedReportPath ?? latestRunReportPath ?? currentReportPath;
      currentReportMarkdownPath = finalSelectedReportMarkdownPath ?? latestRunReportMarkdownPath ?? currentReportMarkdownPath;
      if (currentReportPath) {
        await ensureSymlink(currentReportJsonLinkPath, currentReportPath);
      }
      if (currentReportMarkdownPath) {
        await ensureSymlink(currentReportMarkdownLinkPath, currentReportMarkdownPath);
      }
      const summaryRow: AutoresearchCampaignSummaryRow = {
        runIndex,
        runId,
        startOffset: offset,
        finishedAt: new Date().toISOString(),
        branch,
        commit,
        status: effectiveStatus,
        ...(persistedArtifacts?.runPath ? { runPath: persistedArtifacts.runPath } : {}),
        ...(persistedArtifacts?.runMarkdownPath ? { runMarkdownPath: persistedArtifacts.runMarkdownPath } : {}),
        ...(persistedArtifacts?.selectedProposalPath
          ? { selectedProposalPath: persistedArtifacts.selectedProposalPath }
          : {}),
        ...(persistedArtifacts?.selectedPatchPath ? { selectedPatchPath: persistedArtifacts.selectedPatchPath } : {}),
      };
      await appendAutoresearchCampaignSummary(summaryPath, summaryRow);

      completedWindows += 1;
      const heartbeatAgeSeconds = runStatus ? calculateAgeSeconds(runStatus.lastProgressAt) : undefined;

      await writeCampaignStatus(statusPath, {
        campaignId,
        generatedAt,
        phase: runError ? "error" : "running",
        dataset: options.dataset,
        split: options.split,
        branch,
        commit,
        offset,
        limit: options.limit,
        maxSlices: options.maxSlices,
        windowCount: options.windowCount,
        completedWindows,
        campaignPercent: calculateAutoresearchCampaignPercent({
          completedWindows,
          windowCount: options.windowCount,
        }),
        lastProgressAt,
        reviewConcurrency: options.reviewConcurrency,
        stallThresholdSeconds: options.stallThresholdSeconds,
        stalled: heartbeatAgeSeconds !== undefined
          ? heartbeatAgeSeconds >= options.stallThresholdSeconds
          : false,
        ...(currentReportPath ? { currentReportPath } : {}),
        ...(currentReportMarkdownPath ? { currentReportMarkdownPath } : {}),
        runIndex,
        runId,
        runPath: runRoot,
        runLogPath,
        ...(runStatus
          ? {
            currentRunProgress: {
              phase: runStatus.phase,
              attemptedSlices: runStatus.attemptedSlices,
              completedSlices: runStatus.completedSlices,
              remainingSlices: runStatus.remainingSlices,
              windowPercent: runStatus.windowPercent,
              windowPercentIncludingInflight: runStatus.windowPercentIncludingInflight,
              lastProgressAt: runStatus.lastProgressAt,
              ...(heartbeatAgeSeconds !== undefined ? { heartbeatAgeSeconds } : {}),
              ...(runStatus.finalStatus ? { finalStatus: runStatus.finalStatus } : {}),
              ...(runStatus.currentSlice ? { currentSlice: runStatus.currentSlice } : {}),
              ...(runStatus.currentGate ? { currentGate: runStatus.currentGate } : {}),
              ...(runStatus.currentSliceStartedAt
                ? { currentSliceStartedAt: runStatus.currentSliceStartedAt }
                : {}),
              ...(runStatus.activeSliceElapsedSeconds !== undefined
                ? { activeSliceElapsedSeconds: runStatus.activeSliceElapsedSeconds }
                : {}),
            },
          }
          : {}),
        ...(runError ? { note: runError } : {}),
      });

      await logLine(
        logPath,
        `run_finish index=${runIndex} offset=${offset} status=${effectiveStatus} run=${runId}`,
      );

      if (runPayload) {
        offset += await determineNextOffsetDelta(
          runPayload,
          options.limit,
          options.maxSlices,
          repoDir,
          offset,
        );
        if (finalStatus !== "proposal_ready") {
          finalStatus = effectiveStatus;
        }
        if (effectiveStatus === "exhausted") {
          await logLine(
            logPath,
            `campaign_exhausted index=${runIndex} offset=${offset} run=${runId}`,
          );
          break;
        }
      } else {
        offset += options.limit;
        finalStatus = "error";
      }
    }

    await writeCampaignStatus(statusPath, {
      campaignId,
      generatedAt,
      phase: finalStatus === "error" ? "error" : "completed",
      dataset: options.dataset,
      split: options.split,
      branch,
      commit,
      offset,
      limit: options.limit,
      maxSlices: options.maxSlices,
      windowCount: options.windowCount,
      completedWindows,
      campaignPercent: calculateAutoresearchCampaignPercent({
        completedWindows,
        windowCount: options.windowCount,
      }),
      lastProgressAt,
      reviewConcurrency: options.reviewConcurrency,
      stallThresholdSeconds: options.stallThresholdSeconds,
      stalled: false,
      ...(currentReportPath ? { currentReportPath } : {}),
      ...(currentReportMarkdownPath ? { currentReportMarkdownPath } : {}),
      note: finalSelectedProposalPath
        ? `Selected proposal: ${finalSelectedProposalPath}`
        : finalStatus === "error"
          ? "Campaign ended with an error."
          : finalStatus === "exhausted"
            ? "Campaign exhausted the available bundles and ended cleanly."
          : "Campaign completed without a selected proposal.",
    });
    await logLine(
      logPath,
      `campaign_complete status=${finalSelectedProposalPath ? "proposal_ready" : finalStatus} completed_windows=${completedWindows} next_offset=${offset}`,
    );

    return {
      status: finalSelectedProposalPath ? "proposal_ready" : finalStatus,
      campaignId,
      campaignRoot,
      logPath,
      statusPath,
      summaryPath,
      completedWindows,
      windowCount: options.windowCount,
      nextOffset: offset,
      ...(currentReportPath ? { currentReportPath } : {}),
      ...(currentReportMarkdownPath ? { currentReportMarkdownPath } : {}),
      ...(finalSelectedProposalPath ? { selectedProposalPath: finalSelectedProposalPath } : {}),
      ...(finalSelectedPatchPath ? { selectedPatchPath: finalSelectedPatchPath } : {}),
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

async function executeCampaignRun(options: {
  repoDir: string;
  outputPath: string;
  runLogPath: string;
  runStatusPath: string;
  options: AutoresearchCampaignCommandOptions;
  offset: number;
  onProgress: (snapshot: AutoresearchRunStatusSnapshot) => Promise<void>;
}): Promise<RunPayload> {
  const outputStream = createWriteStream(options.outputPath, { flags: "w" });
  const logStream = createWriteStream(options.runLogPath, { flags: "w" });
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];

  const child = spawn(process.execPath, [
    path.join(options.repoDir, "node_modules", "tsx", "dist", "cli.mjs"),
    path.join(options.repoDir, "scripts", "fstop.ts"),
    "run",
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
    "--status-output",
    options.runStatusPath,
    "--json",
  ], {
    cwd: options.repoDir,
    env: {
      ...process.env,
      APERTURE_AUTORESEARCH_RETAINED_BACKLOG_PATH: defaultAutoresearchRetainedBacklogPath(
        path.join(
          options.options.sourceRepo,
          ".aperture",
          "lab",
          "results",
          "autoresearch",
          "backlog",
        ),
      ),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    stdoutChunks.push(buffer);
    outputStream.write(buffer);
  });
  child.stderr.on("data", (chunk) => {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    stderrChunks.push(buffer);
    logStream.write(buffer);
  });

  const poll = setInterval(async () => {
    const snapshot = await readRunStatusSnapshot(options.runStatusPath);
    if (snapshot) {
      await options.onProgress(snapshot);
    }
  }, 2000);

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  }).finally(() => {
    clearInterval(poll);
  });

  outputStream.end();
  logStream.end();
  await Promise.all([once(outputStream, "finish"), once(logStream, "finish")]);

  const finalSnapshot = await readRunStatusSnapshot(options.runStatusPath);
  if (finalSnapshot) {
    await options.onProgress(finalSnapshot);
  }

  if (exitCode !== 0) {
    const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
    throw new Error(`lab:fstop:run failed with exit code ${exitCode}${stderr ? `: ${stderr}` : ""}`);
  }

  const outputText = Buffer.concat(stdoutChunks).toString("utf8").trim();
  return parseRequiredJsonText<RunPayload>(outputText, "lab:fstop:run");
}

async function determineNextOffsetDelta(
  payload: RunPayload,
  limit: number,
  maxSlices: number,
  repoDir: string,
  startOffset: number,
): Promise<number> {
  if (!payload.runPath) {
    return limit * maxSlices;
  }

  try {
    const run = await readJsonFile<{
      feedback?: {
        attempts?: Array<{
          offset: number;
          limit: number;
        }>;
      };
    }>(path.resolve(repoDir, payload.runPath));
    const attempts = run.feedback?.attempts ?? [];
    if (attempts.length === 0) {
      return limit * maxSlices;
    }
    const maxEnd = attempts.reduce(
      (max, attempt) => Math.max(max, Number(attempt.offset) + Number(attempt.limit)),
      0,
    );
    return Math.max(limit, maxEnd - startOffset);
  } catch {
    return limit * maxSlices;
  }
}

async function readRunStatusSnapshot(
  filePath: string,
): Promise<AutoresearchRunStatusSnapshot | undefined> {
  return await tryReadJsonFile<AutoresearchRunStatusSnapshot>(filePath);
}

async function writeCampaignStatus(
  filePath: string,
  status: Omit<AutoresearchCampaignStatus, "schemaVersion" | "updatedAt">,
): Promise<void> {
  await writeAutoresearchCampaignStatus(filePath, {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    ...status,
  });
}

async function acquireCampaignLock(
  lockPath: string,
  lock: CampaignLock,
): Promise<() => Promise<void>> {
  await mkdir(path.dirname(lockPath), { recursive: true });

  const existing = await readCampaignLock(lockPath);
  if (existing) {
    const alive = processIsAlive(existing.pid);
    if (alive) {
      throw new Error(
        `Another F-Stop campaign is already running: ${existing.campaignId} (pid ${existing.pid}) at ${existing.campaignRoot}`,
      );
    }
    await rm(lockPath, { force: true });
  }

  await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");

  return async () => {
    const current = await readCampaignLock(lockPath);
    if (!current || (current.pid === lock.pid && current.campaignId === lock.campaignId)) {
      await rm(lockPath, { force: true });
    }
  };
}

async function readCampaignLock(lockPath: string): Promise<CampaignLock | undefined> {
  return await tryReadJsonFile<CampaignLock>(lockPath);
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function calculateAgeSeconds(timestamp: string): number {
  return Math.max(0, Math.round((Date.now() - Date.parse(timestamp)) / 1000));
}

async function logLine(logPath: string, message: string): Promise<void> {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  await mkdir(path.dirname(logPath), { recursive: true });
  await writeFile(logPath, line, { flag: "a", encoding: "utf8" });
  process.stderr.write(line);
}

function defaultCampaignId(generatedAt: string): string {
  return `fstop-campaign-${generatedAt.replace(/[:.]/g, "-")}`;
}
