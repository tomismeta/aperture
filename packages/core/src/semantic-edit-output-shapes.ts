export type EditOutputOutcome = "applied" | "failure";

export function readEditOutputOutcome(
  ...values: Array<string | undefined>
): EditOutputOutcome | null {
  for (const value of values) {
    const text = readEditOutputText(value);
    if (text === null) {
      continue;
    }

    if (looksLikeEditFailure(text)) return "failure";
    if (looksLikeEditApplied(text)) return "applied";
  }

  return null;
}

function readEditOutputText(value: string | undefined): string | null {
  const text = stripEditStatusPrefix(value ?? "");
  if (text.length === 0) return null;

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
  return (
    /^(?:apply_patch|edit|write) error$/i.test(text) ||
    /^file has (?:not been read yet|been modified since read)\b[\s\S]{0,260}\bread it (?:first|again)\b[\s\S]{0,160}\bbefore\b/i.test(
      text,
    ) ||
    /^could not find (?:the exact text|edits\[\d+]) in\s+\S[\s\S]{0,300}\.\s+the old\s?text must match exactly\b/i.test(
      text,
    ) ||
    /^found \d+ occurrences of (?:the )?text in\s+\S[\s\S]{0,300}\.\s+the text must be unique\b/i.test(
      text,
    ) ||
    /^no replacement was performed\b/i.test(text)
  );
}

function looksLikeEditApplied(text: string): boolean {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  const modifiedPrefix = "successfully modified file:";
  const createdPrefix = "successfully created and wrote to new file:";
  const lspPrefix = "edit applied successfully. lsp errors detected";
  return (
    (lower.startsWith(modifiedPrefix) && lower.slice(modifiedPrefix.length).trim().length > 0) ||
    (lower.startsWith(createdPrefix) && lower.slice(createdPrefix.length).trim().length > 0) ||
    lower === "edit applied successfully" ||
    (lower.startsWith(lspPrefix) && lower.length <= lspPrefix.length + 200)
  );
}
