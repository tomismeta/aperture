export type StructuredToolOutputObservation = {
  output: string;
  wallTime: string;
  exitCode?: number;
};

export function readStructuredToolOutputObservation(
  summary: string | undefined,
): StructuredToolOutputObservation | null {
  if (summary === undefined) {
    return null;
  }

  const parsed = parseJsonObject(summary);
  if (parsed === null) {
    return null;
  }

  if (typeof parsed.wall_time !== "string" || typeof parsed.output !== "string") {
    return null;
  }

  if (!looksLikeWallTime(parsed.wall_time) || hasUnexpectedStructuredOutputKeys(parsed)) {
    return null;
  }

  if (parsed.output.trim().length === 0) {
    return null;
  }

  const exitCode = readOptionalIntegerExitCode(parsed);
  if (exitCode === "invalid") {
    return null;
  }

  return {
    output: parsed.output,
    wallTime: parsed.wall_time,
    ...(exitCode !== undefined ? { exitCode } : {}),
  };
}

export function looksLikeStrongRawSourceObservation(value: string): boolean {
  const text = value.trim();
  if (text.length === 0) {
    return false;
  }

  return (
    looksLikeRawSourcePrefix(text) ||
    looksLikeLineNumberedRawSource(text) ||
    countRawSourceMarkers(text) >= 3
  );
}

export function looksLikeStructuredToolOutputObservation(output: string): boolean {
  return looksLikeStrongRawSourceObservation(output);
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function looksLikeWallTime(value: string): boolean {
  return /^\d+(?:\.\d+)?\s*(?:ms|s|sec|secs|second|seconds)$/i.test(value.trim());
}

function hasUnexpectedStructuredOutputKeys(value: Record<string, unknown>): boolean {
  const allowedKeys = new Set(["exit_code", "output", "wall_time"]);
  return Object.keys(value).some((key) => !allowedKeys.has(key));
}

function readOptionalIntegerExitCode(
  value: Record<string, unknown>,
): number | "invalid" | undefined {
  if (!Object.prototype.hasOwnProperty.call(value, "exit_code")) {
    return undefined;
  }

  const rawExitCode = value.exit_code;
  if (typeof rawExitCode === "number" && Number.isInteger(rawExitCode)) {
    return rawExitCode;
  }

  if (typeof rawExitCode === "string" && /^-?\d+$/.test(rawExitCode.trim())) {
    return Number.parseInt(rawExitCode, 10);
  }

  return "invalid";
}

function looksLikeRawSourcePrefix(text: string): boolean {
  return /^\s*(?:#include\b|#ifndef\b|#pragma\s+once\b|cmake_minimum_required\s*\(|\/\/\s*copyright\b|#\s*copyright\b)/i.test(
    text,
  );
}

function looksLikeLineNumberedRawSource(text: string): boolean {
  return /\b\d+\s+(?:#include\b|static\b|struct\b|enum\b|typedef\b|void\b|int\b|char\b|bool\b|return\b|namespace\b|class\b|def\b|function\b|const\b|let\b|var\b)/i.test(
    text,
  );
}

function countRawSourceMarkers(text: string): number {
  const markers = [
    /#include\b/i,
    /\bnamespace\s+[a-z_][a-z0-9_:]*\s*\{/i,
    /\bstd::[a-z_][a-z0-9_]*/i,
    /\b(?:class|struct)\s+[a-z_][a-z0-9_]*/i,
    /\btemplate\s*</i,
    /\bint\s+main\s*\(/i,
    /\bcmake_minimum_required\s*\(/i,
    /\bproject\s*\(/i,
    /\bset\s*\([a-z0-9_]+/i,
    /\bdef\s+[a-z_][a-z0-9_]*\s*\(/i,
    /\bfunction\s+[a-z_$][a-z0-9_$]*\s*\(/i,
    /\b(?:const|let|var)\s+[a-z_$][a-z0-9_$]*\s*=/i,
    /\breturn\s+[^.;{}]+[.;]/i,
  ];

  return markers.reduce((count, marker) => count + (marker.test(text) ? 1 : 0), 0);
}
