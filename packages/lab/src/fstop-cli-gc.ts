import {
  lstat,
  readdir,
  readlink,
  realpath,
  rm,
} from "node:fs/promises";
import path from "node:path";

import { pruneWorktreeMetadata } from "./index.js";
import {
  parseGcArgs,
  type GcOptions,
} from "./fstop-cli-args.js";
import { emitResult } from "./fstop-cli-shared.js";

type GcResult = {
  deleted: string[];
  preserved: string[];
  skipped: string[];
};

export async function runGcCli(argv: string[]): Promise<void> {
  const options = parseGcArgs(argv);
  const campaignRoot = path.join(options.runtimeRoot, "campaigns");
  const resultsRoot = path.join(options.runtimeRoot, "results");
  const preservedPaths = new Set<string>(await readPreservedPaths(options.runtimeRoot));
  const result: GcResult = {
    deleted: [],
    preserved: [...preservedPaths].sort(),
    skipped: [],
  };

  await pruneDirectory(campaignRoot, options.keepCampaigns, preservedPaths, result, options);
  for (const directory of [
    path.join(resultsRoot, "offline-review", "batches"),
    path.join(resultsRoot, "offline-review", "requests"),
    path.join(resultsRoot, "offline-review", "prompts"),
    path.join(resultsRoot, "offline-review", "raw"),
    path.join(resultsRoot, "offline-review", "responses"),
    path.join(resultsRoot, "offline-review", "disagreements"),
    path.join(resultsRoot, "offline-review", "recommendations"),
    path.join(resultsRoot, "offline-review", "runs"),
    path.join(resultsRoot, "autoresearch", "briefs"),
    path.join(resultsRoot, "autoresearch", "evaluations"),
    path.join(resultsRoot, "autoresearch", "optimizer", "patches"),
    path.join(resultsRoot, "autoresearch", "optimizer", "prompts"),
    path.join(resultsRoot, "autoresearch", "optimizer", "raw"),
    path.join(resultsRoot, "autoresearch", "optimizer", "runs"),
    path.join(resultsRoot, "autoresearch", "proposals"),
    path.join(resultsRoot, "autoresearch", "reports"),
    path.join(resultsRoot, "autoresearch", "runner", "prompts"),
    path.join(resultsRoot, "autoresearch", "runner", "raw"),
    path.join(resultsRoot, "autoresearch", "runner", "runs"),
  ]) {
    await pruneDirectory(directory, options.keepArtifacts, preservedPaths, result, options);
  }

  if (!options.dryRun) {
    await pruneWorktreeMetadata(options.sourceRepo).catch(() => undefined);
  }

  const payload = {
    status: "ok" as const,
    runtimeRoot: options.runtimeRoot,
    sourceRepo: options.sourceRepo,
    deletedCount: result.deleted.length,
    preservedCount: result.preserved.length,
    skippedCount: result.skipped.length,
    ...result,
  };
  emitResult(options.json, payload, [
    `F-Stop GC completed for ${options.runtimeRoot}.`,
    `Deleted: ${result.deleted.length}`,
    `Preserved: ${result.preserved.length}`,
    `Skipped: ${result.skipped.length}`,
  ]);
}

async function pruneDirectory(
  directory: string,
  keepCount: number,
  preservedPaths: Set<string>,
  result: GcResult,
  options: GcOptions,
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    return;
  }

  const ranked = await Promise.all(entries.map(async (entry) => {
    const filePath = path.join(directory, entry);
    const stats = await lstat(filePath);
    return {
      filePath,
      mtimeMs: stats.mtimeMs,
    };
  }));

  ranked.sort((left, right) => right.mtimeMs - left.mtimeMs || left.filePath.localeCompare(right.filePath));
  const keepSet = new Set(
    ranked.slice(0, Math.max(0, keepCount)).map((entry) => entry.filePath),
  );

  for (const entry of ranked) {
    if (keepSet.has(entry.filePath) || preservedPaths.has(entry.filePath)) {
      continue;
    }
    if (options.dryRun) {
      result.skipped.push(entry.filePath);
      continue;
    }
    await rm(entry.filePath, { recursive: true, force: true });
    result.deleted.push(entry.filePath);
  }
}

async function readPreservedPaths(runtimeRoot: string): Promise<string[]> {
  const paths = new Set<string>();
  for (const linkPath of [
    path.join(runtimeRoot, "current-campaign"),
    path.join(runtimeRoot, "latest-campaign"),
  ]) {
    try {
      const target = await resolveSymlink(linkPath);
      paths.add(target);
    } catch {
      continue;
    }
  }
  return [...paths];
}

async function resolveSymlink(linkPath: string): Promise<string> {
  const target = await readlink(linkPath);
  return realpath(path.resolve(path.dirname(linkPath), target));
}
