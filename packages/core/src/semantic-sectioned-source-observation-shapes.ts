import { looksLikeStrongRawSourceObservation } from "./semantic-observation-shapes.js";
export function looksLikeSectionedSourceObservation(value: string): boolean {
  const body = stripLeadingTestBanner(value);
  return body !== null && looksLikeSectionSourceObservationBody(body);
}
export function looksLikeSectionSourceObservationBody(value: string): boolean {
  return !looksLikeLeadingDiagnostic(value) && looksLikeStrongRawSourceObservation(value);
}
function stripLeadingTestBanner(value: string): string | null {
  const match = /^\s*={2,}\s*Testing\b[^=\r\n]{1,180}={2,}\s*([\s\S]+)$/i.exec(value);
  return match?.[1]?.trim() ?? null;
}
function looksLikeLeadingDiagnostic(value: string): boolean {
  return /^(?:FAIL\b|ERROR\b|FAILED\b|AssertionError\b|Traceback\b|[1-9]\d*\s+fail(?:ed|ures?)\b|(?:failures|errors)\s*[:=]\s*[1-9]\d*\b|exited\s+with\s+(?:code|status)\s+[1-9]\d*\b)/i.test(
    value,
  );
}
