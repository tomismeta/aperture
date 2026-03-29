import { readFile, stat } from "node:fs/promises";

import {
  DEFAULT_FSTOP_SESSION_BUNDLES_DIR,
  importFStopSessionFileToBundle,
  validateFStopSession,
} from "./fstop-session.js";
import {
  DEFAULT_RAW_TRAJECTORY_BUNDLES_DIR,
  importTrajectoryBundlesFromFile,
} from "./fstop-ingest.js";
import type {
  PublicTrajectoryDataset,
  PublicTrajectorySplit,
} from "./public-trajectories.js";
import { isRecord } from "./shape.js";

export type AutoresearchResolvedInput = {
  batchReportPath?: string;
  bundlePaths?: string[];
  ingest?: {
    sourcePath: string;
    sourceKind: "raw-export" | "fstop-session";
    bundleCount: number;
    datasets?: PublicTrajectoryDataset[];
    outputDirectory: string;
    sessionFilePaths?: string[];
  };
};

export async function resolveAutoresearchInputFile(
  filePath: string,
  options: {
    dataset?: PublicTrajectoryDataset;
    split?: PublicTrajectorySplit;
    outputDirectory?: string;
  } = {},
): Promise<AutoresearchResolvedInput> {
  await assertFileExists(filePath, "--file");
  let parsed: unknown;
  try {
    parsed = await loadJsonFile<unknown>(filePath);
  } catch (error) {
    parsed = undefined;
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
  }

  if (isRecord(parsed)) {
    if (Array.isArray(parsed.entries) && isRecord(parsed.summary)) {
      return {
        batchReportPath: filePath,
      };
    }

    if (typeof parsed.sessionId === "string" && Array.isArray(parsed.steps)) {
      return {
        bundlePaths: [filePath],
      };
    }

    const canonicalSession = validateFStopSession(parsed);
    if (canonicalSession) {
      const outputDirectory = options.outputDirectory ?? DEFAULT_FSTOP_SESSION_BUNDLES_DIR;
      const imported = await importFStopSessionFileToBundle({
        filePath,
        outputDirectory,
      });
      return {
        bundlePaths: [imported.bundlePath],
        ingest: {
          sourcePath: filePath,
          sourceKind: "fstop-session",
          bundleCount: 1,
          outputDirectory,
          sessionFilePaths: [imported.sessionPath],
        },
      };
    }
  }

  const outputDirectory = options.outputDirectory ?? DEFAULT_RAW_TRAJECTORY_BUNDLES_DIR;
  const imported = await importTrajectoryBundlesFromFile({
    filePath,
    ...(options.dataset ? { dataset: options.dataset } : {}),
    ...(options.split ? { split: options.split } : {}),
    outputDirectory,
  });
  if (imported.length === 0) {
    throw new Error(`--file did not resolve to any session bundles: ${filePath}`);
  }

  return {
    bundlePaths: imported.map((item) => item.filePath),
    ingest: {
      sourcePath: filePath,
      sourceKind: "raw-export",
      bundleCount: imported.length,
      datasets: [...new Set(imported.map((item) => item.dataset))],
      outputDirectory,
      sessionFilePaths: imported.flatMap((item) => item.sessionFilePath ? [item.sessionFilePath] : []),
    },
  };
}

async function loadJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function assertFileExists(filePath: string, label: string): Promise<void> {
  try {
    await stat(filePath);
  } catch {
    throw new Error(`${label} does not exist: ${filePath}`);
  }
}
