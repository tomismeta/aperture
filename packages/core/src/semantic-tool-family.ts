import {
  hasSemanticPhrase as hasPhrase,
  hasSemanticWord as hasWord,
  normalizeSemanticText,
} from "./semantic-text.js";

export type SemanticToolFamilyContextItem = {
  id: string;
  label: string;
  value?: string;
};

export type SemanticToolFamilyInput = {
  title: string;
  summary?: string;
  toolFamily?: string;
  context?: {
    items?: SemanticToolFamilyContextItem[];
  };
  metadata?: Record<string, unknown>;
};

export function readExplicitSemanticToolFamily(input: SemanticToolFamilyInput): string | null {
  return (
    normalizeToolFamily(input.toolFamily) ??
    normalizeToolFamily(readMetadataToolFamily(input.metadata)) ??
    normalizeToolFamily(readContextToolFamily(input.context))
  );
}

export function inferSemanticToolFamily(input: SemanticToolFamilyInput): string | null {
  const explicit = readExplicitSemanticToolFamily(input);
  if (explicit) {
    return explicit;
  }

  const value = normalizeSemanticText(`${input.title} ${input.summary ?? ""}`);
  const candidates: Array<{ toolFamily: string; risk: number; order: number }> = [];

  if (
    hasPhrase(value, "wants to read") ||
    hasPhrase(value, "wants to inspect") ||
    hasWord(value, "read") ||
    hasWord(value, "inspect")
  ) {
    candidates.push({ toolFamily: "read", risk: 1, order: 0 });
  }
  if (hasPhrase(value, "search files") || hasPhrase(value, "search file contents")) {
    candidates.push({ toolFamily: "search", risk: 1, order: 1 });
  }
  if (hasPhrase(value, "search the web")) {
    candidates.push({ toolFamily: "web", risk: 2, order: 2 });
  }
  if (hasPhrase(value, "wants to write") || hasWord(value, "write")) {
    candidates.push({ toolFamily: "write", risk: 3, order: 3 });
  }
  if (hasPhrase(value, "wants to edit") || hasWord(value, "edit")) {
    candidates.push({ toolFamily: "edit", risk: 3, order: 4 });
  }
  if (hasPhrase(value, "shell command") || hasPhrase(value, "wants to run")) {
    candidates.push({ toolFamily: "bash", risk: 3, order: 5 });
  }

  return (
    candidates.sort((left, right) => right.risk - left.risk || left.order - right.order)[0]
      ?.toolFamily ?? null
  );
}

function readMetadataToolFamily(metadata?: Record<string, unknown>): string | null {
  const value = metadata?.toolFamily;
  return typeof value === "string" ? value : null;
}

function readContextToolFamily(input?: SemanticToolFamilyInput["context"]): string | null {
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
