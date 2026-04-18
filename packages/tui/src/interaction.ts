import type {
  ChoiceDraft,
  Frame,
  FrameField,
  FrameResponse,
  AttentionSurface,
  TuiState,
  FormDraft,
  TextDraft,
  InputDraft,
} from "./types.js";
import { displaySourceLabel } from "./source-label.js";

const ACTIVE_ENGAGEMENT_HOLD_MS = 15_000;

export function handleActiveKeypress(
  core: AttentionSurface,
  state: TuiState,
  frame: Frame,
  key: { name?: string; sequence?: string },
): void {
  core.engage(frame.taskId, frame.interactionId, { durationMs: ACTIVE_ENGAGEMENT_HOLD_MS });
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
      if (spec.selectionMode === "multiple") {
        if (key.name === "x") {
          core.submit(dismissedResponse(frame));
          break;
        }
        const draft = createChoiceDraft(frame);
        state.inputDraft = draft;
        if (key.name === "return") {
          state.statusLine = "Select at least one option before sending";
          break;
        }
        if (key.name === "escape") {
          state.statusLine = "Selection cleared";
          break;
        }
        handleChoiceToggle(frame, draft, key, state);
        if (!state.statusLine) {
          state.statusLine = "Use option numbers to toggle selections, then press [enter]";
        }
        break;
      }

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
      } else if (spec.allowTextResponse && key.name === "i") {
        state.inputDraft = createTextDraft(frame);
        state.statusLine = "Editing reply";
      } else {
        state.statusLine = spec.allowTextResponse
          ? "Press an option number or [i] to type a reply"
          : "Press the option number to select it";
      }
      break;
    }
    case "form": {
      if (key.name === "i" || key.name === "return") {
        state.inputDraft = createFormDraft(frame);
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

export function handleInputKeypress(
  core: AttentionSurface,
  state: TuiState,
  key: { name?: string; sequence?: string; ctrl?: boolean },
): void {
  if (state.inputDraft?.kind === "text") {
    handleTextKeypress(core, state, key);
    return;
  }
  if (state.inputDraft?.kind === "choice") {
    handleChoiceKeypress(core, state, key);
    return;
  }

  handleFormKeypress(core, state, key);
}

export function createAutomaticInputDraft(frame: Frame): InputDraft | null {
  const spec = frame.responseSpec;
  if (!spec) {
    return null;
  }

  switch (spec.kind) {
    case "choice":
      return spec.selectionMode === "multiple" ? createChoiceDraft(frame) : null;
    case "form":
      return createFormDraft(frame);
    default:
      return null;
  }
}

export function shouldReserveSpaceForExpand(inputDraft: InputDraft): boolean {
  switch (inputDraft.kind) {
    case "choice":
      return true;
    case "text":
      return inputDraft.buffer.length === 0;
    case "form":
      return inputDraft.buffer.length === 0;
  }
}

function handleChoiceKeypress(
  core: AttentionSurface,
  state: TuiState,
  key: { name?: string; sequence?: string; ctrl?: boolean },
): void {
  const active = state.attentionView.now;
  const draft = state.inputDraft;
  if (!active || !draft || draft.kind !== "choice" || !active.responseSpec || active.responseSpec.kind !== "choice") {
    state.inputDraft = null;
    return;
  }

  core.engage(active.taskId, active.interactionId, { durationMs: ACTIVE_ENGAGEMENT_HOLD_MS });

  if (key.name === "x") {
    core.submit(dismissedResponse(active));
    state.inputDraft = null;
    return;
  }

  if (key.name === "escape") {
    draft.optionIds = [];
    state.statusLine = "Selection cleared";
    return;
  }

  if (key.name === "return") {
    if (draft.optionIds.length === 0) {
      state.statusLine = "Select at least one option before sending";
      return;
    }

    const selected = active.responseSpec.options
      .filter((option) => draft.optionIds.includes(option.id))
      .map((option) => option.id);
    core.submit({
      taskId: active.taskId,
      interactionId: active.interactionId,
      response: { kind: "option_selected", optionIds: selected },
    });
    state.inputDraft = null;
    return;
  }

  const index = parseDigit(key.sequence);
  if (index !== null) {
    handleChoiceToggle(active, draft, key, state);
    return;
  }

  state.statusLine = "Use option numbers to toggle selections, then press [enter]";
}

function handleFormKeypress(
  core: AttentionSurface,
  state: TuiState,
  key: { name?: string; sequence?: string; ctrl?: boolean },
): void {
  const active = state.attentionView.now;
  const draft = state.inputDraft;
  if (!active || !draft || draft.kind !== "form" || !active.responseSpec || active.responseSpec.kind !== "form") {
    state.inputDraft = null;
    return;
  }

  core.engage(active.taskId, active.interactionId, { durationMs: ACTIVE_ENGAGEMENT_HOLD_MS });

  const field = active.responseSpec.fields[draft.fieldIndex];
  if (!field) {
    state.inputDraft = null;
    return;
  }

  if (key.name === "escape") {
    state.inputDraft = null;
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
      state.inputDraft = null;
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

function handleTextKeypress(
  core: AttentionSurface,
  state: TuiState,
  key: { name?: string; sequence?: string; ctrl?: boolean },
): void {
  const active = state.attentionView.now;
  const draft = state.inputDraft;
  if (!active || !draft || draft.kind !== "text") {
    state.inputDraft = null;
    return;
  }

  core.engage(active.taskId, active.interactionId, { durationMs: ACTIVE_ENGAGEMENT_HOLD_MS });

  if (key.name === "escape") {
    state.inputDraft = null;
    state.statusLine = "Reply cancelled";
    return;
  }

  if (key.name === "backspace") {
    draft.buffer = draft.buffer.slice(0, -1);
    return;
  }

  if (key.name === "return") {
    if (draft.buffer.trim() === "") {
      state.statusLine = "Enter a reply before sending";
      return;
    }
    core.submit({
      taskId: active.taskId,
      interactionId: active.interactionId,
      response: { kind: "text_submitted", text: draft.buffer },
    });
    state.inputDraft = null;
    return;
  }

  if (key.sequence && key.sequence.length === 1 && !key.ctrl) {
    draft.buffer += key.sequence;
  }
}

// ── Response builders ───────────────────────────────────────────────

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

// ── Helpers ─────────────────────────────────────────────────────────

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

function createFormDraft(frame: Frame): FormDraft {
  const spec = frame.responseSpec;
  if (!spec || spec.kind !== "form") {
    return {
      kind: "form",
      interactionId: frame.interactionId,
      fieldIndex: 0,
      values: {},
      buffer: "",
    };
  }

  return {
    kind: "form",
    interactionId: frame.interactionId,
    fieldIndex: 0,
    values: {},
    buffer: fieldSeed(spec.fields[0], {}),
  };
}

function createTextDraft(frame: Frame): TextDraft {
  return {
    kind: "text",
    interactionId: frame.interactionId,
    buffer: "",
  };
}

function createChoiceDraft(frame: Frame): ChoiceDraft {
  return {
    kind: "choice",
    interactionId: frame.interactionId,
    optionIds: [],
  };
}

function handleChoiceToggle(
  frame: Frame,
  draft: ChoiceDraft,
  key: { sequence?: string },
  state: TuiState,
): void {
  const spec = frame.responseSpec;
  if (!spec || spec.kind !== "choice") {
    state.statusLine = "";
    return;
  }

  const index = parseDigit(key.sequence);
  if (index === null) {
    state.statusLine = "";
    return;
  }

  const option = spec.options[index];
  if (!option) {
    state.statusLine = "That choice is out of range";
    return;
  }

  const selected = draft.optionIds.includes(option.id);
  draft.optionIds = selected
    ? draft.optionIds.filter((id) => id !== option.id)
    : [...draft.optionIds, option.id];
  state.statusLine = selected ? `Removed ${option.label}` : `Selected ${option.label}`;
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

export function describeResponse(response: FrameResponse, nextActive: Frame | null): string {
  const base = responseLabel(response);
  if (nextActive && nextActive.interactionId !== response.interactionId) {
    return `${base} · focused on ${nextActive.title} · ${displaySourceLabel(nextActive.source)}`;
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
      return response.response.optionIds.length === 1
        ? `Selected ${response.response.optionIds[0]}`
        : `Selected ${response.response.optionIds.length} options`;
    case "text_submitted":
      return "Sent reply";
    case "form_submitted":
      return "Sent form";
  }
}
