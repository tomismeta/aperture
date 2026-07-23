import assert from "node:assert/strict";
import test from "node:test";

import { KERNEL_DECISION_RECORD_PROJECTION_VERSION } from "../src/artifact-versions.js";
import {
  normalizeReplayRun,
  runReplayScenario,
  scoreReplayRun,
  type ReplayScenario,
  isKernelDecisionRecordFingerprint,
} from "../src/index.js";
import type { ReplayCandidateTrace } from "../src/replay-trace.js";
import { buildDecisionRecordSnapshot } from "../src/runner.js";

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

test("replay runner captures frames, traces, responses, and final view state", () => {
  const scenario: ReplayScenario = {
    id: "replay:approval",
    title: "Approval replay",
    steps: [
      {
        kind: "publish",
        event: {
          id: "evt:approval",
          taskId: "task:deploy",
          timestamp: "2026-03-19T12:00:00.000Z",
          type: "human.input.requested",
          interactionId: "interaction:deploy:approval",
          title: "Approve deploy",
          summary: "A deploy needs approval.",
          consequence: "high",
          request: { kind: "approval" },
          metadata: {
            execution: {
              surface: "terminal",
              runner: "codex",
            },
            governance: {
              approvalState: "pending",
            },
            usage: {
              model: "gpt-5.4",
              inputTokens: 1200,
              outputTokens: 320,
              costUsd: 0.14,
            },
          },
        },
      },
      {
        kind: "markViewed",
        taskId: "task:deploy",
        interactionId: "interaction:deploy:approval",
        surface: "lab",
      },
      {
        kind: "submit",
        response: {
          taskId: "task:deploy",
          interactionId: "interaction:deploy:approval",
          response: { kind: "approved" },
        },
      },
    ],
  };

  const result = runReplayScenario(scenario);
  const scorecard = scoreReplayRun(result);

  assert.equal(result.steps.length, 3);
  assert.ok(result.steps[0]?.frame);
  assert.equal(result.responses.length, 1);
  assert.ok(result.traces.some((trace) => trace.evaluation.kind === "candidate"));
  assert.equal(result.decisions.length, 1);
  assert.equal(result.normalizedEvents.length, 0);
  assert.equal(result.decisions[0]?.decisionKind, "activate");
  assert.equal(scorecard.signals.presented, 1);
  assert.equal(scorecard.signals.viewed, 1);
  assert.equal(scorecard.signals.responded, 1);
  assert.equal(scorecard.outcomes.finalNowInteractionId, null);
  assert.equal(scorecard.workflow.present, true);
  assert.deepEqual(scorecard.workflow.surfaces, ["terminal"]);
  assert.deepEqual(scorecard.workflow.runners, ["codex"]);
  assert.deepEqual(scorecard.workflow.approvalStates, ["pending"]);
  assert.deepEqual(scorecard.workflow.models, ["gpt-5.4"]);
  assert.equal(scorecard.workflow.usageTotals.inputTokens, 1200);
  assert.equal(scorecard.workflow.usageTotals.outputTokens, 320);
  assert.equal(scorecard.workflow.usageTotals.costUsd, 0.14);
});

test("replay runner can exercise source-event normalization paths", () => {
  const scenario: ReplayScenario = {
    id: "replay:source",
    title: "Source event replay",
    steps: [
      {
        kind: "publishSource",
        event: {
          id: "src:1",
          taskId: "task:source",
          interactionId: "interaction:source:1",
          timestamp: "2026-03-19T12:05:00.000Z",
          source: {
            id: "paperclip",
            kind: "human",
            label: "Paperclip",
          },
          type: "human.input.requested",
          activityClass: "question_request",
          title: "Pick a budget override",
          summary: "A budget override is waiting.",
          request: {
            kind: "choice",
            selectionMode: "single",
            options: [
              { id: "500", label: "$500" },
              { id: "1000", label: "$1000" },
            ],
          },
        },
      },
    ],
  };

  const result = runReplayScenario(scenario);

  assert.equal(result.steps.length, 1);
  assert.ok(result.steps[0]?.frame);
  assert.equal(result.semantics.length, 1);
  assert.equal(result.normalizedEvents.length, 1);
  assert.equal(result.decisions.length, 1);
  assert.equal(result.semantics[0]?.interpretation.intentFrame, "question_request");
  assert.equal(result.semantics[0]?.ontology?.ask, "choice");
  assert.equal(result.semantics[0]?.ontology?.activity, "question");
  assert.equal(result.semantics[0]?.ontology?.blocking, "blocking");
  assert.equal(result.semantics[0]?.ontology?.source, "explicit");
  assert.equal(result.normalizedEvents[0]?.event.type, "human.input.requested");
  assert.equal(result.decisions[0]?.semanticConfidence, "low");
  assert.equal(result.views[0]?.nowInteractionId, "interaction:source:1");
});

