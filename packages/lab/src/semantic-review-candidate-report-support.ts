import path from "node:path";

import corePackageMetadata from "../../core/package.json" with { type: "json" };
import { KERNEL_DECISION_RECORD_PROJECTION_VERSION } from "./artifact-versions.js";
import {
  createSessionBundle,
  runSessionBundle,
  type ReplaySessionBundle,
} from "./session-bundle.js";
import type { ReplayObservationStep } from "./scenario.js";
import type {
  SemanticReviewCandidate,
  SemanticReviewCandidateEngineFingerprint,
  SemanticReviewCandidateEvaluationMode,
  SemanticReviewCandidateKind,
  SemanticReviewCandidateReplayClock,
} from "./semantic-review-candidate-types.js";

type CorePackageMetadata = {
  name?: unknown;
  version?: unknown;
};

type ReplayClockReferenceSource =
  keyof SemanticReviewCandidateReplayClock["referenceTimestampSourceCounts"];

type ReplayClockReference = {
  source: ReplayClockReferenceSource;
  timestamp: string;
  timestampMs: number;
};

export type CandidateReviewBundle = {
  bundle: ReplaySessionBundle;
  replayClockReference: ReplayClockReference | null;
};

export function evaluationModeFromReplayOption(options: {
  replayCurrent?: boolean;
}): SemanticReviewCandidateEvaluationMode {
  return options.replayCurrent === true ? "current_engine_replay" : "persisted_bundle_snapshots";
}

export function prepareBundleForCandidateReview(
  bundle: ReplaySessionBundle,
  evaluationMode: SemanticReviewCandidateEvaluationMode,
): CandidateReviewBundle {
  if (evaluationMode === "persisted_bundle_snapshots") {
    return {
      bundle,
      replayClockReference: null,
    };
  }

  const replayClockReference = selectReplayClockReference(bundle);
  const replayed = runSessionBundle(bundle, {
    initialTimeMs: replayClockReference.timestampMs,
    rehydrateSourceQuality: true,
    stepTimeSource: ({ step, previousTimeMs }) =>
      Math.max(readStepTimestampMs(step) ?? previousTimeMs, previousTimeMs),
  });
  return {
    bundle: createSessionBundle(replayed, {
      sessionId: bundle.sessionId,
      exportedAt: bundle.exportedAt,
      ...(bundle.source !== undefined ? { source: bundle.source } : {}),
    }),
    replayClockReference,
  };
}

export function createReplayClockReport(
  evaluationMode: SemanticReviewCandidateEvaluationMode,
): SemanticReviewCandidateReplayClock {
  return {
    strategy:
      evaluationMode === "current_engine_replay"
        ? "monotonic_step_timestamp_previous_timestamp_fallback"
        : "none",
    fallback: "previous_replay_timestamp_then_reference_timestamp",
    referenceTimestampSourceCounts: {
      first_step_timestamp: 0,
      exported_at: 0,
      unix_epoch: 0,
    },
    earliestReferenceTimestamp: null,
    latestReferenceTimestamp: null,
  };
}

export function recordReplayClockReference(
  replayClock: SemanticReviewCandidateReplayClock,
  reference: ReplayClockReference | null,
): void {
  if (reference === null) {
    return;
  }

  replayClock.referenceTimestampSourceCounts[reference.source] += 1;
  replayClock.earliestReferenceTimestamp =
    replayClock.earliestReferenceTimestamp === null ||
    reference.timestamp < replayClock.earliestReferenceTimestamp
      ? reference.timestamp
      : replayClock.earliestReferenceTimestamp;
  replayClock.latestReferenceTimestamp =
    replayClock.latestReferenceTimestamp === null ||
    reference.timestamp > replayClock.latestReferenceTimestamp
      ? reference.timestamp
      : replayClock.latestReferenceTimestamp;
}

export function createSemanticReviewCandidateEngineFingerprint(): SemanticReviewCandidateEngineFingerprint {
  const corePackage = normalizeCorePackageMetadata(corePackageMetadata);
  const kernelDecisionRecordProjectionVersion = KERNEL_DECISION_RECORD_PROJECTION_VERSION;
  return {
    corePackage,
    kernelDecisionRecordProjectionVersion,
    fingerprint: `${corePackage.name}@${corePackage.version}/kernel-decision-v${kernelDecisionRecordProjectionVersion}`,
  };
}

export function countRetainedCandidatesByKind(
  candidatesByKind: Record<SemanticReviewCandidateKind, SemanticReviewCandidate[]>,
): Record<SemanticReviewCandidateKind, number> {
  return Object.fromEntries(
    Object.entries(candidatesByKind).map(([kind, candidates]) => [kind, candidates.length]),
  ) as Record<SemanticReviewCandidateKind, number>;
}

export function repoRelativePath(filePath: string, repoRoot: string): string {
  const absolute = path.resolve(filePath);
  const relative = path.relative(repoRoot, absolute);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    return absolute;
  }
  return relative;
}

export function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
}

function normalizeCorePackageMetadata(value: CorePackageMetadata): {
  name: string;
  version: string;
} {
  return {
    name: typeof value.name === "string" ? value.name : "unknown",
    version: typeof value.version === "string" ? value.version : "unknown",
  };
}

function selectReplayClockReference(bundle: ReplaySessionBundle): ReplayClockReference {
  const firstStepTimestampMs = firstStepTimestamp(bundle.steps);
  if (firstStepTimestampMs !== null) {
    return firstStepTimestampMs;
  }

  const exportedAtMs = parseTimestampMs(bundle.exportedAt);
  if (exportedAtMs !== null) {
    return {
      source: "exported_at",
      timestamp: formatTimestamp(exportedAtMs),
      timestampMs: exportedAtMs,
    };
  }

  return {
    source: "unix_epoch",
    timestamp: formatTimestamp(0),
    timestampMs: 0,
  };
}

function firstStepTimestamp(steps: readonly ReplayObservationStep[]): ReplayClockReference | null {
  for (const step of steps) {
    const timestampMs = readStepTimestampMs(step);
    if (timestampMs !== null) {
      return {
        source: "first_step_timestamp",
        timestamp: formatTimestamp(timestampMs),
        timestampMs,
      };
    }
  }

  return null;
}

function readStepTimestampMs(step: ReplayObservationStep): number | null {
  switch (step.kind) {
    case "publish":
    case "publishSource":
      return parseTimestampMs(step.event.timestamp);
    case "signal":
      return parseTimestampMs(step.signal.timestamp);
    case "submit":
    case "markViewed":
    case "markTimedOut":
    case "markContextExpanded":
    case "markContextSkipped":
      return null;
  }
}

function parseTimestampMs(timestamp: string): number | null {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? null : parsed;
}

function formatTimestamp(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}
