import type { AttentionFrame, AttentionView } from "./frame.js";
import type { AttentionCandidate } from "./interaction-candidate.js";
import { readSemanticRelationEvidenceStrength } from "./judgment-input.js";
import { JUDGMENT_DEFAULTS } from "./judgment-defaults.js";
import type { SemanticRelationHint } from "./semantic-types.js";
import { readSemanticRelationTarget } from "./semantic-relations.js";
import { createCoreClock, type CoreClock } from "./time.js";

export type EpisodeState = "emerging" | "actionable" | "batched" | "waiting" | "stale" | "resolved";
export type EpisodeVisibilityLane = "now" | "next" | "ambient";

export type EpisodeSummary = {
  id: string;
  key: string;
  state: EpisodeState;
  size: number;
  evidenceScore: number;
  evidenceReasons: string[];
  lastInteractionId: string;
  updatedAt: string;
};

type EpisodeRecord = EpisodeSummary & {
  interactions: Set<string>;
  modes: Set<AttentionCandidate["mode"]>;
  highSignals: number;
  blockingSignals: number;
  relationKinds: Set<SemanticRelationHint["kind"]>;
};

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
    const keyedRecord = boundRecord ? null : this.byKey.get(key);
    const record = boundRecord ?? this.resolveAssignableRecord(key, keyedRecord, candidate);
    const nextRecord = this.evolveRecord(record, candidate);

    this.byKey.set(nextRecord.key, nextRecord);
    this.byId.set(nextRecord.id, nextRecord);
    this.byInteractionId.set(candidate.interactionId, nextRecord.id);
    this.pruneDormantRecords();

    return {
      ...candidate,
      episodeId: nextRecord.id,
      episodeKey: nextRecord.key,
      episodeState: nextRecord.state,
      episodeSize: nextRecord.size,
      episodeEvidenceScore: nextRecord.evidenceScore,
      episodeEvidenceReasons: [...nextRecord.evidenceReasons],
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
    for (const relatedInteractionId of record.interactions) {
      this.byInteractionId.delete(relatedInteractionId);
    }
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
    const persistedRelationKinds = shouldPersistEpisodeRelationEvidence(candidate)
      ? (candidate.relationHints ?? []).map((hint) => hint.kind)
      : [];
    return {
      id: `episode:${key}:${nextSequence}`,
      key,
      state: candidate.blocking ? "actionable" : "emerging",
      size: 0,
      evidenceScore: candidate.blocking ? DEFAULTS.blockingBoost : 0,
      evidenceReasons: candidate.blocking
        ? ["operator-facing work makes this episode immediately actionable"]
        : [],
      lastInteractionId: candidate.interactionId,
      updatedAt: candidate.timestamp,
      interactions: new Set<string>(),
      modes: new Set([candidate.mode]),
      highSignals: candidate.consequence === "high" || candidate.tone === "critical" ? 1 : 0,
      blockingSignals: candidate.blocking ? 1 : 0,
      relationKinds: new Set(persistedRelationKinds),
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
      return true;
    }

    const previousMs = this.clock.parse(record.updatedAt);
    const nextMs = this.clock.parse(nextTimestamp);
    if (previousMs === null || nextMs === null) {
      return false;
    }

    return nextMs - previousMs >= DEFAULTS.staleAfterMs;
  }

  private evolveRecord(record: EpisodeRecord, candidate: AttentionCandidate): EpisodeRecord {
    const interactions = new Set(record.interactions);
    interactions.add(candidate.interactionId);

    const modes = new Set(record.modes);
    modes.add(candidate.mode);

    const relationKinds = mergeEpisodeRelationKinds(record.relationKinds, candidate);
    const nextRecord: EpisodeRecord = {
      ...record,
      lastInteractionId: candidate.interactionId,
      updatedAt: candidate.timestamp,
      size: interactions.size,
      interactions,
      modes,
      relationKinds,
      blockingSignals: record.blockingSignals + (candidate.blocking ? 1 : 0),
      highSignals:
        record.highSignals +
        (candidate.consequence === "high" || candidate.tone === "critical" ? 1 : 0),
    };
    const evidence = measureEpisodeEvidence(nextRecord, candidate);
    return {
      ...nextRecord,
      evidenceScore: evidence.score,
      evidenceReasons: evidence.reasons,
      state: nextEpisodeState(record.state, candidate, nextRecord, evidence.score),
    };
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
    for (const interactionId of record.interactions) {
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

function nextEpisodeState(
  current: EpisodeState,
  candidate: AttentionCandidate,
  record: EpisodeRecord,
  evidenceScore: number,
): EpisodeState {
  if (candidate.blocking) {
    return "actionable";
  }

  if (evidenceScore >= DEFAULTS.actionableThreshold) {
    return "actionable";
  }

  if (current === "actionable") {
    return "waiting";
  }

  if (record.size >= 2) {
    return "batched";
  }

  return "emerging";
}

function measureEpisodeEvidence(
  record: EpisodeRecord,
  candidate: AttentionCandidate,
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  if (candidate.blocking) {
    score += DEFAULTS.blockingBoost;
    reasons.push("operator-facing work makes this episode immediately actionable");
  }

  if (record.size >= 2) {
    score += DEFAULTS.recurringEpisodeBoost;
    reasons.push("multiple related interactions have accumulated in this episode");
  }

  if (record.size >= 3) {
    score += DEFAULTS.persistentEpisodeBoost;
    reasons.push("the same episode keeps recurring without resolution");
  }

  if (record.highSignals >= 1) {
    score += DEFAULTS.highSignalBoost;
    reasons.push("at least one related interaction carried high consequence or critical tone");
  }

  if (record.modes.size >= 2) {
    score += DEFAULTS.multiModeBoost;
    reasons.push("related work has spread across multiple interaction modes");
  }

  if (record.highSignals >= 1 && record.size >= 2) {
    score += DEFAULTS.stackingBoost;
    reasons.push("high-signal evidence is stacking up across the episode");
  }

  if (record.relationKinds.has("repeats")) {
    score += DEFAULTS.relationRepeatBoost;
    reasons.push("semantic relation hints indicate this issue is recurring");
  }

  if (record.relationKinds.has("escalates")) {
    score += DEFAULTS.relationEscalationBoost;
    reasons.push("semantic relation hints indicate this issue is escalating");
  }

  return { score, reasons };
}

function mergeEpisodeRelationKinds(
  currentRelationKinds: Set<SemanticRelationHint["kind"]>,
  candidate: AttentionCandidate,
): Set<SemanticRelationHint["kind"]> {
  const relationKinds = new Set(currentRelationKinds);
  if (!shouldPersistEpisodeRelationEvidence(candidate)) {
    return relationKinds;
  }
  for (const relationHint of candidate.relationHints ?? []) {
    relationKinds.add(relationHint.kind);
  }
  return relationKinds;
}

function normalizeEpisodePart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9:/._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}

function shouldPersistEpisodeRelationEvidence(candidate: AttentionCandidate): boolean {
  const strength = readSemanticRelationEvidenceStrength(candidate);
  return strength === null || strength !== "weak";
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
