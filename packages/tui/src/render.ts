import { scoreAttentionFrame } from "@tomismeta/aperture-core";
import type { Frame, InputDraft, QueueGroup, RenderOptions, Posture, AnimationState, ApertureTrace } from "./types.js";
import { renderWhyOverlay } from "./render-why.js";
import { displaySourceLabel } from "./source-label.js";
import {
  ANSI,
  CONTENT_WIDTH,
  SCREEN_WIDTH,
  styleStrong,
  styleTitle,
  styleMuted,
  styleDeepMuted,
  styleKey,
  styleRank,
  styleBrand,
  styleItalicMuted,
  styleSource,
  stylePosture,
  visibleLength,
  alignLine,
  alignFooterStats,
  renderPrefixedBlock,
  formatSigned,
} from "./ansi.js";
import { renderInputDraft } from "./render-input.js";
import type { SignalSummary, AttentionState, AttentionView } from "./types.js";

export function renderAttentionScreen(
  attentionView: AttentionView,
  options?: RenderOptions,
): string {
  const lines: string[] = [];
  const color = options?.color ?? false;
  const active = attentionView.active;
  const queued = attentionView.queued;
  const ambient = attentionView.ambient;
  const posture = options?.posture ?? "calm";
  const activePendingCount = active ? countMatchingFrames(active, queued) : 0;

  lines.push(renderHeader(
    active ? 1 : 0,
    queued.length,
    ambient.length,
    posture,
    color,
    options?.animation ?? null,
  ));
  lines.push(heavyRule(color));

  lines.push(...renderActiveFrame(
    active,
    color,
    options?.expanded ?? false,
    activePendingCount,
    options?.animation ?? null,
    options?.trace ?? null,
  ));

  if (options?.inputDraft && active) {
    lines.push("");
    lines.push(sectionHeader("input", color, "focused"));
    lines.push(...renderInputDraft(active, options.inputDraft, color));
  }

  if (options?.whyMode) {
    // Why mode: replace queue + ambient with judgment trace overlay
    lines.push(...renderWhyOverlay(options.trace ?? null, color, options.whyExpanded ?? false));
  } else {
    lines.push("");
    lines.push(sectionHeader("next", color, "focused"));
    if (queued.length === 0) {
      lines.push(styleMuted('    [○"]', color));
    } else {
      for (const [index, group] of groupQueuedFrames(queued).entries()) {
        lines.push(...renderCompactFrame(group, index + 1, color));
      }
    }

    lines.push("");
    lines.push(sectionHeader("ambient", color, "ambient"));
    if (ambient.length === 0) {
      lines.push(styleDeepMuted('    [·"]', color));
    } else {
      for (const frame of ambient) {
        lines.push(...renderAmbientFrame(frame, color));
      }
    }
  }

  const footer: string[] = [];
  footer.push(heavyRule(color));
  footer.push(...renderControls(active, options?.inputDraft ?? null, options?.whyMode ?? false, options?.whyExpanded ?? false, color));

  const statsLine = renderStatsLine(options?.stats ?? null, color);
  const statusText = options?.statusLine
    ? truncateToWidth(`${styleMuted("status", color)} ${options.statusLine}`, options.statusLine, SCREEN_WIDTH)
    : null;
  if (statsLine && statusText) {
    footer.push(alignFooterStats(statsLine, statusText, SCREEN_WIDTH));
  } else if (statsLine) {
    footer.push(statsLine);
  } else if (statusText) {
    footer.push(statusText);
  }

  if (options?.height) {
    const padding = Math.max(0, options.height - lines.length - footer.length);
    for (let i = 0; i < padding; i++) {
      lines.push("");
    }
  }

  lines.push(...footer);
  return lines.join("\n");
}

// ── Header ──────────────────────────────────────────────────────────

function renderHeader(
  activeCount: number,
  queuedCount: number,
  ambientCount: number,
  posture: Posture,
  color: boolean,
  animation: AnimationState | null,
): string {
  const brand = ` ${styleMuted("/·\\", color)} ${styleBrand("APERTURE", color)}`;

  const counts = [
    summarizeCount("now", activeCount, color),
    summarizeCount("next", queuedCount, color),
    summarizeCount("ambient", ambientCount, color),
  ].join("   ");

  const flashing = animation?.postureFlash && animation.postureFlash.ticksRemaining > 0;
  const postureStr = stylePosture(posture, flashing ?? false, color);

  const left = `${brand}   ${counts}`;
  return alignLine(left, postureStr, SCREEN_WIDTH);
}

