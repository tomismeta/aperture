import { emitKeypressEvents } from "node:readline";
import { stdin as defaultInput, stdout as defaultOutput } from "node:process";

import { scoreFrame } from "@aperture/core";
import type {
  ApertureCore,
  AttentionView,
  Frame,
  FrameField,
  FrameResponse,
  FrameResponseSpec,
} from "@aperture/core";

type InputLike = NodeJS.ReadStream & {
  setRawMode?: (mode: boolean) => void;
  isTTY?: boolean;
};

type OutputLike = NodeJS.WriteStream;

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
};

export function renderAttentionScreen(
  attentionView: AttentionView,
  options?: {
    title?: string;
    statusLine?: string;
    formDraft?: FormDraft | null;
    color?: boolean;
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

  lines.push(styleTitle(title, color));
  lines.push(
    [
      summarizeColumn("● active", active ? 1 : 0, color, globalTone),
      summarizeColumn("◦ queued", queued.length, color, "focused"),
      summarizeColumn("· ambient", ambient.length, color, "ambient"),
    ].join("   "),
  );
  lines.push(horizontalRule(color));
  lines.push(styleSection("Active now", color, globalTone));
  lines.push(...renderFocusPane(active, color));

  if (options?.formDraft && active) {
    lines.push("");
    lines.push(styleSection("Input", color, "focused"));
    lines.push(...renderFormDraft(active, options.formDraft, color));
  }

  lines.push("");
  lines.push(styleSection("Up next", color, "focused"));
  if (queued.length === 0) {
    lines.push(styleMuted("  no queued work", color));
  } else {
    for (const [index, frame] of queued.entries()) {
      lines.push(...renderCompactFrame(frame, index + 1, color));
    }
  }

  lines.push("");
  lines.push(styleSection("Background", color, "ambient"));
  if (ambient.length === 0) {
    lines.push(styleMuted("  calm background", color));
  } else {
    for (const frame of ambient) {
      lines.push(...renderAmbientFrame(frame, color));
    }
  }

  lines.push(horizontalRule(color));
  lines.push(...renderControls(active, options?.formDraft ?? null, color));

  if (statusLine) {
    lines.push(`${styleMuted("status", color)} ${statusLine}`);
  }

  return lines.join("\n");
}

export async function runAttentionTui(
  core: ApertureCore,
  options?: AttentionTuiOptions,
): Promise<void> {
  const input = options?.input ?? defaultInput;
  const output = options?.output ?? defaultOutput;
  const state: TuiState = {
    attentionView: core.getAttentionView(),
    statusLine: "Waiting for events",
    formDraft: null,
  };

  const cleanup = setupTerminal(input, output);
  const render = () => {
    output.write(clearScreen());
    output.write(
      renderAttentionScreen(state.attentionView, {
        title: options?.title ?? "Aperture TUI",
        statusLine: state.statusLine,
        formDraft: state.formDraft,
        color: Boolean(output.isTTY),
      }),
    );
  };

  const unsubAttention = core.subscribeAttentionView((attentionView) => {
    state.attentionView = attentionView;
    const active = attentionView.active;
    if (!active) {
      state.formDraft = null;
      state.statusLine = "Nothing currently needs attention";
    } else if (state.formDraft && state.formDraft.interactionId !== active.interactionId) {
      state.formDraft = null;
      state.statusLine = `Focused on ${active.title}`;
    }
    render();
  });

  const unsubResponse = core.onResponse((response) => {
    state.formDraft = null;
    state.statusLine = describeResponse(response);
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

      handleActiveKeypress(core, state, active, key);
      render();
    };

    const close = () => {
      input.off("keypress", onKeypress);
      unsubAttention();
      unsubResponse();
      cleanup();
      resolve();
    };

    input.on("keypress", onKeypress);
  });
}

