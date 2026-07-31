import path from "node:path";

import {
  digestJsonValue,
} from "./public-corpus-manifest.js";
import { readPublicCorpusRunManifest } from "./public-corpus-manifest-validation.js";
import {
  isVerifiedPublicCorpusBundleRecord,
  readVerifiedPublicCorpusManifestRecords,
} from "./public-corpus-verified-records.js";
import {
  findSessionBundleFiles,
  type ReplaySessionBundle,
} from "./session-bundle.js";
import { loadReplayBundleFromFStopInputFile } from "./fstop-session.js";
import type { CandidateBundleInput } from "./semantic-review-candidate-types.js";

export type ResolvedCandidateBundleInputs = {
  bundleInputs: CandidateBundleInput[];
  fileCount: number;
  manifestRecordCount: number;
  manifestBundleCount: number;
};

export async function resolveCandidateBundleInputs(options: {
  manifestPaths: readonly string[];
  bundlePaths: readonly string[];
  bundleDirectories: readonly string[];
}): Promise<ResolvedCandidateBundleInputs> {
  const bundleInputsByPath = new Map<string, CandidateBundleInput>();
  let manifestRecordCount = 0;
  let manifestBundleCount = 0;

  for (const manifestPath of options.manifestPaths) {
    const resolvedManifestPath = path.resolve(manifestPath);
    const manifest = await readPublicCorpusRunManifest(resolvedManifestPath);
    const records = await readVerifiedPublicCorpusManifestRecords(manifest);
    manifestRecordCount += records.length;

    for (const record of records) {
      if (!isVerifiedPublicCorpusBundleRecord(record)) {
        continue;
      }
      manifestBundleCount += 1;
      const resolvedBundlePath = path.resolve(record.bundlePath);
      bundleInputsByPath.set(resolvedBundlePath, {
        bundlePath: resolvedBundlePath,
        record,
        manifestPath: resolvedManifestPath,
      });
    }
  }

  for (const bundlePath of options.bundlePaths) {
    const resolvedBundlePath = path.resolve(bundlePath);
    if (!bundleInputsByPath.has(resolvedBundlePath)) {
      bundleInputsByPath.set(resolvedBundlePath, { bundlePath: resolvedBundlePath });
    }
  }

  for (const directory of options.bundleDirectories) {
    for (const bundlePath of await findSessionBundleFiles(path.resolve(directory))) {
      const resolvedBundlePath = path.resolve(bundlePath);
      if (!bundleInputsByPath.has(resolvedBundlePath)) {
        bundleInputsByPath.set(resolvedBundlePath, { bundlePath: resolvedBundlePath });
      }
    }
  }

  return {
    bundleInputs: [...bundleInputsByPath.values()].sort((left, right) =>
      left.bundlePath.localeCompare(right.bundlePath),
    ),
    fileCount: bundleInputsByPath.size,
    manifestRecordCount,
    manifestBundleCount,
  };
}

export async function loadCandidateBundleIfValid(
  input: CandidateBundleInput,
): Promise<ReplaySessionBundle | null> {
  let bundle: ReplaySessionBundle;
  try {
    bundle = await loadReplayBundleFromFStopInputFile(input.bundlePath);
  } catch (error) {
    if (input.record?.bundleDigest) {
      throw new Error(
        `Public corpus bundle failed to load: ${input.bundlePath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return null;
  }
  verifyBundleDigest(input, bundle);
  return bundle;
}

function verifyBundleDigest(input: CandidateBundleInput, bundle: ReplaySessionBundle): void {
  if (!input.record?.bundleDigest) {
    return;
  }

  const bundleDigest = digestJsonValue(bundle);
  if (bundleDigest !== input.record.bundleDigest) {
    throw new Error(`Public corpus bundle digest mismatch: ${input.bundlePath}`);
  }
}
