import { writeSessionBundle } from "./session-bundle.js";
import {
  defaultImportedTrajectoryBundlePath,
  defaultPublicTrajectorySplit,
} from "./public-trajectories-shared.js";
import {
  createSessionBundleFromDataclawRow,
  createImportedSessionFromDataclawRow,
  createReplayScenarioFromDataclawRow,
  defaultDataclawBundleSource,
  fetchDataclawRows,
  parseDataclawRowsResponse,
  readDataclawSplit,
} from "./public-trajectories-dataclaw.js";
import {
  createSessionBundleFromOpenAgentSessionsRow,
  createImportedSessionFromOpenAgentSessionsRow,
  createReplayScenarioFromOpenAgentSessionsRow,
  defaultOpenAgentSessionsBundleSource,
  fetchOpenAgentSessionsRows,
  parseOpenAgentSessionsJsonlText,
  readOpenAgentSessionsSplit,
} from "./public-trajectories-open-agent-sessions.js";
import {
  createImportedSessionFromSweSmithRow,
  createImportedSessionFromSweSmithTrajectory,
  createReplayScenarioFromSweSmithTrajectory,
  createScenarioFromSweSmithRow,
  createSessionBundleFromSweSmithRow,
  createSessionBundleFromSweSmithTrajectory,
  defaultSweSmithBundleSource,
  extractSweSmithMessageText,
  fetchSweSmithRows,
  parseSweSmithMessages,
  parseSweSmithRowsResponse,
  readSweSmithSplit,
} from "./public-trajectories-swe-smith.js";
import {
  DEFAULT_PUBLIC_TRAJECTORY_BUNDLES_DIR,
  type ImportPublicTrajectoryBundlesOptions,
  type ImportedTrajectoryBundle,
  type PublicTrajectoryDataset,
} from "./public-trajectories-types.js";

export * from "./public-trajectories-types.js";
export {
  defaultImportedTrajectoryBundlePath,
  defaultPublicTrajectorySplit,
} from "./public-trajectories-shared.js";
export {
  createImportedSessionFromDataclawRow,
  createReplayScenarioFromDataclawRow,
  createSessionBundleFromDataclawRow,
  defaultDataclawBundleSource,
  fetchDataclawRows,
  parseDataclawRowsResponse,
} from "./public-trajectories-dataclaw.js";
export {
  createImportedSessionFromOpenAgentSessionsRow,
  createReplayScenarioFromOpenAgentSessionsRow,
  createSessionBundleFromOpenAgentSessionsRow,
  defaultOpenAgentSessionsBundleSource,
  fetchOpenAgentSessionsRows,
  parseOpenAgentSessionsJsonlText,
} from "./public-trajectories-open-agent-sessions.js";
export {
  createImportedSessionFromPiRow,
  createImportedSessionFromPiMonoRow,
  createReplayScenarioFromPiRow,
  createReplayScenarioFromPiMonoRow,
  createSessionBundleFromPiRow,
  createSessionBundleFromPiMonoRow,
  defaultPiBundleSource,
  defaultPiMonoBundleSource,
  parsePiRow,
  parsePiMonoRow,
} from "./public-trajectories-pi.js";
export {
  createImportedSessionFromSweSmithRow,
  createImportedSessionFromSweSmithTrajectory,
  createReplayScenarioFromSweSmithTrajectory,
  createScenarioFromSweSmithRow,
  createSessionBundleFromSweSmithRow,
  createSessionBundleFromSweSmithTrajectory,
  defaultSweSmithBundleSource,
  extractSweSmithMessageText,
  fetchSweSmithRows,
  parseSweSmithMessages,
  parseSweSmithRowsResponse,
} from "./public-trajectories-swe-smith.js";

export async function importPublicTrajectoryBundles(
  options: ImportPublicTrajectoryBundlesOptions = {},
): Promise<ImportedTrajectoryBundle[]> {
  const dataset = options.dataset ?? "swe-smith";

  switch (dataset) {
    case "swe-smith":
      return importSweSmithBundles(dataset, options);
    case "dataclaw":
      return importDataclawBundles(dataset, options);
    case "pi":
      throw new Error("Pi imports currently require a local raw file via importTrajectoryBundlesFromFile or --file.");
    case "open-agent-sessions":
      return importOpenAgentSessionsBundles(dataset, options);
    default:
      return assertUnsupportedDataset(dataset);
  }
}

