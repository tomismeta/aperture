import { mkdir } from "node:fs/promises";
import path from "node:path";

import {
  appendAutoresearchCampaignSummary,
  type AutoresearchCampaignStatus,
  type AutoresearchCampaignSummaryRow,
  type AutoresearchRunStatusSnapshot,
  AUTORESEARCH_CAMPAIGN_SCHEMA_VERSION,
  calculateAutoresearchCampaignPercent,
  writeAutoresearchCampaignStatus,
} from "./autoresearch-campaign.js";
import { finalizeCampaignRunArtifacts } from "./autoresearch-campaign-artifacts.js";
import {
  defaultAutoresearchFinalReportMarkdownPath,
  synthesizeAutoresearchFinalReport,
} from "./autoresearch-report.js";
import type { PublicTrajectoryDataset, PublicTrajectorySplit } from "./public-trajectories.js";
import {
  acquireCampaignLock,
  calculateAgeSeconds,
  defaultCampaignId,
  determineNextOffsetDelta,
  executeCampaignRun,
  logLine,
  readProposalScore,
  type RunPayload,
} from "./autoresearch-campaign-support.js";
import {
  ensureCleanRepo,
  ensureSymlink,
  prepareWorktreeWorkspace,
  runGit,
} from "./autoresearch-workspace.js";

export type AutoresearchCampaignProvider = "hermes" | "openclaw" | "generic";

export type AutoresearchCampaignCommandOptions = {
  provider: AutoresearchCampaignProvider;
  dataset: PublicTrajectoryDataset;
  split: PublicTrajectorySplit;
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
  const symlinkRoot = options.campaignRoot ? path.dirname(campaignRoot) : baseLabDirectory;
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

    await logLine(
      logPath,
      [
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
      ].join(" "),
    );
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
          offset,
          campaign: {
            provider: options.provider,
            dataset: options.dataset,
            split: options.split,
            limit: options.limit,
            maxSlices: options.maxSlices,
            reviewerProvider: options.reviewerProvider,
            optimizerProvider: options.optimizerProvider,
            reviewConcurrency: options.reviewConcurrency,
            minSessionCount: options.minSessionCount,
            maxReports: options.maxReports,
            sourceRepo: options.sourceRepo,
          },
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

      let persistedArtifacts: Awaited<ReturnType<typeof finalizeCampaignRunArtifacts>> | undefined;

      try {
        const report =
          runPayload?.runPath || runPayload?.selectedProposalPath
            ? await synthesizeAutoresearchFinalReport({
                generatedAt: new Date().toISOString(),
                ...(runPayload?.runPath ? { runnerRunPath: runPayload.runPath } : {}),
                ...(runPayload?.selectedProposalPath
                  ? { proposalPath: runPayload.selectedProposalPath }
                  : {}),
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
          finalSelectedReportMarkdownPath =
            latestRunReportMarkdownPath ?? finalSelectedReportMarkdownPath;
          finalStatus = "proposal_ready";
        }
      }
      currentReportPath = finalSelectedReportPath ?? latestRunReportPath ?? currentReportPath;
      currentReportMarkdownPath =
        finalSelectedReportMarkdownPath ?? latestRunReportMarkdownPath ?? currentReportMarkdownPath;
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
        ...(persistedArtifacts?.runMarkdownPath
          ? { runMarkdownPath: persistedArtifacts.runMarkdownPath }
          : {}),
        ...(persistedArtifacts?.selectedProposalPath
          ? { selectedProposalPath: persistedArtifacts.selectedProposalPath }
          : {}),
        ...(persistedArtifacts?.selectedPatchPath
          ? { selectedPatchPath: persistedArtifacts.selectedPatchPath }
          : {}),
      };
      await appendAutoresearchCampaignSummary(summaryPath, summaryRow);

      completedWindows += 1;
      const heartbeatAgeSeconds = runStatus
        ? calculateAgeSeconds(runStatus.lastProgressAt)
        : undefined;

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
        stalled:
          heartbeatAgeSeconds !== undefined
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

async function writeCampaignStatus(
  filePath: string,
  status: Omit<AutoresearchCampaignStatus, "schemaVersion" | "updatedAt">,
): Promise<void> {
  await writeAutoresearchCampaignStatus(filePath, {
    schemaVersion: AUTORESEARCH_CAMPAIGN_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    ...status,
  });
}
