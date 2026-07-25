import path from "node:path";

import { type PublicCorpusExistingPolicy } from "./public-corpus-manifest.js";
import type { PublicCorpusRunOptions } from "./public-corpus-runner.js";
import { printCorpusRunUsage } from "./fstop-cli-usage.js";
import { printUsageAndExit, readDataset } from "./fstop-cli-args-support.js";
import type { JsonOptions } from "./fstop-cli-args.js";

export type CorpusRunCliOptions = PublicCorpusRunOptions & JsonOptions;

export function parseCorpusRunArgs(argv: string[]): CorpusRunCliOptions {
  const options: CorpusRunCliOptions = {
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--dataset":
        options.dataset = readDataset(readFlagValue(argv, ++index, arg));
        break;
      case "--split":
        options.split = readTraceCommonsSplit(readFlagValue(argv, ++index, arg));
        break;
      case "--offset":
        options.offset = readStrictInteger(readFlagValue(argv, ++index, arg), arg, {
          positive: false,
        });
        break;
      case "--max-rows":
        options.maxRows = readStrictInteger(readFlagValue(argv, ++index, arg), arg, {
          positive: true,
        });
        break;
      case "--page-size":
        options.pageSize = readStrictInteger(readFlagValue(argv, ++index, arg), arg, {
          positive: true,
        });
        break;
      case "--runtime-root":
        options.runtimeRoot = path.resolve(readFlagValue(argv, ++index, arg));
        break;
      case "--output-root":
        options.outputRoot = path.resolve(readFlagValue(argv, ++index, arg));
        break;
      case "--bundle-root":
        options.bundleRoot = path.resolve(readFlagValue(argv, ++index, arg));
        break;
      case "--run-id":
        options.runId = readFlagValue(argv, ++index, arg);
        break;
      case "--resume":
        options.resumeManifestPath = path.resolve(readFlagValue(argv, ++index, arg));
        break;
      case "--request-timeout-seconds":
        options.requestTimeoutSeconds = readStrictInteger(readFlagValue(argv, ++index, arg), arg, {
          positive: true,
        });
        break;
      case "--max-retries":
        options.maxRetries = readStrictInteger(readFlagValue(argv, ++index, arg), arg, {
          positive: false,
        });
        break;
      case "--existing":
        options.existing = readExistingPolicy(readFlagValue(argv, ++index, arg));
        break;
      case "--plan":
        options.plan = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--json":
        options.json = true;
        break;
      case "--help":
      case "-h":
        return printUsageAndExit(printCorpusRunUsage);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (options.resumeManifestPath) {
    assertResumeOptionsOnly(options);
    return options;
  }
  options.split ??= "train";
  return options;
}

function readTraceCommonsSplit(value: string | undefined): "train" {
  if (value === "train") {
    return value;
  }
  throw new Error("--split must be train for corpus-run");
}

function readExistingPolicy(value: string | undefined): PublicCorpusExistingPolicy {
  if (value === "verify" || value === "error" || value === "skip") {
    return value;
  }
  throw new Error("--existing must be one of: verify, error, skip");
}

function readFlagValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function readStrictInteger(value: string, flag: string, options: { positive: boolean }): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(
      `${flag} must be ${options.positive ? "a positive" : "a non-negative"} integer`,
    );
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || (options.positive ? parsed <= 0 : parsed < 0)) {
    throw new Error(
      `${flag} must be ${options.positive ? "a positive" : "a non-negative"} integer`,
    );
  }
  return parsed;
}

function assertResumeOptionsOnly(options: CorpusRunCliOptions): void {
  const disallowed = Object.entries(options)
    .filter(([key, value]) => key !== "resumeManifestPath" && key !== "json" && value !== undefined)
    .map(([key]) => `--${key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}`);
  if (disallowed.length > 0) {
    throw new Error(`--resume cannot be combined with ${disallowed.join(", ")}`);
  }
}