function summarizeCount(label: string, count: number, color: boolean): string {
  const text = `${label} ${count}`;
  return count > 0 ? styleStrong(text, color) : styleMuted(text, color);
}

// ── Active Frame ────────────────────────────────────────────────────

function renderActiveFrame(
  frame: Frame | null,
  color: boolean,
  expanded: boolean,
  pendingCount: number,
  animation: AnimationState | null,
  trace: ApertureTrace | null,
): string[] {
  if (!frame) {
    // Pulsing lens — alternates between brand blue and dim on idle tick
    const tick = animation?.idleTick ?? 0;
    const bright = tick < 2; // 2 ticks bright, 2 ticks dim = slow pulse
    const lensGlyph = '[◉"]';
    const lens = color
      ? (bright
        ? `${ANSI.brand}${lensGlyph}${ANSI.reset}`
        : `${ANSI.dim}${lensGlyph}${ANSI.reset}`)
      : lensGlyph;
    return [
      "",
      "",
      `    ${lens}`,
      "",
    ];
  }

  const source = displaySourceLabel(frame.source);
  const countSuffix = pendingCount > 1 ? ` ×${pendingCount}` : "";

  const entranceFlash = animation?.frameEntrance
    && animation.frameEntrance.interactionId === frame.interactionId
    && animation.frameEntrance.ticksRemaining > 0;
  const marker = entranceFlash
    ? styleStrong("⏺", color)
    : styleMuted("⏺", color);

  // Title line — give it full width, source on the right
  const rawTitle = frame.title;
  const sourceRight = styleSource(source, color);
  const markerWidth = 3; // " ⏺ "
  const maxTitle = SCREEN_WIDTH - markerWidth - source.length - countSuffix.length;
  const displayTitle = rawTitle.length > maxTitle && maxTitle > 3
    ? `${rawTitle.slice(0, maxTitle - 1)}…`
    : rawTitle;

  const titleLine = alignLine(
    ` ${marker} ${styleTitle(`${displayTitle}${countSuffix}`, color)}`,
    sourceRight,
    SCREEN_WIDTH,
  );

  // Tree connector for child lines
  const tree = styleMuted("  ⎿ ", color);
  const meta = [humanMode(frame.mode), humanTone(frame.tone), humanConsequence(frame.consequence)].join(" · ");
  const lines: string[] = [titleLine, `${tree}${styleMuted(meta, color)}`];

  if (frame.summary) {
    const sanitized = frame.summary.replace(/[\n\r]+/g, " ").trim();
    const maxSummary = CONTENT_WIDTH - 5; // "  ⎿ " prefix
    const summaryText = sanitized.length > maxSummary
      ? `${sanitized.slice(0, maxSummary - 1)}…`
      : sanitized;
    lines.push(`${tree}${styleMuted(summaryText, color)}`);
  }

  // Progress bar (always visible if present)
  if (frame.context?.progress !== undefined && frame.context.progress >= 0 && frame.context.progress <= 1) {
    lines.push(`${tree}${renderProgressBar(frame.context.progress, 30, color)}`);
  }

  // Context items — behind [space] expand to keep the default view tight
  const contextItems = frame.context?.items ?? [];
  if (expanded && contextItems.length > 0) {
    for (const item of contextItems.slice(0, 4)) {
      const val = sanitizeContextValue(String(item.value ?? "n/a"));
      const maxVal = CONTENT_WIDTH - 5 - item.label.length - 2;
      const truncatedVal = val.length > maxVal && maxVal > 3
        ? `${val.slice(0, maxVal - 1)}…`
        : val;
      lines.push(`${tree}${styleMuted(`${item.label}: ${truncatedVal}`, color)}`);
    }
  }

  // Choice options
  if (frame.responseSpec?.kind === "choice") {
    for (const [index, option] of frame.responseSpec.options.entries()) {
      lines.push(...renderPrefixedBlock(`${tree}${styleKey(String(index + 1), color)} `, option.label));
    }
    if (frame.responseSpec.allowTextResponse) {
      lines.push(...renderPrefixedBlock(`${tree}${styleKey("i", color)} `, "Type a reply"));
    }
  }

  // Judgment line — prioritize coordinator trace over frame metadata heuristics
  const judgmentLine = extractJudgmentLine(frame, trace);
  if (judgmentLine) {
    lines.push(`${tree}${styleItalicMuted(judgmentLine, color)}`);
  }

  // Expanded debug details
  if (expanded) {
    const score = readScore(frame);
    const attention = readAttention(frame);
    lines.push(`${tree}${styleMuted(`score ${score}`, color)}`);
    if (attention.scoreOffset !== 0) {
      lines.push(`${tree}${styleMuted(`offset ${formatSigned(attention.scoreOffset)}`, color)}`);
    }
    if (attention.rationale.length > 0) {
      lines.push(`${tree}${styleMuted(`why ${attention.rationale.join("; ")}`, color)}`);
    }
  }

  return lines;
}

