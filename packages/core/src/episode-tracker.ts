import type { AttentionFrame, AttentionView } from "./frame.js";
import type { AttentionCandidate } from "./interaction-candidate.js";
import { JUDGMENT_DEFAULTS } from "./judgment-defaults.js";
import { readSemanticRelationTarget } from "./semantic-relations.js";
import { hasQualifiedResolvingRelation } from "./semantic-relation-judgment.js";
import { createCoreClock, type CoreClock } from "./time.js";
import {
  accumulateEpisodeEvidence,
  recomputeEpisodeEvidence,
  type EpisodeRecord,
  type EpisodeState,
  type EpisodeSummary,
} from "./episode-evidence.js";

export type EpisodeVisibilityLane = "now" | "next" | "ambient";

const DEFAULTS = JUDGMENT_DEFAULTS.episodeEvidence;
const DEFAULT_DORMANT_EPISODE_RETENTION_MS = 24 * 60 * 60_000;
const DEFAULT_MAX_DORMANT_EPISODES = 1_024;

export type EpisodeTrackerStats = {
  activeRecords: number;
  dormantRecords: number;
  retainedRecords: number;
  boundInteractions: number;
  dormantRetentionMs: number;
  maxDormantRecords: number;
  prunedRecords: number;
  latestEpisodeAt: string | null;
};

type EpisodeTrackerOptions = {
  clock?: CoreClock;
  dormantRetentionMs?: number;
  maxDormantEpisodes?: number;
};

export class EpisodeTracker {
  private readonly byKey = new Map<string, EpisodeRecord>();
  private readonly byId = new Map<string, EpisodeRecord>();
  private readonly byInteractionId = new Map<string, string>();
  private readonly nextSequenceByKey = new Map<string, number>();
  private readonly clock: CoreClock;
  private readonly dormantRetentionMs: number;
  private readonly maxDormantEpisodes: number;
  private latestObservedAtMs: number | null = null;
  private prunedRecords = 0;

  constructor(options: EpisodeTrackerOptions = {}) {
    this.clock = options.clock ?? createCoreClock();
    this.dormantRetentionMs = options.dormantRetentionMs ?? DEFAULT_DORMANT_EPISODE_RETENTION_MS;
    this.maxDormantEpisodes = options.maxDormantEpisodes ?? DEFAULT_MAX_DORMANT_EPISODES;
  }

  assign(candidate: AttentionCandidate): AttentionCandidate {
    const candidateMs = this.clock.parse(candidate.timestamp);
    if (
      candidateMs !== null &&
      (this.latestObservedAtMs === null || candidateMs > this.latestObservedAtMs)
    ) {
      this.latestObservedAtMs = candidateMs;
    }
    const key = buildEpisodeKey(candidate);
    const existingId = this.byInteractionId.get(candidate.interactionId);
    const boundRecord = existingId ? this.byId.get(existingId) : undefined;
    const reusableBoundRecord =
      boundRecord && !this.shouldRollEpisode(boundRecord, candidate.timestamp)
        ? boundRecord
        : undefined;
    const keyedRecord = reusableBoundRecord ? null : this.byKey.get(key);
    const record = reusableBoundRecord ?? this.resolveAssignableRecord(key, keyedRecord, candidate);
    const obsolete = isObsoleteCandidate(record, candidate, this.clock);
    const nextRecord = obsolete
      ? record
      : accumulateEpisodeEvidence(
          record,
          candidate,
          !isDormantEpisodeState(record.state) && hasQualifiedResolvingRelation(candidate),
        );

    if (shouldIndexRecord(nextRecord, this.byKey.get(nextRecord.key))) {
      this.byKey.set(nextRecord.key, nextRecord);
    }
    this.byId.set(nextRecord.id, nextRecord);
    if (!obsolete) {
      this.byInteractionId.set(candidate.interactionId, nextRecord.id);
    }
    this.pruneDormantRecords();

    return {
      ...candidate,
      episodeId: nextRecord.id,
      episodeKey: nextRecord.key,
      episodeState: nextRecord.state,
      episodeSize: nextRecord.size,
      episodeEvidenceScore: nextRecord.evidenceScore,
      episodeEvidenceReasons: [...nextRecord.evidenceReasons],
      ...(obsolete ? { episodeObsolete: true } : {}),
    };
  }

