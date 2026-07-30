export function looksLikeObservationReferenceWrapper(text: string): boolean {
  return REFERENCE_WRAPPER_PATTERNS.some((pattern) => pattern.test(text));
}

const REFERENCE_WRAPPER_PATTERNS = [
  /^(?:expected|example|sample|reference|desired|golden|baseline|canonical|fixture|documentation)\b[^\r\n:]{0,80}\b(?:output|results?|report|diagnostics?|errors?|failures?)\b[^\r\n:]{0,80}:/i,
  /^(?:expected|example|sample)\b[^\r\n:]{0,80}:\s*(?:actual|received)\s+(?:output|results?|report|diagnostics?|errors?|failures?)\b/i,
  /^(?:for reference|for example|here is an example|in the docs|as shown in the docs|according to\b[^\r\n:]{0,80}|the\b[^\r\n:]{0,80}documentation\b[^\r\n:]{0,80}|the report|source text|this example shows)\b/i,
  /^(?:output format|expected error|for example,|(?:test\b[^\r\n:]{0,80}|probe|error occurred)\s+failed as expected|error occurred as expected|error reading\b[^\r\n:]{0,80}\(expected\)|the\b[^\r\n:]{0,80}\bdocs?\b[^\r\n:]{0,80}(?:show|shows|display|says)|according to\b[^\r\n:]{0,80}\bdocs?\b)/i,
] as const;
