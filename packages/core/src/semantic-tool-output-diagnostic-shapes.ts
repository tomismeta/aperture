import { looksLikeKernelLogDiagnosticPayload } from "./semantic-kernel-log-shapes.js";

export function looksLikeToolOutputDiagnosticPayload(text: string): boolean {
  return (
    looksLikeKernelLogDiagnosticPayload(text) ||
    looksLikeRipgrepIoDiagnostic(text) ||
    looksLikeCommandUsageDiagnosticPayload(text)
  );
}

function looksLikeRipgrepIoDiagnostic(text: string): boolean {
  return /(?:^|[\r\n])\s*rg:\s+\S[^\r\n]*:\s+IO error for operation on\s+\S[^\r\n]*(?=$|[\r\n])/i.test(
    text,
  );
}

export function looksLikeCommandUsageDiagnosticPayload(text: string): boolean {
  return (
    /(?:^|[\r\n])\s*usage:\s+[^\r\n]{1,200}/i.test(text) &&
    /(?:^|[\r\n]|\s)[a-z0-9_.-]+:\s+error:\s+\S/i.test(text)
  );
}
