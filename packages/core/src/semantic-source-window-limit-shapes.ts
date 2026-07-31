const SOURCE_WINDOW_LIMIT_FAILURE_PATTERN =
  /^file content \((?:(?:\d+(?:\.\d+)?\s*(?:kb|mb|gb|b))|(?:\d+\s*tokens?))\) exceeds maximum allowed (?:size \(\d+(?:\.\d+)?\s*(?:kb|mb|gb|b)\)|tokens \(\d+(?:\s*tokens?)?\))\./i;
const SOURCE_WINDOW_LIMIT_RECOVERY_PATTERN =
  /\buse (?:offset and limit|start_line and end_line) parameters?\b|\bsearch for specific content\b/i;
const SOURCE_WINDOW_LIMIT_MIXED_DIAGNOSTIC_PATTERN =
  /\b(?:permission denied|operation not permitted|no such file or directory|failed to read|failed to open|could not read|could not open|unable to read|unable to open)\b/i;

export function looksLikeSourceWindowLimitFailure(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }

  const text = value.trim().replace(/\s+/g, " ");
  return (
    looksLikeSourceWindowLimitEnvelope(text) &&
    !SOURCE_WINDOW_LIMIT_MIXED_DIAGNOSTIC_PATTERN.test(text)
  );
}

export function looksLikeSourceWindowLimitMixedDiagnostic(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }

  const text = value.trim().replace(/\s+/g, " ");
  return (
    looksLikeSourceWindowLimitEnvelope(text) &&
    SOURCE_WINDOW_LIMIT_MIXED_DIAGNOSTIC_PATTERN.test(text)
  );
}

function looksLikeSourceWindowLimitEnvelope(text: string): boolean {
  return (
    SOURCE_WINDOW_LIMIT_FAILURE_PATTERN.test(text) &&
    SOURCE_WINDOW_LIMIT_RECOVERY_PATTERN.test(text)
  );
}