/**
 * Extract a judgment line explaining why this frame is in front of the operator.
 *
 * Priority cascade:
 * 1. Adapter-supplied provenance.whyNow (adapter knows domain context)
 * 2. Coordinator trace: continuity overrides (the real routing decision)
 * 3. Coordinator trace: coordination.reasons (final routing explanation)
 * 4. Frame metadata heuristic rationale (candidate scoring, not routing)
 * 5. Synthesized fallback from frame properties
 */
function extractJudgmentLine(frame: Frame, trace: ApertureTrace | null): string | null {
  // 1. Adapter-supplied explanation
  if (frame.provenance?.whyNow) {
    return frame.provenance.whyNow;
  }

  // 2–3. Coordinator trace data (only available on candidate traces)
  // TypeScript can't narrow the ApertureTrace union through nested discriminants,
  // so we extract the candidate-specific fields after the kind check.
  if (trace && trace.evaluation.kind === "candidate") {
    const candidateTrace = trace as Extract<ApertureTrace, { evaluation: { kind: "candidate" } }>;

    // 2. Continuity overrides — these are the most important: they explain
    // when the engine *changed* its mind about routing (e.g. conflicting_interrupt
    // suppressed an activation, or burst_dampening deferred it)
    const overrides = candidateTrace.coordination.continuityEvaluations
      .filter((e: { kind: string; rationale: string[] }) => e.kind === "override" && e.rationale.length > 0);
    if (overrides.length > 0) {
      // Show the first override's rationale — it's the most significant routing factor
      return `${overrides[0]!.rule}: ${overrides[0]!.rationale[0]}`;
    }

    // 3. Coordination reasons — the coordinator's final routing explanation
    if (candidateTrace.coordination.reasons.length > 0) {
      return candidateTrace.coordination.reasons[0]!;
    }
  }

  // 4. Frame metadata heuristic rationale (candidate scoring context)
  const attention = frame.metadata?.attention;
  if (attention && typeof attention === "object" && "rationale" in attention && Array.isArray(attention.rationale)) {
    const first = attention.rationale[0];
    if (typeof first === "string" && first.length > 0) {
      return first;
    }
  }

  // 5. Synthesize from frame properties
  switch (frame.mode) {
    case "approval":
      return frame.consequence === "high"
        ? "High-risk action requires operator approval"
        : "Approval blocking agent progress";
    case "choice":
      return "Waiting for operator decision";
    case "form":
      return "Input needed to continue";
    case "status":
      return null; // Status frames don't need judgment lines
  }
}

function renderProgressBar(progress: number, width: number, color: boolean): string {
  const filled = Math.round(progress * width);
  const empty = width - filled;
  const bar = `${"█".repeat(filled)}${"░".repeat(empty)}`;
  const pct = `${Math.round(progress * 100)}%`;
  const text = `[${bar}] ${pct}`;
  return color ? `${ANSI.dim}${text}${ANSI.reset}` : text;
}

// ── Queue ───────────────────────────────────────────────────────────

