export const SOURCE_EVENT_SUMMARY_MAX_LENGTH = 8_192;
const PLAIN_SOURCE_EVENT_SUMMARY_MAX_LENGTH = 1_200;
const MIDDLE_CLIP_MARKER = " ... ";
const LEGACY_TAIL_CLIP_MIN_LENGTH = 256;

type StructuredOutputSummary = Record<string, unknown> & { output: string };

export function clipText(value: string, maxLength: number): string {
  const normalized = toSingleLine(value) ?? value;
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 3)}...`;
}

export function clipSourceEventSummary(
  value: string,
  maxLength: number = SOURCE_EVENT_SUMMARY_MAX_LENGTH,
): string {
  const normalized = toSingleLine(value) ?? value;
  const structured = parseJsonObject(normalized);
  if (structured && hasStructuredOutputSummary(structured)) {
    if (normalized.length <= maxLength) {
      return normalized;
    }
    return (
      clipStructuredOutputSummary(structured, maxLength) ?? clipMiddleText(normalized, maxLength)
    );
  }

  const plainMaxLength = Math.min(maxLength, PLAIN_SOURCE_EVENT_SUMMARY_MAX_LENGTH);
  return normalized.length <= plainMaxLength
    ? normalized
    : clipMiddleText(normalized, plainMaxLength);
}

export function isClippedSourceEventSummary(value: string): boolean {
  const normalized = toSingleLine(value) ?? value;
  if (normalized.includes(MIDDLE_CLIP_MARKER)) {
    return true;
  }

  const structured = parseJsonObject(normalized);
  if (structured?.truncated === true) {
    return true;
  }

  return looksLikeLegacyTailClippedSummary(normalized);
}

export function toSingleLine(value: string): string | null {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : null;
}

function clipMiddleText(value: string, maxLength: number): string {
  if (maxLength <= MIDDLE_CLIP_MARKER.length + 2) {
    return clipText(value, maxLength);
  }

  const retainedLength = maxLength - MIDDLE_CLIP_MARKER.length;
  const headLength = Math.ceil(retainedLength * 0.6);
  const tailLength = retainedLength - headLength;
  return `${value.slice(0, headLength).trimEnd()}${MIDDLE_CLIP_MARKER}${value
    .slice(-tailLength)
    .trimStart()}`;
}

function clipStructuredOutputSummary(
  parsed: StructuredOutputSummary,
  maxLength: number,
): string | null {
  const clipped = { ...parsed };
  let low = 0;
  let high = parsed.output.length;
  let best: string | null = null;

  while (low <= high) {
    const midpoint = Math.floor((low + high) / 2);
    clipped.output =
      midpoint < parsed.output.length ? `${parsed.output.slice(0, midpoint)}...` : parsed.output;
    if (midpoint < parsed.output.length) {
      clipped.truncated = true;
    } else {
      delete clipped.truncated;
    }
    const candidate = stringifyJsonObject(clipped);

    if (candidate !== null && candidate.length <= maxLength) {
      best = candidate;
      low = midpoint + 1;
    } else {
      high = midpoint - 1;
    }
  }

  return best;
}

function looksLikeLegacyTailClippedSummary(value: string): boolean {
  return value.length >= LEGACY_TAIL_CLIP_MIN_LENGTH && value.trimEnd().endsWith("...");
}

function hasStructuredOutputSummary(
  value: Record<string, unknown>,
): value is StructuredOutputSummary {
  return typeof value.output === "string";
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function stringifyJsonObject(value: Record<string, unknown>): string | null {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}
