import type { StructuredToolOutputObservation } from "./semantic-structured-output.js";
import {
  looksLikeWallTime,
  parseJsonObject,
  readOptionalIntegerExitCode,
} from "./semantic-structured-output.js";
import {
  readIntegerExitCodeToken,
  readPartialEnvelopeOutput,
} from "./semantic-truncated-structured-output-recovery.js";

export function readTruncatedStructuredToolOutputEnvelope(
  summary: string | undefined,
): StructuredToolOutputObservation | null {
  if (summary === undefined) return null;

  const marked = readMarkedTruncatedStructuredToolOutputObservation(summary);
  if (marked !== null) return marked;

  if (parseJsonObject(summary) !== null) return null;

  return readTruncatedStructuredToolOutputEnvelopePrefix(summary);
}

function readTruncatedStructuredToolOutputEnvelopePrefix(
  summary: string,
): StructuredToolOutputObservation | null {
  const withExitCode =
    /^\s*\{\s*"exit_code"\s*:\s*("[+-]?\d+"|-?\d+)\s*,\s*"wall_time"\s*:\s*"([^"]+)"\s*,\s*"output"\s*:\s*"/.exec(
      summary,
    );
  if (withExitCode) {
    const exitCode = readIntegerExitCodeToken(withExitCode[1] ?? "");
    const wallTime = withExitCode[2] ?? "";
    return readPartialEnvelopeOutput(summary.slice(withExitCode[0].length), {
      ...(exitCode !== null ? { exitCode } : { invalid: true }),
      wallTime,
    });
  }

  const withWallTimeThenExitCode =
    /^\s*\{\s*"wall_time"\s*:\s*"([^"]+)"\s*,\s*"exit_code"\s*:\s*("[+-]?\d+"|-?\d+)\s*,\s*"output"\s*:\s*"/.exec(
      summary,
    );
  if (withWallTimeThenExitCode) {
    const exitCode = readIntegerExitCodeToken(withWallTimeThenExitCode[2] ?? "");
    return readPartialEnvelopeOutput(summary.slice(withWallTimeThenExitCode[0].length), {
      ...(exitCode !== null ? { exitCode } : { invalid: true }),
      wallTime: withWallTimeThenExitCode[1] ?? "",
    });
  }

  const withoutExitCode = /^\s*\{\s*"wall_time"\s*:\s*"([^"]+)"\s*,\s*"output"\s*:\s*"/.exec(
    summary,
  );
  if (withoutExitCode) {
    return readPartialEnvelopeOutput(summary.slice(withoutExitCode[0].length), {
      wallTime: withoutExitCode[1] ?? "",
    });
  }

  const outputOnly = /^\s*\{\s*"output"\s*:\s*"/.exec(summary);
  if (!outputOnly) return null;

  return readPartialEnvelopeOutput(summary.slice(outputOnly[0].length), {});
}

function readMarkedTruncatedStructuredToolOutputObservation(
  summary: string,
): StructuredToolOutputObservation | null {
  const parsed = parseJsonObject(summary);
  if (
    parsed === null ||
    parsed.truncated !== true ||
    typeof parsed.wall_time !== "string" ||
    typeof parsed.output !== "string" ||
    !looksLikeWallTime(parsed.wall_time) ||
    hasUnexpectedMarkedTruncatedKeys(parsed) ||
    parsed.output.trim().length === 0
  ) {
    return null;
  }

  const exitCode = readOptionalIntegerExitCode(parsed);
  if (exitCode === "invalid") return null;

  return {
    output: parsed.output,
    wallTime: parsed.wall_time,
    ...(exitCode !== undefined ? { exitCode } : {}),
  };
}

const hasUnexpectedMarkedTruncatedKeys = (value: Record<string, unknown>) => {
  const allowedKeys = new Set(["exit_code", "output", "truncated", "wall_time"]);
  return Object.keys(value).some((key) => !allowedKeys.has(key));
};
