import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  createOfflineReviewBatchReport,
  defaultOfflineReviewArtifactPath,
  defaultOfflineReviewBatchPath,
  importPublicTrajectoryBundles,
  loadSessionBundle,
  parseOfflineReviewResponseText,
  prepareOfflineReviewArtifact,
  renderOfflineReviewBatchMarkdown,
  summarizeRecommendationItems,
  writeOfflineReviewArtifact,
  writeOfflineReviewBatchReport,
  type OfflineReviewBatchEntry,
  type OfflineReviewFocusArea,
  type OfflineReviewRecommendationItem,
  type OfflineReviewRecommendationReport,
  type PublicTrajectoryDataset,
  type SweSmithTrajectorySplit,
} from "../packages/lab/src/index.js";

type Options = {
  bundlePaths: string[];
  dataset?: PublicTrajectoryDataset;
  split?: SweSmithTrajectorySplit;
  offset?: number;
  limit?: number;
  reviewerProvider?: "hermes" | "openclaw" | "generic";
  reviewerCommand?: string;
  outputPath?: string;
  markdownOutputPath?: string;
  json: boolean;
};

type ReviewRunResult = {
  status: "clean" | "disagreement";
  bundleSessionId: string;
  requestPath: string;
  promptPath: string;
  rawResponsePath: string;
  responseArtifactPath: string;
  reportPath: string;
  recommendationPath: string;
  runPath: string;
  disagreementCount: number;
  actionableCount: number;
};

const TSX_CLI = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../node_modules/tsx/dist/cli.mjs",
);
const OFFLINE_REVIEW_SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "./offline-review.ts",
);

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const {
    bundlePaths,
    imported,
  } = await resolveBundlePaths(options);

  if (bundlePaths.length === 0) {
    throw new Error("No bundles available to review.");
  }

  const reviewerCommand = options.reviewerCommand
    ?? `pnpm lab:review:reviewer --provider ${options.reviewerProvider ?? "generic"}`;
  const entries: OfflineReviewBatchEntry[] = [];

  for (const bundlePath of bundlePaths) {
    const artifactPath = await prepareArtifact(bundlePath);
    const runResult = await runReview(artifactPath, reviewerCommand);
    const entry = await buildBatchEntry(runResult);
    entries.push(entry);
  }

  const report = createOfflineReviewBatchReport(entries, {
    reviewerCommand,
    ...(options.reviewerProvider ? { reviewerProvider: options.reviewerProvider } : {}),
    ...(options.dataset ? { dataset: options.dataset } : {}),
    ...(options.split ? { split: options.split } : {}),
    ...(options.offset !== undefined ? { offset: options.offset } : {}),
    ...(options.limit !== undefined ? { limit: options.limit } : {}),
    imported,
    bundles: bundlePaths,
  });
  const outputPath = options.outputPath ?? defaultOfflineReviewBatchPath(report);
  const markdownOutputPath = options.markdownOutputPath ?? outputPath.replace(/\.json$/i, ".md");

  await writeOfflineReviewBatchReport(outputPath, report);
  await writeText(markdownOutputPath, renderOfflineReviewBatchMarkdown(report));

  emitResult(
    options.json,
    {
      status: "ok",
      outputPath,
      markdownOutputPath,
      bundleCount: report.summary.bundleCount,
      disagreementCount: report.summary.disagreementCount,
      actionableCount: report.summary.actionableCount,
      focusAreaCounts: report.summary.focusAreaCounts,
      recommendationCounts: report.summary.recommendationCounts,
      entries: report.entries.map((entry) => ({
        sessionId: entry.sessionId,
        status: entry.status,
        disagreementCount: entry.disagreementCount,
        actionableCount: entry.actionableCount,
        reviewer: entry.reviewer,
        model: entry.model,
      })),
    },
    [
      `Offline review batch complete for ${report.summary.bundleCount} bundle(s).`,
      `Report: ${outputPath}`,
      `Summary: ${markdownOutputPath}`,
      `Disagreements: ${report.summary.disagreementCount}`,
      `Actionable: ${report.summary.actionableCount}`,
    ],
  );
}

