import assert from "node:assert/strict";
import test from "node:test";

import { KERNEL_DECISION_RECORD_PROJECTION_VERSION } from "../src/artifact-versions.js";
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
