import assert from "node:assert/strict";
import test from "node:test";

import type { AttentionFrame as Frame, AttentionView } from "@tomismeta/aperture-core";

import { buildSurfaceAttentionView } from "../src/surface-view.js";

function makeFrame(overrides: Partial<Frame> = {}): Frame {
  return {
    id: "frame-1",
    taskId: "task-1",
    interactionId: "interaction-1",
    version: 1,
    mode: "status",
    tone: "ambient",
    consequence: "low",
    title: "Session running",
    timing: {
      createdAt: "2026-03-18T10:00:00.000Z",
      updatedAt: "2026-03-18T10:00:00.000Z",
    },
    responseSpec: { kind: "none" },
    ...overrides,
  };
}

test("buildSurfaceAttentionView drops stale passive ambient status frames", () => {
  const attentionView: AttentionView = {
    active: null,
    queued: [],
    ambient: [
      makeFrame(),
      makeFrame({
        id: "frame-2",
        interactionId: "interaction-2",
        title: "Recent session running",
        timing: {
          createdAt: "2026-03-18T10:04:30.000Z",
          updatedAt: "2026-03-18T10:04:30.000Z",
        },
      }),
    ],
  };

  const filtered = buildSurfaceAttentionView(attentionView, {
    nowMs: Date.parse("2026-03-18T10:06:00.000Z"),
    ambientStaleMs: 5 * 60 * 1000,
  });

  assert.equal(filtered.ambient.length, 1);
  assert.equal(filtered.ambient[0]?.interactionId, "interaction-2");
});

test("buildSurfaceAttentionView keeps actionable ambient frames even when old", () => {
  const attentionView: AttentionView = {
    active: null,
    queued: [],
    ambient: [
      makeFrame({
        responseSpec: {
          kind: "acknowledge",
          actions: [
            { id: "ack", label: "Acknowledge", kind: "acknowledge", emphasis: "primary" },
          ],
        },
      }),
    ],
  };

  const filtered = buildSurfaceAttentionView(attentionView, {
    nowMs: Date.parse("2026-03-18T10:10:00.000Z"),
    ambientStaleMs: 5 * 60 * 1000,
  });

  assert.equal(filtered.ambient.length, 1);
});
