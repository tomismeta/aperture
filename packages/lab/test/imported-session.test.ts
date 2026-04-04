import assert from "node:assert/strict";
import test from "node:test";

import {
  createReplayScenarioFromImportedSession,
  createSessionBundleFromImportedSession,
  runSessionBundle,
  type ImportedSession,
} from "../src/index.js";

test("canonical imported sessions compile only replayable source events into scenarios", () => {
  const session: ImportedSession = {
    schemaVersion: 1,
    sessionId: "imported:test-session",
    title: "Imported test session",
    importedAt: "2026-03-29T00:00:00.000Z",
    doctrineTags: ["public_seed"],
    source: {
      id: "test:import",
      kind: "public-dataset",
      label: "Test import",
      redacted: true,
    },
    entries: [
      {
        index: 0,
        timestamp: "2026-03-29T00:00:00.000Z",
        role: "system",
        kind: "message",
        significance: "context",
        text: "System prompt.",
      },
      {
        index: 1,
        timestamp: "2026-03-29T00:00:01.000Z",
        role: "user",
        kind: "message",
        significance: "attention",
        sourceEvent: {
          id: "imported:test-session:start",
          type: "task.started",
          taskId: "imported:test-session",
          timestamp: "2026-03-29T00:00:01.000Z",
          title: "Fix the importer",
        },
      },
      {
        index: 2,
        timestamp: "2026-03-29T00:00:02.000Z",
        role: "assistant",
        kind: "completion",
        significance: "attention",
        sourceEvent: {
          id: "imported:test-session:done",
          type: "task.completed",
          taskId: "imported:test-session",
          timestamp: "2026-03-29T00:00:02.000Z",
          summary: "Finished.",
        },
      },
    ],
  };

  const scenario = createReplayScenarioFromImportedSession(session);

  assert.equal(scenario.id, session.sessionId);
  assert.equal(scenario.steps.length, 2);
  assert.equal(scenario.steps[0]?.kind, "publishSource");
  assert.equal(scenario.steps[1]?.kind, "publishSource");
});

test("canonical imported sessions can become replayable session bundles", () => {
  const session: ImportedSession = {
    schemaVersion: 1,
    sessionId: "imported:test-bundle",
    title: "Imported bundle",
    importedAt: "2026-03-29T00:00:00.000Z",
    entries: [
      {
        index: 0,
        timestamp: "2026-03-29T00:00:00.000Z",
        role: "user",
        kind: "message",
        significance: "attention",
        sourceEvent: {
          id: "imported:test-bundle:start",
          type: "task.started",
          taskId: "imported:test-bundle",
          timestamp: "2026-03-29T00:00:00.000Z",
          title: "Investigate the failure",
        },
      },
      {
        index: 1,
        timestamp: "2026-03-29T00:00:01.000Z",
        role: "assistant",
        kind: "tool_call",
        significance: "attention",
        sourceEvent: {
          id: "imported:test-bundle:run",
          type: "task.updated",
          taskId: "imported:test-bundle",
          timestamp: "2026-03-29T00:00:01.000Z",
          toolFamily: "bash",
          title: "bash action",
          summary: "Running the repro.",
          status: "running",
        },
      },
      {
        index: 2,
        timestamp: "2026-03-29T00:00:02.000Z",
        role: "tool",
        kind: "tool_result",
        significance: "attention",
        sourceEvent: {
          id: "imported:test-bundle:fail",
          type: "task.updated",
          taskId: "imported:test-bundle",
          timestamp: "2026-03-29T00:00:02.000Z",
          toolFamily: "bash",
          title: "bash failure",
          summary: "Traceback...",
          status: "failed",
        },
      },
    ],
  };

  const bundle = createSessionBundleFromImportedSession(session);
  const replayed = runSessionBundle(bundle);

  assert.equal(bundle.steps.length, 3);
  assert.equal(bundle.normalizedEvents.length, 3);
  assert.equal(bundle.semanticSnapshots.length, 3);
  assert.equal(replayed.views.at(-1)?.nowInteractionId, bundle.outcomes.finalNowInteractionId);
});
