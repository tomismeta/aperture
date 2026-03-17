import assert from "node:assert/strict";
import test from "node:test";

import type {
  AttentionFrame as Frame,
  AttentionSignalSummary as SignalSummary,
  AttentionState,
  AttentionView,
} from "@tomismeta/aperture-core";

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

  assert.match(screen, /APERTURE/);
  assert.match(screen, /now 1/);
  assert.match(screen, /next 1/);
  assert.match(screen, /ambient 1/);
  // New layout uses ── section headers and ⏺ marker with ⎿ tree connectors
  assert.match(screen, /── next ──/);
  assert.match(screen, /── ambient ──/);
  assert.match(screen, /⏺/); // active frame marker
  assert.match(screen, /⎿/); // tree connector for child lines
  assert.match(screen, /Approve deployment/);
  assert.match(screen, /Choose target/);
  assert.match(screen, /Run failed/);
  assert.match(screen, /permission · needs attention · medium risk/);
  assert.doesNotMatch(screen, /score 1211/, "score should be hidden by default");

  const expanded = renderAttentionScreen(attentionView, { title: "Aperture TUI", expanded: true });
  assert.match(expanded, /score 1211/);
});

test("renderAttentionScreen shows numbered choice options in the now pane", () => {
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

  assert.match(screen, /\[⏎\].*ack/i);
});

