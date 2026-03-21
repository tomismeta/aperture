import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type {
  ApertureCoreOptions,
  AttentionResponse,
  AttentionSignal,
} from "@tomismeta/aperture-core";
import type { ApertureTrace } from "../../core/src/trace.js";

import type {
  ReplayDecisionSnapshot,
  ReplayNormalizedEventSnapshot,
  ReplayObservationStep,
  ReplayScenario,
  ReplaySemanticSnapshot,
  ReplayViewSnapshot,
} from "./scenario.js";
import { runReplayScenario, type ReplayRunResult } from "./runner.js";
import { scoreReplayRun } from "./scorecard.js";

export const SESSION_BUNDLE_SCHEMA_VERSION = 1 as const;

export const DEFAULT_SESSION_BUNDLES_DIR = path.resolve(
  process.cwd(),
  "packages/lab/bundles",
);

export type ReplaySessionBundleSource = {
  id: string;
  kind?: string;
  label?: string;
  redacted?: boolean;
};

export type ReplaySessionBundle = {
  schemaVersion: typeof SESSION_BUNDLE_SCHEMA_VERSION;
  sessionId: string;
  title: string;
  description?: string;
  doctrineTags?: string[];
  source?: ReplaySessionBundleSource;
  exportedAt: string;
  core?: ApertureCoreOptions;
  steps: ReplayObservationStep[];
  normalizedEvents: ReplayNormalizedEventSnapshot[];
  traces: ApertureTrace[];
  signals: AttentionSignal[];
  responses: AttentionResponse[];
  viewSnapshots: ReplayViewSnapshot[];
  semanticSnapshots: ReplaySemanticSnapshot[];
  decisionSnapshots: ReplayDecisionSnapshot[];
  outcomes: {
    totalSteps: number;
    surfacedFrames: number;
    finalActiveInteractionId: string | null;
    finalQueuedCount: number;
    finalAmbientCount: number;
    finalQueuedInteractionIds: string[];
    finalAmbientInteractionIds: string[];
  };
};

type CreateSessionBundleOptions = {
  sessionId?: string;
  source?: ReplaySessionBundleSource;
  exportedAt?: string;
};

export function createSessionBundle(
  result: ReplayRunResult,
  options: CreateSessionBundleOptions = {},
): ReplaySessionBundle {
  const scorecard = scoreReplayRun(result);

  return {
    schemaVersion: SESSION_BUNDLE_SCHEMA_VERSION,
    sessionId: options.sessionId ?? result.scenario.id,
    title: result.scenario.title,
    ...(result.scenario.description !== undefined ? { description: result.scenario.description } : {}),
    ...(result.scenario.doctrineTags !== undefined ? { doctrineTags: result.scenario.doctrineTags } : {}),
    ...(options.source !== undefined ? { source: options.source } : {}),
    exportedAt: options.exportedAt ?? new Date().toISOString(),
    ...(result.scenario.core !== undefined ? { core: result.scenario.core } : {}),
    steps: result.scenario.steps,
    normalizedEvents: result.normalizedEvents,
    traces: result.traces,
    signals: result.signals,
    responses: result.responses,
    viewSnapshots: result.views,
    semanticSnapshots: result.semantics,
    decisionSnapshots: result.decisions,
    outcomes: scorecard.outcomes,
  };
}

export function sessionBundleToScenario(bundle: ReplaySessionBundle): ReplayScenario {
  return {
    id: `bundle:${bundle.sessionId}`,
    title: bundle.title,
    ...(bundle.description !== undefined ? { description: bundle.description } : {}),
    ...(bundle.doctrineTags !== undefined ? { doctrineTags: bundle.doctrineTags } : {}),
    ...(bundle.core !== undefined ? { core: bundle.core } : {}),
    steps: bundle.steps,
  };
}

export function runSessionBundle(bundle: ReplaySessionBundle): ReplayRunResult {
  return runReplayScenario(sessionBundleToScenario(bundle));
}

export async function loadSessionBundles(
  directory: string = DEFAULT_SESSION_BUNDLES_DIR,
): Promise<ReplaySessionBundle[]> {
  try {
    const bundles = await readSessionBundleDirectory(directory);
    return bundles.sort((left, right) => left.sessionId.localeCompare(right.sessionId));
  } catch (error) {
    if (isMissingDirectoryError(error)) {
      return [];
    }

    throw error;
  }
}

export async function writeSessionBundle(
  filePath: string,
  bundle: ReplaySessionBundle,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
}

export function defaultSessionBundlePath(
  bundle: ReplaySessionBundle,
  directory: string = DEFAULT_SESSION_BUNDLES_DIR,
): string {
  return path.join(directory, `${safeBundleFilename(bundle.sessionId)}.json`);
}

export function createTempSessionBundlePath(prefix: string = "aperture-session-bundle"): string {
  const basename = `${prefix}-${Date.now()}.json`;
  return path.join(os.tmpdir(), basename);
}

async function readSessionBundleDirectory(directory: string): Promise<ReplaySessionBundle[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const bundles: ReplaySessionBundle[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      bundles.push(...await readSessionBundleDirectory(absolutePath));
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }

    const raw = await readFile(absolutePath, "utf8");
    const bundle = JSON.parse(raw) as ReplaySessionBundle;
    if (bundle.schemaVersion !== SESSION_BUNDLE_SCHEMA_VERSION) {
      continue;
    }
    bundles.push(bundle);
  }

  return bundles;
}

function safeBundleFilename(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
}

function isMissingDirectoryError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
