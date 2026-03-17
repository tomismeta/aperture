import { emitKeypressEvents } from "node:readline";
import { stdin as defaultInput, stdout as defaultOutput } from "node:process";

import { renderAttentionScreen } from "./render.js";
import { renderWhyOverlay } from "./render-why.js";
import { computePosture } from "./posture.js";
import { createAnimationState, tickAnimation } from "./animation.js";
import {
  handleActiveKeypress,
  handleInputKeypress,
  describeResponse,
} from "./interaction.js";

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
export type { AttentionTuiOptions, RenderOptions } from "./types.js";

export async function runAttentionTui(
  core: AttentionSurface,
  options?: AttentionTuiOptions,
): Promise<void> {
  const input = (options?.input ?? defaultInput) as InputLike;
  const output = (options?.output ?? defaultOutput) as OutputLike;
  const title = options?.title ?? "Aperture";

  const initialView = core.getAttentionView();
  const initialSummary = core.getSignalSummary();

  const state: TuiState = {
    attentionView: initialView,
    statusLine: "Waiting for events",
    inputDraft: null,
    expanded: false,
    whyMode: false,
    whyExpanded: false,
    traceCache: new Map(),
    posture: computePosture(initialSummary, initialView),
    previousPosture: "calm",
    animation: createAnimationState(),
  };
  let renderScheduled = false;

  const cleanup = setupTerminal(input, output, title);

  const render = () => {
    output.write(redrawScreen());

    if (state.whyMode) {
      const activeTrace = state.attentionView.active
        ? state.traceCache.get(state.attentionView.active.interactionId) ?? null
        : null;

      output.write(
        renderAttentionScreenWithWhy(state, title, output, activeTrace),
      );
    } else {
      output.write(
        renderAttentionScreen(state.attentionView, {
          title,
          statusLine: state.statusLine,
          inputDraft: state.inputDraft,
          expanded: state.expanded,
          color: Boolean(output.isTTY),
          height: output.rows,
          stats: {
            summary: core.getSignalSummary(),
            state: core.getAttentionState(),
          },
          posture: state.posture,
          animation: state.animation,
        }),
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

  const onResize = () => requestRender();
  output.on("resize", onResize);

  // Animation tick (500ms)
  const animationInterval = setInterval(() => {
    const hadActiveAnimation = tickAnimation(state.animation);
    // Re-render for active animations (posture flash, frame entrance)
    // or for the idle lens pulse when surface is truly empty
    const isEmpty = !state.attentionView.active
      && state.attentionView.queued.length === 0
      && state.attentionView.ambient.length === 0;
    if (hadActiveAnimation || isEmpty) {
      requestRender();
    }
  }, 500);

  // Subscribe to attention view updates
  const unsubAttention = core.subscribeAttentionView((attentionView) => {
    const previousActiveId = state.attentionView.active?.interactionId ?? null;
    state.attentionView = attentionView;
    const active = attentionView.active;

    // Update posture
    const newPosture = computePosture(core.getSignalSummary(), attentionView);
    if (newPosture !== state.posture) {
      state.previousPosture = state.posture;
      state.animation.postureFlash = { previous: state.posture, ticksRemaining: 2 };
      state.posture = newPosture;
    }

    // Frame entrance animation
    if (active && active.interactionId !== previousActiveId) {
      state.animation.frameEntrance = { interactionId: active.interactionId, ticksRemaining: 1 };
    }

    if (!active) {
      state.inputDraft = null;
      state.expanded = false;
      state.whyMode = false;
      state.whyExpanded = false;
      state.statusLine = "Nothing currently needs attention";
    } else if (active.interactionId !== previousActiveId) {
      state.whyExpanded = false;
      state.statusLine = `Focused on ${active.title}`;
    } else if (state.inputDraft && state.inputDraft.interactionId !== active.interactionId) {
      state.inputDraft = null;
      state.expanded = false;
      state.statusLine = `Focused on ${active.title}`;
    }

    // Prune trace cache — only keep traces for visible interactions
    const visibleIds = new Set<string>();
    if (active) visibleIds.add(active.interactionId);
    for (const f of attentionView.queued) visibleIds.add(f.interactionId);
    for (const f of attentionView.ambient) visibleIds.add(f.interactionId);
    for (const id of state.traceCache.keys()) {
      if (!visibleIds.has(id)) state.traceCache.delete(id);
    }

    requestRender();
  });

  // Subscribe to responses
  const unsubResponse = core.onResponse((response) => {
    state.inputDraft = null;
    const nextActive = core.getAttentionView().active;
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

  render();

  return new Promise<void>((resolve) => {
    const onKeypress = (_chunk: string, key: { ctrl?: boolean; name?: string; sequence?: string }) => {
      if (key.ctrl && key.name === "c") {
        close();
        return;
      }

      // Frame input active — capture all keys there
      if (state.inputDraft) {
        handleInputKeypress(core, state, key);
        requestRender();
        return;
      }

      const active = state.attentionView.active;

      // Global keys (always available)
      if (key.name === "q") {
        close();
        return;
      }

      if (key.name === "space") {
        if (state.whyMode) {
          state.whyExpanded = !state.whyExpanded;
        } else {
          state.expanded = !state.expanded;
        }
        requestRender();
        return;
      }

      if (key.name === "y") {
        state.whyMode = !state.whyMode;
        if (!state.whyMode) state.whyExpanded = false;
        requestRender();
        return;
      }

      if (!active) {
        return;
      }

      // Frame response keys
      handleActiveKeypress(core, state, active, key);
      requestRender();
    };

    const close = () => {
      clearInterval(animationInterval);
      input.off("keypress", onKeypress);
      output.off("resize", onResize);
      unsubAttention();
      unsubResponse();
      if (unsubTrace) unsubTrace();
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
): string {
  return renderAttentionScreen(state.attentionView, {
    title,
    statusLine: state.statusLine,
    color: Boolean(output.isTTY),
    height: output.rows,
    posture: state.posture,
    animation: state.animation,
    whyMode: true,
    whyExpanded: state.whyExpanded,
    trace,
  });
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
  output.write(`\u001b]0;${cleanTitle}\u0007`);
}

function clearScreen(): string {
  process.title = "Aperture";
  return "\u001B]0;Aperture\u0007\u001B[?25l\u001B[?1049h\u001B[2J\u001B[H";
}

function redrawScreen(): string {
  return "\u001B[H\u001B[2J";
}

function restoreScreen(): string {
  return "\u001B[?25h\u001B[2J\u001B[H\u001B[?1049l";
}