function parseArgs(argv: string[]): Options {
  const bundlePaths: string[] = [];
  let dataset: PublicTrajectoryDataset | undefined;
  let split: SweSmithTrajectorySplit | undefined;
  let offset: number | undefined;
  let limit: number | undefined;
  let reviewerProvider: Options["reviewerProvider"];
  let reviewerCommand: string | undefined;
  let outputPath: string | undefined;
  let markdownOutputPath: string | undefined;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--bundle":
        bundlePaths.push(path.resolve(argv[++index] ?? ""));
        break;
      case "--dataset":
        dataset = readDataset(argv[++index]);
        break;
      case "--split":
        split = readSplit(argv[++index]);
        break;
      case "--offset":
        offset = readInteger(argv[++index], "--offset");
        break;
      case "--limit":
        limit = readInteger(argv[++index], "--limit");
        break;
      case "--reviewer-provider":
        reviewerProvider = readReviewerProvider(argv[++index]);
        break;
      case "--reviewer-command":
        reviewerCommand = argv[++index];
        break;
      case "--output":
        outputPath = path.resolve(argv[++index] ?? "");
        break;
      case "--markdown-output":
        markdownOutputPath = path.resolve(argv[++index] ?? "");
        break;
      case "--json":
        json = true;
        break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return {
    bundlePaths,
    ...(dataset ? { dataset } : {}),
    ...(split ? { split } : {}),
    ...(offset !== undefined ? { offset } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(reviewerProvider ? { reviewerProvider } : {}),
    ...(reviewerCommand ? { reviewerCommand } : {}),
    ...(outputPath ? { outputPath } : {}),
    ...(markdownOutputPath ? { markdownOutputPath } : {}),
    json,
  };
}

async function resolveBundlePaths(
  options: Options,
): Promise<{ bundlePaths: string[]; imported: boolean }> {
  if (options.bundlePaths.length > 0) {
    for (const bundlePath of options.bundlePaths) {
      await stat(bundlePath);
    }
    return {
      bundlePaths: options.bundlePaths,
      imported: false,
    };
  }

  const imported = await importPublicTrajectoryBundles({
    dataset: options.dataset ?? "swe-smith",
    split: options.split ?? "tool",
    ...(options.offset !== undefined ? { offset: options.offset } : {}),
    ...(options.limit !== undefined ? { limit: options.limit } : {}),
  });

  return {
    bundlePaths: imported.map((entry) => entry.filePath),
    imported: true,
  };
}

async function prepareArtifact(bundlePath: string): Promise<string> {
  const bundle = await loadSessionBundle(bundlePath);
  const artifact = prepareOfflineReviewArtifact(bundle, {
    bundlePath,
  });
  const artifactPath = defaultOfflineReviewArtifactPath(artifact);
  await writeOfflineReviewArtifact(artifactPath, artifact);
  return artifactPath;
}

async function runReview(
  artifactPath: string,
  reviewerCommand: string,
): Promise<ReviewRunResult> {
  const output = await runJsonCli([
    OFFLINE_REVIEW_SCRIPT,
    "run",
    "--artifact",
    artifactPath,
    "--reviewer-command",
    reviewerCommand,
    "--json",
  ]);

  return {
    status: readRunStatus(output.status),
    bundleSessionId: readString(output.bundleSessionId, "bundleSessionId"),
    requestPath: readString(output.requestPath, "requestPath"),
    promptPath: readString(output.promptPath, "promptPath"),
    rawResponsePath: readString(output.rawResponsePath, "rawResponsePath"),
    responseArtifactPath: readString(output.responseArtifactPath, "responseArtifactPath"),
    reportPath: readString(output.reportPath, "reportPath"),
    recommendationPath: readString(output.recommendationPath, "recommendationPath"),
    runPath: readString(output.runPath, "runPath"),
    disagreementCount: readIntegerField(output.disagreementCount, "disagreementCount"),
    actionableCount: readIntegerField(output.actionableCount, "actionableCount"),
  };
}

async function buildBatchEntry(runResult: ReviewRunResult): Promise<OfflineReviewBatchEntry> {
  const recommendation = JSON.parse(
    await readFile(runResult.recommendationPath, "utf8"),
  ) as OfflineReviewRecommendationReport;
  const response = parseOfflineReviewResponseText(await readFile(runResult.responseArtifactPath, "utf8"));

  return {
    sessionId: runResult.bundleSessionId,
    status: runResult.status,
    disagreementCount: runResult.disagreementCount,
    actionableCount: runResult.actionableCount,
    reviewer: response.review.reviewer,
    model: response.review.model,
    requestPath: runResult.requestPath,
    promptPath: runResult.promptPath,
    rawResponsePath: runResult.rawResponsePath,
    responseArtifactPath: runResult.responseArtifactPath,
    reportPath: runResult.reportPath,
    recommendationPath: runResult.recommendationPath,
    runPath: runResult.runPath,
    focusAreaCounts: summarizeFocusAreaCounts(recommendation.items),
    recommendationCounts: recommendation.summary.recommendationCounts,
    topRecommendations: summarizeRecommendationItems(recommendation.items),
  };
}

function summarizeFocusAreaCounts(
  items: OfflineReviewRecommendationItem[],
): Record<OfflineReviewFocusArea, number> {
  const counts: Record<OfflineReviewFocusArea, number> = {
    title: 0,
    summary: 0,
    status: 0,
    intentFrame: 0,
    toolFamily: 0,
    consequence: 0,
  };

  for (const item of items) {
    counts[item.focusArea] += item.disagreementCount;
  }

  return counts;
}

async function runJsonCli(argv: string[]): Promise<Record<string, unknown>> {
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, [TSX_CLI, ...argv], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    child.stderr.on("data", (chunk) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      const stdoutText = Buffer.concat(stdoutChunks).toString("utf8").trim();
      const stderrText = Buffer.concat(stderrChunks).toString("utf8").trim();
      if (code !== 0) {
        reject(new Error(`Command failed with exit code ${code}${stderrText ? `: ${stderrText}` : ""}`));
        return;
      }
      if (!stdoutText) {
        reject(new Error("Expected JSON output from child command."));
        return;
      }
      resolve(stdoutText);
    });
  });

  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`Failed to parse child JSON output: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function emitResult(json: boolean, payload: Record<string, unknown>, lines: string[]): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${lines.join("\n")}\n`);
}

