import { emitKeypressEvents } from "node:readline";
import { env, stdin as defaultInput, stdout as defaultOutput } from "node:process";

import { renderAttentionScreen, shouldRenderPreflightScreen } from "./render.js";
import { renderWhyOverlay } from "./render-why.js";
import { computePosture } from "./posture.js";
import { createAnimationState, tickAnimation } from "./animation.js";
import { ANSI } from "./ansi.js";
import {
  handleActiveKeypress,
  handleInputKeypress,
  describeResponse,
  createAutomaticInputDraft,
  shouldReserveSpaceForExpand,
} from "./interaction.js";
import { displaySourceLabel } from "./source-label.js";
import { buildSurfaceAttentionView, isAttentionViewEmpty, sameAttentionView } from "./surface-view.js";

import type {
  AttentionSurface,
  AttentionTuiOptions,
  TuiState,
  InputLike,
  OutputLike,
  Frame,
  ApertureTrace,
} from "./types.js";

export { renderAttentionScreen } from "./render.js";
export type {
  AttentionTuiOptions,
  RenderOptions,
  AttentionConnectionAction,
  AttentionConnectionEntry,
  AttentionConnectionSnapshot,
  AttentionConnectionState,
} from "./types.js";

const PASSIVE_ENGAGEMENT_HOLD_MS = 5_000;
const ACTIVE_ENGAGEMENT_HOLD_MS = 15_000;

