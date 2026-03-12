import { emitKeypressEvents } from "node:readline";
import { stdin as defaultInput, stdout as defaultOutput } from "node:process";

import { scoreFrame } from "@aperture/core";
import type {
  AttentionState,
  AttentionView,
  Frame,
  FrameField,
  FrameResponse,
  FrameResponseSpec,
  SignalSummary,
} from "@aperture/core";

type InputLike = NodeJS.ReadStream & {
  setRawMode?: (mode: boolean) => void;
  isTTY?: boolean;
};

type OutputLike = NodeJS.WriteStream;

type AttentionSurface = {
  getAttentionView(): AttentionView;
  getSignalSummary(): SignalSummary;
  getAttentionState(): AttentionState;
  subscribeAttentionView(listener: (attentionView: AttentionView) => void): () => void;
  onResponse(listener: (response: FrameResponse) => void): () => void;
  submit(response: FrameResponse): void;
};

export type AttentionTuiOptions = {
  title?: string;
  input?: InputLike;
  output?: OutputLike;
};

type FormDraft = {
  interactionId: string;
  fieldIndex: number;
  values: Record<string, unknown>;
  buffer: string;
};

type TuiState = {
  attentionView: AttentionView;
  statusLine: string;
  formDraft: FormDraft | null;
  expanded: boolean;
};

type QueueGroup = {
  frame: Frame;
  count: number;
};

const PANEL_CONTENT_WIDTH = 74;
const PANEL_BORDER_WIDTH = PANEL_CONTENT_WIDTH + 2;
const SCREEN_WIDTH = PANEL_BORDER_WIDTH + 2;

