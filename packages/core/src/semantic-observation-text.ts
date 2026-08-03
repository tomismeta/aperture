const OBSERVATION_STATUS_PREFIX_PATTERN = /^(?:bash|edit|read|search|tool)\s+failure\s+/i;
const VISIBLE_TRUNCATION_BOUNDARY_PATTERN = /(?:\.\.\.|…)\s*$/;

export function stripObservationStatusPrefix(value: string): string {
  return value.trim().replace(OBSERVATION_STATUS_PREFIX_PATTERN, "");
}

export function hasVisibleTruncationBoundary(value: string): boolean {
  return VISIBLE_TRUNCATION_BOUNDARY_PATTERN.test(value.trim());
}
