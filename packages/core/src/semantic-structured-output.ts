export type StructuredToolOutputObservation = {
  output: string;
  wallTime?: string;
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

export function looksLikeStructuredToolOutputEnvelope(summary: string | undefined): boolean {
  if (summary === undefined) {
    return false;
  }

  if (/^\s*\{\s*(?:"exit_code"\s*:|"wall_time"\s*:|"output"\s*:)/.test(summary)) {
    return true;
  }

  const parsed = parseJsonObject(summary);
  if (parsed?.truncated === true) {
    return true;
  }

  return (
    parsed !== null &&
    Object.prototype.hasOwnProperty.call(parsed, "wall_time") &&
    Object.prototype.hasOwnProperty.call(parsed, "output")
  );
}

export function parseJsonObject(value: string): Record<string, unknown> | null {
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

export function looksLikeWallTime(value: string): boolean {
  return /^\d+(?:\.\d+)?\s*(?:ms|s|sec|secs|second|seconds)$/i.test(value.trim());
}

function hasUnexpectedStructuredOutputKeys(value: Record<string, unknown>): boolean {
  const allowedKeys = new Set(["exit_code", "output", "wall_time"]);
  return Object.keys(value).some((key) => !allowedKeys.has(key));
}

export function readOptionalIntegerExitCode(
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
