type TaxonomyInput = {
  title: string;
  summary?: string;
};

export function inferToolFamily(input: TaxonomyInput): string | null {
  const value = `${input.title} ${input.summary ?? ""}`.toLowerCase();
  if (value.includes(" read ") || value.includes(" wants to read")) return "read";
  if (value.includes(" write ") || value.includes(" wants to write")) return "write";
  if (value.includes(" edit ") || value.includes(" wants to edit")) return "edit";
  if (value.includes(" shell command") || value.includes(" wants to run")) return "bash";
  if (value.includes("search the web")) return "web";
  if (value.includes("search files") || value.includes("search file contents")) return "search";
  return null;
}

export function sourceKey(source?: { kind?: string; id: string }): string | null {
  if (!source) {
    return null;
  }

  return source.kind ?? source.id;
}