test("normalized replay runs retain semantic and decision detail for determinism audits", () => {
  const scenario: ReplayScenario = {
    id: "replay:normalized-semantic-detail",
    title: "Normalized replay semantic detail",
    steps: [
      {
        kind: "publishSource",
        label: "question with tool context",
        event: {
          id: "src:semantic:1",
          taskId: "task:semantic",
          interactionId: "interaction:semantic:1",
          timestamp: "2026-03-27T21:00:00.000Z",
          source: { id: "paperclip", label: "Paperclip" },
          type: "human.input.requested",
          title: "Should we read the config first?",
          summary: "Choose the next step.",
          context: {
            items: [{ id: "toolFamily", label: "Tool Family", value: "read" }],
          },
          request: {
            kind: "choice",
            selectionMode: "single",
            options: [{ id: "yes", label: "Yes" }],
          },
        },
      },
    ],
  };

  const normalized = normalizeReplayRun(runReplayScenario(scenario));

  assert.equal(normalized.semantics.length, 1);
  assert.equal(normalized.decisions.length, 1);
  assert.equal(normalized.semantics[0]?.toolFamily, "read");
  assert.equal(normalized.semantics[0]?.ontology?.ask, "choice");
  assert.equal(normalized.semantics[0]?.ontology?.source, "explicit");
  assert.equal(normalized.semantics[0]?.provenance.toolFamily, "source");
  assert.deepEqual(normalized.decisions[0]?.semanticImpactDecisionBearing, [
    "activity (canonical)",
    "consequence (canonical)",
  ]);
  assert.equal(
    normalized.decisions[0]?.decisionRecordProjectionVersion,
    KERNEL_DECISION_RECORD_PROJECTION_VERSION,
  );
  assert.equal(normalized.decisions[0]?.decisionRecordRoute, "activate");
  assert.equal(normalized.decisions[0]?.plannedLane, "now");
  assert.equal(normalized.decisions[0]?.decisionRecordOperatorPresence, "present");
  assert.equal(normalized.decisions[0]?.decisionRecordCandidateScore, 1211);
  assert.equal(normalized.decisions[0]?.decisionRecordValueComponents.blocking, 1000);
  assert.ok(normalized.decisions[0]?.decisionRecordReasonCodes.includes("route:activate"));
  assert.ok(isKernelDecisionRecordFingerprint(normalized.decisions[0]?.decisionRecordFingerprint));
  assert.ok(
    normalized.decisions[0]?.semanticInfluence.includes(
      "tool family stayed context-only on the question/form path",
    ),
  );
});

test("replay decision snapshots apply strict claimScore precedence", () => {
  const legacy = buildDecisionRecordSnapshot(
    createDecisionRecordTrace({
      candidateScore: 1,
      breakdown: { components: { priority: 1 } },
    }),
  );
  const current = buildDecisionRecordSnapshot(
    createDecisionRecordTrace({
      claimScore: 2,
      candidateScore: 1,
      breakdown: { components: { priority: 2 } },
    }),
  );
  const malformedCurrent = buildDecisionRecordSnapshot(
    createDecisionRecordTrace({
      claimScore: "bad",
      candidateScore: 1,
      breakdown: { components: { priority: 1 } },
    } as never),
  );
  const malformedComponents = buildDecisionRecordSnapshot(
    createDecisionRecordTrace({
      claimScore: 1,
      breakdown: {
        components: {
          priority: 1,
          contextCost: Number.NaN,
        },
      },
    }),
  );

  assert.equal(legacy.decisionRecordCandidateScore, 1);
  assert.equal(current.decisionRecordCandidateScore, 2);
  assert.deepEqual(malformedCurrent, {});
  assert.deepEqual(malformedComponents, {});
});

function createDecisionRecordTrace(
  value: NonNullable<ReplayCandidateTrace["decisionRecord"]>["value"],
): ReplayCandidateTrace {
  return {
    coordination: { resultLane: "next" },
    decisionRecord: {
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
      value,
    },
  } as unknown as ReplayCandidateTrace;
}
