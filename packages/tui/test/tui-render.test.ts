import assert from "node:assert/strict";
import test from "node:test";

import type { AttentionView, Frame } from "@aperture/core";

import { renderAttentionScreen } from "../src/index.js";

function makeFrame(overrides: Partial<Frame> = {}): Frame {
  return {
    id: "frame-1",
    taskId: "task-1",
    interactionId: "interaction-1",
    version: 1,
    mode: "approval",
    tone: "focused",
    consequence: "medium",
    title: "Approve deployment",
    summary: "A deploy needs review.",
    timing: {
      createdAt: "2026-03-10T00:00:00.000Z",
      updatedAt: "2026-03-10T00:00:00.000Z",
    },
    responseSpec: {
      kind: "approval",
      actions: [
        { id: "approve", label: "Approve", kind: "approve", emphasis: "primary" },
        { id: "reject", label: "Reject", kind: "reject", emphasis: "danger" },
      ],
    },
    metadata: {
      attention: {
        score: 1211,
        scoreOffset: 5,
        rationale: ["blocking work remains sticky"],
      },
    },
    ...overrides,
  };
}

test("renderAttentionScreen shows active, queued, and ambient summaries", () => {
  const attentionView: AttentionView = {
    active: makeFrame(),
    queued: [makeFrame({ id: "frame-2", title: "Choose target", mode: "choice" })],
    ambient: [
      makeFrame({
        id: "frame-3",
        title: "Run failed",
        mode: "status",
        responseSpec: { kind: "none" },
      }),
    ],
  };

  const screen = renderAttentionScreen(attentionView, { title: "Aperture TUI" });

  assert.match(screen, /Aperture TUI/);
  assert.match(screen, /active 1/);
  assert.match(screen, /queued 1/);
  assert.match(screen, /ambient 1/);
  assert.match(screen, /Active now/);
  assert.match(screen, /Up next/);
  assert.match(screen, /Background/);
  assert.match(screen, /Approve deployment/);
  assert.match(screen, /Choose target/);
  assert.match(screen, /Run failed/);
  assert.match(screen, /score 1211/);
});

test("renderAttentionScreen shows numbered choice options in the active pane", () => {
  const choiceFrame = makeFrame({
    mode: "choice",
    title: "Which environment should be used?",
    summary: "Target selection",
    responseSpec: {
      kind: "choice",
      options: [
        { id: "staging", label: "staging" },
        { id: "prod", label: "production" },
      ],
    },
  });

  const attentionView: AttentionView = {
    active: choiceFrame,
    queued: [],
    ambient: [],
  };

  const screen = renderAttentionScreen(attentionView, { title: "Aperture TUI" });

  assert.match(screen, /\[1\] staging/);
  assert.match(screen, /\[2\] production/);
});