  resolveInteraction(interactionId: string): void {
    const episodeId = this.byInteractionId.get(interactionId);
    if (!episodeId) {
      return;
    }

    const record = this.byId.get(episodeId);
    if (!record) {
      return;
    }

    if (this.byKey.get(record.key)?.id === record.id) {
      this.byKey.delete(record.key);
    }
    this.byId.delete(record.id);
    for (const relatedInteractionId of record.interactions.keys()) {
      this.byInteractionId.delete(relatedInteractionId);
    }
  }

  retractInteraction(interactionId: string): EpisodeSummary | null {
    const episodeId = this.byInteractionId.get(interactionId);
    const record = episodeId ? this.byId.get(episodeId) : undefined;
    if (!record || record.interactions.size <= 1) {
      this.resolveInteraction(interactionId);
      return null;
    }
    // Cancellation withdraws one member, not the related work still pending.
    this.byInteractionId.delete(interactionId);
    record.interactions.delete(interactionId);
    recomputeEpisodeEvidence(record);
    return {
      id: record.id,
      key: record.key,
      state: record.state,
      size: record.size,
      evidenceScore: record.evidenceScore,
      evidenceReasons: [...record.evidenceReasons],
      lastInteractionId: record.lastInteractionId,
      updatedAt: record.updatedAt,
    };
  }

  readFrameEpisode(frame: AttentionFrame | null): EpisodeSummary | null {
    if (!frame) {
      return null;
    }

    const metadata = frame.metadata?.episode;
    if (!metadata || typeof metadata !== "object") {
      return null;
    }

    const id = readString(metadata, "id");
    const key = readString(metadata, "key");
    const state = readState(metadata, "state");
    const size = readNumber(metadata, "size");
    const evidenceScore = readNumber(metadata, "evidenceScore") ?? 0;
    const evidenceReasons = readStringList(metadata, "evidenceReasons");
    const lastInteractionId = readString(metadata, "lastInteractionId");
    const updatedAt = readString(metadata, "updatedAt");

    if (!id || !key || !state || size === null || !lastInteractionId || !updatedAt) {
      return null;
    }

    return { id, key, state, size, evidenceScore, evidenceReasons, lastInteractionId, updatedAt };
  }

  stats(): EpisodeTrackerStats {
    let activeRecords = 0;
    let dormantRecords = 0;
    let latestEpisodeAt: string | null = null;

    for (const record of this.byId.values()) {
      if (this.isActiveRecord(record)) {
        activeRecords += 1;
      } else {
        dormantRecords += 1;
      }
      if (latestEpisodeAt === null || record.updatedAt > latestEpisodeAt) {
        latestEpisodeAt = record.updatedAt;
      }
    }

    return {
      activeRecords,
      dormantRecords,
      retainedRecords: this.byId.size,
      boundInteractions: this.byInteractionId.size,
      dormantRetentionMs: this.dormantRetentionMs,
      maxDormantRecords: this.maxDormantEpisodes,
      prunedRecords: this.prunedRecords,
      latestEpisodeAt,
    };
  }

  private createRecord(key: string, candidate: AttentionCandidate): EpisodeRecord {
    const nextSequence = (this.nextSequenceByKey.get(key) ?? 0) + 1;
    this.nextSequenceByKey.set(key, nextSequence);
    return {
      id: `episode:${key}:${nextSequence}`,
      key,
      state: "emerging",
      size: 0,
      evidenceScore: 0,
      evidenceReasons: [],
      lastInteractionId: candidate.interactionId,
      updatedAt: candidate.timestamp,
      interactions: new Map(),
      observationSequence: 0,
      modes: new Set(),
      highSignals: 0,
      blockingSignals: 0,
      relationKinds: new Set(),
    };
  }

