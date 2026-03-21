import assert from "node:assert/strict";
import test from "node:test";

import { runReplayScenario, scoreReplayRun, type ReplayScenario } from "../src/index.js";

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
  assert.equal(result.decisions[0]?.decisionKind, "activate");
  assert.equal(scorecard.signals.presented, 1);
  assert.equal(scorecard.signals.viewed, 1);
  assert.equal(scorecard.signals.responded, 1);
  assert.equal(scorecard.outcomes.finalActiveInteractionId, null);
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
  assert.equal(result.decisions.length, 1);
  assert.equal(result.semantics[0]?.interpretation.intentFrame, "question_request");
  assert.equal(result.decisions[0]?.semanticConfidence, "low");
  assert.equal(result.views[0]?.activeInteractionId, "interaction:source:1");
});