function renderCompactFrame(group: QueueGroup, rank: number, color: boolean): string[] {
  const { frame, count } = group;
  const source = displaySourceLabel(frame.source);
  const rankStr = `${String(rank).padStart(2, "0")}`;
  const modeStr = humanMode(frame.mode);
  const countSuffix = count > 1 ? ` ×${count}` : "";
  const fixedWidth = 2 + rankStr.length + 2 + source.length + 2 + modeStr.length + countSuffix.length;
  const available = CONTENT_WIDTH - fixedWidth;
  const rawTitle = frame.title;
  const title = rawTitle.length > available && available > 3
    ? `${rawTitle.slice(0, available - 1)}…`
    : rawTitle;
  const displayTitle = count > 1 ? `${title}${countSuffix}` : title;
  const left = `  ${styleRank(rank, color)} ${styleTitle(displayTitle, color)} ${styleSource(source, color)}`;
  const right = styleMuted(modeStr, color);
  return [`${alignLine(left, right, SCREEN_WIDTH)}`];
}

export function groupQueuedFrames(frames: Frame[]): QueueGroup[] {
  const groups = new Map<string, QueueGroup>();
  const ordered: QueueGroup[] = [];

  for (const frame of frames) {
    const key = queueGroupKey(frame);
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }

    const group = { frame, count: 1 };
    groups.set(key, group);
    ordered.push(group);
  }

  return ordered;
}

function queueGroupKey(frame: Frame): string {
  const source = frame.source?.label ?? frame.source?.id ?? "";
  return [frame.mode, frame.tone, frame.consequence, frame.title, frame.summary ?? "", source].join("::");
}

export function countMatchingFrames(frame: Frame, queued: Frame[]): number {
  const key = queueGroupKey(frame);
  let count = 1;
  for (const queuedFrame of queued) {
    if (queueGroupKey(queuedFrame) === key) {
      count += 1;
    }
  }
  return count;
}

// ── Ambient ─────────────────────────────────────────────────────────

function renderAmbientFrame(frame: Frame, color: boolean): string[] {
  const source = displaySourceLabel(frame.source);
  return [
    `  ${styleMuted("~", color)} ${styleDeepMuted(frame.title, color)} ${styleMuted("·", color)} ${styleDeepMuted(source, color)}`,
  ];
}

// ── Section Headers ─────────────────────────────────────────────────

function sectionHeader(label: string, color: boolean, _tone: Frame["tone"]): string {
  const dashes = "──";
  const text = `${dashes} ${label} ${dashes}`;
  return color ? `${ANSI.dim}${text}${ANSI.reset}` : text;
}

function heavyRule(color: boolean): string {
  const line = "━".repeat(SCREEN_WIDTH);
  return color ? `${ANSI.dim}${line}${ANSI.reset}` : line;
}

// ── Controls ────────────────────────────────────────────────────────

function renderControls(
  active: Frame | null,
  inputDraft: InputDraft | null,
  whyMode: boolean,
  whyExpanded: boolean,
  color: boolean,
): string[] {
  if (!active) {
    return [`${styleMuted("controls", color)} ${styleKey("q", color)} quit`];
  }

  if (inputDraft) {
    return [
      `${styleMuted("controls", color)} ${styleKey("type", color)} edit  ${styleKey("enter", color)} next/submit  ${styleKey("esc", color)} cancel  ${styleKey("q", color)} quit`,
    ];
  }

  const parts: string[] = [];
  const label = (text: string) => styleMuted(text, color);

  // Response actions
  switch (active.responseSpec?.kind) {
    case "acknowledge":
      parts.push(`${styleKey("⏎", color)}${label("ack")}`);
      parts.push(`${styleKey("x", color)}${label("dismiss")}`);
      break;
    case "approval":
      parts.push(`${styleKey("a", color)}${label("approve")}`);
      parts.push(`${styleKey("r", color)}${label("reject")}`);
      parts.push(`${styleKey("x", color)}${label("dismiss")}`);
      break;
    case "choice":
      parts.push(`${styleKey("1-9", color)}${label("choose")}`);
      if (active.responseSpec.allowTextResponse && !whyMode) {
        parts.push(`${styleKey("i", color)}${label("reply")}`);
      }
      parts.push(`${styleKey("x", color)}${label("dismiss")}`);
      break;
    case "form":
      if (!whyMode) parts.push(`${styleKey("i", color)}${label("input")}`);
      parts.push(`${styleKey("x", color)}${label("dismiss")}`);
      break;
  }

  // View controls — ⎵ does double duty: detail on main, expand on why
  if (whyMode) {
    parts.push(`${styleKey("⎵", color)}${label(whyExpanded ? "collapse" : "expand")}`);
    parts.push(`${styleKey("y", color)}${label("close")}`);
  } else {
    parts.push(`${styleKey("⎵", color)}${label("detail")}`);
    parts.push(`${styleKey("y", color)}${label("why")}`);
  }
  parts.push(`${styleKey("q", color)}${label("quit")}`);

  return [parts.join("  ")];
}