function readDataset(value: string | undefined): PublicTrajectoryDataset {
  if (value === "swe-smith") {
    return value;
  }
  throw new Error("--dataset must be 'swe-smith'");
}

function readSplit(value: string | undefined): SweSmithTrajectorySplit {
  if (value === "tool" || value === "xml" || value === "ticks") {
    return value;
  }
  throw new Error("--split must be one of: tool, xml, ticks");
}

function readReviewerProvider(
  value: string | undefined,
): NonNullable<Options["reviewerProvider"]> {
  if (value === "hermes" || value === "openclaw" || value === "generic") {
    return value;
  }
  throw new Error("--reviewer-provider must be one of: hermes, openclaw, generic");
}

function readInteger(value: string | undefined, flag: string): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative integer`);
  }
  return parsed;
}

function readIntegerField(value: unknown, field: string): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  throw new Error(`Expected numeric field ${field} in child output.`);
}

function readString(value: unknown, field: string): string {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  throw new Error(`Expected string field ${field} in child output.`);
}

function readRunStatus(value: unknown): ReviewRunResult["status"] {
  if (value === "clean" || value === "disagreement") {
    return value;
  }
  throw new Error("Expected run status to be 'clean' or 'disagreement'.");
}

async function writeText(outputPath: string, contents: string): Promise<void> {
  await stat(path.dirname(outputPath)).catch(async () => {
    await mkdir(path.dirname(outputPath), { recursive: true });
  });
  await writeFile(outputPath, `${contents}\n`, "utf8");
}

function printUsage(): void {
  console.log([
    "Usage: pnpm lab:review:batch [options]",
    "",
    "Runs a clean offline review batch and emits an aggregate report.",
    "",
    "Inputs:",
    "  --bundle <path>              Review an existing session bundle (repeatable)",
    "  --dataset <swe-smith>        Import public bundles instead of passing --bundle",
    "  --split <tool|xml|ticks>     Dataset split when importing (default: tool)",
    "  --offset <n>                 Dataset row offset when importing",
    "  --limit <n>                  Number of bundles to import/review (default: provider-specific workflow decides if omitted)",
    "",
    "Reviewer:",
    "  --reviewer-provider <name>   hermes | openclaw | generic",
    "  --reviewer-command <cmd>     Explicit reviewer command override",
    "",
    "Outputs:",
    "  --output <path>              Aggregate JSON report path",
    "  --markdown-output <path>     Aggregate markdown report path",
    "  --json                       Emit machine-readable summary to stdout",
  ].join("\n"));
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
