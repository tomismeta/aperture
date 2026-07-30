export type EditOutputOutcome = "applied" | "failure";

export function readEditOutputOutcome(
  ...values: Array<string | undefined>
): EditOutputOutcome | null {
  for (const value of values) {
    const text = readEditOutputText(value);
    if (text === null) {
      continue;
    }

    if (looksLikeEditFailure(text)) {
      return "failure";
    }

    if (looksLikeEditApplied(text)) {
      return "applied";
    }
  }

  return null;
}

function readEditOutputText(value: string | undefined): string | null {
  const text = stripEditStatusPrefix(value ?? "");
  if (text.length === 0) {
    return null;
  }

  const toolUseErrorBody = /^<tool_use_error>\s*([\s\S]{1,500})\s*<\/tool_use_error>\s*$/i.exec(
    text,
  )?.[1];
  return toolUseErrorBody ?? text;
}

function stripEditStatusPrefix(value: string): string {
  return value
    .trim()
    .replace(/^(?:edit|tool)\s+failure\s+(?:[-\u2013\u2014]\s*)?/i, "")
    .replace(/^OBSERVATION:\s*/i, "")
    .replace(/^<tool_output_masked>\s*/i, "")
    .trim();
}

function looksLikeEditFailure(text: string): boolean {
  return [
    /^apply_patch error$/i,
    /^edit error$/i,
    /^write error$/i,
    /^File has not been read yet\.\s+Read it first before writing to it\.$/i,
    /^File has been modified since read,\s+either by the user or by a linter\.\s+Read it again before attempting to write it\.$/i,
    /^Could not find the exact text in\s+\S[\s\S]{0,300}\.\s+The old text must match exactly including all whitespace and newlines\.$/i,
    /^Could not find edits\[\d+]\s+in\s+\S[\s\S]{0,300}\.\s+The oldText must match exactly including all whitespace and newlines\.$/i,
    /^Found \d+ occurrences of the text in\s+\S[\s\S]{0,300}\.\s+The text must be unique\.\s+Please provide more context to make it unique\.$/i,
    /^No replacement was performed\b/i,
  ].some((pattern) => pattern.test(text));
}

function looksLikeEditApplied(text: string): boolean {
  return [
    /^Successfully modified file:\s+\S/i,
    /^Successfully created and wrote to new file:\s+\S/i,
    /^Edit applied successfully\.\s+LSP errors detected in this file,\s+please fix:/i,
  ].some((pattern) => pattern.test(text));
}