// ── Stats ───────────────────────────────────────────────────────────

function renderStatsLine(
  stats: { summary: SignalSummary; state: AttentionState } | null,
  color: boolean,
): string | null {
  if (!stats || stats.summary.counts.presented < 5) {
    return null;
  }

  const { summary, state } = stats;
  const routed = `${summary.counts.presented} routed`;
  const responded = `${summary.counts.responded} responded`;
  const avg = summary.averageResponseLatencyMs !== null
    ? `${Math.round(summary.averageResponseLatencyMs)}ms avg`
    : null;

  const parts = [routed, responded];
  if (avg) {
    parts.push(avg);
  }

  const statsText = parts.map((p) => styleMuted(p, color)).join(styleMuted(" · ", color));
  const stateColored = state === "engaged" || state === "monitoring"
    ? styleStrong(state, color)
    : styleMuted(state, color);

  return `${statsText} ${styleMuted("·", color)} ${stateColored}`;
}

// ── Helpers ─────────────────────────────────────────────────────────

function readScore(frame: Frame): number {
  const attention = frame.metadata?.attention;
  if (attention && typeof attention === "object" && "score" in attention && typeof attention.score === "number") {
    return attention.score;
  }
  return scoreAttentionFrame(frame);
}

function readAttention(frame: Frame): { scoreOffset: number; rationale: string[] } {
  const attention = frame.metadata?.attention;
  if (!attention || typeof attention !== "object") {
    return { scoreOffset: 0, rationale: [] };
  }

  const scoreOffset =
    "scoreOffset" in attention && typeof attention.scoreOffset === "number"
      ? attention.scoreOffset
      : 0;
  const rationale =
    "rationale" in attention && Array.isArray(attention.rationale)
      ? attention.rationale.filter((item): item is string => typeof item === "string")
      : [];

  return { scoreOffset, rationale };
}

export function humanMode(mode: Frame["mode"]): string {
  switch (mode) {
    case "approval": return "permission";
    case "choice": return "choose";
    case "form": return "input needed";
    case "status": return "update";
    default: return mode;
  }
}

export function humanTone(tone: Frame["tone"]): string {
  switch (tone) {
    case "critical": return "urgent";
    case "focused": return "needs attention";
    case "ambient": return "low urgency";
    default: return tone;
  }
}

export function humanConsequence(consequence: Frame["consequence"]): string {
  switch (consequence) {
    case "high": return "high risk";
    case "medium": return "medium risk";
    case "low": return "low risk";
    default: return consequence;
  }
}

/** Collapse newlines and trim context item values to a single line. */
function sanitizeContextValue(value: unknown): string {
  const raw = value === undefined || value === null ? "n/a" : String(value);
  return raw.replace(/[\n\r]+/g, " ").trim();
}

/** Truncate a styled string by its visible (plain) content to fit width. */
function truncateToWidth(styled: string, plain: string, maxWidth: number): string {
  if (plain.length + 7 <= maxWidth) return styled; // "status " prefix = 7 chars
  const available = maxWidth - 7 - 1; // leave room for …
  if (available <= 0) return "";
  const truncatedPlain = plain.slice(0, available) + "…";
  return `${ANSI.dim}status${ANSI.reset} ${truncatedPlain}`;
}
