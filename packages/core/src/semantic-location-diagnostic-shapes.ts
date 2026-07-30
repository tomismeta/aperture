import { looksLikeDiagnosticReference } from "./semantic-diagnostic-reference-shapes.js";

const LOCATION_DIAGNOSTIC_PATTERNS = [
  /(?:^|[\r\n])\s*(?:[A-Za-z]:[\\/])?(?:[./\\\w-]+[\\/])?[\w.-]+\.[a-z0-9]{1,8}\s+\d+:\d+\s+(?:error|fatal)\b/i,
  /(?:^|[\r\n])\s*(?:[A-Za-z]:[\\/])?(?:[./\\\w-]+[\\/])?[\w.-]+\.[a-z0-9]{1,8}:\d+:\d+:\s+(?:(?:\[(?:error|fatal)\])|(?:error|fatal)\b)\s+\S/i,
  /(?:^|[\r\n])\s*(?:[A-Za-z]:[\\/])?(?:[./\\\w-]+[\\/])?[\w.-]+\.[a-z0-9]{1,8}\(\d+,\d+\):\s+(?:error|fatal)\b\s+\S/i,
  /(?:^|[\r\n])\s*\d+:\d+\s+(?:error|fatal)\b[^\n]{0,160}\([a-z][a-z0-9-]+\)/i,
  /(?:^|[\r\n])\s*(?:[a-z][\w.-]*(?:lint|test|check|build|compil|type|format|validat|audit|scan|parse|command|tool)[\w.-]*\s+)?(?:results?|output|report|diagnostics?|problems?):\s+[^\n]{0,160}(?:[A-Za-z]:[\\/])?(?:[./\\\w-]+[\\/])?[\w.-]+\.[a-z0-9]{1,8}\s+\d+:\d+\s+(?:error|fatal)\b/i,
  /(?:^|[\r\n])\s*(?:[a-z][\w.-]*(?:lint|test|check|build|compil|type|format|validat|audit|scan|parse|command|tool)[\w.-]*\s+)?(?:results?|output|report|diagnostics?|problems?):\s+[^\n]{0,160}(?:[A-Za-z]:[\\/])?(?:[./\\\w-]+[\\/])?[\w.-]+\.[a-z0-9]{1,8}:\d+:\d+:\s+(?:(?:\[(?:error|fatal)\])|(?:error|fatal)\b)\s+\S/i,
  /\bcommand\s+output:\s+[^\n]{0,240}(?:[A-Za-z]:[\\/])?(?:[./\\\w-]+[\\/])?[\w.-]+\.[a-z0-9]{1,8}:\d+:\d+:\s+(?:(?:\[(?:error|fatal)\])|(?:error|fatal)\b)\s+\S/i,
  /\bline\s+\d+:\s+syntax\s+error\b[^\n]{0,160}\(level:\s*error\)/i,
  /\b(?:error(?:\s+parsing\s+[a-z0-9_. -]+)?):\s+[^\n]{0,240}\bline\s+\d+,\s+column\s+\d+\b/i,
  /\b(?:parseerror|parsing\s+error|invalid\s+syntax)\b[^\n]{0,240}\bline\s+\d+,\s+column\s+\d+\b/i,
  /(?:^|[\r\n])\s*E\s+AssertionError\b/i,
] as const;

const BENIGN_ZERO_DIAGNOSTIC_PATTERN =
  /\b(?:no\s+errors?|0\s+errors?|no\s+failures?|0\s+failures?)\b/i;

export function looksLikeLocationDiagnosticObservation(value: string): boolean {
  const text = stripAnsiControlSequences(value).trim();
  if (
    text.length === 0 ||
    looksLikeDiagnosticReference(text) ||
    BENIGN_ZERO_DIAGNOSTIC_PATTERN.test(text)
  ) {
    return false;
  }

  return LOCATION_DIAGNOSTIC_PATTERNS.some((pattern) => pattern.test(text));
}

function stripAnsiControlSequences(text: string): string {
  return text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}