async function importSweSmithBundles(
  dataset: Extract<PublicTrajectoryDataset, "swe-smith">,
  options: ImportPublicTrajectoryBundlesOptions,
): Promise<ImportedTrajectoryBundle[]> {
  const split = readSweSmithSplit(options.split ?? defaultPublicTrajectorySplit(dataset));
  const rows = await fetchSweSmithRows({ ...options, split });
  const imported: ImportedTrajectoryBundle[] = [];

  for (const row of rows) {
    const bundle = createSessionBundleFromSweSmithTrajectory(row, {
      split,
      ...(options.exportedAt !== undefined ? { exportedAt: options.exportedAt } : {}),
    });
    const filePath = defaultImportedTrajectoryBundlePath(
      bundle,
      dataset,
      split,
      options.outputDirectory ?? DEFAULT_PUBLIC_TRAJECTORY_BUNDLES_DIR,
    );

    if (!options.dryRun) {
      await writeSessionBundle(filePath, bundle);
    }

    imported.push({
      dataset,
      split,
      row,
      recordId: row.traj_id,
      bundle,
      filePath,
    });
  }

  return imported;
}

async function importDataclawBundles(
  dataset: Extract<PublicTrajectoryDataset, "dataclaw">,
  options: ImportPublicTrajectoryBundlesOptions,
): Promise<ImportedTrajectoryBundle[]> {
  const split = readDataclawSplit(options.split ?? defaultPublicTrajectorySplit(dataset));
  const rows = await fetchDataclawRows({ ...options, split });
  const imported: ImportedTrajectoryBundle[] = [];

  for (const row of rows) {
    const bundle = createSessionBundleFromDataclawRow(row, {
      split,
      ...(options.exportedAt !== undefined ? { exportedAt: options.exportedAt } : {}),
    });
    const filePath = defaultImportedTrajectoryBundlePath(
      bundle,
      dataset,
      split,
      options.outputDirectory ?? DEFAULT_PUBLIC_TRAJECTORY_BUNDLES_DIR,
    );

    if (!options.dryRun) {
      await writeSessionBundle(filePath, bundle);
    }

    imported.push({
      dataset,
      split,
      row,
      recordId: row.session_id,
      bundle,
      filePath,
    });
  }

  return imported;
}

async function importOpenAgentSessionsBundles(
  dataset: Extract<PublicTrajectoryDataset, "open-agent-sessions">,
  options: ImportPublicTrajectoryBundlesOptions,
): Promise<ImportedTrajectoryBundle[]> {
  const split = readOpenAgentSessionsSplit(options.split ?? defaultPublicTrajectorySplit(dataset));
  const rows = await fetchOpenAgentSessionsRows({
    split,
    ...(options.offset !== undefined ? { offset: options.offset } : {}),
    ...(options.limit !== undefined ? { limit: options.limit } : {}),
    ...(options.dryRun !== undefined ? { dryRun: options.dryRun } : {}),
  });
  const imported: ImportedTrajectoryBundle[] = [];

  for (const row of rows) {
    const bundle = createSessionBundleFromOpenAgentSessionsRow(row, {
      split,
      ...(options.exportedAt !== undefined ? { exportedAt: options.exportedAt } : {}),
    });
    const filePath = defaultImportedTrajectoryBundlePath(
      bundle,
      dataset,
      split,
      options.outputDirectory ?? DEFAULT_PUBLIC_TRAJECTORY_BUNDLES_DIR,
    );

    if (!options.dryRun) {
      await writeSessionBundle(filePath, bundle);
    }

    imported.push({
      dataset,
      split,
      row,
      recordId: row.session_id,
      bundle,
      filePath,
    });
  }

  return imported;
}

function assertUnsupportedDataset(dataset: never): never {
  throw new Error(`Unsupported public trajectory dataset: ${dataset}`);
}
