import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createFStopSessionFromSessionBundle,
  createSessionBundleFromFStopSession,
  defaultFStopSessionFilePath,
  FSTOP_SESSION_SCHEMA_VERSION,
  loadFStopSessionFile,
  loadReplayBundleFromFStopInputFile,
  validateFStopSession,
  writeFStopSessionFile,
  type FStopSession,
} from "../src/index.js";

test("F-Stop session files validate, write, and load cleanly", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aperture-fstop-session-"));
  const session: FStopSession = {
    schemaVersion: FSTOP_SESSION_SCHEMA_VERSION,
    sessionId: "fstop:test-session",
    traceId: "trace:test-session",
    title: "Test session",
    importedAt: "2026-03-29T00:00:00.000Z",
    source: {
      id: "test:source",
      kind: "fixture",
      label: "Fixture source",
      redacted: true,
    },
    entries: [
      {
        index: 0,
        timestamp: "2026-03-29T00:00:00.000Z",
        entryId: "entry-0",
        role: "user",
        kind: "message",
        significance: "attention",
        text: "Inspect the failing command.",
        sourceEvent: {
          id: "fstop:test-session:start",
          type: "task.started",
          taskId: "fstop:test-session",
          timestamp: "2026-03-29T00:00:00.000Z",
          title: "Inspect the failing command",
        },
      },
    ],
  };

  assert.ok(validateFStopSession(session));

  const filePath = defaultFStopSessionFilePath(session, directory);
  await writeFStopSessionFile(filePath, session);
  const loaded = await loadFStopSessionFile(filePath);
  const bundle = createSessionBundleFromFStopSession(loaded);

  assert.equal(loaded.sessionId, session.sessionId);
  assert.equal(bundle.sessionId, session.sessionId);
  assert.equal(bundle.steps.length, 1);
});

test("F-Stop session files can be derived from replay bundles and loaded as generic replay input", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aperture-fstop-session-bundle-"));
  const session: FStopSession = {
    schemaVersion: FSTOP_SESSION_SCHEMA_VERSION,
    sessionId: "fstop:test-bundle-session",
    title: "Bundle session",
    importedAt: "2026-03-29T00:00:00.000Z",
    entries: [
      {
        index: 0,
        timestamp: "2026-03-29T00:00:00.000Z",
        role: "user",
        kind: "message",
        significance: "attention",
        label: "issue prompt",
        sourceEvent: {
          id: "fstop:test-bundle-session:start",
          type: "task.started",
          taskId: "fstop:test-bundle-session",
          timestamp: "2026-03-29T00:00:00.000Z",
          title: "Inspect the failing command",
        },
      },
      {
        index: 1,
        timestamp: "2026-03-29T00:00:01.000Z",
        role: "tool",
        kind: "tool_result",
        significance: "attention",
        label: "pytest failure",
        toolFamily: "bash",
        sourceEvent: {
          id: "fstop:test-bundle-session:tool:1",
          type: "task.updated",
          taskId: "fstop:test-bundle-session",
          timestamp: "2026-03-29T00:00:01.000Z",
          title: "Pytest failure",
          status: "failed",
          toolFamily: "bash",
          summary: "Traceback: assertion failed",
        },
      },
    ],
  };

  const bundle = createSessionBundleFromFStopSession(session);
  const roundTripped = createFStopSessionFromSessionBundle(bundle);
  const filePath = defaultFStopSessionFilePath(roundTripped, directory).replace(/\.json$/, ".fstop-session.json");
  await writeFStopSessionFile(filePath, roundTripped);

  const loaded = await loadReplayBundleFromFStopInputFile(filePath);
  assert.equal(loaded.sessionId, bundle.sessionId);
  assert.equal(loaded.steps.length, bundle.steps.length);
});
