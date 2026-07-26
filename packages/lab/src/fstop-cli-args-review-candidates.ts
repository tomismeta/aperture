import path from "node:path";

import { printUsageAndExit, readInteger } from "./fstop-cli-args-support.js";
import type { JsonOptions } from "./fstop-cli-args.js";
import { printReviewCandidateUsage } from "./fstop-cli-usage.js";

export type ReviewCandidateCliOptions = JsonOptions & {
  manifestPaths: string[];
  bundlePaths: string[];
  bundleDirectories: string[];
  outputPath?: string;
  markdownOutputPath?: string;
  maxCandidatesPerKind: number;
  maxCandidatesPerSessionPerKind: number;
};

export function parseReviewCandidateArgs(argv: string[]): ReviewCandidateCliOptions {
  const manifestPaths: string[] = [];
  const bundlePaths: string[] = [];
  const bundleDirectories: string[] = [];
  let outputPath: string | undefined;
  let markdownOutputPath: string | undefined;
  let maxCandidatesPerKind = 30;
  let maxCandidatesPerSessionPerKind = 3;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--manifest":
        manifestPaths.push(readRequiredPath(argv, ++index, "--manifest"));
        break;
      case "--bundle":
        bundlePaths.push(readRequiredPath(argv, ++index, "--bundle"));
        break;
      case "--bundle-dir":
        bundleDirectories.push(readRequiredPath(argv, ++index, "--bundle-dir"));
        break;
      case "--output":
        outputPath = readRequiredPath(argv, ++index, "--output");
        break;
      case "--markdown-output":
        markdownOutputPath = readRequiredPath(argv, ++index, "--markdown-output");
        break;
      case "--limit-per-kind":
        maxCandidatesPerKind = readInteger(argv[++index], "--limit-per-kind");
        break;
      case "--limit-per-session-kind":
        maxCandidatesPerSessionPerKind = readInteger(argv[++index], "--limit-per-session-kind");
        break;
      case "--json":
        json = true;
        break;
      case "--help":
      case "-h":
        return printUsageAndExit(printReviewCandidateUsage);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (manifestPaths.length === 0 && bundlePaths.length === 0 && bundleDirectories.length === 0) {
    throw new Error("Provide at least one --manifest, --bundle, or --bundle-dir");
  }
  if (maxCandidatesPerKind < 1) {
    throw new Error("--limit-per-kind must be a positive integer.");
  }
  if (maxCandidatesPerSessionPerKind < 1) {
    throw new Error("--limit-per-session-kind must be a positive integer.");
  }

  return {
    manifestPaths,
    bundlePaths,
    bundleDirectories,
    ...(outputPath ? { outputPath } : {}),
    ...(markdownOutputPath ? { markdownOutputPath } : {}),
    maxCandidatesPerKind,
    maxCandidatesPerSessionPerKind,
    json,
  };
}

function readRequiredPath(argv: string[], index: number, label: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${label} requires a path.`);
  }
  return path.resolve(value);
}
