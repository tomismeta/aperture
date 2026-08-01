const SOURCE_WINDOW_LIMIT_SUBJECT_PATTERN =
  /^(?:(?:file|source|document|read)\s+)?(?:content|output|payload|window)\b|^(?:file|source|document|read)\b/i;
const SOURCE_WINDOW_LIMIT_MEASUREMENT_PATTERN =
  /\((?:(?:\d+(?:\.\d+)?\s*(?:kb|mb|gb|b))|(?:\d+\s*tokens?))\)/i;
const SOURCE_WINDOW_LIMIT_POLICY_PATTERN =
  /\b(?:exceeds?|exceeded|larger than|too large for|over|above)\s+(?:the\s+)?(?:maximum|max|allowed|configured|read)(?:\s+(?:allowed|read|token))?\s+(?:size|tokens?|limit|window)\b|\b(?:maximum|max|allowed|configured|read)(?:\s+(?:allowed|read|token))?\s+(?:size|tokens?|limit|window)\s+(?:is|was)?\s*(?:exceeded|reached)\b/i;
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
    SOURCE_WINDOW_LIMIT_SUBJECT_PATTERN.test(text) &&
    SOURCE_WINDOW_LIMIT_MEASUREMENT_PATTERN.test(text) &&
    SOURCE_WINDOW_LIMIT_POLICY_PATTERN.test(text) &&
    SOURCE_WINDOW_LIMIT_RECOVERY_PATTERN.test(text)
  );
}
