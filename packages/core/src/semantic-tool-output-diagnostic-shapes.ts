import { looksLikeKernelLogDiagnosticPayload } from "./semantic-kernel-log-shapes.js";

export function looksLikeToolOutputDiagnosticPayload(text: string): boolean {
  return looksLikeKernelLogDiagnosticPayload(text) || looksLikeRipgrepIoDiagnostic(text);
}

function looksLikeRipgrepIoDiagnostic(text: string): boolean {
  return /(?:^|[\r\n])\s*rg:\s+\S[^\r\n]*:\s+IO error for operation on\s+\S[^\r\n]*(?=$|[\r\n])/i.test(
    text,
  );
}
