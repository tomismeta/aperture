import assert from "node:assert/strict";
import test from "node:test";

import { readTaskFailureSemanticEvidence } from "@tomismeta/aperture-core/internal";

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

test("imported tool-result replay refreshes stale clipped summaries from full text", () => {
  const fullToolText = [
    "/repo/node_modules/tsx/dist/register.cjs:3",
    "const loader = true; ".repeat(120),
    "Error: Cannot find module './packages/tui/src/keys.js'",
    "Require stack:",
    "- /repo/[eval]",
    "Node.js v25.2.1",
    "Command exited with code 1",
  ].join("\n");
  const session: ImportedSession = {
    schemaVersion: 1,
    sessionId: "imported:stale-tool-summary",
    title: "Imported stale tool summary",
    importedAt: "2026-03-29T00:00:00.000Z",
    entries: [
      {
        index: 0,
        timestamp: "2026-03-29T00:00:00.000Z",
        role: "tool",
        kind: "tool_result",
        significance: "attention",
        text: fullToolText,
        sourceEvent: {
          id: "imported:stale-tool-summary:tool",
          type: "task.updated",
          taskId: "imported:stale-tool-summary",
          timestamp: "2026-03-29T00:00:00.000Z",
          toolFamily: "bash",
          title: "bash failure",
          summary: "/repo/node_modules/tsx/dist/register.cjs:3 const loader = true...",
          status: "failed",
        },
      },
    ],
  };

  const scenario = createReplayScenarioFromImportedSession(session);
  const event = scenario.steps[0]?.kind === "publishSource" ? scenario.steps[0].event : undefined;

  assert.equal(event?.type, "task.updated");
  assert.match(event?.summary ?? "", /Cannot find module '\.\/packages\/tui\/src\/keys\.js'/);
  assert.equal(readTaskFailureSemanticEvidence(event)?.kind, "terminal_failure");
});

test("imported command-family tool-result replay refreshes stale clipped summaries from full text", () => {
  const fullToolText = [
    "/repo/node_modules/tsx/dist/register.cjs:3",
    "const loader = true; ".repeat(120),
    "Error: Cannot find module './packages/core/src/index.js'",
    "Require stack:",
    "- /repo/[eval]",
    "Node.js v25.2.1",
    "Command exited with code 1",
  ].join("\n");
  const session: ImportedSession = {
    schemaVersion: 1,
    sessionId: "imported:stale-exec-command-summary",
    title: "Imported stale exec command summary",
    importedAt: "2026-03-29T00:00:00.000Z",
    entries: [
      {
        index: 0,
        timestamp: "2026-03-29T00:00:00.000Z",
        role: "tool",
        kind: "tool_result",
        significance: "attention",
        text: fullToolText,
        sourceEvent: {
          id: "imported:stale-exec-command-summary:tool",
          type: "task.updated",
          taskId: "imported:stale-exec-command-summary",
          timestamp: "2026-03-29T00:00:00.000Z",
          toolFamily: "exec_command",
          title: "exec_command failure",
          summary: "/repo/node_modules/tsx/dist/register.cjs:3 const loader = true...",
          status: "failed",
        },
      },
    ],
  };

  const scenario = createReplayScenarioFromImportedSession(session);
  const event = scenario.steps[0]?.kind === "publishSource" ? scenario.steps[0].event : undefined;

  assert.equal(event?.type, "task.updated");
  assert.equal(event?.toolFamily, "bash");
  assert.match(event?.summary ?? "", /Cannot find module '\.\/packages\/core\/src\/index\.js'/);
  assert.equal(readTaskFailureSemanticEvidence(event)?.kind, "terminal_failure");
});

test("imported tool-result replay does not refresh clipped non-failed summaries", () => {
  const session: ImportedSession = {
    schemaVersion: 1,
    sessionId: "imported:running-tool-summary",
    title: "Imported running tool summary",
    importedAt: "2026-03-29T00:00:00.000Z",
    entries: [
      {
        index: 0,
        timestamp: "2026-03-29T00:00:00.000Z",
        role: "tool",
        kind: "tool_result",
        significance: "attention",
        text: `${"progress output ".repeat(120)}Command exited with code 1`,
        sourceEvent: {
          id: "imported:running-tool-summary:tool",
          type: "task.updated",
          taskId: "imported:running-tool-summary",
          timestamp: "2026-03-29T00:00:00.000Z",
          toolFamily: "bash",
          title: "bash update",
          summary: "progress output...",
          status: "running",
        },
      },
    ],
  };

  const scenario = createReplayScenarioFromImportedSession(session);
  const event = scenario.steps[0]?.kind === "publishSource" ? scenario.steps[0].event : undefined;

  assert.equal(event?.type, "task.updated");
  assert.equal(event?.summary, "progress output...");
});

test("imported tool-result replay does not refresh failed read summaries", () => {
  const session: ImportedSession = {
    schemaVersion: 1,
    sessionId: "imported:read-tool-summary",
    title: "Imported read tool summary",
    importedAt: "2026-03-29T00:00:00.000Z",
    entries: [
      {
        index: 0,
        timestamp: "2026-03-29T00:00:00.000Z",
        role: "tool",
        kind: "tool_result",
        significance: "attention",
        text: `${"source excerpt ".repeat(120)}[169 more lines in file. Use offset=110 to continue]`,
        sourceEvent: {
          id: "imported:read-tool-summary:tool",
          type: "task.updated",
          taskId: "imported:read-tool-summary",
          timestamp: "2026-03-29T00:00:00.000Z",
          toolFamily: "read",
          title: "read failure",
          summary: "source excerpt...",
          status: "failed",
        },
      },
    ],
  };

  const scenario = createReplayScenarioFromImportedSession(session);
  const event = scenario.steps[0]?.kind === "publishSource" ? scenario.steps[0].event : undefined;

  assert.equal(event?.type, "task.updated");
  assert.equal(event?.summary, "source excerpt...");
});

test("imported tool-result replay refreshes oversized stale summaries with bounded text", () => {
  const fullToolText = `${"source context ".repeat(700)}Command exited with code 1`;
  const session: ImportedSession = {
    schemaVersion: 1,
    sessionId: "imported:oversized-tool-summary",
    title: "Imported oversized tool summary",
    importedAt: "2026-03-29T00:00:00.000Z",
    entries: [
      {
        index: 0,
        timestamp: "2026-03-29T00:00:00.000Z",
        role: "tool",
        kind: "tool_result",
        significance: "attention",
        text: fullToolText,
        sourceEvent: {
          id: "imported:oversized-tool-summary:tool",
          type: "task.updated",
          taskId: "imported:oversized-tool-summary",
          timestamp: "2026-03-29T00:00:00.000Z",
          toolFamily: "bash",
          title: "bash failure",
          summary: "source context...",
          status: "failed",
        },
      },
    ],
  };

  const scenario = createReplayScenarioFromImportedSession(session);
  const event = scenario.steps[0]?.kind === "publishSource" ? scenario.steps[0].event : undefined;

  assert.equal(event?.type, "task.updated");
  assert.notEqual(event?.summary, "source context...");
  assert.match(event?.summary ?? "", / \.\.\. /);
  assert.match(event?.summary ?? "", /Command exited with code 1$/);
  assert.ok((event?.summary?.length ?? Infinity) < fullToolText.length);
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
