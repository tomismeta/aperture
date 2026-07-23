import {
  KERNEL_DECISION_RECORD_PROJECTION_V1_VERSION,
  KERNEL_DECISION_RECORD_PROJECTION_VERSION,
} from "./artifact-versions.js";
import {
  compareKernelCanonicalKey,
  digestKernelCanonicalJson,
  serializeKernelCanonicalJson,
} from "./kernel-canonical-json.js";
import type { ReplayDecisionRecordTraceProjection } from "./replay-trace.js";
import type {
  ReplayDecisionOperatorPresence,
  ReplayDecisionPlannedLane,
  ReplayDecisionRoute,
  ReplayDecisionSnapshot,
} from "./scenario.js";

export const KERNEL_DECISION_RECORD_PROJECTION_V1_SCHEMA =
  "aperture.kernel.decision_record_projection.v1" as const;
export const KERNEL_DECISION_RECORD_PROJECTION_SCHEMA =
  "aperture.kernel.decision_record_projection.v2" as const;

export type KernelDecisionRecordFingerprint = `sha256:${string}`;
type KernelDecisionRealizedLane = NonNullable<ReplayDecisionSnapshot["resultLane"]>;

type KernelDecisionRecordProjectionBase = {
  route: ReplayDecisionRoute;
  evidence: {
    operatorPresence: ReplayDecisionOperatorPresence;
    currentFrameId: string | null;
    currentEpisodeId: string | null;
  };
  value: {
    candidateScore: number;
    components: Record<string, number>;
  };
  reasons: string[];
  reasonCodes: string[];
};

export type KernelDecisionRecordProjectionV1 = KernelDecisionRecordProjectionBase & {
  schema: typeof KERNEL_DECISION_RECORD_PROJECTION_V1_SCHEMA;
  version: typeof KERNEL_DECISION_RECORD_PROJECTION_V1_VERSION;
  lane: ReplayDecisionPlannedLane;
};

export type KernelDecisionRecordProjectionV2 = KernelDecisionRecordProjectionBase & {
  schema: typeof KERNEL_DECISION_RECORD_PROJECTION_SCHEMA;
  version: typeof KERNEL_DECISION_RECORD_PROJECTION_VERSION;
  plannedLane: ReplayDecisionPlannedLane;
  realizedLane: KernelDecisionRealizedLane;
};

export type KernelDecisionRecordProjection =
  | KernelDecisionRecordProjectionV1
  | KernelDecisionRecordProjectionV2;

export function buildKernelDecisionRecordProjection(
  record: ReplayDecisionRecordTraceProjection,
  options: { realizedLane: KernelDecisionRealizedLane },
): KernelDecisionRecordProjectionV2 | null {
  if (record.planning.reasonCodes === undefined) {
    return null;
  }

  return canonicalizeKernelDecisionRecordProjection({
    schema: KERNEL_DECISION_RECORD_PROJECTION_SCHEMA,
    version: KERNEL_DECISION_RECORD_PROJECTION_VERSION,
    route: record.planning.route,
    plannedLane: record.planning.plannedLane,
    realizedLane: options.realizedLane,
    evidence: {
      operatorPresence: record.evidenceSnapshot.operatorPresence,
      currentFrameId: record.evidenceSnapshot.currentFrameId,
      currentEpisodeId: record.evidenceSnapshot.currentEpisodeId,
    },
    value: {
      candidateScore: record.value.candidateScore,
      components: sortNumberMap(record.value.breakdown.components),
    },
    reasons: record.planning.reasons,
    reasonCodes: record.planning.reasonCodes,
  });
}

