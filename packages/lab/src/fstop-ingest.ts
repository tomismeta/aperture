import path from "node:path";

import {
  createImportedSessionFromDataclawRow,
  createImportedSessionFromOpenAgentSessionsRow,
  createImportedSessionFromPiRow,
  createImportedSessionFromSweSmithTrajectory,
  createImportedSessionFromTraceCommonsRow,
  createSessionBundleFromDataclawRow,
  createSessionBundleFromOpenAgentSessionsRow,
  createSessionBundleFromPiRow,
  createSessionBundleFromSweSmithTrajectory,
  createSessionBundleFromTraceCommonsRow,
  defaultImportedTrajectoryBundlePath,
  type ImportedTrajectoryBundle,
  type OpenAgentSessionsSplit,
  type PublicTrajectoryDataset,
  type PublicTrajectorySplit,
  type TraceCommonsSplit,
} from "./public-trajectories.js";
import {
  DEFAULT_FSTOP_SESSION_FILES_DIR,
  defaultFStopSessionFilePath,
  type FStopSession,
  writeFStopSessionFile,
} from "./fstop-session.js";
import { defaultLabRuntimeSubdirectory } from "./runtime-paths.js";
import { writeSessionBundle, type ReplaySessionBundle } from "./session-bundle.js";
import {
  loadRawTrajectoryRecords,
  type RawTrajectoryRecord,
} from "./fstop-ingest-raw.js";

export const DEFAULT_RAW_TRAJECTORY_BUNDLES_DIR = defaultLabRuntimeSubdirectory("bundles", "raw");

export type ImportTrajectoryBundlesFromFileOptions = {
  filePath: string;
  dataset?: PublicTrajectoryDataset;
  split?: PublicTrajectorySplit;
  outputDirectory?: string;
  sessionOutputDirectory?: string;
  exportedAt?: string;
  dryRun?: boolean;
};

export async function importTrajectoryBundlesFromFile(
  options: ImportTrajectoryBundlesFromFileOptions,
): Promise<ImportedTrajectoryBundle[]> {
  const filePath = path.resolve(options.filePath);
  const records = await loadRawTrajectoryRecords(filePath, options);
  const outputDirectory = options.outputDirectory ?? DEFAULT_RAW_TRAJECTORY_BUNDLES_DIR;
  const sessionOutputDirectory = options.sessionOutputDirectory ?? DEFAULT_FSTOP_SESSION_FILES_DIR;
  const imported: ImportedTrajectoryBundle[] = [];

  for (const record of records) {
    const session = createSessionFromRawRecord(record, options);
    const bundle = annotateImportedBundleSource(createBundleFromRawRecord(record, options), filePath);
    const bundlePath = defaultImportedTrajectoryBundlePath(
      bundle,
      record.dataset,
      record.split,
      outputDirectory,
    );
    const sessionFilePath = defaultFStopSessionFilePath(
      session,
      path.join(sessionOutputDirectory, record.dataset, record.split),
    );

    if (!options.dryRun) {
      await writeFStopSessionFile(sessionFilePath, session);
      await writeSessionBundle(bundlePath, bundle);
    }

    imported.push({
      dataset: record.dataset,
      split: record.split,
      row: record.row,
      recordId: record.recordId,
      session,
      sessionFilePath,
      bundle,
      filePath: bundlePath,
    });
  }

  return imported;
}

function createBundleFromRawRecord(
  record: RawTrajectoryRecord,
  options: ImportTrajectoryBundlesFromFileOptions,
): ReplaySessionBundle {
  if (record.dataset === "dataclaw") {
    return createSessionBundleFromDataclawRow(record.row, {
      split: record.split as "train",
      ...(options.exportedAt ? { exportedAt: options.exportedAt } : {}),
    });
  }

  if (record.dataset === "open-agent-sessions") {
    return createSessionBundleFromOpenAgentSessionsRow(record.row, {
      split: record.split as OpenAgentSessionsSplit,
      ...(options.exportedAt ? { exportedAt: options.exportedAt } : {}),
    });
  }

  if (record.dataset === "pi") {
    return createSessionBundleFromPiRow(record.row, {
      split: record.split as "train",
      ...(options.exportedAt ? { exportedAt: options.exportedAt } : {}),
    });
  }

  if (record.dataset === "trace-commons") {
    return createSessionBundleFromTraceCommonsRow(record.row, {
      split: record.split as TraceCommonsSplit,
      ...(options.exportedAt ? { exportedAt: options.exportedAt } : {}),
    });
  }

  return createSessionBundleFromSweSmithTrajectory(record.row, {
    split: record.split as "tool" | "xml" | "ticks",
    ...(options.exportedAt ? { exportedAt: options.exportedAt } : {}),
  });
}

function createSessionFromRawRecord(
  record: RawTrajectoryRecord,
  _options: ImportTrajectoryBundlesFromFileOptions,
): FStopSession {
  if (record.dataset === "dataclaw") {
    return createImportedSessionFromDataclawRow(record.row, {
      split: record.split as "train",
    });
  }

  if (record.dataset === "open-agent-sessions") {
    return createImportedSessionFromOpenAgentSessionsRow(record.row, {
      split: record.split as OpenAgentSessionsSplit,
    });
  }

  if (record.dataset === "pi") {
    return createImportedSessionFromPiRow(record.row, {
      split: record.split as "train",
    });
  }

  if (record.dataset === "trace-commons") {
    return createImportedSessionFromTraceCommonsRow(record.row, {
      split: record.split as TraceCommonsSplit,
    });
  }

  return createImportedSessionFromSweSmithTrajectory(record.row, {
    split: record.split as "tool" | "xml" | "ticks",
  });
}

function annotateImportedBundleSource(
  bundle: ReplaySessionBundle,
  filePath: string,
): ReplaySessionBundle {
  if (!bundle.source) {
    return bundle;
  }

  const existingNotes = bundle.source.capture?.notes ?? [];
  const notes = existingNotes.includes(`input_file=${filePath}`)
    ? existingNotes
    : [...existingNotes, `input_file=${filePath}`, "input_transport=local-file"];

  return {
    ...bundle,
    source: {
      ...bundle.source,
      capture: {
        ...bundle.source.capture,
        notes,
      },
    },
  };
}

export { loadOpenAgentSessionsEventsFromJsonlFile } from "./fstop-ingest-raw.js";
