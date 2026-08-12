const SOURCE_WINDOW_LIMIT_SUBJECT_PATTERN =
  /^(?:(?:file|source|document|read)\s+)?(?:content|output|payload|window)\b|^(?:file|source|document|read)\b|^(?:returned|showing|displaying)\s+lines?\b/i;
const SOURCE_WINDOW_LIMIT_MEASUREMENT_PATTERN =
  /\((?:(?:\d+(?:\.\d+)?\s*(?:kb|mb|gb|b))|(?:\d+\s*tokens?))\)|\blines?\s+\d+(?:\s+(?:through|to)\s+|\s*-\s*)\d+\s+of\s+\d+\b/i;
const SOURCE_WINDOW_LIMIT_POLICY_PATTERN =
  /\b(?:exceeds?|exceeded|larger than|too large for|over|above)\s+(?:the\s+)?(?:maximum|max|allowed|configured|read)(?:\s+(?:allowed|read|token))?\s+(?:size|tokens?|limit|window)\b|\b(?:maximum|max|allowed|configured|read)(?:\s+(?:allowed|read|token))?\s+(?:size|tokens?|limit|window)\s+(?:is|was)?\s*(?:exceeded|reached)\b|\b(?:remainder|rest)\s+(?:was\s+)?(?:intentionally\s+)?(?:omitted|truncated|clipped)\s+(?:by|at|because of)\s+(?:the\s+)?(?:read|output|display)\s+(?:limit|boundary)\b/i;
const SOURCE_WINDOW_LIMIT_RECOVERY_PATTERN =
  /\buse (?:offset and limit|start_line and end_line) parameters?\b|\bsearch for specific content\b|\b(?:remainder|rest)\s+(?:was\s+)?(?:intentionally\s+)?(?:omitted|truncated|clipped)\b/i;
const SOURCE_WINDOW_LIMIT_MIXED_DIAGNOSTIC_PATTERN =
  /\b(?:permission denied|operation not permitted|no such file or directory|failed to read|failed to open|could not read|could not open|unable to read|unable to open)\b/i;

export function looksLikeSourceWindowLimitFailure(value: string | undefined): boolean {
  if (value === undefined) return false;

  const text = value.trim().replace(/\s+/g, " ");
  return (
    looksLikeSourceWindowLimitEnvelope(text) &&
    !SOURCE_WINDOW_LIMIT_MIXED_DIAGNOSTIC_PATTERN.test(text)
  );
}

export function looksLikeSourceWindowLimitMixedDiagnostic(value: string | undefined): boolean {
  if (value === undefined) return false;

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
