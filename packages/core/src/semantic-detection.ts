import type { AttentionConsequenceLevel } from "./frame.js";

export type SemanticDetectionContextItem = {
  id: string;
  label: string;
  value?: string;
};

export type SemanticDetectionInput = {
  title: string;
  summary?: string;
  toolFamily?: string;
  context?: {
    items?: SemanticDetectionContextItem[];
  };
  metadata?: Record<string, unknown>;
};

export function normalizeSemanticText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9/.-]+/g, " ").trim();
}

export function dedupeSemanticStrings(values: string[]): string[] {
  return [...new Set(values)];
}

export function readExplicitSemanticToolFamily(input: SemanticDetectionInput): string | null {
  return (
    normalizeToolFamily(input.toolFamily)
    ?? normalizeToolFamily(readMetadataToolFamily(input.metadata))
    ?? normalizeToolFamily(readContextToolFamily(input.context))
  );
}

export function inferSemanticToolFamily(input: SemanticDetectionInput): string | null {
  const explicit = readExplicitSemanticToolFamily(input);
  if (explicit) {
    return explicit;
  }

  const value = normalizeSemanticText(`${input.title} ${input.summary ?? ""}`);
  if (hasPhrase(value, "wants to read") || hasWord(value, "read")) return "read";
  if (hasPhrase(value, "wants to write") || hasWord(value, "write")) return "write";
  if (hasPhrase(value, "wants to edit") || hasWord(value, "edit")) return "edit";
  if (hasPhrase(value, "shell command") || hasPhrase(value, "wants to run")) return "bash";
  if (hasPhrase(value, "search the web")) return "web";
  if (hasPhrase(value, "search files") || hasPhrase(value, "search file contents")) return "search";
  return null;
}

export function detectImpliedOperatorAsk(text: string): boolean {
  return containsAnySemanticPhrase(text, IMPLIED_OPERATOR_ASKS);
}

export function inferConsequenceFromSemanticText(
  text: string,
  fallback: AttentionConsequenceLevel,
  toolFamily?: string,
): AttentionConsequenceLevel {
  if (containsAnySemanticPhrase(text, HIGH_RISK_PHRASES)) {
    return "high";
  }

  if (toolFamily === "read" || toolFamily === "search") {
    return fallback === "high" ? "high" : "low";
  }

  if (toolFamily === "write" || toolFamily === "edit" || toolFamily === "bash") {
    return fallback === "low" ? "medium" : fallback;
  }

  return fallback;
}

export function containsAnySemanticPhrase(value: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => value.includes(phrase));
}

function readMetadataToolFamily(metadata?: Record<string, unknown>): string | null {
  const value = metadata?.toolFamily;
  return typeof value === "string" ? value : null;
}

function readContextToolFamily(input?: SemanticDetectionInput["context"]): string | null {
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

function hasPhrase(value: string, phrase: string): boolean {
  return value.includes(phrase);
}

function hasWord(value: string, word: string): boolean {
  return new RegExp(`(?:^|\\s)${escapeRegExp(word)}(?:\\s|$)`).test(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const IMPLIED_OPERATOR_ASKS = [
  "need your input",
  "need your approval",
  "waiting for approval",
  "approval required",
  "should i continue",
  "can you approve",
  "what should i do",
  "please review",
] as const;

const HIGH_RISK_PHRASES = [
  "production",
  "prod",
  "force push",
  "git push --force",
  "rm -rf",
  "drop table",
  "delete database",
  "delete prod",
  "sudo",
  "chmod 777",
  "kill process",
  "migrate",
] as const;