  private resolveAssignableRecord(
    key: string,
    current: EpisodeRecord | null | undefined,
    candidate: AttentionCandidate,
  ): EpisodeRecord {
    if (!current) {
      return this.createRecord(key, candidate);
    }

    if (this.shouldRollEpisode(current, candidate.timestamp)) {
      const staleRecord = {
        ...current,
        state: "stale" as const,
      };
      this.byId.set(staleRecord.id, staleRecord);
      return this.createRecord(key, candidate);
    }

    return current;
  }

  private shouldRollEpisode(record: EpisodeRecord, nextTimestamp: string): boolean {
    if (isDormantEpisodeState(record.state)) {
      return isAfterTimestamp(nextTimestamp, record.updatedAt, this.clock);
    }

    const previousMs = this.clock.parse(record.updatedAt);
    const nextMs = this.clock.parse(nextTimestamp);
    if (previousMs === null || nextMs === null) {
      return false;
    }

    return nextMs - previousMs >= DEFAULTS.staleAfterMs;
  }

  private pruneDormantRecords(): void {
    const dormantRecords = [...this.byId.values()].filter((record) => !this.isActiveRecord(record));

    if (this.latestObservedAtMs !== null) {
      for (const record of dormantRecords) {
        const updatedAtMs = this.clock.parse(record.updatedAt);
        if (updatedAtMs === null) {
          continue;
        }
        if (this.latestObservedAtMs - updatedAtMs > this.dormantRetentionMs) {
          this.deleteRecord(record);
        }
      }
    }

    const remainingDormant = [...this.byId.values()]
      .filter((record) => !this.isActiveRecord(record))
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));

    if (remainingDormant.length <= this.maxDormantEpisodes) {
      return;
    }

    const overflow = remainingDormant.length - this.maxDormantEpisodes;
    for (const record of remainingDormant.slice(0, overflow)) {
      this.deleteRecord(record);
    }
  }

  private isActiveRecord(record: EpisodeRecord): boolean {
    return this.byKey.get(record.key)?.id === record.id && !isDormantEpisodeState(record.state);
  }

  private deleteRecord(record: EpisodeRecord): void {
    if (this.byKey.get(record.key)?.id === record.id) {
      this.byKey.delete(record.key);
    }
    this.byId.delete(record.id);
    for (const interactionId of record.interactions.keys()) {
      if (this.byInteractionId.get(interactionId) === record.id) {
        this.byInteractionId.delete(interactionId);
      }
    }
    this.prunedRecords += 1;
  }
}

export function buildEpisodeKey(candidate: AttentionCandidate): string {
  const source = candidate.source?.kind ?? candidate.source?.id ?? "unknown";
  const anchor = episodeAnchor(candidate);
  const modeClass = candidate.blocking ? "interruptive" : "status";
  return normalizeEpisodePart([source, modeClass, anchor].join(":"));
}

export function readFrameEpisodeId(frame: AttentionFrame | null): string | null {
  return frame ? readString(frame.metadata?.episode, "id") : null;
}

export function readFrameEpisodeState(frame: AttentionFrame | null): EpisodeState | null {
  return frame ? readState(frame.metadata?.episode, "state") : null;
}

export function isDormantEpisodeState(state: EpisodeState | null): boolean {
  return state === "stale" || state === "resolved";
}

export function isCandidateInActionableEpisode(candidate: AttentionCandidate): boolean {
  return candidate.episodeState === "actionable";
}

export function isLiveEpisodeFrame(
  frame: AttentionFrame | null | undefined,
  episodeId: string,
  excludedInteractionId?: string,
): frame is AttentionFrame {
  return (
    frame !== null &&
    frame !== undefined &&
    frame.interactionId !== excludedInteractionId &&
    readFrameEpisodeId(frame) === episodeId &&
    !isDormantEpisodeState(readFrameEpisodeState(frame))
  );
}

