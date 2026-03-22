import assert from "node:assert/strict";
import test from "node:test";

import type {
  AttentionFrame as Frame,
  AttentionView,
} from "@tomismeta/aperture-core";
import type { AttentionSignalSummary as SignalSummary } from "../../core/src/signal-summary.js";
import type { AttentionState } from "../../core/src/attention-state.js";

import { renderAttentionScreen } from "../src/index.js";
import { ANSI } from "../src/ansi.js";

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

test("renderAttentionScreen shows connection status when the surface is empty", () => {
  const attentionView: AttentionView = {
    active: null,
    queued: [],
    ambient: [],
  };

  const screen = renderAttentionScreen(attentionView, {
    title: "Aperture",
    connectionStatus: {
      summary: "Bringing your agent surfaces online.",
      entries: [
        {
          id: "claude",
          label: "Claude Code",
          state: "action",
          detail: "Claude bridge is ready. Claude Code still needs to reload the updated hooks.",
          hint: "Restart Claude Code and run /hooks once to finish setup.",
          actions: [
            { id: "refresh-claude", key: "c", label: "finish Claude setup" },
          ],
        },
        {
          id: "opencode",
          label: "OpenCode",
          state: "action",
          detail: "Waiting for OpenCode at http://127.0.0.1:4096.",
          hint: "Run: opencode serve --port 4096, then opencode attach http://127.0.0.1:4096.",
          actions: [
            { id: "retry-opencode", key: "r", label: "retry OpenCode" },
          ],
        },
      ],
      actions: [
        { id: "skip-setup", key: "s", label: "skip for now" },
        { id: "refresh-claude", key: "c", label: "finish Claude setup" },
        { id: "retry-opencode", key: "r", label: "retry OpenCode" },
      ],
    },
  });

  assert.match(screen, /Welcome to Aperture/);
  assert.match(screen, /The live attention surface for humans working with agents\./);
  assert.match(screen, /── setup ──/);
  assert.match(screen, /Claude Code/);
  assert.match(screen, /OpenCode/);
  assert.match(screen, /needs setup/);
  assert.match(screen, /Run: opencode serve --port 4096/);
  assert.match(screen, /opencode attach/);
  assert.match(screen, /http:\/\/127\.0\.0\.1:4096/);
  assert.match(screen, /Restart Claude Code and run \/hooks once to finish setup\./);
  assert.match(screen, /\[s\].*skip for now/);
  assert.match(screen, /\[c\].*finish Claude setup/);
  assert.match(screen, /\[r\].*retry OpenCode/);
  assert.doesNotMatch(screen, /── next ──/);
  assert.doesNotMatch(screen, /── ambient ──/);
  assert.match(screen, /controls.*\[q\].*quit/);
  assert.doesNotMatch(screen, /controls.*check setup/);
});

test("renderAttentionScreen hides ready-only connections when there is no setup work left", () => {
  const attentionView: AttentionView = {
    active: null,
    queued: [],
    ambient: [],
  };

  const screen = renderAttentionScreen(attentionView, {
    title: "Aperture",
    connectionStatus: {
      summary: "Integrations are ready.",
      entries: [
        {
          id: "claude",
          label: "Claude Code",
          state: "ready",
          detail: "Attached to an existing Claude Code bridge.",
        },
      ],
    },
  });

  assert.doesNotMatch(screen, /── connections ──/);
  assert.doesNotMatch(screen, /Claude Code/);
});

test("renderAttentionScreen keeps a show setup action after setup is skipped", () => {
  const attentionView: AttentionView = {
    active: null,
    queued: [],
    ambient: [],
  };

  const screen = renderAttentionScreen(attentionView, {
    title: "Aperture",
    connectionStatus: {
      entries: [
        {
          id: "claude",
          label: "Claude Code",
          state: "ready",
          detail: "Attached to an existing Claude Code bridge.",
        },
      ],
      actions: [{ id: "show-setup", key: "s", label: "show setup" }],
    },
  });

  assert.doesNotMatch(screen, /Welcome to Aperture/);
  assert.doesNotMatch(screen, /── setup ──/);
  assert.match(screen, /controls.*\[s\].*show setup/);
});