test("renderAttentionScreen hides rationale by default and shows when expanded", () => {
  const attentionView: AttentionView = {
    active: makeFrame(),
    queued: [],
    ambient: [],
  };

  const collapsed = renderAttentionScreen(attentionView, { title: "Aperture TUI" });
  // Rationale now shows as judgment line (from metadata.attention.rationale)
  // but the full "why" debug section with offset is hidden
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
  assert.match(screen, /\[⎵\].*detail/);
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

test("renderAttentionScreen compacts repeated queued notifications", () => {
  const repeated = makeFrame({
    id: "frame-2",
    interactionId: "interaction-2",
    title: "Approve Read package.json",
    source: {
      id: "claude-code:session-1",
      kind: "claude-code",
      label: "Claude Code tom #61cc80",
    },
  });

  const attentionView: AttentionView = {
    active: makeFrame({
      title: "Approve Read package.json",
      source: {
        id: "claude-code:session-1",
        kind: "claude-code",
        label: "Claude Code tom #61cc80",
      },
    }),
    queued: [
      repeated,
      { ...repeated, id: "frame-3", interactionId: "interaction-3" },
      makeFrame({
        id: "frame-4",
        interactionId: "interaction-4",
        title: "Approve Read README.md",
        source: {
          id: "claude-code:session-2",
          kind: "claude-code",
          label: "Claude Code aperture #f3d677",
        },
      }),
    ],
    ambient: [],
  };

  const screen = renderAttentionScreen(attentionView, { title: "Aperture" });

  assert.match(screen, /Approve Read package\.json .*×2/);
  assert.match(screen, /Approve Read package\.json .*×3/);
  assert.equal((screen.match(/Approve Read package\.json/g) ?? []).length, 2);
});

test("renderAttentionScreen shows duplicate active approvals as a pending count", () => {
  const duplicate = makeFrame({
    id: "frame-2",
    interactionId: "interaction-2",
    title: "Approve Read components.md",
    summary: "/Users/tom/dev/aperture/docs/components.md",
    source: {
      id: "claude-code:session-1",
      kind: "claude-code",
      label: "Claude Code tom #61cc80",
    },
  });

  const attentionView: AttentionView = {
    active: makeFrame({
      title: "Approve Read components.md",
      summary: "/Users/tom/dev/aperture/docs/components.md",
      source: {
        id: "claude-code:session-1",
        kind: "claude-code",
        label: "Claude Code tom #61cc80",
      },
    }),
    queued: [duplicate],
    ambient: [],
  };

  const screen = renderAttentionScreen(attentionView, { title: "Aperture" });

  assert.match(screen, /Approve Read components\.md .*×2/);
});

test("renderAttentionScreen single-line header with posture indicator", () => {
  const attentionView: AttentionView = {
    active: makeFrame(),
    queued: [],
    ambient: [],
  };

  const screen = renderAttentionScreen(attentionView, { posture: "calm" });
  // Header should be on one line with brand + counts + posture
  assert.match(screen, /APERTURE/);
  assert.match(screen, /calm/);
  // No tagline
  assert.doesNotMatch(screen, /human attention control plane/);
});

test("renderAttentionScreen borderless active frame with judgment line", () => {
  const attentionView: AttentionView = {
    active: makeFrame({ mode: "approval", consequence: "high" }),
    queued: [],
    ambient: [],
  };

  const screen = renderAttentionScreen(attentionView);
  // No box borders
  assert.doesNotMatch(screen, /╭/);
  assert.doesNotMatch(screen, /╰/);
  // Has judgment line (from metadata.attention.rationale since no trace is provided)
  assert.match(screen, /blocking work remains sticky/);

  // Without metadata rationale, falls back to synthesized line
  const noMetaView: AttentionView = {
    active: makeFrame({ mode: "approval", consequence: "high", metadata: {} }),
    queued: [],
    ambient: [],
  };
  const noMetaScreen = renderAttentionScreen(noMetaView);
  assert.match(noMetaScreen, /High-risk action requires operator approval/);
});

test("renderAttentionScreen judgment line prioritizes trace coordination over heuristics", () => {
  const attentionView: AttentionView = {
    active: makeFrame({
      metadata: {
        attention: {
          score: 1211,
          scoreOffset: 5,
          rationale: ["heuristic rationale should be lower priority"],
        },
      },
    }),
    queued: [],
    ambient: [],
  };

  // Without trace: falls back to metadata heuristic rationale
  const noTraceScreen = renderAttentionScreen(attentionView);
  assert.match(noTraceScreen, /heuristic rationale should be lower priority/);

  // With a candidate trace that has coordination reasons:
  // the coordination reason should take priority over heuristic rationale
  const traceWithReasons = {
    timestamp: "2026-03-10T00:00:00.000Z",
    event: { kind: "submitted", taskId: "task-1", interaction: {} },
    evaluation: {
      kind: "candidate" as const,
      original: {} as any,
      adjusted: { interactionId: "interaction-1" } as any,
    },
    heuristics: { scoreOffset: 0, rationale: [] },
    episode: null,
    policy: {} as any,
    policyRules: { gateEvaluations: [], criterion: null, criterionEvaluations: [] },
    utility: { candidate: {} as any, currentScore: null, currentPriority: null },
    planner: { kind: "activate" as const, reasons: [], continuityEvaluations: [] },
    coordination: {
      kind: "activate" as const,
      resultBucket: "active" as const,
      candidateScore: 1211,
      currentScore: null,
      currentPriority: null,
      criterion: null,
      ambiguity: null,
      reasons: ["blocking work requires operator response"],
      continuityEvaluations: [],
    },
    taskSummary: {} as any,
    globalSummary: {} as any,
    taskAttentionState: "calm" as any,
    globalAttentionState: "calm" as any,
    pressureForecast: {} as any,
    attentionBurden: {} as any,
    current: null,
    taskView: {} as any,
    attentionView: { active: null, queued: [], ambient: [] },
    result: null,
  };

  const withTraceScreen = renderAttentionScreen(attentionView, { trace: traceWithReasons });
  assert.match(withTraceScreen, /blocking work requires operator response/);
  assert.doesNotMatch(withTraceScreen, /heuristic rationale/);
});

test("renderAttentionScreen judgment line shows continuity overrides first", () => {
  const attentionView: AttentionView = {
    active: makeFrame(),
    queued: [],
    ambient: [],
  };

  const traceWithOverride = {
    timestamp: "2026-03-10T00:00:00.000Z",
    event: { kind: "submitted", taskId: "task-1", interaction: {} },
    evaluation: {
      kind: "candidate" as const,
      original: {} as any,
      adjusted: { interactionId: "interaction-1" } as any,
    },
    heuristics: { scoreOffset: 0, rationale: [] },
    episode: null,
    policy: {} as any,
    policyRules: { gateEvaluations: [], criterion: null, criterionEvaluations: [] },
    utility: { candidate: {} as any, currentScore: null, currentPriority: null },
    planner: { kind: "activate" as const, reasons: [], continuityEvaluations: [] },
    coordination: {
      kind: "activate" as const,
      resultBucket: "active" as const,
      candidateScore: 1211,
      currentScore: null,
      currentPriority: null,
      criterion: null,
      ambiguity: null,
      reasons: ["coordination reason"],
      continuityEvaluations: [
        { rule: "conflicting_interrupt", kind: "override", rationale: ["suppressed due to active approval"] },
        { rule: "burst_dampening", kind: "noop", rationale: [] },
      ],
    },
    taskSummary: {} as any,
    globalSummary: {} as any,
    taskAttentionState: "calm" as any,
    globalAttentionState: "calm" as any,
    pressureForecast: {} as any,
    attentionBurden: {} as any,
    current: null,
    taskView: {} as any,
    attentionView: { active: null, queued: [], ambient: [] },
    result: null,
  };

  const screen = renderAttentionScreen(attentionView, { trace: traceWithOverride });
  // Continuity override should take priority over coordination reasons
  assert.match(screen, /conflicting_interrupt.*suppressed due to active approval/);
  assert.doesNotMatch(screen, /coordination reason/);
});

test("renderAttentionScreen why mode key hint", () => {
  const attentionView: AttentionView = {
    active: makeFrame(),
    queued: [],
    ambient: [],
  };

  const screen = renderAttentionScreen(attentionView);
  assert.match(screen, /\[y\].*why/);
});

test("renderAttentionScreen why mode replaces queue and ambient", () => {
  const attentionView: AttentionView = {
    active: makeFrame(),
    queued: [makeFrame({ id: "frame-2", title: "Queued item" })],
    ambient: [makeFrame({ id: "frame-3", title: "Ambient item", mode: "status", responseSpec: { kind: "none" } })],
  };

  const normalScreen = renderAttentionScreen(attentionView);
  assert.match(normalScreen, /── next ──/);
  assert.match(normalScreen, /── ambient ──/);

  const whyScreen = renderAttentionScreen(attentionView, { whyMode: true });
  // In why mode, next and ambient sections should not appear
  assert.doesNotMatch(whyScreen, /── next ──/);
  assert.doesNotMatch(whyScreen, /── ambient ──/);
  // Should show trace-related content (or "no trace available")
  assert.match(whyScreen, /no trace available/);
});

test("renderAttentionScreen why mode collapsed hides noop rules and shows count", () => {
  const attentionView: AttentionView = {
    active: makeFrame(),
    queued: [],
    ambient: [],
  };

  const trace = {
    timestamp: "2026-03-10T00:00:00.000Z",
    event: { kind: "submitted", taskId: "task-1", interaction: {} },
    evaluation: {
      kind: "candidate" as const,
      original: {} as any,
      adjusted: { interactionId: "interaction-1" } as any,
    },
    heuristics: { scoreOffset: 0, rationale: [] },
    episode: null,
    policy: {} as any,
    policyRules: {
      gateEvaluations: [
        { rule: "configured_policy", kind: "noop", rationale: [] },
        { rule: "blocking_work", kind: "verdict", rationale: ["requires operator response"] },
        { rule: "background_task", kind: "noop", rationale: [] },
        { rule: "status_update", kind: "noop", rationale: [] },
      ],
      criterion: null,
      criterionEvaluations: [],
    },
    utility: { candidate: {} as any, currentScore: null, currentPriority: null },
    planner: { kind: "activate" as const, reasons: [], continuityEvaluations: [] },
    coordination: {
      kind: "activate" as const,
      resultBucket: "active" as const,
      candidateScore: 1211,
      currentScore: null,
      currentPriority: null,
      criterion: null,
      ambiguity: null,
      reasons: ["blocking work requires operator response"],
      continuityEvaluations: [],
    },
    taskSummary: {} as any,
    globalSummary: {} as any,
    taskAttentionState: "calm" as any,
    globalAttentionState: "calm" as any,
    pressureForecast: {} as any,
    attentionBurden: {} as any,
    current: null,
    taskView: {} as any,
    attentionView: { active: null, queued: [], ambient: [] },
    result: null,
  };

  // Collapsed (default) — only verdict rules shown, noops hidden with count
  const collapsed = renderAttentionScreen(attentionView, { whyMode: true, trace });
  assert.match(collapsed, /blocking work/);
  assert.match(collapsed, /set policy/);
  assert.match(collapsed, /surface:\s+active/);
  assert.match(collapsed, /\+ 3 rules did not apply/);
  assert.doesNotMatch(collapsed, /configured policy/);

  // Expanded — all rules shown, no count line
  const expanded = renderAttentionScreen(attentionView, { whyMode: true, whyExpanded: true, trace });
  assert.match(expanded, /configured policy/);
  assert.match(expanded, /blocking work/);
  assert.match(expanded, /background task/);
  assert.match(expanded, /status update/);
  assert.doesNotMatch(expanded, /rules did not apply/);
});

test("renderAttentionScreen why mode controls show expand/collapse hint", () => {
  const attentionView: AttentionView = {
    active: makeFrame(),
    queued: [],
    ambient: [],
  };

  const whyCollapsed = renderAttentionScreen(attentionView, { whyMode: true });
  assert.match(whyCollapsed, /\[⎵\].*expand/);
  assert.match(whyCollapsed, /\[y\].*close/);

  const whyExpanded = renderAttentionScreen(attentionView, { whyMode: true, whyExpanded: true });
  assert.match(whyExpanded, /\[⎵\].*collapse/);
});

test("renderAttentionScreen why mode keeps threshold details on separate lines", () => {
  const attentionView: AttentionView = {
    active: makeFrame(),
    queued: [],
    ambient: [],
  };

  const trace = {
    timestamp: "2026-03-10T00:00:00.000Z",
    event: { kind: "submitted", taskId: "task-1", interaction: {} },
    evaluation: {
      kind: "candidate" as const,
      original: {} as any,
      adjusted: { interactionId: "interaction-1" } as any,
    },
    heuristics: { scoreOffset: 0, rationale: [] },
    episode: null,
    policy: {} as any,
    policyRules: {
      gateEvaluations: [],
      criterion: {
        criterion: {
          activationThreshold: 1150,
          promotionMargin: 80,
        },
        ambiguity: {
          reason: "threshold sits close to the currently active approval",
        },
      },
      criterionEvaluations: [
        { rule: "continuity_headroom", kind: "adjust", rationale: ["keeps headroom for active work"] },
      ],
    },
    utility: { candidate: {} as any, currentScore: 1100, currentPriority: null },
    planner: { kind: "queue" as const, reasons: [], continuityEvaluations: [] },
    coordination: {
      kind: "queue" as const,
      resultBucket: "queued" as const,
      candidateScore: 1120,
      currentScore: 1100,
      currentPriority: null,
      criterion: null,
      ambiguity: null,
      reasons: ["continuity keeps the existing item active"],
      continuityEvaluations: [],
    },
    taskSummary: {} as any,
    globalSummary: {} as any,
    taskAttentionState: "calm" as any,
    globalAttentionState: "calm" as any,
    pressureForecast: {} as any,
    attentionBurden: {} as any,
    current: null,
    taskView: {} as any,
    attentionView: { active: null, queued: [], ambient: [] },
    result: null,
  };

  const screen = renderAttentionScreen(attentionView, { whyMode: true, trace });
  assert.match(screen, /score:\s+1120[\s\S]*current:\s+1100[\s\S]*threshold:\s+1150/);
  assert.match(screen, /criterion[\s\S]*threshold:\s+1150[\s\S]*margin:\s+80[\s\S]*ambiguity:\s+threshold sits close to the currently active approval/);
});
