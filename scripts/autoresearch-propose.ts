import path from "node:path";

import {
  defaultAutoresearchProposalSplit,
  runAutoresearchProposalCommand,
  type AutoresearchProposalCommandOptions,
  type PublicTrajectoryDataset,
  type PublicTrajectorySplit,
} from "../packages/lab/src/index.js";

type Provider = "hermes" | "openclaw" | "generic";

type Options = AutoresearchProposalCommandOptions & {
  json: boolean;
};

const DEFAULT_AUTORESEARCH_REVIEW_CONCURRENCY = 2;

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const result = await runAutoresearchProposalCommand(options);

  emitResult(
    options.json,
    {
      status: result.status,
      proposalPath: result.proposalPath,
      proposalMarkdownPath: result.proposalMarkdownPath,
      batchReportPath: result.batchReportPath,
      candidateCalibrationDir: result.candidateCalibrationDir,
      signalCount: result.signalCount,
      promotedCaseCount: result.promotedCaseCount,
      ...(result.optimizerRunPath ? { optimizerRunPath: result.optimizerRunPath } : {}),
      ...(result.optimizerPatchPath ? { optimizerPatchPath: result.optimizerPatchPath } : {}),
    },
    [
      `Autoresearch proposal status: ${result.status}.`,
      `Proposal: ${result.proposalPath}`,
      `Batch report: ${result.batchReportPath}`,
      `Signals: ${result.signalCount}`,
      `Promoted cases: ${result.promotedCaseCount}`,
      ...(result.optimizerRunPath ? [`Optimizer run: ${result.optimizerRunPath}`] : []),
      ...(result.optimizerPatchPath ? [`Patch: ${result.optimizerPatchPath}`] : []),
    ],
  );
}

function parseArgs(argv: string[]): Options {
  let inputFile: string | undefined;
  const bundlePaths: string[] = [];
  let dataset: PublicTrajectoryDataset = "swe-smith";
  let split: PublicTrajectorySplit | undefined;
  let offset: number | undefined;
  let limit: number | undefined;
  let batchReportPath: string | undefined;
  let reviewerProvider: Provider = "generic";
  let reviewerCommand: string | undefined;
  let optimizerProvider: Provider = reviewerProvider;
  let optimizerCommand: string | undefined;
  let reviewConcurrency = DEFAULT_AUTORESEARCH_REVIEW_CONCURRENCY;
  let minSessionCount = 2;
  let maxReports = 4;
  let outputPath: string | undefined;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--dataset":
        dataset = readDataset(argv[++index]);
        break;
      case "--file":
        inputFile = path.resolve(argv[++index] ?? "");
        break;
      case "--bundle":
        bundlePaths.push(path.resolve(argv[++index] ?? ""));
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
      case "--batch-report":
        batchReportPath = path.resolve(argv[++index] ?? "");
        break;
      case "--reviewer-provider":
        reviewerProvider = readProvider(argv[++index]);
        if (optimizerProvider === "generic") {
          optimizerProvider = reviewerProvider;
        }
        break;
      case "--reviewer-command":
        reviewerCommand = argv[++index];
        break;
      case "--optimizer-provider":
        optimizerProvider = readProvider(argv[++index]);
        break;
      case "--optimizer-command":
        optimizerCommand = argv[++index];
        break;
      case "--review-concurrency":
        reviewConcurrency = readPositiveInteger(argv[++index], "--review-concurrency");
        break;
      case "--min-session-count":
        minSessionCount = readInteger(argv[++index], "--min-session-count");
        break;
      case "--max-reports":
        maxReports = readInteger(argv[++index], "--max-reports");
        break;
      case "--output":
        outputPath = path.resolve(argv[++index] ?? "");
        break;
      case "--json":
        json = true;
        break;
      case "--help":
      case "-h":
        return printUsageAndExit(printUsage);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return {
    ...(inputFile ? { inputFile } : {}),
    bundlePaths,
    dataset,
    split: split ?? defaultAutoresearchProposalSplit(dataset),
    ...(offset !== undefined ? { offset } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(batchReportPath ? { batchReportPath } : {}),
    reviewerProvider,
    ...(reviewerCommand ? { reviewerCommand } : {}),
    optimizerProvider,
    ...(optimizerCommand ? { optimizerCommand } : {}),
    reviewConcurrency,
    minSessionCount,
    maxReports,
    ...(outputPath ? { outputPath } : {}),
    json,
  };
}

function printUsage(): void {
  console.log([
    "Usage: pnpm lab:fstop:propose [options]",
    "",
    "Runs an Aperture Lab F-Stop discovery batch, promotes repeated high-confidence disagreements into an ignored candidate corpus,",
    "then runs the optimizer and emits a reviewable proposal artifact.",
    "",
    "Options:",
    "  --file <path>                        Autodetect a session bundle JSON, precomputed batch report JSON, or supported raw export file",
    "  --bundle <path>                      Review an explicit session bundle (repeatable)",
    "  --dataset <swe-smith|dataclaw|open-agent-sessions>  Public dataset to import (default: swe-smith)",
    "  --split <tool|xml|ticks|train|approved>             Dataset split to import (default: dataset-specific)",
    "  --offset <number>                    Row offset in the dataset",
    "  --limit <number>                     Number of rows to import",
    "  --batch-report <path>                Reuse a precomputed offline-review batch report instead of rerunning discovery",
    "  --reviewer-provider <provider>       Reviewer provider (default: generic)",
    "  --reviewer-command <cmd>             Explicit reviewer command override",
    "  --optimizer-provider <provider>      Optimizer provider (defaults to reviewer provider)",
    "  --optimizer-command <cmd>            Explicit optimizer command override",
    "  --review-concurrency <number>        Parallel offline reviews per discovery batch (default: 2)",
    "  --min-session-count <number>         Require a signal to recur across this many sessions (default: 2)",
    "  --max-reports <number>               Promote at most this many reports into the candidate corpus (default: 4)",
    "  --output <path>                      Proposal JSON output path",
    "  --json                               Emit machine-readable JSON",
  ].join("\n"));
}

function readProvider(value: string | undefined): Provider {
  if (value === "hermes" || value === "openclaw" || value === "generic") {
    return value;
  }
  throw new Error("--provider values must be one of: hermes, openclaw, generic");
}

function readDataset(value: string | undefined): PublicTrajectoryDataset {
  if (value === "swe-smith" || value === "dataclaw" || value === "open-agent-sessions") {
    return value;
  }
  throw new Error("--dataset must be: swe-smith, dataclaw, open-agent-sessions");
}

function readSplit(value: string | undefined): PublicTrajectorySplit {
  if (value === "tool" || value === "xml" || value === "ticks" || value === "train" || value === "approved") {
    return value;
  }
  throw new Error("--split must be one of: tool, xml, ticks, train, approved");
}

function readInteger(value: string | undefined, flag: string): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative integer`);
  }
  return parsed;
}

function readPositiveInteger(value: string | undefined, flag: string): number {
  const parsed = readInteger(value, flag);
  if (parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }

  return parsed;
}

function emitResult(json: boolean, payload: Record<string, unknown>, lines: string[]): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}

function printUsageAndExit(renderUsage: () => void): never {
  renderUsage();
  process.exit(0);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
