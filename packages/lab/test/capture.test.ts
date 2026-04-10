import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createCaptureReviewArtifacts,
  writeCaptureReviewArtifacts,
  writeSessionBundleReviewArtifact,
  type RuntimeSessionCaptureLike,
} from "../src/capture.js";

function explanationSnapshot(
  value: Partial<NonNullable<RuntimeSessionCaptureLike["currentExplanation"]>>,
): NonNullable<RuntimeSessionCaptureLike["currentExplanation"]> {
  return {
    targetInteractionId: null,
    targetLane: "none",
    headline: null,
    whyNow: null,
    routingAuthority: null,
    semanticImpact: null,
    semanticInfluence: [],
    coordinationReasons: [],
    plannerReasons: [],
    policyRationale: [],
    criterionRationale: [],
    continuityRationale: [],
    attentionRationale: [],
    ...value,
  };
}

test("createCaptureReviewArtifacts builds a session bundle and offline review artifact from a runtime capture", () => {
  const capture: RuntimeSessionCaptureLike = {
    runtimeId: "runtime:live:test",
    kind: "aperture",
    startedAt: "2026-04-10T03:00:00.000Z",
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
    adapters: [],
    currentExplanation: explanationSnapshot({
      targetInteractionId: "interaction:task:live:failed:status",
      targetLane: "now",
      headline: "Work has failed and should be reviewed.",
      whyNow: "Work has failed and should be reviewed.",
      routingAuthority: "status",
    }),
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

test("writeCaptureReviewArtifacts persists both bundle and artifact paths", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aperture-capture-review-"));
  const capture: RuntimeSessionCaptureLike = {
    runtimeId: "runtime:live:test",
    kind: "aperture",
    startedAt: "2026-04-10T03:00:00.000Z",
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
        title: "Build failed",
        summary: "The latest build failed and may need a retry.",
        status: "failed",
      },
    ],
    submittedResponses: [],
    signals: [],
    traces: [],
    attentionViewSnapshots: [],
    currentAttentionView: {
      now: null,
      next: [],
      ambient: [],
    },
    adapters: [],
    currentExplanation: explanationSnapshot({}),
  };

  const bundlePath = path.join(tempDir, "bundle.json");
  const artifactPath = path.join(tempDir, "artifact.json");
  const result = await writeCaptureReviewArtifacts(capture, {
    sessionId: "session:write:capture",
    title: "Writable capture",
    bundlePath,
    artifactPath,
  });

  const writtenBundle = JSON.parse(await readFile(bundlePath, "utf8")) as { sessionId: string };
  const writtenArtifact = JSON.parse(await readFile(artifactPath, "utf8")) as {
    bundle: { sessionId: string; bundlePath?: string };
  };

  assert.equal(result.bundlePath, bundlePath);
  assert.equal(result.artifactPath, artifactPath);
  assert.equal(writtenBundle.sessionId, "session:write:capture");
  assert.equal(writtenArtifact.bundle.sessionId, "session:write:capture");
  assert.equal(writtenArtifact.bundle.bundlePath, bundlePath);
});

test("writeSessionBundleReviewArtifact prepares an artifact from an existing bundle", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aperture-bundle-review-"));
  const bundlePath = path.join(tempDir, "bundle.json");
  const artifactPath = path.join(tempDir, "artifact.json");
  const capture: RuntimeSessionCaptureLike = {
    runtimeId: "runtime:live:test",
    kind: "aperture",
    startedAt: "2026-04-10T03:00:00.000Z",
    exportedAt: "2026-04-10T03:05:00.000Z",
    captureSteps: [
      {
        sequence: 1,
        recordedAt: "2026-04-10T03:00:00.000Z",
        kind: "publishSource",
        event: {
          id: "src:live:waiting",
          type: "task.updated",
          taskId: "task:live:waiting",
          timestamp: "2026-04-10T03:00:00.000Z",
          title: "Waiting on approval",
          summary: "Still waiting on a human decision.",
          status: "waiting",
        },
      },
    ],
    publishedSourceEvents: [
      {
        id: "src:live:waiting",
        type: "task.updated",
        taskId: "task:live:waiting",
        timestamp: "2026-04-10T03:00:00.000Z",
        title: "Waiting on approval",
        summary: "Still waiting on a human decision.",
        status: "waiting",
      },
    ],
    submittedResponses: [],
    signals: [],
    traces: [],
    attentionViewSnapshots: [],
    currentAttentionView: {
      now: null,
      next: [
        { interactionId: "interaction:task:live:waiting:status" } as never,
      ],
      ambient: [],
    },
    adapters: [],
    currentExplanation: explanationSnapshot({
      targetInteractionId: "interaction:task:live:waiting:status",
      targetLane: "next",
      headline: "Waiting work is queued behind current attention.",
      whyNow: "Waiting work is queued behind current attention.",
      routingAuthority: "status",
    }),
  };

  await writeCaptureReviewArtifacts(capture, {
    sessionId: "session:bundle:review",
    title: "Bundle review source",
    bundlePath,
  });

  const result = await writeSessionBundleReviewArtifact(bundlePath, {
    artifactPath,
    focusAreas: ["status", "blocking", "confidence"],
  });
  const writtenArtifact = JSON.parse(await readFile(artifactPath, "utf8")) as {
    bundle: { sessionId: string; explanation?: { headline?: string } };
    focusAreas: string[];
  };

  assert.equal(result.bundle.sessionId, "session:bundle:review");
  assert.equal(result.artifactPath, artifactPath);
  assert.deepEqual(result.artifact.focusAreas, ["status", "blocking", "confidence"]);
  assert.equal(writtenArtifact.bundle.sessionId, "session:bundle:review");
  assert.equal(
    writtenArtifact.bundle.explanation?.headline,
    "Waiting work is queued behind current attention.",
  );
});
