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
  },
): string {
  const lines: string[] = [];
  const title = options?.title ?? "Aperture TUI";
  const statusLine = options?.statusLine ?? "";
  const active = attentionView.active;
  const queued = attentionView.queued;
  const ambient = attentionView.ambient;

  lines.push(title);
  lines.push(
    [
      summarizeColumn("active", active ? 1 : 0),
      summarizeColumn("queued", queued.length),
      summarizeColumn("ambient", ambient.length),
    ].join("   "),
  );
  lines.push(horizontalRule());
  lines.push("Focus");
  lines.push(...renderFocusPane(active));

  if (options?.formDraft && active) {
    lines.push("");
    lines.push("Input");
    lines.push(...renderFormDraft(active, options.formDraft));
  }

  lines.push("");
  lines.push("Queue");
  if (queued.length === 0) {
    lines.push("  none");
  } else {
    for (const frame of queued) {
      lines.push(...renderCompactFrame(frame));
    }
  }

  lines.push("");
  lines.push("Ambient");
  if (ambient.length === 0) {
    lines.push("  none");
  } else {
    for (const frame of ambient) {
      lines.push(...renderAmbientFrame(frame));
    }
  }

  lines.push(horizontalRule());
  lines.push(...renderControls(active, options?.formDraft ?? null));

  if (statusLine) {
    lines.push(`Status: ${statusLine}`);
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

function renderFormDraft(frame: Frame, formDraft: FormDraft): string[] {
  const spec = frame.responseSpec;
  if (!spec || spec.kind !== "form") {
    return [];
  }

  return spec.fields.map((field, index) => {
    const marker = index === formDraft.fieldIndex ? ">" : " ";
    const value = index === formDraft.fieldIndex
      ? formDraft.buffer
      : stringifyFieldValue(formDraft.values[field.id]);
    return `  ${marker} ${field.label}: ${value || "(empty)"}`;
  });
}

function stringifyFieldValue(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

function renderControls(active: Frame | null, formDraft: FormDraft | null): string[] {
  if (!active) {
    return ["Controls: q quit"];
  }

  if (formDraft) {
    return ["Controls: type to edit · Enter next/submit · Esc cancel · q quit after closing form"];
  }

  switch (active.responseSpec?.kind) {
    case "approval":
      return ["Controls: a approve · r reject · x dismiss · q quit"];
    case "choice":
      return ["Controls: 1-9 choose option · x dismiss · q quit"];
    case "form":
      return ["Controls: i fill form · x dismiss · q quit"];
    default:
      return ["Controls: q quit"];
  }
}

function renderFocusPane(frame: Frame | null): string[] {
  if (!frame) {
    return ["  calm surface · nothing currently needs attention"];
  }

  const source = frame.source?.label ?? frame.source?.id ?? "unknown";
  const score = readScore(frame);
  const lines = [
    `  ${frame.title}`,
    `  ${source} · ${frame.mode} · ${frame.tone} · ${frame.consequence} · score ${score}`,
  ];

  if (frame.summary) {
    lines.push(`  ${frame.summary}`);
  }
  if (frame.context?.items?.length) {
    for (const item of frame.context.items.slice(0, 4)) {
      lines.push(`  ${item.label}: ${item.value ?? "n/a"}`);
    }
  }
  const attention = readAttention(frame);
  if (attention.scoreOffset !== 0) {
    lines.push(`  offset ${attention.scoreOffset}`);
  }
  if (attention.rationale.length > 0) {
    lines.push(`  why ${attention.rationale.join("; ")}`);
  }
  return lines;
}

function renderCompactFrame(frame: Frame): string[] {
  const source = frame.source?.label ?? frame.source?.id ?? "unknown";
  const score = readScore(frame);
  const lines = [`  • ${frame.title}`];
  lines.push(`    ${source} · score ${score} · ${frame.tone}`);
  if (frame.summary) {
    lines.push(`    ${frame.summary}`);
  }
  return lines;
}

function renderAmbientFrame(frame: Frame): string[] {
  const source = frame.source?.label ?? frame.source?.id ?? "unknown";
  const lines = [`  · ${frame.title}`];
  lines.push(`    ${source} · ${frame.tone} · ${frame.consequence}`);
  if (frame.summary) {
    lines.push(`    ${frame.summary}`);
  }
  return lines;
}

function summarizeColumn(label: string, count: number): string {
  return `${label} ${count}`;
}

function horizontalRule(): string {
  return "─".repeat(72);
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
