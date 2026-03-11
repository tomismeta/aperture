import assert from "node:assert/strict";
import test from "node:test";

import type { AttentionState, AttentionView, Frame, SignalSummary } from "@aperture/core";

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
  assert.match(screen, /APERTURE/);
  assert.match(screen, /active 1/);
  assert.match(screen, /queued 1/);
  assert.match(screen, /ambient 1/);
  assert.match(screen, /ACTIVE NOW/);
  assert.match(screen, /QUEUE/);
  assert.match(screen, /AMBIENT/);
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

test("renderAttentionScreen shows acknowledge controls for active status work", () => {
  const attentionView: AttentionView = {
    active: makeFrame({
      mode: "status",
      title: "Bash failed",
      summary: "The deploy command failed.",
      tone: "critical",
      consequence: "high",
      responseSpec: {
        kind: "acknowledge",
        actions: [
          { id: "acknowledge", label: "Acknowledge", kind: "acknowledge", emphasis: "primary" },
        ],
      },
    }),
    queued: [],
    ambient: [],
  };

  const screen = renderAttentionScreen(attentionView, { title: "Aperture TUI" });

  assert.match(screen, /\[enter\] acknowledge/i);
});

test("renderAttentionScreen hides rationale by default and shows when expanded", () => {
  const attentionView: AttentionView = {
    active: makeFrame(),
    queued: [],
    ambient: [],
  };

  const collapsed = renderAttentionScreen(attentionView, { title: "Aperture TUI" });
  assert.doesNotMatch(collapsed, /blocking work remains sticky/);
  assert.doesNotMatch(collapsed, /offset/);

  const expanded = renderAttentionScreen(attentionView, { title: "Aperture TUI", expanded: true });
  assert.match(expanded, /blocking work remains sticky/);
  assert.match(expanded, /\+5/);
});

test("renderAttentionScreen shows space key hint in controls", () => {
  const attentionView: AttentionView = {
    active: makeFrame(),
    queued: [],
    ambient: [],
  };

  const screen = renderAttentionScreen(attentionView, { title: "Aperture TUI" });
  assert.match(screen, /\[space\] detail/);
});

test("renderAttentionScreen preserves status text when stats are also shown", () => {
  const attentionView: AttentionView = {
    active: makeFrame({
      title: "Approve Bash find /Users/tom/dev/ape…",
    }),
    queued: [],
    ambient: [],
  };

  const summary: SignalSummary = {
    recentSignals: 9,
    lifetimeSignals: 9,
    counts: {
      presented: 9,
      viewed: 0,
      responded: 6,
      dismissed: 0,
      deferred: 0,
      contextExpanded: 0,
      contextSkipped: 0,
      timedOut: 0,
      returned: 0,
      attentionShifted: 0,
    },
    deferred: {
      queued: 0,
      suppressed: 0,
      manual: 0,
    },
    responseRate: 0.66,
    dismissalRate: 0,
    averageResponseLatencyMs: 4220,
    averageDismissalLatencyMs: null,
    lastSignalAt: "2026-03-10T00:00:00.000Z",
  };

  const screen = renderAttentionScreen(attentionView, {
    title: "Aperture",
    statusLine: "Approved · focused on Approve Bash ls -la",
    stats: {
      summary,
      state: "overloaded" satisfies AttentionState,
    },
  });

  assert.match(screen, /Approved · focused on Approve Bash ls -la/);
});