test("renderAttentionScreen shows setup instead of a lone bridge-status ambient frame", () => {
  const attentionView: AttentionView = {
    active: null,
    queued: [],
    ambient: [
      makeFrame({
        id: "frame-bridge",
        taskId: "opencode:http%3A%2F%2F127.0.0.1%3A4096%7C:session:bridge",
        interactionId: "interaction:opencode:http%3A%2F%2F127.0.0.1%3A4096%7C:session:bridge:status",
        mode: "status",
        tone: "ambient",
        title: "OpenCode event stream disconnected",
        summary: "fetch failed",
        responseSpec: { kind: "none" },
      }),
    ],
  };

  const screen = renderAttentionScreen(attentionView, {
    title: "Aperture",
    connectionStatus: {
      summary: "Finish setup to bring your agent surfaces online.",
      entries: [
        {
          id: "opencode",
          label: "OpenCode",
          state: "action",
          detail: "Waiting for OpenCode at http://127.0.0.1:4096.",
          hint: "Run: opencode serve --port 4096, then opencode attach http://127.0.0.1:4096.",
          actions: [{ id: "retry-opencode", key: "r", label: "retry OpenCode" }],
        },
      ],
      actions: [
        { id: "skip-setup", key: "s", label: "skip for now" },
        { id: "retry-opencode", key: "r", label: "retry OpenCode" },
      ],
    },
  });

  assert.match(screen, /Welcome to Aperture/);
  assert.match(screen, /OpenCode/);
  assert.doesNotMatch(screen, /── ambient ──/);
  assert.doesNotMatch(screen, /OpenCode event stream disconnected/);
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

test("renderAttentionScreen nests active input inside the event tree", () => {
  const attentionView: AttentionView = {
    active: makeFrame({
      mode: "form",
      title: "OpenCode is waiting for your reply",
      summary: "What's your favorite programming language and why?",
      responseSpec: {
        kind: "form",
        fields: [{ id: "reply", label: "Reply", type: "textarea" }],
      },
    }),
    queued: [],
    ambient: [],
  };

  const screen = renderAttentionScreen(attentionView, {
    title: "Aperture",
    inputDraft: {
      kind: "form",
      interactionId: "interaction-1",
      fieldIndex: 0,
      values: {},
      buffer: "",
    },
  });

  assert.doesNotMatch(screen, /── input ──/);
  assert.match(screen, /⎿ What's your favorite programming language and why\?/);
  assert.match(screen, /⎿ › Reply · \(empty\)/);
});

test("renderAttentionScreen expands full prompt text when expanded", () => {
  const attentionView: AttentionView = {
    active: makeFrame({
      mode: "form",
      title: "OpenCode is waiting for your reply",
      summary: "That's a compelling vision - personalization that adapts to each user while keeping the surface calm and predictable for operators.",
      responseSpec: {
        kind: "form",
        fields: [{ id: "reply", label: "Reply", type: "textarea" }],
      },
    }),
    queued: [],
    ambient: [],
  };

  const collapsed = renderAttentionScreen(attentionView, { title: "Aperture" });
  assert.match(collapsed, /personalization that adapts to each user .*…/);

  const expanded = renderAttentionScreen(attentionView, { title: "Aperture", expanded: true });
  assert.match(expanded, /personalization that adapts to each user/);
  assert.match(expanded, /while keeping the surface calm and predictable for operators\./);
});

test("renderAttentionScreen accents input prompts and reply labels in brand blue", () => {
  const attentionView: AttentionView = {
    active: makeFrame({
      mode: "form",
      title: "OpenCode is waiting for your reply",
      summary: "What's your favorite programming language and why?",
      responseSpec: {
        kind: "form",
        fields: [{ id: "reply", label: "Reply", type: "textarea" }],
      },
    }),
    queued: [],
    ambient: [],
  };

  const screen = renderAttentionScreen(attentionView, {
    title: "Aperture",
    color: true,
    inputDraft: {
      kind: "form",
      interactionId: "interaction-1",
      fieldIndex: 0,
      values: {},
      buffer: "",
    },
  });

  assert.match(screen, new RegExp(`${escapeRegExp(ANSI.bold)}${escapeRegExp(ANSI.brand)}What's your favorite programming language and why\\?`));
  assert.match(screen, new RegExp(`${escapeRegExp(ANSI.bold)}${escapeRegExp(ANSI.brand)}Reply`));
});

test("renderAttentionScreen accents approval summaries in non-bold brand blue", () => {
  const attentionView: AttentionView = {
    active: makeFrame({
      mode: "approval",
      title: "Claude Code wants to run a shell command",
      summary: "ls /Users/tom/Desktop/aperture-test-suite",
      responseSpec: {
        kind: "approval",
        actions: [
          { id: "approve", label: "Approve", kind: "approve", emphasis: "primary" },
          { id: "reject", label: "Reject", kind: "reject", emphasis: "danger" },
        ],
      },
    }),
    queued: [],
    ambient: [],
  };

  const screen = renderAttentionScreen(attentionView, {
    title: "Aperture",
    color: true,
  });

  assert.match(screen, new RegExp(`${escapeRegExp(ANSI.brand)}ls /Users/tom/Desktop/aperture-test-suite`));
  assert.doesNotMatch(
    screen,
    new RegExp(`${escapeRegExp(ANSI.bold)}${escapeRegExp(ANSI.brand)}ls /Users/tom/Desktop/aperture-test-suite`),
  );
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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
    summary: "/Users/tom/dev/aperture/docs/product/components.md",
    source: {
      id: "claude-code:session-1",
      kind: "claude-code",
      label: "Claude Code tom #61cc80",
    },
  });

  const attentionView: AttentionView = {
    active: makeFrame({
      title: "Approve Read components.md",
      summary: "/Users/tom/dev/aperture/docs/product/components.md",
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
