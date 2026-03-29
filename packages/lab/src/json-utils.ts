import { readFile } from "node:fs/promises";

export type JsonCandidateValidator = (value: unknown) => boolean;

export function parseRequiredJsonText<T>(
  text: string,
  label: string,
): T {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error(`${label} produced no JSON output.`);
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch (error) {
    throw new Error(`${label} produced invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  return parseRequiredJsonText<T>(await readFile(filePath, "utf8"), filePath);
}

export async function tryReadJsonFile<T>(filePath: string): Promise<T | undefined> {
  try {
    return await readJsonFile<T>(filePath);
  } catch {
    return undefined;
  }
}

export function extractJsonCandidate(
  raw: string,
  options: {
    validators?: readonly JsonCandidateValidator[];
    fallbackValidator?: JsonCandidateValidator;
  } = {},
): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    const fenced = fencedMatch[1].trim();
    const extracted = extractJsonCandidate(fenced, options);
    if (extracted) {
      return extracted;
    }
  }

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    const parsed = tryParseJson(trimmed);
    if (parsed !== undefined && classifyCandidate(parsed, options) !== "none") {
      return trimmed;
    }
  }

  let fallbackCandidate: string | null = null;
  for (const candidate of extractJsonObjects(trimmed)) {
    const parsed = tryParseJson(candidate);
    if (parsed === undefined) {
      continue;
    }

    const match = classifyCandidate(parsed, options);
    if (match === "primary") {
      return candidate;
    }
    if (match === "fallback" && fallbackCandidate === null) {
      fallbackCandidate = candidate;
    }
  }

  return fallbackCandidate;
}

export function extractJsonObjects(text: string): string[] {
  const matches: string[] = [];

  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== "{") {
      continue;
    }

    const end = findBalancedJsonEnd(text, start);
    if (end < 0) {
      continue;
    }

    const candidate = text.slice(start, end + 1);
    if (tryParseJson(candidate) !== undefined) {
      matches.push(candidate);
    }
  }

  return matches;
}

function tryParseJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function classifyCandidate(
  parsed: unknown,
  options: {
    validators?: readonly JsonCandidateValidator[];
    fallbackValidator?: JsonCandidateValidator;
  },
): "primary" | "fallback" | "none" {
  const validators = options.validators ?? [];
  if (validators.length === 0 && !options.fallbackValidator) {
    return "primary";
  }
  if (validators.some((validator) => validator(parsed))) {
    return "primary";
  }
  if (options.fallbackValidator?.(parsed)) {
    return "fallback";
  }
  return "none";
}

function findBalancedJsonEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === "\"") {
        inString = false;
      }

      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}
