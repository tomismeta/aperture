import assert from "node:assert/strict";
import test from "node:test";

import {
  KERNEL_DECISION_RECORD_PROJECTION_V1_VERSION,
  KERNEL_DECISION_RECORD_PROJECTION_VERSION,
} from "../src/artifact-versions.js";
import {
  buildKernelDecisionRecordProjection,
  buildKernelDecisionRecordProjectionFromSnapshot,
} from "../src/index.js";
import { validateReplayDecisionSnapshot } from "../src/validation-replay-decision.js";

const VALID_REASON_CODES = [
  "route:queue",
  "lane:next",
  "policy:minimum_lane:next",
  "pressure:level:steady",
  "pressure:overload:low",
  "evidence:operator_presence:present",
  "evidence:current_frame:absent",
  "evidence:current_episode:absent",
];

const VALID_SNAPSHOT = {
  stepIndex: 0,
  stepKind: "publish",
  evaluationKind: "candidate",
  decisionKind: "queue",
  decisionRecordProjectionVersion: KERNEL_DECISION_RECORD_PROJECTION_VERSION,
  decisionRecordRoute: "queue",
  plannedLane: "next",
  resultLane: "next",
  decisionRecordCurrentFrameId: null,
  decisionRecordCurrentEpisodeId: null,
  decisionRecordOperatorPresence: "present",
  decisionRecordCandidateScore: 1,
  decisionRecordValueComponents: { priority: 1 },
  decisionRecordReasons: [],
  decisionRecordReasonCodes: VALID_REASON_CODES,
};

test("kernel decision projection rejects non-finite candidate scores", () => {
  for (const decisionRecordCandidateScore of [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ]) {
    assert.equal(
      validateReplayDecisionSnapshot({
        ...VALID_SNAPSHOT,
        decisionRecordCandidateScore,
      }),
      null,
    );
  }
});

test("kernel decision projection rejects non-finite value components", () => {
  for (const badComponent of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.equal(
      validateReplayDecisionSnapshot({
        ...VALID_SNAPSHOT,
        decisionRecordValueComponents: {
          priority: 1,
          badComponent,
        },
      }),
      null,
    );
  }
});

test("kernel decision projection keeps v1 readable and requires v2 realized lane", () => {
  assert.ok(
    validateReplayDecisionSnapshot({
      ...VALID_SNAPSHOT,
      decisionRecordProjectionVersion: KERNEL_DECISION_RECORD_PROJECTION_V1_VERSION,
      resultLane: undefined,
    }),
  );
  assert.equal(validateReplayDecisionSnapshot({ ...VALID_SNAPSHOT, resultLane: undefined }), null);
});

test("kernel decision projection rejects malformed snapshot components directly", () => {
  assert.equal(
    buildKernelDecisionRecordProjectionFromSnapshot({
      ...VALID_SNAPSHOT,
      decisionRecordValueComponents: {
        priority: 1,
        contextCost: undefined,
      },
    } as never),
    null,
  );
});

test("kernel decision projection rejects non-finite snapshot scores directly", () => {
  for (const decisionRecordCandidateScore of [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ]) {
    assert.equal(
      buildKernelDecisionRecordProjectionFromSnapshot({
        ...VALID_SNAPSHOT,
        decisionRecordCandidateScore,
      } as never),
      null,
    );
  }
});

test("kernel decision projection rejects malformed claimScore without legacy fallback", () => {
  const legacyProjection = buildKernelDecisionRecordProjection(
    {
      planning: {
        route: "queue",
        plannedLane: "next",
        reasons: [],
        reasonCodes: VALID_REASON_CODES,
      },
      evidenceSnapshot: {
        operatorPresence: "present",
        currentFrameId: null,
        currentEpisodeId: null,
      },
      value: {
        candidateScore: 1,
        breakdown: { components: { priority: 1 } },
      },
    },
    { realizedLane: "next" },
  );
  const malformedNewProjection = buildKernelDecisionRecordProjection(
    {
      planning: {
        route: "queue",
        plannedLane: "next",
        reasons: [],
        reasonCodes: VALID_REASON_CODES,
      },
      evidenceSnapshot: {
        operatorPresence: "present",
        currentFrameId: null,
        currentEpisodeId: null,
      },
      value: {
        claimScore: "bad",
        candidateScore: 1,
        breakdown: { components: { priority: 1 } },
      },
    } as never,
    { realizedLane: "next" },
  );

  assert.equal(legacyProjection?.value.candidateScore, 1);
  assert.equal(malformedNewProjection, null);
});

test("kernel decision projection rejects malformed value components without sanitizing", () => {
  const projection = buildKernelDecisionRecordProjection(
    {
      planning: {
        route: "queue",
        plannedLane: "next",
        reasons: [],
        reasonCodes: VALID_REASON_CODES,
      },
      evidenceSnapshot: {
        operatorPresence: "present",
        currentFrameId: null,
        currentEpisodeId: null,
      },
      value: {
        claimScore: 1,
        breakdown: {
          components: {
            priority: 1,
            contextCost: Number.NaN,
          },
        },
      },
    },
    { realizedLane: "next" },
  );

  assert.equal(projection, null);
});
