import path from "node:path";

import {
  DEFAULT_FSTOP_SESSION_BUNDLES_DIR,
  DEFAULT_RAW_TRAJECTORY_BUNDLES_DIR,
  defaultPublicTrajectorySplit,
  importFStopSessionFileToBundle,
  importPublicTrajectoryBundles,
  importTrajectoryBundlesFromFile,
  validateFStopSession,
} from "./index.js";
import {
  parseIngestArgs,
  parseTrajectoryImportArgs,
  type IngestOptions,
} from "./fstop-cli-args.js";
import {
  safeParseJson,
  safeReadText,
} from "./fstop-cli-shared.js";

export async function runIngestCli(argv: string[]): Promise<void> {
  const options = parseIngestArgs(argv);
  if (!options.filePath) {
    throw new Error("--file is required");
  }

  const fileText = await safeReadText(options.filePath);
  const parsed = fileText ? safeParseJson(fileText) : undefined;
  const canonicalSession = parsed ? validateFStopSession(parsed) : null;
  const payload = canonicalSession
    ? await importCanonicalSession(options)
    : await importRawTrajectoryExport(options);

  if (options.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  const mode = options.dryRun ? "Prepared" : "Imported";
  const sourceLabel = payload.sourceKind === "fstop-session" ? "canonical F-Stop session" : "raw trajectory export";
  process.stdout.write(
    `${mode} ${payload.bundleCount} bundle${payload.bundleCount === 1 ? "" : "s"} from ${sourceLabel} ${path.resolve(options.filePath)}.\n`,
  );
  if ("datasets" in payload && payload.datasets && payload.datasets.length > 0) {
    process.stdout.write(`Datasets: ${payload.datasets.join(", ")}\n`);
  }
  if (payload.sessionFilePaths && payload.sessionFilePaths.length > 0) {
    process.stdout.write("Canonical sessions:\n");
    for (const sessionFilePath of payload.sessionFilePaths) {
      process.stdout.write(`- ${path.relative(process.cwd(), sessionFilePath)}\n`);
    }
  }
  process.stdout.write("Bundles:\n");
  for (const bundlePath of payload.bundlePaths) {
    process.stdout.write(`- ${path.relative(process.cwd(), bundlePath)}\n`);
  }
}

export async function runTrajectoryImportCli(argv: string[]): Promise<void> {
  const options = parseTrajectoryImportArgs(argv);
  const imported = await importPublicTrajectoryBundles(options);
  const dataset = options.dataset ?? "swe-smith";
  const split = options.split ?? defaultPublicTrajectorySplit(dataset);
  const mode = options.dryRun ? "Prepared" : "Imported";

  process.stdout.write(
    `${mode} ${imported.length} public trajectory bundle${imported.length === 1 ? "" : "s"} from ${dataset} (${split}, offset ${options.offset ?? 0}).\n`,
  );
  for (const item of imported) {
    process.stdout.write(`- ${item.recordId} -> ${path.relative(process.cwd(), item.filePath)}\n`);
  }
}

async function importCanonicalSession(options: IngestOptions): Promise<{
  bundleCount: number;
  bundlePaths: string[];
  outputDirectory: string;
  sessionFilePaths?: string[];
  sourceKind: "fstop-session";
  sourcePath: string;
  status: "ok";
}> {
  const outputDirectory = options.outputDirectory ?? DEFAULT_FSTOP_SESSION_BUNDLES_DIR;
  const imported = await importFStopSessionFileToBundle({
    filePath: options.filePath,
    outputDirectory,
    ...(options.exportedAt ? { exportedAt: options.exportedAt } : {}),
    ...(options.dryRun ? { dryRun: options.dryRun } : {}),
  });
  return {
    status: "ok",
    sourcePath: options.filePath,
    sourceKind: "fstop-session",
    bundleCount: 1,
    outputDirectory,
    bundlePaths: [imported.bundlePath],
    sessionFilePaths: [imported.sessionPath],
  };
}

async function importRawTrajectoryExport(options: IngestOptions): Promise<{
  bundleCount: number;
  bundlePaths: string[];
  datasets: string[];
  outputDirectory: string;
  sessionFilePaths: string[];
  sourceKind: "raw-export";
  sourcePath: string;
  status: "ok";
}> {
  const imported = await importTrajectoryBundlesFromFile(options);
  const datasets = [...new Set(imported.map((item) => item.dataset))];
  return {
    status: "ok",
    sourcePath: options.filePath,
    sourceKind: "raw-export",
    bundleCount: imported.length,
    datasets,
    outputDirectory: options.outputDirectory ?? DEFAULT_RAW_TRAJECTORY_BUNDLES_DIR,
    bundlePaths: imported.map((item) => item.filePath),
    sessionFilePaths: imported.flatMap((item) => item.sessionFilePath ? [item.sessionFilePath] : []),
  };
}
