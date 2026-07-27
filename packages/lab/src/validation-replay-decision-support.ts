import type { ReplayDecisionSnapshot, ReplayEpisodeState } from "./scenario.js";
import { isRecord, isStringArray } from "./shape.js";

const EPISODE_STATES = new Set<ReplayEpisodeState>([
  "emerging",
  "actionable",
  "batched",
  "waiting",
  "stale",
  "resolved",
]);

export function isReplayEpisodeState(value: unknown): value is ReplayEpisodeState {
  return typeof value === "string" && EPISODE_STATES.has(value as ReplayEpisodeState);
}

export function isReplayEpisodeSize(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export function isReplayEpisodeEvidenceScore(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function validateReplayEpisodeSnapshotEvidence(value: Record<string, unknown>): boolean {
  if (!hasPairedEpisodeIdentity(value)) {
    return false;
  }

  if (!hasMaterialEpisodeEvidence(value)) {
    return true;
  }

  const suppressedNone = value.decisionKind === "suppressed" && value.resultLane === "none";
  if (value.episodeObsolete !== suppressedNone) {
    return false;
  }

  return (
    typeof value.episodeId === "string" &&
    typeof value.episodeKey === "string" &&
    isReplayEpisodeState(value.episodeState) &&
    isReplayEpisodeSize(value.episodeSize) &&
    isReplayEpisodeEvidenceScore(value.episodeEvidenceScore) &&
    isStringArray(value.episodeEvidenceReasons) &&
    typeof value.episodeObsolete === "boolean"
  );
}

export function validateReplayEpisodeExpectationEvidence(value: Record<string, unknown>): boolean {
  if (!hasPairedEpisodeIdentity(value)) {
    return false;
  }

  if (value.episodeObsolete === true) {
    if (value.decisionKind !== undefined && value.decisionKind !== "suppressed") {
      return false;
    }
    if (value.resultLane !== undefined && value.resultLane !== "none") {
      return false;
    }
  }

  if (
    value.episodeObsolete !== undefined &&
    value.decisionKind !== undefined &&
    value.resultLane !== undefined &&
    value.episodeObsolete !== (value.decisionKind === "suppressed" && value.resultLane === "none")
  ) {
    return false;
  }

  return (
    (value.episodeEvidenceReasonsInclude === undefined ||
      isStringArray(value.episodeEvidenceReasonsInclude)) &&
    (value.episodeSize === undefined || isReplayEpisodeSize(value.episodeSize)) &&
    (value.episodeEvidenceScore === undefined ||
      isReplayEpisodeEvidenceScore(value.episodeEvidenceScore))
  );
}

export function isReplayDecisionValueComponents(
  value: unknown,
): value is NonNullable<ReplayDecisionSnapshot["decisionRecordValueComponents"]> {
  if (!isRecord(value)) {
    return false;
  }

  return Object.entries(value).every(
    ([, componentValue]) => typeof componentValue === "number" && Number.isFinite(componentValue),
  );
}

export function validateReplayDecisionAmbiguity(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (isRecord(value) &&
      value.kind === "interrupt" &&
      (value.reason === "low_signal" || value.reason === "small_score_gap") &&
      (value.resolution === "queue" || value.resolution === "ambient"))
  );
}

function hasPairedEpisodeIdentity(value: Record<string, unknown>): boolean {
  const id = value.episodeId;
  const key = value.episodeKey;

  if (id === undefined && key === undefined) {
    return true;
  }

  return (typeof id === "string" && typeof key === "string") || (id === null && key === null);
}

function hasMaterialEpisodeEvidence(value: Record<string, unknown>): boolean {
  return (
    typeof value.episodeId === "string" ||
    typeof value.episodeKey === "string" ||
    value.episodeState !== undefined ||
    value.episodeSize !== undefined ||
    value.episodeEvidenceScore !== undefined ||
    value.episodeEvidenceReasons !== undefined ||
    value.episodeObsolete === true
  );
}