export function renderAttentionScreen(
  attentionView: AttentionView,
  options?: {
    title?: string;
    statusLine?: string;
    formDraft?: FormDraft | null;
    color?: boolean;
    height?: number;
    stats?: { summary: SignalSummary; state: AttentionState } | null;
    expanded?: boolean;
  },
): string {
  const lines: string[] = [];
  const title = options?.title ?? "Aperture TUI";
  const statusLine = options?.statusLine ?? "";
  const color = options?.color ?? false;
  const active = attentionView.active;
  const queued = attentionView.queued;
  const ambient = attentionView.ambient;
  const globalTone = active?.tone ?? (queued[0]?.tone ?? "ambient");
  const activePendingCount = active ? countMatchingFrames(active, queued) : 0;

  lines.push(...renderMasthead(title, color, globalTone));
  lines.push(horizontalRule(color));
  lines.push(
    alignLine(
      [
        summarizeColumn("active", active ? 1 : 0, color, globalTone),
        summarizeColumn("queued", queued.length, color, "focused"),
        summarizeColumn("ambient", ambient.length, color, "ambient"),
      ].join("   "),
      `${styleMuted("posture", color)} ${styleTone(globalTone, color)}`,
      SCREEN_WIDTH,
    ),
  );
  lines.push(horizontalRule(color));
  lines.push(styleSection("ACTIVE NOW", color, globalTone));
  lines.push(...renderFocusPane(active, color, options?.expanded ?? false, activePendingCount));

  if (options?.formDraft && active) {
    lines.push("");
    lines.push(styleSection("INPUT", color, "focused"));
    lines.push(...renderFormDraft(active, options.formDraft, color));
  }

  lines.push("");
  lines.push(styleSection("QUEUE", color, "focused"));
  if (queued.length === 0) {
    lines.push(styleMuted("  no queued work", color));
  } else {
    for (const [index, group] of groupQueuedFrames(queued).entries()) {
      lines.push(...renderCompactFrame(group, index + 1, color));
    }
  }

  lines.push("");
  lines.push(styleSection("AMBIENT", color, "ambient"));
  if (ambient.length === 0) {
    lines.push(styleMuted("  calm background", color));
  } else {
    for (const frame of ambient) {
      lines.push(...renderAmbientFrame(frame, color));
    }
  }

  const footer: string[] = [];
  footer.push(horizontalRule(color));
  footer.push(...renderControls(active, options?.formDraft ?? null, color));
  const statsLine = renderStatsLine(options?.stats ?? null, color);
  if (statsLine && statusLine) {
    footer.push(alignFooterStats(statsLine, `${styleMuted("status", color)} ${statusLine}`, SCREEN_WIDTH));
  } else if (statsLine) {
    footer.push(statsLine);
  } else if (statusLine) {
    footer.push(`${styleMuted("status", color)} ${statusLine}`);
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

export async function runAttentionTui(
  core: AttentionSurface,
  options?: AttentionTuiOptions,
): Promise<void> {
  const input = options?.input ?? defaultInput;
  const output = options?.output ?? defaultOutput;
  const state: TuiState = {
    attentionView: core.getAttentionView(),
    statusLine: "Waiting for events",
    formDraft: null,
    expanded: false,
  };

  const cleanup = setupTerminal(input, output);
  const render = () => {
    output.write(clearScreen());
    output.write(
      renderAttentionScreen(state.attentionView, {
        title: options?.title ?? "Aperture TUI",
        statusLine: state.statusLine,
        formDraft: state.formDraft,
        expanded: state.expanded,
        color: Boolean(output.isTTY),
        height: output.rows,
        stats: {
          summary: core.getSignalSummary(),
          state: core.getAttentionState(),
        },
      }),
    );
  };

  const onResize = () => render();
  output.on("resize", onResize);

  const unsubAttention = core.subscribeAttentionView((attentionView) => {
    const previousActiveId = state.attentionView.active?.interactionId ?? null;
    state.attentionView = attentionView;
    const active = attentionView.active;
    if (!active) {
      state.formDraft = null;
      state.expanded = false;
      state.statusLine = "Nothing currently needs attention";
    } else if (active.interactionId !== previousActiveId) {
      state.statusLine = `Focused on ${active.title}`;
    } else if (state.formDraft && state.formDraft.interactionId !== active.interactionId) {
      state.formDraft = null;
      state.expanded = false;
      state.statusLine = `Focused on ${active.title}`;
    }
    render();
  });

  const unsubResponse = core.onResponse((response) => {
    state.formDraft = null;
    const nextActive = core.getAttentionView().active;
    state.statusLine = describeResponse(response, nextActive);
    render();
  });

  render();

  return new Promise<void>((resolve) => {
    const onKeypress = (_chunk: string, key: { ctrl?: boolean; name?: string; sequence?: string }) => {
      if (key.ctrl && key.name === "c") {
        close();
        return;
      }

      if (state.formDraft) {
        handleFormKeypress(core, state, key);
        render();
        return;
      }

      const active = state.attentionView.active;
      if (!active) {
        if (key.name === "q") {
          close();
        }
        return;
      }

      if (key.name === "q") {
        close();
        return;
      }

      if (key.name === "space") {
        state.expanded = !state.expanded;
        render();
        return;
      }

      handleActiveKeypress(core, state, active, key);
      render();
    };

    const close = () => {
      input.off("keypress", onKeypress);
      output.off("resize", onResize);
      unsubAttention();
      unsubResponse();
      cleanup();
      resolve();
    };

    input.on("keypress", onKeypress);
  });
}

function handleActiveKeypress(
  core: AttentionSurface,
  state: TuiState,
  frame: Frame,
  key: { name?: string; sequence?: string },
): void {
  const spec = frame.responseSpec;
  if (!spec || spec.kind === "none") {
    return;
  }

  switch (spec.kind) {
    case "acknowledge": {
      if (key.name === "return" || key.name === "a") {
        core.submit(acknowledgedResponse(frame));
      } else if (key.name === "x" || key.name === "escape") {
        core.submit(dismissedResponse(frame));
      } else {
        state.statusLine = "Use [enter] acknowledge or [x] dismiss";
      }
      break;
    }
    case "approval": {
      if (key.name === "a") {
        core.submit(approvedResponse(frame));
      } else if (key.name === "r") {
        core.submit(rejectedResponse(frame));
      } else if (key.name === "x" || key.name === "escape") {
        core.submit(dismissedResponse(frame));
      } else {
        state.statusLine = "Use [a] approve, [r] reject, [x] dismiss";
      }
      break;
    }
    case "choice": {
      const index = parseDigit(key.sequence);
      if (index !== null) {
        const option = spec.options[index];
        if (option) {
          core.submit({
            taskId: frame.taskId,
            interactionId: frame.interactionId,
            response: { kind: "option_selected", optionIds: [option.id] },
          });
        } else {
          state.statusLine = "That choice is out of range";
        }
      } else if (key.name === "x" || key.name === "escape") {
        core.submit(dismissedResponse(frame));
      } else {
        state.statusLine = "Press the option number to select it";
      }
      break;
    }
    case "form": {
      if (key.name === "i" || key.name === "return") {
        state.formDraft = createFormDraft(frame);
        state.statusLine = `Editing ${spec.fields[0]?.label ?? "form"}`;
      } else if (key.name === "x" || key.name === "escape") {
        core.submit(dismissedResponse(frame));
      } else {
        state.statusLine = "Press [i] to fill the form";
      }
      break;
    }
  }
}

function handleFormKeypress(
  core: AttentionSurface,
  state: TuiState,
  key: { name?: string; sequence?: string; ctrl?: boolean },
): void {
  const active = state.attentionView.active;
  const draft = state.formDraft;
  if (!active || !draft || !active.responseSpec || active.responseSpec.kind !== "form") {
    state.formDraft = null;
    return;
  }

  const field = active.responseSpec.fields[draft.fieldIndex];
  if (!field) {
    state.formDraft = null;
    return;
  }

  if (key.name === "escape") {
    state.formDraft = null;
    state.statusLine = "Form editing cancelled";
    return;
  }

  if (key.name === "backspace") {
    draft.buffer = draft.buffer.slice(0, -1);
    return;
  }

  if (key.name === "return") {
    draft.values[field.id] = normalizeFieldValue(field, draft.buffer);
    const nextIndex = draft.fieldIndex + 1;
    if (nextIndex >= active.responseSpec.fields.length) {
      core.submit({
        taskId: active.taskId,
        interactionId: active.interactionId,
        response: { kind: "form_submitted", values: draft.values },
      });
      state.formDraft = null;
      return;
    }

    draft.fieldIndex = nextIndex;
    draft.buffer = fieldSeed(active.responseSpec.fields[nextIndex], draft.values);
    state.statusLine = `Editing ${active.responseSpec.fields[nextIndex]?.label ?? "form"}`;
    return;
  }

  if (key.sequence && key.sequence.length === 1 && !key.ctrl) {
    draft.buffer += key.sequence;
  }
}

function createFormDraft(frame: Frame): FormDraft {
  const spec = frame.responseSpec;
  if (!spec || spec.kind !== "form") {
    return {
      interactionId: frame.interactionId,
      fieldIndex: 0,
      values: {},
      buffer: "",
    };
  }

  return {
    interactionId: frame.interactionId,
    fieldIndex: 0,
    values: {},
    buffer: fieldSeed(spec.fields[0], {}),
  };
}

function fieldSeed(field: FrameField | undefined, values: Record<string, unknown>): string {
  if (!field) {
    return "";
  }
  const value = values[field.id];
  return typeof value === "string" ? value : value === undefined ? "" : String(value);
}

function normalizeFieldValue(field: FrameField, raw: string): unknown {
  switch (field.type) {
    case "number":
      return raw.trim() === "" ? raw : Number(raw);
    case "boolean":
      return /^(1|true|y|yes)$/i.test(raw.trim());
    default:
      return raw;
  }
}

function renderFormDraft(frame: Frame, formDraft: FormDraft, color: boolean): string[] {
  const spec = frame.responseSpec;
  if (!spec || spec.kind !== "form") {
    return [];
  }

  return spec.fields.map((field, index) => {
    const marker = index === formDraft.fieldIndex ? styleAccent("›", color) : styleMuted("·", color);
    const value = index === formDraft.fieldIndex
      ? formDraft.buffer
      : stringifyFieldValue(formDraft.values[field.id]);
    return `  ${marker} ${styleStrong(field.label, color)} ${styleMuted("·", color)} ${value || styleMuted("(empty)", color)}`;
  });
}

function stringifyFieldValue(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

function renderControls(active: Frame | null, formDraft: FormDraft | null, color: boolean): string[] {
  if (!active) {
    return [`${styleMuted("controls", color)} ${styleKey("q", color)} quit`];
  }

  if (formDraft) {
    return [
      `${styleMuted("controls", color)} ${styleKey("type", color)} edit  ${styleKey("enter", color)} next/submit  ${styleKey("esc", color)} cancel  ${styleKey("q", color)} quit`,
    ];
  }

  const detail = `${styleKey("space", color)} detail`;
  switch (active.responseSpec?.kind) {
    case "acknowledge":
      return [
        `${styleMuted("controls", color)} ${styleKey("enter", color)} acknowledge  ${styleKey("x", color)} dismiss  ${detail}  ${styleKey("q", color)} quit`,
      ];
    case "approval":
      return [
        `${styleMuted("controls", color)} ${styleKey("a", color)} approve  ${styleKey("r", color)} reject  ${styleKey("x", color)} dismiss  ${detail}  ${styleKey("q", color)} quit`,
      ];
    case "choice":
      return [
        `${styleMuted("controls", color)} ${styleKey("1-9", color)} choose  ${styleKey("x", color)} dismiss  ${detail}  ${styleKey("q", color)} quit`,
      ];
    case "form":
      return [
        `${styleMuted("controls", color)} ${styleKey("i", color)} input  ${styleKey("x", color)} dismiss  ${detail}  ${styleKey("q", color)} quit`,
      ];
    default:
      return [`${styleMuted("controls", color)} ${detail}  ${styleKey("q", color)} quit`];
  }
}

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
    ? styleAccent(state, color)
    : styleMuted(state, color);

  return `${statsText} ${styleMuted("·", color)} ${stateColored}`;
}

function renderFocusPane(
  frame: Frame | null,
  color: boolean,
  expanded = false,
  pendingCount = 0,
): string[] {
  if (!frame) {
    return panel(
      [
        styleMuted("no active frame", color),
        "",
        styleMuted("the surface is intentionally calm", color),
      ],
      color,
      "ambient",
    );
  }

  const source = frame.source?.label ?? frame.source?.id ?? "unknown";
  const score = readScore(frame);
  const attention = readAttention(frame);
  const countSuffix = pendingCount > 1 ? ` ×${pendingCount}` : "";
  // Truncate title to fit on one line with source: "title · source"
  const sourceChunk = ` · ${source}`;
  const maxTitle = PANEL_CONTENT_WIDTH - sourceChunk.length - countSuffix.length;
  const rawTitle = frame.title;
  const truncatedTitle = rawTitle.length > maxTitle && maxTitle > 3
    ? `${rawTitle.slice(0, maxTitle - 1)}…`
    : rawTitle;
  const title = `${truncatedTitle}${countSuffix}`;
  const meta = [humanMode(frame.mode), humanTone(frame.tone), humanConsequence(frame.consequence)]
    .map((p) => styleMuted(p, color))
    .join(styleMuted(" · ", color));
  const lines = [
    `${styleStrong(title, color)} ${styleMuted("·", color)} ${styleAccent(source, color)}`,
    meta,
  ];

  if (frame.summary) {
    lines.push("");
    const summaryText = frame.summary.length > PANEL_CONTENT_WIDTH
      ? `${frame.summary.slice(0, PANEL_CONTENT_WIDTH - 1)}…`
      : frame.summary;
    lines.push(styleMuted(summaryText, color));
  }

  if (expanded && frame.context?.items?.length) {
    lines.push("");
    lines.push(styleMuted("context", color));
    for (const item of frame.context.items.slice(0, 4)) {
      lines.push(...renderLabeledBlock(item.label, String(item.value ?? "n/a"), color));
    }
  }

  if (frame.responseSpec?.kind === "choice") {
    lines.push("");
    lines.push(styleMuted("options", color));
    for (const [index, option] of frame.responseSpec.options.entries()) {
      lines.push(...renderPrefixedBlock(`${styleKey(String(index + 1), color)} `, option.label));
    }
  }

  if (expanded) {
    lines.push("");
    lines.push(...renderLabeledBlock("score", String(score), color));
    if (attention.scoreOffset !== 0) {
      lines.push(...renderLabeledBlock("offset", formatSigned(attention.scoreOffset), color));
    }
    if (attention.rationale.length > 0) {
      lines.push(...renderLabeledBlock("why", attention.rationale.join("; "), color));
    }
  }

  return panel(lines, color, frame.tone);
}

function renderCompactFrame(group: QueueGroup, rank: number, color: boolean): string[] {
  const { frame, count } = group;
  const source = frame.source?.label ?? frame.source?.id ?? "unknown";
  const rankStr = `[${String(rank).padStart(2, "0")}]`;
  const modeStr = humanMode(frame.mode);
  const countSuffix = count > 1 ? ` ×${count}` : "";
  // Available width: line width - indent(2) - rank - spaces(3) - source - mode
  const fixedWidth = 2 + rankStr.length + 1 + source.length + 1 + modeStr.length + 2 + countSuffix.length;
  const available = PANEL_CONTENT_WIDTH - fixedWidth;
  const rawTitle = frame.title;
  const title = rawTitle.length > available && available > 3
    ? `${rawTitle.slice(0, available - 1)}…`
    : rawTitle;
  const displayTitle = count > 1 ? `${title}${countSuffix}` : title;
  const left = `${styleRank(rank, color)} ${styleStrong(displayTitle, color)} ${styleAccent(source, color)}`;
  const right = styleMuted(modeStr, color);
  return [`  ${alignLine(left, right, PANEL_CONTENT_WIDTH - 2)}`];
}

function groupQueuedFrames(frames: Frame[]): QueueGroup[] {
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

function countMatchingFrames(frame: Frame, queued: Frame[]): number {
  const key = queueGroupKey(frame);
  let count = 1;
  for (const queuedFrame of queued) {
    if (queueGroupKey(queuedFrame) === key) {
      count += 1;
    }
  }
  return count;
}

function renderAmbientFrame(frame: Frame, color: boolean): string[] {
  const source = frame.source?.label ?? frame.source?.id ?? "unknown";
  return [
    `  ${styleMuted("~", color)} ${styleDeepMuted(frame.title, color)} ${styleMuted("·", color)} ${styleDeepMuted(source, color)}`,
  ];
}

function summarizeColumn(label: string, count: number, color: boolean, tone: Frame["tone"]): string {
  const text = `${label} ${count}`;
  return color ? `${toneColor(tone)}${ANSI.bold}${text}${ANSI.reset}` : text;
}

function horizontalRule(color: boolean): string {
  const line = "─".repeat(SCREEN_WIDTH);
  return color ? `${ANSI.dim}${line}${ANSI.reset}` : line;
}

function clearScreen(): string {
  return "\u001B[?25l\u001B[?1049h\u001B[2J\u001B[H";
}

function restoreScreen(): string {
  return "\u001B[?25h\u001B[2J\u001B[H\u001B[?1049l";
}

function setupTerminal(input: InputLike, output: OutputLike): () => void {
  emitKeypressEvents(input);
  if (input.isTTY && input.setRawMode) {
    input.setRawMode(true);
  }
  input.resume();
  output.write(clearScreen());

  return () => {
    if (input.isTTY && input.setRawMode) {
      input.setRawMode(false);
    }
    input.pause();
    output.write(restoreScreen());
  };
}

function describeResponse(response: FrameResponse, nextActive: Frame | null): string {
  const base = responseLabel(response);
  if (nextActive && nextActive.interactionId !== response.interactionId) {
    return `${base} · focused on ${nextActive.title}`;
  }

  return base;
}

function responseLabel(response: FrameResponse): string {
  switch (response.response.kind) {
    case "acknowledged":
      return "Acknowledged";
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "dismissed":
      return "Dismissed";
    case "option_selected":
      return `Selected ${response.response.optionIds.join(", ")}`;
    case "form_submitted":
      return "Submitted form";
  }
}

function approvedResponse(frame: Frame): FrameResponse {
  return {
    taskId: frame.taskId,
    interactionId: frame.interactionId,
    response: { kind: "approved" },
  };
}

function acknowledgedResponse(frame: Frame): FrameResponse {
  return {
    taskId: frame.taskId,
    interactionId: frame.interactionId,
    response: { kind: "acknowledged" },
  };
}

function rejectedResponse(frame: Frame): FrameResponse {
  return {
    taskId: frame.taskId,
    interactionId: frame.interactionId,
    response: { kind: "rejected" },
  };
}

function dismissedResponse(frame: Frame): FrameResponse {
  return {
    taskId: frame.taskId,
    interactionId: frame.interactionId,
    response: { kind: "dismissed" },
  };
}

function parseDigit(sequence: string | undefined): number | null {
  if (!sequence || sequence.length !== 1) {
    return null;
  }
  const numeric = Number.parseInt(sequence, 10);
  if (Number.isNaN(numeric) || numeric < 1) {
    return null;
  }
  return numeric - 1;
}

function readScore(frame: Frame): number {
  const attention = frame.metadata?.attention;
  if (attention && typeof attention === "object" && "score" in attention && typeof attention.score === "number") {
    return attention.score;
  }
  return scoreFrame(frame);
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

const ANSI = {
  reset: "\u001B[0m",
  bold: "\u001B[1m",
  dim: "\u001B[2m",
  white: "\u001B[97m",
  gray: "\u001B[90m",
  blue: "\u001B[94m",
  brightPurple: "\u001B[95m",
} as const;

function toneColor(tone: Frame["tone"]): string {
  switch (tone) {
    case "critical":
      return ANSI.brightPurple;
    case "focused":
      return ANSI.blue;
    default:
      return ANSI.gray;
  }
}

function styleSection(value: string, color: boolean, tone: Frame["tone"]): string {
  const label = `▸ ${value} `;
  const fill = "·".repeat(Math.max(0, SCREEN_WIDTH - label.length));
  return color
    ? `${ANSI.bold}${toneColor(tone)}${label}${ANSI.reset}${ANSI.dim}${fill}${ANSI.reset}`
    : `${label}${fill}`;
}

function styleStrong(value: string, color: boolean): string {
  return color ? `${ANSI.bold}${ANSI.white}${value}${ANSI.reset}` : value;
}

function styleMuted(value: string, color: boolean): string {
  return color ? `${ANSI.dim}${value}${ANSI.reset}` : value;
}

function styleDeepMuted(value: string, color: boolean): string {
  return color ? `${ANSI.dim}${ANSI.gray}${value}${ANSI.reset}` : value;
}

function styleAccent(value: string, color: boolean): string {
  return color ? `${ANSI.brightPurple}${value}${ANSI.reset}` : value;
}

function styleTone(value: string, color: boolean): string {
  if (!color) {
    return value;
  }
  return `${toneColor(value as Frame["tone"])}${value}${ANSI.reset}`;
}

function styleScore(score: number, color: boolean): string {
  const value = `score ${score}`;
  return color ? `${ANSI.bold}${ANSI.brightPurple}${value}${ANSI.reset}` : value;
}

function styleKey(value: string, color: boolean): string {
  const wrapped = `[${value}]`;
  return color ? `${ANSI.bold}${ANSI.brightPurple}${wrapped}${ANSI.reset}` : wrapped;
}

function styleRank(rank: number, color: boolean): string {
  const value = `[${String(rank).padStart(2, "0")}]`;
  return color ? `${ANSI.bold}${ANSI.brightPurple}${value}${ANSI.reset}` : value;
}

function renderMasthead(_title: string, color: boolean, _tone: Frame["tone"]): string[] {
  return [
    "",
    `  ${styleAccent("/·\\", color)}  ${styleBrand("APERTURE", color)}`,
    `  ${styleAccent("\\·/", color)}  ${styleDeepMuted("The human attention engine for multi-agent systems.", color)}`,
    "",
  ];
}

function styleBrand(value: string, color: boolean): string {
  return color ? `${ANSI.bold}${ANSI.brightPurple}${value}${ANSI.reset}` : value;
}

function panel(lines: string[], color: boolean, tone: Frame["tone"]): string[] {
  const top = color
    ? `${toneColor(tone)}╭${"─".repeat(PANEL_BORDER_WIDTH)}╮${ANSI.reset}`
    : `╭${"─".repeat(PANEL_BORDER_WIDTH)}╮`;
  const bottom = color
    ? `${toneColor(tone)}╰${"─".repeat(PANEL_BORDER_WIDTH)}╯${ANSI.reset}`
    : `╰${"─".repeat(PANEL_BORDER_WIDTH)}╯`;

  return [top, ...lines.map((line) => wrapBoxLine(line)), bottom];
}

function renderLabeledBlock(label: string, value: string, color: boolean): string[] {
  return renderPrefixedBlock(`${styleMuted(`${label} `, color)}`, value, `${" ".repeat(label.length)} `);
}

function renderPrefixedBlock(prefix: string, value: string, continuationPrefix = "    "): string[] {
  const prefixWidth = visibleLength(prefix);
  const wrapped = wrapText(value, PANEL_CONTENT_WIDTH - prefixWidth);
  return wrapped.map((line, index) => `${index === 0 ? prefix : continuationPrefix}${line}`);
}

function wrapBoxLine(value: string): string {
  const padded = padVisible(value, PANEL_CONTENT_WIDTH);
  return `│ ${padded} │`;
}

function padVisible(value: string, width: number): string {
  const visible = visibleLength(value);
  if (visible < width) {
    return `${value}${" ".repeat(width - visible)}`;
  }
  if (visible > width) {
    return truncateVisible(value, width);
  }
  return value;
}

function truncateVisible(value: string, width: number): string {
  if (width < 1) return "";
  let visible = 0;
  let i = 0;
  const ansiPattern = /\u001B\[[0-9;]*m/;
  while (i < value.length && visible < width) {
    const remaining = value.slice(i);
    const match = remaining.match(ansiPattern);
    if (match && match.index === 0) {
      i += match[0].length;
      continue;
    }
    visible++;
    i++;
  }
  // Collect any trailing ANSI reset sequences
  const tail = value.slice(i);
  const trailingAnsi = tail.match(/^(\u001B\[[0-9;]*m)+/);
  if (trailingAnsi) {
    return value.slice(0, i) + trailingAnsi[0];
  }
  return value.slice(0, i) + ANSI.reset;
}

function alignLine(left: string, right: string, width: number): string {
  const gap = width - visibleLength(left) - visibleLength(right);
  if (gap <= 1) {
    return left;
  }
  return `${left}${" ".repeat(gap)}${right}`;
}

function alignFooterStats(left: string, right: string, width: number): string {
  const rightWidth = visibleLength(right);
  if (rightWidth >= width) {
    return truncateVisible(right, width);
  }

  const availableLeft = Math.max(0, width - rightWidth - 1);
  if (availableLeft === 0) {
    return right;
  }

  const fittedLeft = visibleLength(left) > availableLeft
    ? truncateVisible(left, Math.max(1, availableLeft - 1))
    : left;
  const gap = Math.max(1, width - visibleLength(fittedLeft) - rightWidth);
  return `${fittedLeft}${" ".repeat(gap)}${right}`;
}

function formatSigned(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function humanMode(mode: Frame["mode"]): string {
  switch (mode) {
    case "approval": return "permission";
    case "choice": return "choose";
    case "form": return "input needed";
    case "status": return "update";
    default: return mode;
  }
}

function humanTone(tone: Frame["tone"]): string {
  switch (tone) {
    case "critical": return "urgent";
    case "focused": return "needs attention";
    case "ambient": return "low urgency";
    default: return tone;
  }
}

function humanConsequence(consequence: Frame["consequence"]): string {
  switch (consequence) {
    case "high": return "high risk";
    case "medium": return "medium risk";
    case "low": return "low risk";
    default: return consequence;
  }
}

function wrapText(value: string, width: number): string[] {
  const normalized = value.trim();
  if (normalized === "" || width < 1) {
    return [""];
  }

  const words = normalized.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    // Hard-break words that exceed the available width
    const chunks = hardBreak(word, width);

    for (const chunk of chunks) {
      if (current === "") {
        current = chunk;
        continue;
      }

      if (`${current} ${chunk}`.length <= width) {
        current = `${current} ${chunk}`;
        continue;
      }

      lines.push(current);
      current = chunk;
    }
  }

  if (current !== "") {
    lines.push(current);
  }

  return lines;
}

function hardBreak(word: string, width: number): string[] {
  if (word.length <= width) {
    return [word];
  }

  const chunks: string[] = [];
  let offset = 0;
  while (offset < word.length) {
    chunks.push(word.slice(offset, offset + width));
    offset += width;
  }
  return chunks;
}

function visibleLength(value: string): number {
  return stripAnsi(value).length;
}

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;]*m/g, "");
}
