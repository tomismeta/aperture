import { createWriteStream } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { once } from "node:events";
import path from "node:path";
import { spawn } from "node:child_process";

import type { AutoresearchRunStatusSnapshot } from "./autoresearch-campaign.js";
import { defaultAutoresearchRetainedBacklogPath } from "./autoresearch-backlog.js";
import { parseRequiredJsonText, readJsonFile, tryReadJsonFile } from "./json-utils.js";
import { type AutoresearchProposalRun } from "./autoresearch-proposal.js";

export type RunPayload = {
  status?: string;
  runPath?: string;
  runMarkdownPath?: string;
  selectedProposalPath?: string;
  selectedBatchReportPath?: string;
  selectedOptimizerRunPath?: string;
  selectedPatchPath?: string;
};

export type CampaignLock = {
  campaignId: string;
  campaignRoot: string;
  pid: number;
  createdAt: string;
};

export async function readProposalScore(proposalPath: string): Promise<number> {
  const proposal = await readJsonFile<AutoresearchProposalRun>(proposalPath);
  const statusScore = proposal.status === "proposed" ? 1_000_000 : 0;
  return (
    statusScore +
    proposal.summary.selectedSignalCount * 10_000 +
    proposal.summary.promotedCaseCount * 1_000 +
    proposal.summary.actionableCount
  );
}

export async function executeCampaignRun(options: {
  repoDir: string;
  outputPath: string;
  runLogPath: string;
  runStatusPath: string;
  offset: number;
  campaign: {
    provider: string;
    dataset: string;
    split: string;
    limit: number;
    maxSlices: number;
    reviewerProvider: string;
    optimizerProvider: string;
    reviewConcurrency: number;
    minSessionCount: number;
    maxReports: number;
    sourceRepo: string;
  };
  onProgress: (snapshot: AutoresearchRunStatusSnapshot) => Promise<void>;
}): Promise<RunPayload> {
  const outputStream = createWriteStream(options.outputPath, { flags: "w" });
  const logStream = createWriteStream(options.runLogPath, { flags: "w" });
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];

  const child = spawn(
    process.execPath,
    buildCampaignRunCommand({
      repoDir: options.repoDir,
      statusPath: options.runStatusPath,
      offset: options.offset,
      campaign: options.campaign,
    }),
    {
      cwd: options.repoDir,
      env: {
        ...process.env,
        APERTURE_AUTORESEARCH_RETAINED_BACKLOG_PATH: defaultAutoresearchRetainedBacklogPath(
          path.join(
            options.campaign.sourceRepo,
            ".aperture",
            "lab",
            "results",
            "autoresearch",
            "backlog",
          ),
        ),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

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
  }, 2_000);

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
    throw new Error(
      `lab:fstop:run failed with exit code ${exitCode}${stderr ? `: ${stderr}` : ""}`,
    );
  }

  const outputText = Buffer.concat(stdoutChunks).toString("utf8").trim();
  return parseRequiredJsonText<RunPayload>(outputText, "lab:fstop:run");
}

export async function determineNextOffsetDelta(
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

export async function acquireCampaignLock(
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

export function calculateAgeSeconds(timestamp: string): number {
  return Math.max(0, Math.round((Date.now() - Date.parse(timestamp)) / 1000));
}

export async function logLine(logPath: string, message: string): Promise<void> {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  await mkdir(path.dirname(logPath), { recursive: true });
  await writeFile(logPath, line, { flag: "a", encoding: "utf8" });
  process.stderr.write(line);
}

export function defaultCampaignId(generatedAt: string): string {
  return `fstop-campaign-${generatedAt.replace(/[:.]/g, "-")}`;
}

function buildCampaignRunCommand(options: {
  repoDir: string;
  statusPath: string;
  offset: number;
  campaign: {
    provider: string;
    dataset: string;
    split: string;
    limit: number;
    maxSlices: number;
    reviewerProvider: string;
    optimizerProvider: string;
    reviewConcurrency: number;
    minSessionCount: number;
    maxReports: number;
  };
}): string[] {
  return [
    path.join(options.repoDir, "node_modules", "tsx", "dist", "cli.mjs"),
    path.join(options.repoDir, "scripts", "fstop.ts"),
    "run",
    "--provider",
    options.campaign.provider,
    "--dataset",
    options.campaign.dataset,
    "--split",
    options.campaign.split,
    "--offset",
    String(options.offset),
    "--limit",
    String(options.campaign.limit),
    "--max-slices",
    String(options.campaign.maxSlices),
    "--reviewer-provider",
    options.campaign.reviewerProvider,
    "--optimizer-provider",
    options.campaign.optimizerProvider,
    "--review-concurrency",
    String(options.campaign.reviewConcurrency),
    "--min-session-count",
    String(options.campaign.minSessionCount),
    "--max-reports",
    String(options.campaign.maxReports),
    "--status-output",
    options.statusPath,
    "--json",
  ];
}

async function readCampaignLock(lockPath: string): Promise<CampaignLock | undefined> {
  return tryReadJsonFile<CampaignLock>(lockPath);
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readRunStatusSnapshot(
  filePath: string,
): Promise<AutoresearchRunStatusSnapshot | undefined> {
  return tryReadJsonFile<AutoresearchRunStatusSnapshot>(filePath);
}
