export function looksLikeExplicitReadFailureDiagnostic(value: string): boolean {
  return /^(?:read\s+failed\b|failed to (?:read|open)\b|could not (?:read|open)\b|unable to (?:read|open)\b)/i.test(
    value
      .trim()
      .replace(/^(?:read|tool)\s+failure\s+/i, "")
      .replace(/^#{1,6}\s+/, ""),
  );
}
