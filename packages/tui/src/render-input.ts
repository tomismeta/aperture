import type { Frame, InputDraft, FormDraft, TextDraft } from "./types.js";
import { renderPrefixedBlock, styleStrong, styleMuted, stylePrompt } from "./ansi.js";

export function renderInputDraft(
  frame: Frame,
  inputDraft: InputDraft,
  color: boolean,
  options?: { prefix?: string },
): string[] {
  const prefix = options?.prefix ?? "  ";
  if (inputDraft.kind === "text") {
    return renderTextDraft(inputDraft, color, prefix);
  }

  return renderFormDraft(frame, inputDraft, color, prefix);
}

function renderFormDraft(frame: Frame, formDraft: FormDraft, color: boolean, prefix: string): string[] {
  const spec = frame.responseSpec;
  if (!spec || spec.kind !== "form") {
    return [];
  }

  return spec.fields.flatMap((field, index) => {
    const marker = index === formDraft.fieldIndex ? styleStrong("›", color) : styleMuted("·", color);
    const value = index === formDraft.fieldIndex
      ? formDraft.buffer
      : stringifyFieldValue(formDraft.values[field.id]);
    return renderPrefixedBlock(
      `${prefix}${marker} ${stylePrompt(field.label, color)} ${styleMuted("·", color)} `,
      value || styleMuted("(empty)", color),
      `${prefix}  `,
    );
  });
}

function stringifyFieldValue(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

function renderTextDraft(textDraft: TextDraft, color: boolean, prefix: string): string[] {
  const value = textDraft.buffer || "";
  return renderPrefixedBlock(
    `${prefix}${styleStrong("›", color)} ${stylePrompt("Reply", color)} ${styleMuted("·", color)} `,
    value || styleMuted("(empty)", color),
    `${prefix}  `,
  );
}