export async function runAttentionTui(
  core: AttentionSurface,
  options?: AttentionTuiOptions,
): Promise<void> {
  const input = (options?.input ?? defaultInput) as InputLike;
  const output = (options?.output ?? defaultOutput) as OutputLike;
  const title = options?.title ?? "Aperture";
  const terminalTitle = options?.terminalTitle ?? title;
  const reducedMotion = options?.reducedMotion ?? Boolean(env.SSH_CONNECTION || env.SSH_TTY);
  const ambientStaleMs = options?.ambientStaleMs;
  const surfaceViewOptions = ambientStaleMs !== undefined ? { ambientStaleMs } : {};

  const initialView = buildSurfaceAttentionView(core.getAttentionView(), surfaceViewOptions);
  const initialSummary = core.getSignalSummary();
  const initialPosture = reducedMotion && isAttentionViewEmpty(initialView)
    ? "calm"
    : computePosture(initialSummary, initialView);
  const initialInputDraft = initialView.now ? createAutomaticInputDraft(initialView.now) : null;

  const state: TuiState = {
    attentionView: initialView,
    statusLine: initialInputDraft
      ? editingStatusLabel(initialView.now)
      : initialView.now
      ? focusStatusLabel(initialView.now)
      : "Waiting for activity",
    inputDraft: initialInputDraft,
    expanded: false,
    showSetup: false,
    whyMode: false,
    whyExpanded: false,
    traceCache: new Map(),
    connectionStatus: options?.getConnectionStatus?.() ?? null,
    posture: initialPosture,
    previousPosture: "calm",
    animation: createAnimationState(),
  };
  let renderScheduled = false;

  const cleanup = setupTerminal(input, output, terminalTitle);

  const render = () => {
    output.write(redrawScreen());

    if (state.whyMode) {
      const activeTrace = state.attentionView.now
        ? state.traceCache.get(state.attentionView.now.interactionId) ?? null
        : null;

      output.write(
        renderAttentionScreenWithWhy(state, title, output, activeTrace, reducedMotion),
      );
    } else {
      const renderOptions = {
        title,
        statusLine: state.statusLine,
        inputDraft: state.inputDraft,
        expanded: state.expanded,
        showSetup: state.showSetup,
        color: Boolean(output.isTTY),
        height: output.rows,
        stats: {
          summary: core.getSignalSummary(),
          state: core.getAttentionState(),
        },
        posture: state.posture,
        animation: state.animation,
        connectionStatus: state.connectionStatus,
      };
      output.write(
        renderAttentionScreen(state.attentionView, renderOptions),
      );
    }
  };

  const requestRender = () => {
    if (renderScheduled) return;
    renderScheduled = true;
    setImmediate(() => {
      renderScheduled = false;
      render();
      });
  };

  const applyAttentionView = (attentionView: typeof state.attentionView) => {
    const previousActiveId = state.attentionView.now?.interactionId ?? null;
    const previousView = state.attentionView;
    state.attentionView = attentionView;
    const active = attentionView.now;

    const newPosture = reducedMotion && isAttentionViewEmpty(attentionView)
      ? "calm"
      : computePosture(core.getSignalSummary(), attentionView);
    if (!reducedMotion && newPosture !== state.posture) {
      state.previousPosture = state.posture;
      state.animation.postureFlash = { previous: state.posture, ticksRemaining: 2 };
    }
    state.posture = newPosture;

    if (!reducedMotion && active && active.interactionId !== previousActiveId) {
      state.animation.frameEntrance = { interactionId: active.interactionId, ticksRemaining: 1 };
    }

    if (!active) {
      state.inputDraft = null;
      state.expanded = false;
      if (attentionView.next.length > 0) {
        state.showSetup = false;
      }
      state.whyMode = false;
      state.whyExpanded = false;
      state.statusLine = "Nothing needs attention right now";
    } else if (active.interactionId !== previousActiveId) {
      core.engage(active.taskId, active.interactionId, { durationMs: PASSIVE_ENGAGEMENT_HOLD_MS });
      state.showSetup = false;
      state.inputDraft = createAutomaticInputDraft(active);
      state.whyExpanded = false;
      state.statusLine = state.inputDraft
        ? editingStatusLabel(active)
        : focusStatusLabel(active);
    } else if (state.inputDraft && state.inputDraft.interactionId !== active.interactionId) {
      state.inputDraft = createAutomaticInputDraft(active);
      state.expanded = false;
      state.statusLine = state.inputDraft
        ? editingStatusLabel(active)
        : focusStatusLabel(active);
    }

    const visibleIds = new Set<string>();
    if (active) visibleIds.add(active.interactionId);
    for (const f of attentionView.next) visibleIds.add(f.interactionId);
    for (const f of attentionView.ambient) visibleIds.add(f.interactionId);
    for (const id of state.traceCache.keys()) {
      if (!visibleIds.has(id)) state.traceCache.delete(id);
    }

    return !sameAttentionView(previousView, attentionView);
  };

  const onResize = () => requestRender();
  output.on("resize", onResize);

  // Animation tick (500ms)
  const animationInterval = setInterval(() => {
    const latestView = buildSurfaceAttentionView(core.getAttentionView(), surfaceViewOptions);
    const viewChanged = applyAttentionView(latestView);
    const isEmpty = isAttentionViewEmpty(state.attentionView);
    const hasNoActiveFrame = state.attentionView.now === null;
    const hadActiveAnimation = tickAnimation(state.animation);
    const showingPreflight = shouldRenderPreflightScreen(
      state.connectionStatus,
      state.attentionView,
      state.showSetup,
    );
    const idleLensTarget = getIdleLensTarget(showingPreflight, hasNoActiveFrame, isEmpty);
    const shouldPulseIdleLens = idleLensTarget !== null
      && (state.animation.idleTick === 0 || state.animation.idleTick === 2);

    if (reducedMotion) {
      if (hadActiveAnimation || viewChanged) {
        requestRender();
      } else if (shouldPulseIdleLens) {
        writeIdleLensPulse(output, Boolean(output.isTTY), state.animation.idleTick, idleLensTarget);
      }
      return;
    }

    // Re-render for active animations, live posture/view cooling, or the calm idle pulse
    // whenever nothing currently owns the operator's focus.
    if (hadActiveAnimation || viewChanged || hasNoActiveFrame || isEmpty) {
      requestRender();
    }
  }, 500);

  // Subscribe to attention view updates
  const unsubAttention = core.subscribeAttentionView((attentionView) => {
    applyAttentionView(buildSurfaceAttentionView(attentionView, surfaceViewOptions));
    requestRender();
  });

  // Subscribe to responses
  const unsubResponse = core.onResponse((response) => {
    state.inputDraft = null;
    const nextActive = core.getAttentionView().now;
    state.statusLine = describeResponse(response, nextActive);
    requestRender();
  });

  // Subscribe to traces (optional)
  let unsubTrace: (() => void) | null = null;
  if (core.onTrace) {
    unsubTrace = core.onTrace((trace: ApertureTrace) => {
      if (trace.evaluation.kind !== "candidate") return;
      // TypeScript doesn't narrow the union through nested discriminants,
      // so we extract the interactionId from the evaluation (always present on candidate).
      const interactionId = trace.evaluation.adjusted?.interactionId;
      if (interactionId) {
        state.traceCache.set(interactionId, trace);
        if (state.whyMode) requestRender();
      }
    });
  }

  const unsubConnectionStatus = options?.subscribeConnectionStatus
    ? options.subscribeConnectionStatus((connectionStatus) => {
      state.connectionStatus = connectionStatus;
      requestRender();
    })
    : null;

  render();

  return new Promise<void>((resolve) => {
    const onKeypress = (_chunk: string, key: { ctrl?: boolean; name?: string; sequence?: string }) => {
      if (key.ctrl && key.name === "c") {
        close();
        return;
      }

      // Frame input active — capture all keys there
      if (state.inputDraft) {
        if (key.name === "space" && shouldReserveSpaceForExpand(state.inputDraft)) {
          state.expanded = !state.expanded;
          requestRender();
          return;
        }
        handleInputKeypress(core, state, key);
        requestRender();
        return;
      }

      const active = state.attentionView.now;

      // Global keys (always available)
      if (key.name === "q") {
        close();
        return;
      }

      if (key.name === "space") {
        if (active) {
          core.engage(active.taskId, active.interactionId, { durationMs: ACTIVE_ENGAGEMENT_HOLD_MS });
        }
        if (state.whyMode) {
          state.whyExpanded = !state.whyExpanded;
        } else {
          state.expanded = !state.expanded;
        }
        requestRender();
        return;
      }

      if (key.name === "y") {
        if (active) {
          core.engage(active.taskId, active.interactionId, { durationMs: ACTIVE_ENGAGEMENT_HOLD_MS });
        }
        state.whyMode = !state.whyMode;
        if (!state.whyMode) state.whyExpanded = false;
        requestRender();
        return;
      }

      if (!active) {
        const surfaceIsQuiet = state.attentionView.next.length === 0;
        if (!surfaceIsQuiet) {
          return;
        }
        const action = state.connectionStatus?.actions?.find((candidate) => candidate.key === key.sequence);
        if (action && options?.runConnectionAction) {
          if (action.id === "show-setup") {
            state.showSetup = !state.showSetup;
            state.statusLine = state.showSetup ? "Showing setup" : "Back to live view";
            requestRender();
            if (state.showSetup) {
              void Promise.resolve(options.runConnectionAction(action.id)).catch(() => {});
            }
            return;
          }
          if (action.id === "skip-setup") {
            state.showSetup = false;
          }
          state.statusLine = `Running ${action.label}`;
          requestRender();
          void Promise.resolve(options.runConnectionAction(action.id))
            .then(() => {
              state.statusLine = `Finished ${action.label}`;
              requestRender();
            })
            .catch((error) => {
              const message = error instanceof Error ? error.message : String(error);
              state.statusLine = `${action.label} failed: ${message}`;
              requestRender();
            });
        }
        return;
      }

      // Frame response keys
      handleActiveKeypress(core, state, active, key);
      requestRender();
    };

    const close = () => {
      if (animationInterval) {
        clearInterval(animationInterval);
      }
      input.off("keypress", onKeypress);
      output.off("resize", onResize);
      unsubAttention();
      unsubResponse();
      if (unsubTrace) unsubTrace();
      if (unsubConnectionStatus) unsubConnectionStatus();
      cleanup();
      resolve();
    };

    emitKeypressEvents(input);
    if ((input as InputLike).isTTY && (input as InputLike).setRawMode) {
      (input as InputLike).setRawMode!(true);
    }
    input.resume();

    input.on("keypress", onKeypress);
  });
}

