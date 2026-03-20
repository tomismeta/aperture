import type { AttentionFrame } from "./frame.js";
import type { AttentionCandidate } from "./interaction-candidate.js";
import { JUDGMENT_DEFAULTS } from "./judgment-defaults.js";
import type { SemanticRelationHint } from "./semantic-types.js";

export type EpisodeState = "emerging" | "actionable" | "batched" | "waiting" | "stale" | "resolved";

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

export class EpisodeTracker {
  private readonly byKey = new Map<string, EpisodeRecord>();
  private readonly byInteractionId = new Map<string, string>();

  assign(candidate: AttentionCandidate): AttentionCandidate {
    const key = buildEpisodeKey(candidate);
    const existingId = this.byInteractionId.get(candidate.interactionId);
    const record =
      (existingId ? this.findById(existingId) : undefined)
      ?? this.byKey.get(key)
      ?? this.createRecord(key, candidate);

    record.interactions.add(candidate.interactionId);
    record.lastInteractionId = candidate.interactionId;
    record.updatedAt = candidate.timestamp;
    record.size = record.interactions.size;
    record.modes.add(candidate.mode);
    if (candidate.blocking) {
      record.blockingSignals += 1;
    }
    if (candidate.consequence === "high" || candidate.tone === "critical") {
      record.highSignals += 1;
    }
    const evidence = measureEpisodeEvidence(record, candidate);
    record.evidenceScore = evidence.score;
    record.evidenceReasons = evidence.reasons;
    record.state = nextEpisodeState(record.state, candidate, record, evidence.score);

    this.byKey.set(record.key, record);
    this.byInteractionId.set(candidate.interactionId, record.id);

    return {
      ...candidate,
      episodeId: record.id,
      episodeKey: record.key,
      episodeState: record.state,
      episodeSize: record.size,
      episodeEvidenceScore: record.evidenceScore,
      episodeEvidenceReasons: [...record.evidenceReasons],
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

  private createRecord(key: string, candidate: AttentionCandidate): EpisodeRecord {
    return {
      id: `episode:${key}`,
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
      relationKinds: new Set((candidate.relationHints ?? []).map((hint) => hint.kind)),
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

export function buildEpisodeKey(candidate: AttentionCandidate): string {
  const source = candidate.source?.kind ?? candidate.source?.id ?? "unknown";
  const anchor = episodeAnchor(candidate);
  const modeClass = candidate.blocking ? "interruptive" : "status";
  return normalizeEpisodePart([source, modeClass, anchor].join(":"));
}

export function readFrameEpisodeId(frame: AttentionFrame | null): string | null {
  return frame ? readString(frame.metadata?.episode, "id") : null;
}

function episodeAnchor(candidate: AttentionCandidate): string {
  const relationAnchor = readRelationAnchor(candidate.relationHints);
  if (relationAnchor) {
    return relationAnchor;
  }

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

  for (const relationHint of candidate.relationHints ?? []) {
    record.relationKinds.add(relationHint.kind);
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

function readRelationAnchor(relationHints: AttentionCandidate["relationHints"]): string | null {
  if (!relationHints || relationHints.length === 0) {
    return null;
  }

  const targetHint = relationHints.find((hint) => typeof hint.target === "string" && hint.target.length > 0);
  return targetHint?.target ?? null;
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

function readStringList(value: unknown, key: string): string[] {
  if (!value || typeof value !== "object" || !(key in value)) {
    return [];
  }

  const candidate = (value as Record<string, unknown>)[key];
  if (!Array.isArray(candidate)) {
    return [];
  }

  return candidate.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}