export function buildKernelDecisionRecordProjectionFromSnapshot(
  snapshot: ReplayDecisionSnapshot,
): KernelDecisionRecordProjection | null {
  if (
    snapshot.decisionRecordRoute === undefined ||
    snapshot.plannedLane === undefined ||
    snapshot.decisionRecordOperatorPresence === undefined ||
    snapshot.decisionRecordCurrentFrameId === undefined ||
    snapshot.decisionRecordCurrentEpisodeId === undefined ||
    snapshot.decisionRecordCandidateScore === undefined ||
    snapshot.decisionRecordValueComponents === undefined ||
    snapshot.decisionRecordReasons === undefined ||
    snapshot.decisionRecordReasonCodes === undefined
  ) {
    return null;
  }

  if (snapshot.decisionRecordProjectionVersion === KERNEL_DECISION_RECORD_PROJECTION_V1_VERSION) {
    return canonicalizeKernelDecisionRecordProjection({
      schema: KERNEL_DECISION_RECORD_PROJECTION_V1_SCHEMA,
      version: KERNEL_DECISION_RECORD_PROJECTION_V1_VERSION,
      route: snapshot.decisionRecordRoute,
      lane: snapshot.plannedLane,
      evidence: {
        operatorPresence: snapshot.decisionRecordOperatorPresence,
        currentFrameId: snapshot.decisionRecordCurrentFrameId,
        currentEpisodeId: snapshot.decisionRecordCurrentEpisodeId,
      },
      value: {
        candidateScore: snapshot.decisionRecordCandidateScore,
        components: sortNumberMap(snapshot.decisionRecordValueComponents),
      },
      reasons: snapshot.decisionRecordReasons,
      reasonCodes: snapshot.decisionRecordReasonCodes,
    });
  }

  if (
    snapshot.decisionRecordProjectionVersion !== KERNEL_DECISION_RECORD_PROJECTION_VERSION ||
    snapshot.resultLane === undefined
  ) {
    return null;
  }

  return canonicalizeKernelDecisionRecordProjection({
    schema: KERNEL_DECISION_RECORD_PROJECTION_SCHEMA,
    version: KERNEL_DECISION_RECORD_PROJECTION_VERSION,
    route: snapshot.decisionRecordRoute,
    plannedLane: snapshot.plannedLane,
    realizedLane: snapshot.resultLane,
    evidence: {
      operatorPresence: snapshot.decisionRecordOperatorPresence,
      currentFrameId: snapshot.decisionRecordCurrentFrameId,
      currentEpisodeId: snapshot.decisionRecordCurrentEpisodeId,
    },
    value: {
      candidateScore: snapshot.decisionRecordCandidateScore,
      components: sortNumberMap(snapshot.decisionRecordValueComponents),
    },
    reasons: snapshot.decisionRecordReasons,
    reasonCodes: snapshot.decisionRecordReasonCodes,
  });
}

export function canonicalizeKernelDecisionRecordProjection(
  projection: KernelDecisionRecordProjectionV1,
): KernelDecisionRecordProjectionV1;
export function canonicalizeKernelDecisionRecordProjection(
  projection: KernelDecisionRecordProjectionV2,
): KernelDecisionRecordProjectionV2;
export function canonicalizeKernelDecisionRecordProjection(
  projection: KernelDecisionRecordProjection,
): KernelDecisionRecordProjection;
export function canonicalizeKernelDecisionRecordProjection(
  projection: KernelDecisionRecordProjection,
): KernelDecisionRecordProjection {
  if (projection.version === KERNEL_DECISION_RECORD_PROJECTION_V1_VERSION) {
    return {
      schema: KERNEL_DECISION_RECORD_PROJECTION_V1_SCHEMA,
      version: KERNEL_DECISION_RECORD_PROJECTION_V1_VERSION,
      route: projection.route,
      lane: projection.lane,
      evidence: { ...projection.evidence },
      value: {
        candidateScore: projection.value.candidateScore,
        components: sortNumberMap(projection.value.components),
      },
      reasons: [...projection.reasons],
      reasonCodes: [...projection.reasonCodes].sort(compareKernelCanonicalKey),
    };
  }

  return {
    schema: KERNEL_DECISION_RECORD_PROJECTION_SCHEMA,
    version: KERNEL_DECISION_RECORD_PROJECTION_VERSION,
    route: projection.route,
    plannedLane: projection.plannedLane,
    realizedLane: projection.realizedLane,
    evidence: { ...projection.evidence },
    value: {
      candidateScore: projection.value.candidateScore,
      components: sortNumberMap(projection.value.components),
    },
    reasons: [...projection.reasons],
    reasonCodes: [...projection.reasonCodes].sort(compareKernelCanonicalKey),
  };
}

export function serializeKernelDecisionRecordProjection(
  projection: KernelDecisionRecordProjection,
): string {
  return serializeKernelCanonicalJson(canonicalizeKernelDecisionRecordProjection(projection));
}

export function fingerprintKernelDecisionRecordProjection(
  projection: KernelDecisionRecordProjection,
): KernelDecisionRecordFingerprint {
  const canonical = canonicalizeKernelDecisionRecordProjection(projection);
  const fingerprintInput = {
    schema: canonical.schema,
    version: canonical.version,
    route: canonical.route,
    ...(canonical.version === KERNEL_DECISION_RECORD_PROJECTION_V1_VERSION
      ? { lane: canonical.lane }
      : { plannedLane: canonical.plannedLane, realizedLane: canonical.realizedLane }),
    evidence: canonical.evidence,
    value: canonical.value,
    reasonCodes: canonical.reasonCodes,
  };

  return digestKernelCanonicalJson(fingerprintInput);
}

export function isKernelDecisionRecordFingerprint(
  value: unknown,
): value is KernelDecisionRecordFingerprint {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}

function sortNumberMap(value: Record<string, number | undefined>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, number] => typeof entry[1] === "number")
      .sort(([left], [right]) => compareKernelCanonicalKey(left, right)),
  );
}
