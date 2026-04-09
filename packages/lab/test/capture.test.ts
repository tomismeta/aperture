import assert from "node:assert/strict";
import test from "node:test";

import {
  createCaptureReviewArtifacts,
  type RuntimeSessionCaptureLike,
} from "../src/capture.js";

test("createCaptureReviewArtifacts builds a session bundle and offline review artifact from a runtime capture", () => {
  const capture: RuntimeSessionCaptureLike = {
    runtimeId: "runtime:live:test",
    kind: "aperture",
    exportedAt: "2026-04-10T03:05:00.000Z",
    captureSteps: [
      {
        sequence: 1,
        recordedAt: "2026-04-10T03:00:00.000Z",
        kind: "publishSource",
        event: {
          id: "src:live:failed",
          type: "task.updated",
          taskId: "task:live:failed",
          timestamp: "2026-04-10T03:00:00.000Z",
          source: { id: "custom-agent", label: "Custom Agent" },
          title: "Build failed",
          summary: "The latest build failed and may need a retry.",
          status: "failed",
        },
      },
    ],
    publishedSourceEvents: [
      {
        id: "src:live:failed",
        type: "task.updated",
        taskId: "task:live:failed",
        timestamp: "2026-04-10T03:00:00.000Z",
        source: { id: "custom-agent", label: "Custom Agent" },
        title: "Build failed",
        summary: "The latest build failed and may need a retry.",
        status: "failed",
      },
    ],
    submittedResponses: [],
    signals: [],
    traces: [],
    attentionViewSnapshots: [
      {
        sequence: 1,
        recordedAt: "2026-04-10T03:00:02.000Z",
        attentionView: {
          now: { interactionId: "interaction:task:live:failed:status" } as never,
          next: [],
          ambient: [],
        },
      },
    ],
    currentAttentionView: {
      now: { interactionId: "interaction:task:live:failed:status" } as never,
      next: [],
      ambient: [],
    },
    currentExplanation: {
      targetInteractionId: "interaction:task:live:failed:status",
      targetLane: "now",
      headline: "Work has failed and should be reviewed.",
      whyNow: "Work has failed and should be reviewed.",
      routingAuthority: "status",
    },
  };

  const result = createCaptureReviewArtifacts(capture, {
    sessionId: "session:live:failed",
    title: "Live failure capture",
    doctrineTags: ["captured", "debug"],
    bundlePath: "/tmp/live-failure-bundle.json",
    focusAreas: ["title", "status", "consequence"],
    rubricVersion: "capture-review-v1",
    generatedAt: "2026-04-10T03:06:00.000Z",
    source: {
      id: "aperture",
      kind: "runtime",
      label: "Aperture runtime",
    },
  });

  assert.equal(result.bundle.sessionId, "session:live:failed");
  assert.equal(result.bundle.title, "Live failure capture");
  assert.deepEqual(result.bundle.doctrineTags, ["captured", "debug"]);
  assert.equal(result.bundle.explanation?.headline, "Work has failed and should be reviewed.");
  assert.equal(result.bundle.explanation?.targetLane, "now");
  assert.equal(result.bundle.outcomes.finalNowInteractionId, "interaction:task:live:failed:status");

  assert.equal(result.artifact.bundle.sessionId, "session:live:failed");
  assert.equal(result.artifact.bundle.bundlePath, "/tmp/live-failure-bundle.json");
  assert.equal(result.artifact.bundle.explanation?.routingAuthority, "status");
  assert.deepEqual(result.artifact.focusAreas, ["title", "status", "consequence"]);
  assert.equal(result.artifact.rubricVersion, "capture-review-v1");
  assert.equal(result.artifact.generatedAt, "2026-04-10T03:06:00.000Z");
  assert.equal(result.artifact.steps[0]?.sourceEvent?.status, "failed");
});
