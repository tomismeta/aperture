export function looksLikeKernelLogDiagnosticPayload(text: string): boolean {
  return KERNEL_LOG_DIAGNOSTIC_PATTERN.test(text);
}

const KERNEL_LOG_DIAGNOSTIC_PATTERN =
  /(?:^|[\r\n]|\s)(?:\d+:\s*)?\[\s*\d+(?:\.\d+)?][^\r\n]*(?:\*ERROR\*|\b(?:error|failed|failure|fault)\b|\bkernel panic\b|\bBUG:\s*(?:soft|hard) lockup\b)/i;
