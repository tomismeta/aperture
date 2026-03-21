import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createSessionBundle,
  defaultSessionBundlePath,
  loadSessionBundles,
  runReplayScenario,
  runSessionBundle,
  type ReplayScenario,
  writeSessionBundle,
} from "../src/index.js";

test("session bundles capture replay outputs and normalized source events", () => {
  const scenario: ReplayScenario = {
    id: "bundle:source",
    title: "Source bundle replay",
    description: "Replay a source event and preserve the normalized event.",
    doctrineTags: ["semantic_normalization"],
    steps: [
      {
        kind: "publishSource",
        label: "source choice",
        event: {
          id: "src:bundle:1",
          taskId: "task:bundle",
          interactionId: "interaction:bundle:1",
          timestamp: "2026-03-21T18:30:00.000Z",
          source: {
            id: "paperclip",
            kind: "human",
            label: "Paperclip",
          },
          type: "human.input.requested",
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
  const bundle = createSessionBundle(result, {
    sessionId: "session:bundle:source",
    source: {
      id: "paperclip",
      kind: "plugin",
      label: "Paperclip",
      redacted: true,
    },
    exportedAt: "2026-03-21T18:31:00.000Z",
  });

  assert.equal(bundle.sessionId, "session:bundle:source");
  assert.equal(bundle.title, scenario.title);
  assert.equal(bundle.steps.length, 1);
  assert.equal(bundle.normalizedEvents.length, 1);
  assert.equal(bundle.normalizedEvents[0]?.event.type, "human.input.requested");
  assert.equal(bundle.semanticSnapshots.length, 1);
  assert.equal(bundle.decisionSnapshots.length, 1);
  assert.equal(bundle.outcomes.finalActiveInteractionId, "interaction:bundle:1");
});

test("session bundles can replay back into the same final attention outcome", () => {
  const scenario: ReplayScenario = {
    id: "bundle:roundtrip",
    title: "Roundtrip bundle replay",
    steps: [
      {
        kind: "publish",
        event: {
          id: "evt:bundle:approval",
          taskId: "task:bundle:approval",
          timestamp: "2026-03-21T18:32:00.000Z",
          type: "human.input.requested",
          interactionId: "interaction:bundle:approval",
          title: "Approve deploy",
          summary: "A deploy needs approval.",
          consequence: "high",
          request: { kind: "approval" },
        },
      },
      {
        kind: "publishSource",
        event: {
          id: "evt:bundle:status",
          type: "task.updated",
          taskId: "task:bundle:status",
          timestamp: "2026-03-21T18:32:10.000Z",
          source: { id: "custom-agent" },
          title: "Build failed",
          summary: "The latest build failed and may need a retry.",
          status: "failed",
          semanticHints: {
            confidence: "low",
          },
        },
      },
    ],
  };

  const result = runReplayScenario(scenario);
  const bundle = createSessionBundle(result, {
    sessionId: "session:bundle:roundtrip",
    exportedAt: "2026-03-21T18:33:00.000Z",
  });
  const replayed = runSessionBundle(bundle);

  assert.deepEqual(
    replayed.views.at(-1)?.attentionView,
    result.views.at(-1)?.attentionView,
  );
  assert.deepEqual(replayed.decisions, result.decisions);
});

test("session bundles can be written to disk and loaded back", async () => {
  const scenario: ReplayScenario = {
    id: "bundle:disk",
    title: "Disk bundle replay",
    steps: [
      {
        kind: "publish",
        event: {
          id: "evt:bundle:disk",
          taskId: "task:bundle:disk",
          timestamp: "2026-03-21T18:34:00.000Z",
          type: "human.input.requested",
          interactionId: "interaction:bundle:disk",
          title: "Approve cleanup",
          summary: "Cleanup is waiting for approval.",
          consequence: "medium",
          request: { kind: "approval" },
        },
      },
    ],
  };

  const result = runReplayScenario(scenario);
  const bundle = createSessionBundle(result, {
    sessionId: "session:bundle:disk",
    exportedAt: "2026-03-21T18:35:00.000Z",
  });

  const directory = await mkdtemp(path.join(os.tmpdir(), "aperture-bundles-"));
  const filePath = defaultSessionBundlePath(bundle, directory);

  await writeSessionBundle(filePath, bundle);

  const raw = JSON.parse(await readFile(filePath, "utf8")) as { sessionId: string };
  const loaded = await loadSessionBundles(directory);

  assert.equal(raw.sessionId, bundle.sessionId);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0]?.sessionId, bundle.sessionId);
  assert.equal(loaded[0]?.outcomes.finalActiveInteractionId, bundle.outcomes.finalActiveInteractionId);
});
