const CLI_PARSE_ERROR_EMITTERS = new Set(["jq"]);
const KERNEL_LOG_DIAGNOSTIC_PATTERN =
  /(?:^|[\r\n]|\s)(?:\d+:\s*)?\[\s*\d+(?:\.\d+)?][^\r\n]*(?:\*ERROR\*|\b(?:error|failed|failure|fault)\b|\bkernel panic\b|\bBUG:\s*(?:soft|hard) lockup\b)/i;

export function looksLikeKernelLogDiagnosticPayload(text: string): boolean {
  return KERNEL_LOG_DIAGNOSTIC_PATTERN.test(text);
}

export function looksLikeToolOutputDiagnosticPayload(text: string): boolean {
  return (
    looksLikeKernelLogDiagnosticPayload(text) ||
    looksLikeRipgrepIoDiagnostic(text) ||
    looksLikeCliParseErrorDiagnostic(text) ||
    looksLikeCommandUsageDiagnosticPayload(text)
  );
}

function looksLikeRipgrepIoDiagnostic(text: string): boolean {
  return /(?:^|[\r\n])\s*rg:\s+\S[^\r\n]*:\s+IO error for operation on\s+\S[^\r\n]*(?=$|[\r\n])/i.test(
    text,
  );
}

function looksLikeCliParseErrorDiagnostic(text: string): boolean {
  const match =
    /^([a-z0-9][a-z0-9_.-]{0,60}):[ \t]+parse error:[^\r\n]{0,240}\b(?:at|on)[ \t]+line[ \t]+\d+\b[^\r\n]*(?=$|[\r\n])/i.exec(
      text.replace(/^[ \t]+/, ""),
    );
  const toolName = match?.[1]?.toLowerCase();
  return toolName !== undefined && CLI_PARSE_ERROR_EMITTERS.has(toolName);
}

export function looksLikeCommandUsageDiagnosticPayload(text: string): boolean {
  return (
    /(?:^|[\r\n])\s*usage:\s+[^\r\n]{1,200}/i.test(text) &&
    /(?:^|[\r\n]|\s)[a-z0-9_.-]+:\s+error:\s+\S/i.test(text)
  );
}
