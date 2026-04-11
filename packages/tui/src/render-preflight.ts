import type {
  AnimationState,
  AttentionConnectionSnapshot,
  AttentionConnectionState,
  AttentionView,
} from "./types.js";
import {
  ANSI,
  SCREEN_WIDTH,
  alignLine,
  renderPrefixedBlock,
  styleBrand,
  styleDeepMuted,
  styleKey,
  styleMuted,
  styleStrong,
  styleTitle,
  visibleLength,
} from "./ansi.js";

function isConnectionBridgeStatus(frame: AttentionView["ambient"][number]): boolean {
  if (frame.mode !== "status") {
    return false;
  }
  if (typeof frame.taskId === "string" && frame.taskId.includes(":session:bridge")) {
    return true;
  }
  return (
    typeof frame.interactionId === "string" &&
    frame.interactionId.includes(":session:bridge:status")
  );
}

export function shouldRenderPreflightScreen(
  connectionStatus: AttentionConnectionSnapshot | null,
  attentionView: AttentionView,
  showSetup = false,
): boolean {
  if (!connectionStatus || connectionStatus.entries.length === 0) {
    return false;
  }

  const hasVisibleActions =
    (connectionStatus.actions?.length ?? 0) > 0
      ? connectionStatus.actions!.some((action) => action.id !== "show-setup")
      : false;
  const hasEntryActions = connectionStatus.entries.some(
    (entry) => (entry.actions?.length ?? 0) > 0,
  );
  const needsSetup = connectionStatus.entries.some(
    (entry) => entry.state !== "ready" && entry.state !== "disabled",
  );
  const hasForegroundWork = attentionView.now !== null || attentionView.next.length > 0;
  if (showSetup && !hasForegroundWork) {
    return true;
  }
  const hasAttentionWork =
    hasForegroundWork || attentionView.ambient.some((frame) => !isConnectionBridgeStatus(frame));

  return !hasAttentionWork && (needsSetup || hasVisibleActions || hasEntryActions);
}

export function renderPreflightScreen(
  connectionStatus: AttentionConnectionSnapshot | null,
  color: boolean,
  animation: AnimationState | null,
): string[] {
  if (!connectionStatus || connectionStatus.entries.length === 0) {
    return [styleDeepMuted("    [·]", color)];
  }

  const lines: string[] = [];
  lines.push("");
  lines.push(`  ${renderIdleLens(color, animation)}`);
  lines.push("");
  lines.push(...renderPrefixedBlock("  ", styleTitle("Welcome to Aperture", color), "  "));
  lines.push(
    ...renderPrefixedBlock(
      "  ",
      styleMuted("The live attention surface for humans working with agents.", color),
      "  ",
    ),
  );
  if (connectionStatus.summary) {
    lines.push(...renderPrefixedBlock("  ", styleMuted(connectionStatus.summary, color), "  "));
  }
  lines.push("");
  lines.push(sectionHeader("setup", color));

  for (const entry of connectionStatus.entries) {
    const left = `  ${styleBrand(entry.label, color)}`;
    const right = styleConnectionState(entry.state, color);
    lines.push(alignLine(left, right, SCREEN_WIDTH));
    lines.push(
      ...renderPrefixedBlock(styleMuted("  ⎿ ", color), entry.detail, styleMuted("    ", color)),
    );
    if (entry.hint) {
      lines.push(
        ...renderPrefixedBlock(
          styleMuted("    tip ", color),
          entry.hint,
          styleMuted("        ", color),
        ),
      );
    }
    if (entry.actions && entry.actions.length > 0) {
      lines.push(...renderConnectionActionRow("    next ", entry.actions, color));
    }
  }

  return lines;
}

function renderIdleLens(color: boolean, animation: AnimationState | null): string {
  const tick = animation?.idleTick ?? 0;
  const bright = tick < 2;
  const lensGlyph = '[◉"]';
  if (!color) {
    return lensGlyph;
  }
  return bright ? `${ANSI.brand}${lensGlyph}${ANSI.reset}` : `${ANSI.dim}${lensGlyph}${ANSI.reset}`;
}

function renderConnectionActionRow(
  prefixText: string,
  actions: NonNullable<AttentionConnectionSnapshot["actions"]>,
  color: boolean,
): string[] {
  if (actions.length === 0) {
    return [];
  }

  const prefix = styleMuted(prefixText, color);
  const continuationPrefix = styleMuted(" ".repeat(prefixText.length), color);
  const segments = actions.map(
    (action) => `${styleKey(action.key, color)} ${styleMuted(action.label, color)}`,
  );
  const lines: string[] = [];
  let current = prefix;
  let currentWidth = visibleLength(prefix);

  for (const segment of segments) {
    const separator = currentWidth > visibleLength(prefix) ? "  " : "";
    const addition = `${separator}${segment}`;
    const nextWidth = currentWidth + visibleLength(addition);
    if (nextWidth > SCREEN_WIDTH && currentWidth > visibleLength(prefix)) {
      lines.push(current);
      current = `${continuationPrefix}${segment}`;
      currentWidth = visibleLength(continuationPrefix) + visibleLength(segment);
      continue;
    }
    current += addition;
    currentWidth = nextWidth;
  }

  lines.push(current);
  return lines;
}

function styleConnectionState(state: AttentionConnectionState, color: boolean): string {
  const label = humanConnectionState(state);
  switch (state) {
    case "ready":
      return styleBrand(label, color);
    case "starting":
      return styleMuted(label, color);
    case "action":
      return styleStrong(label, color);
    case "error":
      return styleStrong(label, color);
    case "disabled":
      return styleDeepMuted(label, color);
  }
}

function humanConnectionState(state: AttentionConnectionState): string {
  switch (state) {
    case "ready":
      return "ready";
    case "starting":
      return "starting";
    case "action":
      return "needs setup";
    case "error":
      return "error";
    case "disabled":
      return "off";
  }
}

function sectionHeader(label: string, color: boolean): string {
  const text = `── ${label} ──`;
  return color ? `${ANSI.dim}${text}${ANSI.reset}` : text;
}