function handleActiveKeypress(
  core: ApertureCore,
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
  core: ApertureCore,
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
    return [`${styleMuted("keys", color)} ${styleKey("q", color)} quit`];
  }

  if (formDraft) {
    return [
      `${styleMuted("keys", color)} ${styleKey("type", color)} edit  ${styleKey("enter", color)} next/submit  ${styleKey("esc", color)} cancel  ${styleKey("q", color)} quit`,
    ];
  }

  switch (active.responseSpec?.kind) {
    case "acknowledge":
      return [
        `${styleMuted("keys", color)} ${styleKey("enter", color)} acknowledge  ${styleKey("x", color)} dismiss  ${styleKey("q", color)} quit`,
      ];
    case "approval":
      return [
        `${styleMuted("keys", color)} ${styleKey("a", color)} approve  ${styleKey("r", color)} reject  ${styleKey("x", color)} dismiss  ${styleKey("q", color)} quit`,
      ];
    case "choice":
      return [
        `${styleMuted("keys", color)} ${styleKey("1-9", color)} choose  ${styleKey("x", color)} dismiss  ${styleKey("q", color)} quit`,
      ];
    case "form":
      return [
        `${styleMuted("keys", color)} ${styleKey("i", color)} input  ${styleKey("x", color)} dismiss  ${styleKey("q", color)} quit`,
      ];
    default:
      return [`${styleMuted("keys", color)} ${styleKey("q", color)} quit`];
  }
}

function renderFocusPane(frame: Frame | null, color: boolean): string[] {
  if (!frame) {
    return [
      styleMuted("  no active frame", color),
      styleMuted("  the surface is intentionally calm", color),
    ];
  }

  const source = frame.source?.label ?? frame.source?.id ?? "unknown";
  const score = readScore(frame);
  const attention = readAttention(frame);
  const lines = boxed([
    `${styleStrong(frame.title, color)}`,
    `${styleMuted(source, color)} ${styleMuted("·", color)} ${styleTone(frame.tone, color)} ${styleMuted("·", color)} ${styleMuted(frame.mode, color)} ${styleMuted("·", color)} ${styleMuted(frame.consequence, color)} ${styleMuted("·", color)} ${styleScore(score, color)}`,
  ], color, frame.tone);

  if (frame.summary) {
    lines.push(...boxedBody(frame.summary, color));
  }
  if (frame.context?.items?.length) {
    for (const item of frame.context.items.slice(0, 4)) {
      lines.push(...boxedBody(`${item.label}: ${item.value ?? "n/a"}`, color));
    }
  }
  if (frame.responseSpec?.kind === "choice") {
    for (const [index, option] of frame.responseSpec.options.entries()) {
      lines.push(
        ...boxedBody(
          `${styleKey(String(index + 1), color)} ${option.label}`,
          color,
        ),
      );
    }
  }
  if (attention.scoreOffset !== 0) {
    lines.push(...boxedBody(`${styleMuted("offset", color)} ${formatSigned(attention.scoreOffset)}`, color));
  }
  if (attention.rationale.length > 0) {
    lines.push(...boxedBody(`${styleMuted("why", color)} ${attention.rationale.join("; ")}`, color));
  }
  return closeBox(lines, color, frame.tone);
}

function renderCompactFrame(frame: Frame, rank: number, color: boolean): string[] {
  const source = frame.source?.label ?? frame.source?.id ?? "unknown";
  const score = readScore(frame);
  const lines = [
    `  ${styleRank(rank, color)} ${styleStrong(frame.title, color)}`,
    `    ${styleMuted(source, color)} ${styleMuted("·", color)} ${styleScore(score, color)} ${styleMuted("·", color)} ${styleTone(frame.tone, color)}`,
  ];
  if (frame.summary) {
    lines.push(`    ${styleMuted(frame.summary, color)}`);
  }
  return lines;
}

function renderAmbientFrame(frame: Frame, color: boolean): string[] {
  const source = frame.source?.label ?? frame.source?.id ?? "unknown";
  const score = readScore(frame);
  const lines = [
    `  ${styleMuted("·", color)} ${styleMuted(frame.title, color)}`,
    `    ${styleMuted(source, color)} ${styleMuted("·", color)} ${styleMuted(frame.consequence, color)} ${styleMuted("·", color)} ${styleMuted(frame.tone, color)} ${styleMuted("·", color)} ${styleMuted(`score ${score}`, color)}`,
  ];
  if (frame.summary) {
    lines.push(`    ${styleMuted(frame.summary, color)}`);
  }
  return lines;
}