// ── Why Mode Screen ─────────────────────────────────────────────────

function renderAttentionScreenWithWhy(
  state: TuiState,
  title: string,
  output: OutputLike,
  trace: ApertureTrace | null,
  reducedMotion: boolean,
): string {
  const renderOptions = {
    title,
    statusLine: state.statusLine,
    color: Boolean(output.isTTY),
    height: output.rows,
    posture: state.posture,
    animation: state.animation,
    whyMode: true,
    whyExpanded: state.whyExpanded,
    trace,
  };

  return renderAttentionScreen(state.attentionView, renderOptions);
}

// ── Terminal Helpers ─────────────────────────────────────────────────

function setupTerminal(input: InputLike, output: OutputLike, title: string): () => void {
  writeTerminalTitle(output, title);
  output.write(clearScreen());

  return () => {
    if ((input as InputLike).isTTY && (input as InputLike).setRawMode) {
      (input as InputLike).setRawMode!(false);
    }
    input.pause();
    output.write(restoreScreen());
  };
}

function writeTerminalTitle(output: OutputLike, title: string): void {
  if (!output.isTTY) return;
  const cleanTitle = title.replace(/[\u0007\u001b]/g, "");
  output.write(`\u001b]1;${cleanTitle}\u0007`);
}

function writeIdleLensPulse(
  output: OutputLike,
  color: boolean,
  idleTick: number,
  target: { row: number; col: number } | null,
): void {
  if (!output.isTTY) {
    return;
  }
  if (!target) {
    return;
  }
  output.write(`\u001B[s\u001B[${target.row};${target.col}H${renderIdleLensGlyph(color, idleTick)}\u001B[u`);
}

function renderIdleLensGlyph(color: boolean, idleTick: number): string {
  const lensGlyph = '[◉"]';
  const bright = idleTick < 2;
  if (!color) {
    return lensGlyph;
  }
  return bright
    ? `${ANSI.brand}${lensGlyph}${ANSI.reset}`
    : `${ANSI.dim}${lensGlyph}${ANSI.reset}`;
}

function getIdleLensTarget(
  showingPreflight: boolean,
  hasNoActiveFrame: boolean,
  isEmpty: boolean,
): { row: number; col: number } | null {
  if (showingPreflight) {
    return { row: 4, col: 3 };
  }
  if (hasNoActiveFrame && isEmpty) {
    return { row: 5, col: 5 };
  }
  return null;
}

function editingStatusLabel(frame: Frame | null): string {
  if (!frame) {
    return "Editing reply";
  }

  if (frame.responseSpec?.kind === "form") {
    return `Editing ${frame.responseSpec.fields[0]?.label ?? frame.title}`;
  }

  return `Editing ${frame.title}`;
}

function focusStatusLabel(frame: Frame): string {
  return `Focused on ${frame.title} · ${displaySourceLabel(frame.source)}`;
}

function clearScreen(): string {
  return "\u001B[?25l\u001B[?1049h\u001B[2J\u001B[H";
}

function redrawScreen(): string {
  return "\u001B[H\u001B[J";
}

function restoreScreen(): string {
  return "\u001B[?25h\u001B[2J\u001B[H\u001B[?1049l";
}
