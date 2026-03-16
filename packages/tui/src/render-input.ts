import type { Frame, InputDraft, FormDraft, TextDraft } from "./types.js";
import { styleStrong, styleMuted } from "./ansi.js";

export function renderInputDraft(frame: Frame, inputDraft: InputDraft, color: boolean): string[] {
  if (inputDraft.kind === "text") {
    return renderTextDraft(inputDraft, color);
  }

  return renderFormDraft(frame, inputDraft, color);
}

function renderFormDraft(frame: Frame, formDraft: FormDraft, color: boolean): string[] {
  const spec = frame.responseSpec;
  if (!spec || spec.kind !== "form") {
    return [];
  }

  return spec.fields.map((field, index) => {
    const marker = index === formDraft.fieldIndex ? styleStrong("›", color) : styleMuted("·", color);
    const value = index === formDraft.fieldIndex
      ? formDraft.buffer
      : stringifyFieldValue(formDraft.values[field.id]);
    return `  ${marker} ${styleStrong(field.label, color)} ${styleMuted("·", color)} ${value || styleMuted("(empty)", color)}`;
  });
}

function stringifyFieldValue(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

function renderTextDraft(textDraft: TextDraft, color: boolean): string[] {
  const value = textDraft.buffer || "";
  return [
    `  ${styleStrong("›", color)} ${styleStrong("Reply", color)} ${styleMuted("·", color)} ${value || styleMuted("(empty)", color)}`,
  ];
}
