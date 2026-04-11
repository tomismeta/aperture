import path from "node:path";

import {
  runOfflineReviewBatchCommand,
  type OfflineReviewBatchCommandOptions,
  type PublicTrajectoryDataset,
  type PublicTrajectorySplit,
} from "../packages/lab/src/index.js";

type Options = OfflineReviewBatchCommandOptions & {
  json: boolean;
};

const DEFAULT_OFFLINE_REVIEW_BATCH_CONCURRENCY = 2;

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const result = await runOfflineReviewBatchCommand(options);

  emitResult(
    options.json,
    result,
    [
      `Offline review batch complete for ${result.bundleCount} bundle(s).`,
      `Report: ${result.outputPath}`,
      `Summary: ${result.markdownOutputPath}`,
      `Errors: ${result.errorCount}`,
      `Disagreements: ${result.disagreementCount}`,
      `Actionable: ${result.actionableCount}`,
    ],
  );
}

function parseArgs(argv: string[]): Options {
  const bundlePaths: string[] = [];
  let dataset: PublicTrajectoryDataset | undefined;
  let split: PublicTrajectorySplit | undefined;
  let offset: number | undefined;
  let limit: number | undefined;
  let concurrency = DEFAULT_OFFLINE_REVIEW_BATCH_CONCURRENCY;
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
      case "--concurrency":
        concurrency = readPositiveInteger(argv[++index], "--concurrency");
        break;
      case "--reviewer-provider":
        reviewerProvider = readProvider(argv[++index]);
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
        return printUsageAndExit(printUsage);
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
    concurrency,
    ...(reviewerProvider ? { reviewerProvider } : {}),
    ...(reviewerCommand ? { reviewerCommand } : {}),
    ...(outputPath ? { outputPath } : {}),
    ...(markdownOutputPath ? { markdownOutputPath } : {}),
    json,
  };
}

function emitResult(json: boolean, payload: Record<string, unknown>, lines: string[]): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}

function readDataset(value: string | undefined): PublicTrajectoryDataset {
  if (value === "swe-smith" || value === "dataclaw" || value === "open-agent-sessions") {
    return value;
  }
  throw new Error("--dataset must be 'swe-smith', 'dataclaw', or 'open-agent-sessions'");
}

function readSplit(value: string | undefined): PublicTrajectorySplit {
  if (value === "tool" || value === "xml" || value === "ticks" || value === "train" || value === "approved") {
    return value;
  }
  throw new Error("--split must be one of: tool, xml, ticks, train, approved");
}

function readProvider(value: string | undefined): NonNullable<Options["reviewerProvider"]> {
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

function readPositiveInteger(value: string | undefined, flag: string): number {
  const parsed = readInteger(value, flag);
  if (parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function printUsage(): void {
  console.log([
    "Usage: pnpm lab:fstop:review [options]",
    "",
    "Runs a clean offline review batch and emits an aggregate report.",
    "",
    "Inputs:",
    "  --bundle <path>              Review an existing session bundle (repeatable)",
    "  --dataset <swe-smith|dataclaw|open-agent-sessions>  Import public bundles instead of passing --bundle",
    "  --split <tool|xml|ticks|train|approved>  Dataset split when importing (default: dataset-specific)",
    "  --offset <n>                 Dataset row offset when importing",
    "  --limit <n>                  Number of bundles to import/review",
    `  --concurrency <n>            Max concurrent reviewer runs (default: ${DEFAULT_OFFLINE_REVIEW_BATCH_CONCURRENCY})`,
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

function printUsageAndExit(renderUsage: () => void): never {
  renderUsage();
  process.exit(0);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
