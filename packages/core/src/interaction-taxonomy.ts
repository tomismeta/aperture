import type { AttentionActivityClass } from "./events.js";

type TaxonomyInput = {
  title: string;
  summary?: string;
  toolFamily?: string;
  context?: {
    items?: Array<{
      id: string;
      label: string;
      value?: string;
    }>;
  };
  metadata?: Record<string, unknown>;
};

type BoundedToolFamilyInput = TaxonomyInput & {
  mode: "status" | "approval" | "choice" | "form";
  activityClass?: AttentionActivityClass;
};

export function readExplicitToolFamily(input: TaxonomyInput): string | null {
  return (
    normalizeToolFamily(input.toolFamily)
    ?? normalizeToolFamily(readMetadataToolFamily(input.metadata))
    ?? normalizeToolFamily(readContextToolFamily(input.context))
  );
}

export function inferToolFamily(input: TaxonomyInput): string | null {
  const explicit = readExplicitToolFamily(input);
  if (explicit) {
    return explicit;
  }

  const value = normalizeText(`${input.title} ${input.summary ?? ""}`);
  if (hasPhrase(value, "wants to read") || hasWord(value, "read")) return "read";
  if (hasPhrase(value, "wants to write") || hasWord(value, "write")) return "write";
  if (hasPhrase(value, "wants to edit") || hasWord(value, "edit")) return "edit";
  if (hasPhrase(value, "shell command") || hasPhrase(value, "wants to run")) return "bash";
  if (hasPhrase(value, "search the web")) return "web";
  if (hasPhrase(value, "search files") || hasPhrase(value, "search file contents")) return "search";
  return null;
}

export function readBoundedToolFamily(input: BoundedToolFamilyInput): string | null {
  if (input.mode === "status") {
    return readExplicitToolFamily(input);
  }

  if (input.activityClass !== undefined && input.activityClass !== "permission_request") {
    return readExplicitToolFamily(input);
  }

  if (input.mode !== "approval") {
    return readExplicitToolFamily(input);
  }

  return inferToolFamily(input);
}

export function sourceKey(source?: { kind?: string; id: string }): string | null {
  if (!source) {
    return null;
  }

  return source.kind ?? source.id;
}

function readMetadataToolFamily(metadata?: Record<string, unknown>): string | null {
  const value = metadata?.toolFamily;
  return typeof value === "string" ? value : null;
}

function readContextToolFamily(input?: TaxonomyInput["context"]): string | null {
  if (!input?.items) {
    return null;
  }

  for (const item of input.items) {
    const id = item.id.toLowerCase();
    const label = item.label.toLowerCase();
    if (id === "toolfamily" || id === "tool_family" || id === "tool" || label === "tool family") {
      return item.value ?? null;
    }
  }

  return null;
}

function normalizeToolFamily(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9.]+/g, " ").trim();
}

function hasPhrase(value: string, phrase: string): boolean {
  return value.includes(phrase);
}

function hasWord(value: string, word: string): boolean {
  return new RegExp(`(?:^|\\s)${escapeRegExp(word)}(?:\\s|$)`).test(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
