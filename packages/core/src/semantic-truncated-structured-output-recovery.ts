import type { StructuredToolOutputObservation } from "./semantic-structured-output.js";
import { looksLikeWallTime } from "./semantic-structured-output.js";

export type PartialEnvelopeFields = {
  exitCode?: number;
  wallTime?: string;
  invalid?: true;
};

export function readPartialEnvelopeOutput(
  value: string,
  prefixFields: PartialEnvelopeFields,
): StructuredToolOutputObservation | null {
  if (prefixFields.invalid === true) {
    return null;
  }
  if (prefixFields.wallTime !== undefined && !looksLikeWallTime(prefixFields.wallTime)) {
    return null;
  }

  const output = readJsonStringPrefix(value);
  if (output.text.trim().length === 0) {
    return null;
  }

  const suffixFields = readVisibleSuffixFields(output.suffix);
  if (suffixFields === null) {
    return null;
  }
  if (
    (prefixFields.exitCode !== undefined && suffixFields.exitCode !== undefined) ||
    (prefixFields.wallTime !== undefined && suffixFields.wallTime !== undefined)
  ) {
    return null;
  }

  const exitCode = prefixFields.exitCode ?? suffixFields.exitCode;
  const wallTime = prefixFields.wallTime ?? suffixFields.wallTime;
  return {
    output: output.text,
    ...(wallTime !== undefined ? { wallTime } : {}),
    ...(exitCode !== undefined ? { exitCode } : {}),
  };
}

export function readIntegerExitCodeToken(value: string): number | null {
  const normalized = value.replace(/^"|"$/g, "").trim();
  return /^-?\d+$/.test(normalized) ? Number.parseInt(normalized, 10) : null;
}

function readVisibleSuffixFields(value: string): PartialEnvelopeFields | null {
  let rest = value.trim();
  const fields: PartialEnvelopeFields = {};

  while (rest.length > 0) {
    if (rest === "}") {
      return fields;
    }
    const keyMatch = /^,\s*"([a-z_]+)"\s*:\s*/.exec(rest);
    if (!keyMatch) {
      return null;
    }
    rest = rest.slice(keyMatch[0].length);

    switch (keyMatch[1]) {
      case "exit_code": {
        const parsed = readSuffixExitCode(rest);
        if (parsed === null || fields.exitCode !== undefined) {
          return null;
        }
        fields.exitCode = parsed.exitCode;
        rest = parsed.rest;
        break;
      }
      case "wall_time": {
        const parsed = readSuffixWallTime(rest);
        if (parsed === null || fields.wallTime !== undefined) {
          return null;
        }
        fields.wallTime = parsed.wallTime;
        rest = parsed.rest;
        break;
      }
      case "truncated": {
        const parsed = readSuffixTruncated(rest);
        if (parsed === null) {
          return null;
        }
        rest = parsed;
        break;
      }
      default:
        return null;
    }
  }

  return fields;
}

function readSuffixExitCode(value: string): { exitCode: number; rest: string } | null {
  const match = /^(?:"([+-]?\d+)"|([+-]?\d+))/.exec(value);
  const exitCode = match ? readIntegerExitCodeToken(match[1] ?? match[2] ?? "") : null;
  if (match === null || exitCode === null) {
    return null;
  }
  return { exitCode, rest: value.slice(match[0].length).trim() };
}

function readSuffixWallTime(value: string): { wallTime: string; rest: string } | null {
  const match = /^"([^"]+)"/.exec(value);
  const wallTime = match?.[1] ?? "";
  if (!match || !looksLikeWallTime(wallTime)) {
    return null;
  }
  return { wallTime, rest: value.slice(match[0].length).trim() };
}

function readSuffixTruncated(value: string): string | null {
  const match = /^true\b/.exec(value);
  return match ? value.slice(match[0].length).trim() : null;
}

function readJsonStringPrefix(value: string): { text: string; suffix: string } {
  let output = "";

  for (let index = 0; index < value.length; index += 1) {
    const current = value[index];
    if (current === '"') {
      return { text: output, suffix: value.slice(index + 1) };
    }

    if (current !== "\\") {
      output += current;
      continue;
    }

    const escaped = value[index + 1];
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
        output += decodeUnicodeEscape(value, index);
        index += isUnicodeEscape(value, index) ? 4 : 0;
        break;
      default:
        output += escaped;
        break;
    }
  }

  return { text: output, suffix: "" };
}

function decodeUnicodeEscape(value: string, index: number): string {
  const hex = value.slice(index + 1, index + 5);
  return /^[0-9a-f]{4}$/i.test(hex) ? String.fromCharCode(Number.parseInt(hex, 16)) : "u";
}

function isUnicodeEscape(value: string, index: number): boolean {
  return /^[0-9a-f]{4}$/i.test(value.slice(index + 1, index + 5));
}
