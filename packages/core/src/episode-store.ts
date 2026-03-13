import type { Frame } from "./frame.js";
import type { InteractionCandidate } from "./interaction-candidate.js";

export type EpisodeState = "emerging" | "actionable" | "batched" | "waiting" | "stale" | "resolved";

export type EpisodeSummary = {
  id: string;
  key: string;
  state: EpisodeState;
  size: number;
  lastInteractionId: string;
  updatedAt: string;
};

type EpisodeRecord = EpisodeSummary & {
  interactions: Set<string>;
};

export class EpisodeStore {
  private readonly byKey = new Map<string, EpisodeRecord>();
  private readonly byInteractionId = new Map<string, string>();

  assign(candidate: InteractionCandidate): InteractionCandidate {
    const key = buildEpisodeKey(candidate);
    const existingId = this.byInteractionId.get(candidate.interactionId);
    const record =
      (existingId ? this.findById(existingId) : undefined)
      ?? this.byKey.get(key)
      ?? this.createRecord(key, candidate);

    record.interactions.add(candidate.interactionId);
    record.lastInteractionId = candidate.interactionId;
    record.updatedAt = candidate.timestamp;
    record.state = nextEpisodeState(record.state, candidate);
    record.size = record.interactions.size;

    this.byKey.set(record.key, record);
    this.byInteractionId.set(candidate.interactionId, record.id);

    return {
      ...candidate,
      episodeId: record.id,
      episodeKey: record.key,
      episodeState: record.state,
      episodeSize: record.size,
    };
  }

  resolveInteraction(interactionId: string): void {
    const episodeId = this.byInteractionId.get(interactionId);
    if (!episodeId) {
      return;
    }

    const record = this.findById(episodeId);
    if (!record) {
      return;
    }

    record.state = "resolved";
    this.byKey.set(record.key, record);
  }

  readFrameEpisode(frame: Frame | null): EpisodeSummary | null {
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
    const lastInteractionId = readString(metadata, "lastInteractionId");
    const updatedAt = readString(metadata, "updatedAt");

    if (!id || !key || !state || size === null || !lastInteractionId || !updatedAt) {
      return null;
    }

    return { id, key, state, size, lastInteractionId, updatedAt };
  }

  private createRecord(key: string, candidate: InteractionCandidate): EpisodeRecord {
    return {
      id: `episode:${key}`,
      key,
      state: candidate.blocking ? "actionable" : "emerging",
      size: 0,
      lastInteractionId: candidate.interactionId,
      updatedAt: candidate.timestamp,
      interactions: new Set<string>(),
    };
  }

  private findById(id: string): EpisodeRecord | undefined {
    for (const record of this.byKey.values()) {
      if (record.id === id) {
        return record;
      }
    }

    return undefined;
  }
}

export function buildEpisodeKey(candidate: InteractionCandidate): string {
  const source = candidate.source?.kind ?? candidate.source?.id ?? "unknown";
  const anchor = episodeAnchor(candidate);
  const modeClass = candidate.blocking ? "interruptive" : "status";
  return normalizeEpisodePart([source, modeClass, anchor].join(":"));
}

export function readFrameEpisodeId(frame: Frame | null): string | null {
  return frame ? readString(frame.metadata?.episode, "id") : null;
}

function episodeAnchor(candidate: InteractionCandidate): string {
  const items = candidate.context?.items ?? [];
  const preferred = items.find((item) => {
    const id = item.id.toLowerCase();
    const label = item.label.toLowerCase();
    return (
      id.includes("file")
      || id === "path"
      || id.includes("issue")
      || id === "command"
      || label.includes("file")
      || label.includes("path")
      || label.includes("issue")
      || label.includes("command")
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

function nextEpisodeState(current: EpisodeState, candidate: InteractionCandidate): EpisodeState {
  if (candidate.blocking) {
    return "actionable";
  }

  if (current === "actionable") {
    return "waiting";
  }

  return "emerging";
}

function normalizeEpisodePart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9:/._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
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
