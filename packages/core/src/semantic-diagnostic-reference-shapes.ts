export function looksLikeDiagnosticReference(value: string): boolean {
  return (
    looksLikeExpectedDiagnosticReference(value) ||
    looksLikeExpectedDiagnosticProbe(value) ||
    looksLikeProseDiagnosticReference(value) ||
    looksLikeSourceDiagnosticReference(value)
  );
}

function looksLikeExpectedDiagnosticReference(text: string): boolean {
  return /^\s*(?:(?:expected|example|sample|reference|illustrative|previous|golden|baseline|canonical|fixture|desired)(?:\s+(?:[a-z][\w.-]{0,40}|from\s+[a-z][\w.-]{0,40})){0,3}\s+(?:output|stdout|stderr|diagnostics?|results?|reports?)(?:\s+from\s+[a-z][\w.-]{0,40})?|(?:sample|reference|example|fixture)\s+from\s+[a-z][\w.-]{0,40}|(?:expected|example|sample|reference|illustrative|previous|golden|baseline|canonical|fixture|desired)(?:\s+[a-z][\w.-]{0,40})?|fixture)\s*:/i.test(
    text,
  );
}

function looksLikeSourceDiagnosticReference(text: string): boolean {
  return /^\s*(?:(?:(?:const|let|var)\s+)?[a-z_$][\w$]*\s*=\s*(?:(?:new\s+)?[A-Z][A-Za-z0-9_$]{1,80}\s*\(\s*)?["'`]|(?:print|console\.log|assert(?:\.\w+)?|expect)\s*\(|(?:throw\s+)?new\s+[A-Z][A-Za-z0-9_$]{1,80}\s*\(\s*["'`]|raise\s+[A-Z][A-Za-z0-9_$]{1,80}\s*\(\s*["'`]|(?:[a-z_$][\w$]*\.)+[a-z_$][\w$]*\s*\(\s*["'`]|[A-Z][A-Za-z0-9_$]{1,80}\s*\(\s*["'`]|["'`][^"'`\n]{0,160}\b(?:expected\s+)?(?:exception|failed|failure|tests?\s+failed)\b|\/\/|#\s*fixture\b|return\s+["'`])/i.test(
    text,
  );
}

function looksLikeExpectedDiagnosticProbe(text: string): boolean {
  return (
    /^\s*(?:expected\s+(?:error|failure|exception)|(?:(?:test|case|probe|scenario)(?:\s+\d+)?[^\n:]{0,80}:?\s+)?(?:failed|failure|error|exception)\s+as\s+expected|(?:error|failure|exception)\s+occurred\s+as\s+expected)\b/i.test(
      text,
    ) || /^\s*(?:error|failure|exception)[^\n:]{0,120}\(expected\):/i.test(text)
  );
}

function looksLikeProseDiagnosticReference(text: string): boolean {
  return /^\s*(?:for\s+example\b|for\s+reference\s*[,:]|output\s+format\s*:|(?:source|fixture|sample|example)\s+(?:text|code|snippet|fixture)\s*:|this\s+(?:example|sample|fixture)\s+(?:shows?|uses?|contains?|demonstrates?)\s*:|documentation\s+(?:output|results?|reports?|diagnostics?)\s*:|the\s+(?:output|results?|reports?|diagnostics?)\s*:|(?:according\s+to\s+)?(?:the\s+)?[^\n:]{0,80}\b(?:documentation|docs?)\b(?:[^\n:]{0,80}\b(?:displays?|says?|shows?)\b|[^\n:]{0,80}[,:]))/i.test(
    text,
  );
}
