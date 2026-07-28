import type { StructuredToolOutputObservation } from "./semantic-structured-output.js";
import { parseJsonObject, readOptionalIntegerExitCode } from "./semantic-structured-output.js";

export function readTruncatedStructuredToolOutputDiagnosticEvidence(
  summary: string | undefined,
): StructuredToolOutputObservation | null {
  if (summary === undefined) {
    return null;
  }

  const marked = readMarkedTruncatedStructuredToolOutputObservation(summary);
  if (marked !== null) {
    return marked;
  }

  return readTruncatedStructuredToolOutputObservation(summary);
}

function readTruncatedStructuredToolOutputObservation(
  summary: string,
): StructuredToolOutputObservation | null {
  const withExitCode =
    /^\s*\{\s*"exit_code"\s*:\s*("[+-]?\d+"|-?\d+)\s*,\s*"wall_time"\s*:\s*"([^"]+)"\s*,\s*"output"\s*:\s*"/.exec(
      summary,
    );
  if (withExitCode) {
    const output = decodeTruncatedJsonStringContent(summary.slice(withExitCode[0].length));
    const exitCode = readIntegerExitCodeToken(withExitCode[1] ?? "");

    if (exitCode === null || output.trim().length === 0) {
      return null;
    }

    return { output, wallTime: withExitCode[2] ?? "", exitCode };
  }

  const withoutExitCode = /^\s*\{\s*"wall_time"\s*:\s*"([^"]+)"\s*,\s*"output"\s*:\s*"/.exec(
    summary,
  );
  if (!withoutExitCode) {
    return null;
  }

  const output = decodeTruncatedJsonStringContent(summary.slice(withoutExitCode[0].length));
  if (output.trim().length === 0) {
    return null;
  }

  return { output, wallTime: withoutExitCode[1] ?? "" };
}

function readMarkedTruncatedStructuredToolOutputObservation(
  summary: string,
): StructuredToolOutputObservation | null {
  const parsed = parseJsonObject(summary);
  if (
    parsed === null ||
    parsed.truncated !== true ||
    typeof parsed.wall_time !== "string" ||
    typeof parsed.output !== "string"
  ) {
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

function readIntegerExitCodeToken(value: string): number | null {
  const normalized = value.replace(/^"|"$/g, "").trim();
  return /^-?\d+$/.test(normalized) ? Number.parseInt(normalized, 10) : null;
}

function decodeTruncatedJsonStringContent(value: string): string {
  const closedValue = removeTrailingClosedJsonStringQuote(value);
  let output = "";

  for (let index = 0; index < closedValue.length; index += 1) {
    const current = closedValue[index];
    if (current !== "\\") {
      output += current;
      continue;
    }

    const escaped = closedValue[index + 1];
    if (escaped === undefined) {
      break;
    }
    index += 1;

    switch (escaped) {
      case "n":
        output += "\n";
        break;
      case "r":
        output += "\r";
        break;
      case "t":
        output += "\t";
        break;
      case "u":
        output += decodeUnicodeEscape(closedValue, index);
        index += isUnicodeEscape(closedValue, index) ? 4 : 0;
        break;
      default:
        output += escaped;
        break;
    }
  }

  return output;
}

function decodeUnicodeEscape(value: string, index: number): string {
  const hex = value.slice(index + 1, index + 5);
  return /^[0-9a-f]{4}$/i.test(hex) ? String.fromCharCode(Number.parseInt(hex, 16)) : "u";
}

function isUnicodeEscape(value: string, index: number): boolean {
  return /^[0-9a-f]{4}$/i.test(value.slice(index + 1, index + 5));
}

function removeTrailingClosedJsonStringQuote(value: string): string {
  const match = /"\s*$/.exec(value);
  if (!match || match.index === undefined || hasOddBackslashRunBefore(value, match.index)) {
    return value;
  }

  return value.slice(0, match.index);
}

function hasOddBackslashRunBefore(value: string, index: number): boolean {
  let count = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
    count += 1;
  }
  return count % 2 === 1;
}