export function findVisibleEpisodeFrames(
  attentionView: AttentionView | undefined,
  episodeId: string,
  options: {
    lanes?: readonly EpisodeVisibilityLane[];
    excludedInteractionId?: string;
  } = {},
): AttentionFrame[] {
  const lanes = options.lanes ?? ["now", "next", "ambient"];
  const frames: Array<AttentionFrame | null | undefined> = [];
  if (lanes.includes("now")) {
    frames.push(attentionView?.now);
  }
  if (lanes.includes("next")) {
    frames.push(...(attentionView?.next ?? []));
  }
  if (lanes.includes("ambient")) {
    frames.push(...(attentionView?.ambient ?? []));
  }

  return frames.filter((frame): frame is AttentionFrame =>
    isLiveEpisodeFrame(frame, episodeId, options.excludedInteractionId),
  );
}

function episodeAnchor(candidate: AttentionCandidate): string {
  // Prefer explicit relation targets first because they are the most stable
  // cross-wording episode anchor. Fall back to context metadata, then the
  // human-visible summary/title, and only then the task id.
  const relationAnchor = readSemanticRelationTarget(candidate.relationHints);
  if (relationAnchor) {
    return relationAnchor;
  }

  const items = candidate.context?.items ?? [];
  const preferred = items.find((item) => {
    const id = item.id.toLowerCase();
    const label = item.label.toLowerCase();
    return (
      id.includes("file") ||
      id === "path" ||
      id.includes("issue") ||
      id === "command" ||
      label.includes("file") ||
      label.includes("path") ||
      label.includes("issue") ||
      label.includes("command")
    );
  });

  if (preferred?.value) {
    return preferred.value;
  }

  const summaryAnchor = candidate.summary ?? candidate.title;
  if (summaryAnchor.length > 0) {
    return summaryAnchor;
  }

  return candidate.taskId;
}

function normalizeEpisodePart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9:/._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}

function shouldIndexRecord(record: EpisodeRecord, current: EpisodeRecord | undefined): boolean {
  if (!current || current.id === record.id) {
    return true;
  }

  return !isDormantEpisodeState(record.state);
}

function isBeforeTimestamp(left: string, right: string, clock: CoreClock): boolean {
  const leftMs = clock.parse(left);
  const rightMs = clock.parse(right);
  if (leftMs !== null && rightMs !== null) {
    return leftMs < rightMs;
  }

  return left < right;
}

function isAfterTimestamp(left: string, right: string, clock: CoreClock): boolean {
  const leftMs = clock.parse(left);
  const rightMs = clock.parse(right);
  if (leftMs !== null && rightMs !== null) {
    return leftMs > rightMs;
  }

  return left > right;
}

function isObsoleteCandidate(
  record: EpisodeRecord,
  candidate: AttentionCandidate,
  clock: CoreClock,
): boolean {
  return isBeforeTimestamp(candidate.timestamp, record.updatedAt, clock);
}

function readString(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object" || !(key in value)) {
    return null;
  }

  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}

function readNumber(value: unknown, key: string): number | null {
  if (!value || typeof value !== "object" || !(key in value)) {
    return null;
  }

  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "number" ? candidate : null;
}

function readState(value: unknown, key: string): EpisodeState | null {
  const candidate = readString(value, key);
  switch (candidate) {
    case "emerging":
    case "actionable":
    case "batched":
    case "waiting":
    case "stale":
    case "resolved":
      return candidate;
    default:
      return null;
  }
}

function readStringList(value: unknown, key: string): string[] {
  if (!value || typeof value !== "object" || !(key in value)) {
    return [];
  }

  const candidate = (value as Record<string, unknown>)[key];
  if (!Array.isArray(candidate)) {
    return [];
  }

  return candidate.filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0,
  );
}
