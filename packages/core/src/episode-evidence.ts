import type { AttentionCandidate } from "./interaction-candidate.js";
import { readSemanticRelationEvidenceStrength } from "./judgment-input.js";
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

type EpisodeObservation = Pick<AttentionCandidate, "interactionId" | "timestamp" | "blocking"> & {
  sequence: number;
};

type EpisodeInteractionEvidence = {
  modes: Set<AttentionCandidate["mode"]>;
  highSignals: number;
  blockingSignals: number;
  relationKinds: Set<SemanticRelationHint["kind"]>;
  latest: EpisodeObservation;
  previous?: EpisodeObservation;
};

export type EpisodeRecord = EpisodeSummary & {
  interactions: Map<string, EpisodeInteractionEvidence>;
  observationSequence: number;
  modes: Set<AttentionCandidate["mode"]>;
  highSignals: number;
  blockingSignals: number;
  relationKinds: Set<SemanticRelationHint["kind"]>;
};

const DEFAULTS = JUDGMENT_DEFAULTS.episodeEvidence;

export function accumulateEpisodeEvidence(
  record: EpisodeRecord,
  candidate: AttentionCandidate,
  resolvesEpisode: boolean,
): EpisodeRecord {
  if (record.state === "stale" || record.state === "resolved") {
    return preserveRecordState(record, candidate);
  }

  const interactions = accumulateInteractionEvidence(record, candidate);
  const modes = new Set(record.modes);
  modes.add(candidate.mode);

  const relationKinds = mergeEpisodeRelationKinds(record.relationKinds, candidate);
  const nextRecord: EpisodeRecord = {
    ...record,
    lastInteractionId: candidate.interactionId,
    updatedAt: candidate.timestamp,
    size: interactions.size,
    interactions,
    observationSequence: record.observationSequence + 1,
    modes,
    relationKinds,
    blockingSignals: record.blockingSignals + (candidate.blocking ? 1 : 0),
    highSignals:
      record.highSignals +
      (candidate.consequence === "high" || candidate.tone === "critical" ? 1 : 0),
  };
  const evidence = measureEpisodeEvidence(nextRecord, candidate);
  if (resolvesEpisode) {
    return {
      ...nextRecord,
      evidenceScore: 0,
      evidenceReasons: ["semantic relation hints indicate this episode is resolved"],
      state: "resolved",
    };
  }

  return {
    ...nextRecord,
    evidenceScore: evidence.score,
    evidenceReasons: evidence.reasons,
    state: nextEpisodeState(record.state, candidate, nextRecord, evidence.score),
  };
}

export function recomputeEpisodeEvidence(record: EpisodeRecord): void {
  record.size = record.interactions.size;
  record.modes = new Set();
  record.relationKinds = new Set();
  record.highSignals = 0;
  record.blockingSignals = 0;
  let latest: EpisodeObservation | undefined;
  let previous: EpisodeObservation | undefined;
  for (const evidence of record.interactions.values()) {
    for (const mode of evidence.modes) {
      record.modes.add(mode);
    }
    for (const kind of evidence.relationKinds) {
      record.relationKinds.add(kind);
    }
    record.highSignals += evidence.highSignals;
    record.blockingSignals += evidence.blockingSignals;
    for (const observation of [evidence.previous, evidence.latest]) {
      if (!observation) {
        continue;
      }
      if (!latest || observation.sequence > latest.sequence) {
        previous = latest;
        latest = observation;
      } else if (!previous || observation.sequence > previous.sequence) {
        previous = observation;
      }
    }
  }
  if (!latest) {
    return;
  }
  record.lastInteractionId = latest.interactionId;
  record.updatedAt = latest.timestamp;
  if (record.state === "resolved") {
    return;
  }
  const evidence = measureEpisodeEvidence(record, latest);
  record.evidenceScore = evidence.score;
  record.evidenceReasons = evidence.reasons;
  if (record.state !== "stale") {
    // Accumulated evidence is monotonic. Below the actionable threshold only
    // the preceding blocking observation can cause the one-update waiting state.
    // Two observations per member suffice even after withdrawing other members.
    record.state = nextEpisodeState(
      previous?.blocking ? "actionable" : "emerging",
      latest,
      record,
      evidence.score,
    );
  }
}

function nextEpisodeState(
  current: EpisodeState,
  candidate: Pick<AttentionCandidate, "blocking">,
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
  candidate: Pick<AttentionCandidate, "blocking">,
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
  const strength = readSemanticRelationEvidenceStrength(candidate);
  if (strength === "weak") {
    return relationKinds;
  }
  for (const relationHint of candidate.relationHints ?? []) {
    relationKinds.add(relationHint.kind);
  }
  return relationKinds;
}

function preserveRecordState(record: EpisodeRecord, candidate: AttentionCandidate): EpisodeRecord {
  const interactions = accumulateInteractionEvidence(record, candidate, true);

  const modes = new Set(record.modes);
  modes.add(candidate.mode);

  return {
    ...record,
    size: interactions.size,
    interactions,
    observationSequence: record.observationSequence + 1,
    modes,
  };
}

function accumulateInteractionEvidence(
  record: EpisodeRecord,
  candidate: AttentionCandidate,
  preserveState = false,
): Map<string, EpisodeInteractionEvidence> {
  const interactions = new Map(record.interactions);
  const previous = interactions.get(candidate.interactionId);
  const modes = new Set(previous?.modes);
  modes.add(candidate.mode);
  interactions.set(candidate.interactionId, {
    modes,
    highSignals:
      (previous?.highSignals ?? 0) +
      (!preserveState && (candidate.consequence === "high" || candidate.tone === "critical")
        ? 1
        : 0),
    blockingSignals:
      (previous?.blockingSignals ?? 0) + (!preserveState && candidate.blocking ? 1 : 0),
    relationKinds: preserveState
      ? (previous?.relationKinds ?? new Set())
      : mergeEpisodeRelationKinds(previous?.relationKinds ?? new Set(), candidate),
    latest: {
      interactionId: candidate.interactionId,
      timestamp: candidate.timestamp,
      blocking: candidate.blocking,
      sequence: record.observationSequence + 1,
    },
    ...(previous ? { previous: previous.latest } : {}),
  });
  return interactions;
}