function summarizeColumn(label: string, count: number, color: boolean, tone: Frame["tone"]): string {
  const text = `${label} ${count}`;
  return color ? `${toneColor(tone)}${ANSI.bold}${text}${ANSI.reset}` : text;
}

function horizontalRule(color: boolean): string {
  const line = "─".repeat(72);
  return color ? `${ANSI.dim}${line}${ANSI.reset}` : line;
}

function clearScreen(): string {
  return "\u001B[?1049h\u001B[2J\u001B[H";
}

function restoreScreen(): string {
  return "\u001B[2J\u001B[H\u001B[?1049l";
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
    output.write(restoreScreen());
  };
}

function describeResponse(response: FrameResponse): string {
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
  cyan: "\u001B[36m",
  blue: "\u001B[94m",
  yellow: "\u001B[93m",
  red: "\u001B[91m",
  white: "\u001B[97m",
  gray: "\u001B[90m",
} as const;

function toneColor(tone: Frame["tone"]): string {
  switch (tone) {
    case "critical":
      return ANSI.red;
    case "focused":
      return ANSI.blue;
    default:
      return ANSI.gray;
  }
}

function styleTitle(value: string, color: boolean): string {
  return color ? `${ANSI.bold}${ANSI.white}${value}${ANSI.reset}` : value;
}

function styleSection(value: string, color: boolean, tone: Frame["tone"]): string {
  return color ? `${ANSI.bold}${toneColor(tone)}${value}${ANSI.reset}` : value;
}

function styleStrong(value: string, color: boolean): string {
  return color ? `${ANSI.bold}${ANSI.white}${value}${ANSI.reset}` : value;
}

function styleMuted(value: string, color: boolean): string {
  return color ? `${ANSI.dim}${value}${ANSI.reset}` : value;
}

function styleAccent(value: string, color: boolean): string {
  return color ? `${ANSI.blue}${value}${ANSI.reset}` : value;
}

function styleTone(value: string, color: boolean): string {
  if (!color) {
    return value;
  }
  return `${toneColor(value as Frame["tone"])}${value}${ANSI.reset}`;
}

function styleScore(score: number, color: boolean): string {
  const value = `score ${score}`;
  return color ? `${ANSI.bold}${ANSI.cyan}${value}${ANSI.reset}` : value;
}

function styleKey(value: string, color: boolean): string {
  const wrapped = `[${value}]`;
  return color ? `${ANSI.bold}${ANSI.cyan}${wrapped}${ANSI.reset}` : wrapped;
}

function styleRank(rank: number, color: boolean): string {
  const value = `${rank}.`;
  return color ? `${ANSI.bold}${ANSI.blue}${value}${ANSI.reset}` : value;
}

function boxed(lines: string[], color: boolean, tone: Frame["tone"]): string[] {
  const border = color ? `${toneColor(tone)}┌${"─".repeat(70)}┐${ANSI.reset}` : `┌${"─".repeat(70)}┐`;
  return [border, ...lines.map((line) => wrapBoxLine(line))];
}

function boxedBody(value: string, _color: boolean): string[] {
  return [wrapBoxLine(value)];
}

function closeBox(lines: string[], color: boolean, tone: Frame["tone"]): string[] {
  const border = color ? `${toneColor(tone)}└${"─".repeat(70)}┘${ANSI.reset}` : `└${"─".repeat(70)}┘`;
  return [...lines, border];
}

function wrapBoxLine(value: string): string {
  const width = 68;
  const visible = visibleLength(value);
  const padded = visible < width ? `${value}${" ".repeat(width - visible)}` : value;
  return `│ ${padded} │`;
}

function formatSigned(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function visibleLength(value: string): number {
  return stripAnsi(value).length;
}

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;]*m/g, "");
}
