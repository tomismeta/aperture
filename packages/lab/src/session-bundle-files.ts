import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_SESSION_BUNDLES_DIR,
  SESSION_BUNDLE_SCHEMA_VERSION,
  type ReplaySessionBundle,
  validateSessionBundle,
} from "./session-bundle-model.js";
import { isRecord } from "./shape.js";

export async function loadSessionBundles(
  directory: string = DEFAULT_SESSION_BUNDLES_DIR,
): Promise<ReplaySessionBundle[]> {
  try {
    const bundlePaths = await findSessionBundleFiles(directory);
    const bundles: ReplaySessionBundle[] = [];
    for (const bundlePath of bundlePaths) {
      const bundle = await loadSessionBundleIfValid(bundlePath);
      if (bundle) {
        bundles.push(bundle);
      }
    }
    return bundles.sort((left, right) => left.sessionId.localeCompare(right.sessionId));
  } catch (error) {
    if (isMissingDirectoryError(error)) {
      return [];
    }

    throw error;
  }
}

export async function findSessionBundleFiles(
  directory: string = DEFAULT_SESSION_BUNDLES_DIR,
): Promise<string[]> {
  try {
    return (await readSessionBundleFilePaths(directory)).sort((left, right) =>
      left.localeCompare(right),
    );
  } catch (error) {
    if (isMissingDirectoryError(error)) {
      return [];
    }

    throw error;
  }
}

export async function loadSessionBundle(filePath: string): Promise<ReplaySessionBundle> {
  const bundle = await loadSessionBundleIfValid(filePath);
  if (!bundle) {
    throw new Error(`Invalid session bundle at ${filePath}`);
  }

  return bundle;
}

export async function loadSessionBundleIfValid(
  filePath: string,
): Promise<ReplaySessionBundle | null> {
  const raw = await readFile(filePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Failed to parse session bundle at ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!isRecord(parsed) || parsed.schemaVersion !== SESSION_BUNDLE_SCHEMA_VERSION) {
    return null;
  }

  const bundle = validateSessionBundle(parsed);
  if (!bundle) {
    throw new Error(`Invalid session bundle at ${filePath}`);
  }

  return bundle;
}

export async function writeSessionBundle(
  filePath: string,
  bundle: ReplaySessionBundle,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
}

export function createTempSessionBundlePath(prefix: string = "aperture-session-bundle"): string {
  const basename = `${prefix}-${Date.now()}.json`;
  return path.join(os.tmpdir(), basename);
}

async function readSessionBundleFilePaths(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const bundlePaths: string[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      bundlePaths.push(...(await readSessionBundleFilePaths(absolutePath)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".json")) {
      bundlePaths.push(absolutePath);
    }
  }

  return bundlePaths;
}

function isMissingDirectoryError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
