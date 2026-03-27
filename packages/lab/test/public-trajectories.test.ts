import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultImportedTrajectoryBundlePath,
  createScenarioFromSweSmithRow,
  createSessionBundleFromSweSmithRow,
  extractSweSmithMessageText,
  parseSweSmithMessages,
  parseSweSmithRowsResponse,
  runSessionBundle,
  type SweSmithRow,
} from "../src/index.js";

const SAMPLE_ROW: SweSmithRow = {
  instance_id: "example/repo-123",
  model: "claude-3-7-sonnet-20250219",
  resolved: true,
  traj_id: "example/repo-123.run-42",
  patch: "diff --git a/file.py b/file.py\nindex 111..222 100644\n--- a/file.py\n+++ b/file.py\n@@\n-print('bad')\n+print('good')\n",
  messages: JSON.stringify([
    {
      role: "system",
      content: "You are a helpful assistant that can interact with a computer to solve tasks.",
      agent: "main",
      message_type: "system_prompt",
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "We're currently solving the following issue within our repository. ISSUE:\nMoneyWidget crashes on invalid provider responses\nTraceback shows string indices must be integers.",
        },
      ],
      agent: "main",
      message_type: "observation",
    },
    {
      role: "assistant",
      content: "I'll reproduce the failure first.",
      thought: "Reproduce before patching.",
      action: "pytest tests/test_widget.py",
      agent: "main",
      tool_calls: [
        {
          index: 0,
          function: {
            name: "bash",
            arguments: "{\"command\":\"pytest tests/test_widget.py\"}",
          },
          id: "toolu_bash",
          type: "function",
        },
      ],
      message_type: "action",
    },
    {
      role: "tool",
      content: [
        {
          type: "text",
          text: "Traceback (most recent call last): TypeError: string indices must be integers",
        },
      ],
      agent: "main",
      tool_call_ids: ["toolu_bash"],
      message_type: "observation",
    },
    {
      role: "assistant",
      content: "I'll patch the provider handling now.",
      thought: "Apply the fix.",
      action: "apply_patch <<'PATCH' ...",
      agent: "main",
      tool_calls: [
        {
          index: 0,
          function: {
            name: "edit",
            arguments: "{\"path\":\"/testbed/provider.py\"}",
          },
          id: "toolu_edit",
          type: "function",
        },
      ],
      message_type: "action",
    },
    {
      role: "tool",
      content: [
        {
          type: "text",
          text: "Patch applied successfully.",
        },
      ],
      agent: "main",
      tool_call_ids: ["toolu_edit"],
      message_type: "observation",
    },
    {
      role: "assistant",
      content: "",
      thought: "Done.",
      action: "submit",
      agent: "main",
      tool_calls: [
        {
          index: 0,
          function: {
            name: "submit",
            arguments: "{}",
          },
          id: "toolu_submit",
          type: "function",
        },
      ],
      message_type: "action",
    },
  ]),
};

test("SWE-smith rows parse from dataset-style rows payloads", () => {
  const rows = parseSweSmithRowsResponse({
    rows: [
      { row: SAMPLE_ROW },
    ],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.traj_id, SAMPLE_ROW.traj_id);
});

test("SWE-smith message helpers preserve transcript text", () => {
  const messages = parseSweSmithMessages(SAMPLE_ROW);

  assert.equal(messages.length, 7);
  assert.equal(
    extractSweSmithMessageText(messages[1]!),
    "We're currently solving the following issue within our repository. ISSUE:\nMoneyWidget crashes on invalid provider responses\nTraceback shows string indices must be integers.",
  );
  assert.equal(
    extractSweSmithMessageText(messages[3]!),
    "Traceback (most recent call last): TypeError: string indices must be integers",
  );
});

test("SWE-smith rows map into replay scenarios with started, update, failure, and completion steps", () => {
  const scenario = createScenarioFromSweSmithRow(SAMPLE_ROW);

  assert.equal(scenario.steps.length, 6);
  assert.equal(scenario.steps[0]?.kind, "publishSource");
  assert.equal(scenario.steps[0]?.event.type, "task.started");
  assert.equal(scenario.steps[0]?.event.title, "MoneyWidget crashes on invalid provider responses");

  const bashAction = scenario.steps[1];
  assert.equal(bashAction?.kind, "publishSource");
  assert.equal(bashAction?.event.type, "task.updated");
  assert.equal(bashAction?.event.status, "running");
  assert.equal(bashAction?.event.toolFamily, "bash");

  const failedObservation = scenario.steps[2];
  assert.equal(failedObservation?.kind, "publishSource");
  assert.equal(failedObservation?.event.type, "task.updated");
  assert.equal(failedObservation?.event.status, "failed");
  assert.equal(failedObservation?.event.toolFamily, "bash");

  const completed = scenario.steps.at(-1);
  assert.equal(completed?.kind, "publishSource");
  assert.equal(completed?.event.type, "task.completed");
});

test("SWE-smith rows can become replayable session bundles", () => {
  const bundle = createSessionBundleFromSweSmithRow(SAMPLE_ROW);
  const replayed = runSessionBundle(bundle);

  assert.equal(bundle.steps.length, 6);
  assert.equal(bundle.normalizedEvents.length, 6);
  assert.equal(bundle.semanticSnapshots.length, 6);
  assert.equal(bundle.decisionSnapshots.length, 6);
  assert.equal(bundle.source?.id, "huggingface:swe-smith");
  assert.ok(bundle.source?.capture?.notes?.includes("split=tool"));
  assert.equal(replayed.views.at(-1)?.activeInteractionId, bundle.outcomes.finalActiveInteractionId);
  assert.equal(replayed.views.at(-1)?.queuedInteractionIds.length, bundle.outcomes.finalQueuedCount);
  assert.equal(replayed.views.at(-1)?.ambientInteractionIds.length, bundle.outcomes.finalAmbientCount);
});

test("SWE-smith imported bundle paths stay under the dataset and split tree", () => {
  const bundle = createSessionBundleFromSweSmithRow(SAMPLE_ROW);
  const filePath = defaultImportedTrajectoryBundlePath(bundle, "swe-smith", "tool", "/tmp/aperture-imports");

  assert.match(filePath, /\/tmp\/aperture-imports\/swe-smith\/tool\/public:swe-smith:example-repo-123-run-42\.json$/);
});
