export function looksLikeSuccessfulTestOutputObservation(value: string): boolean {
  const text = value.trim();
  if (looksLikeFailedTestOutputDiagnostic(text)) {
    return false;
  }

  return (
    looksLikeBannerTestSuccess(text) ||
    looksLikeUnittestSuccess(text) ||
    looksLikePytestSuccess(text) ||
    looksLikeCommandTestSuccess(text)
  );
}

export function looksLikeFailedTestOutputDiagnostic(value: string): boolean {
  return [
    /\bFAILED\s+\([^)]*\b(?:failures|errors)=[1-9]\d*/i,
    /(?:^|[\r\n])\s*(?:FAIL|ERROR):\s+\S/i,
    /\b(?:test failed|tests failed|failed tests)\b/i,
    /\b(?:failures|errors)=[1-9]\d*\b/i,
    /\b[1-9]\d*\s+failed\b/i,
    /\b[1-9]\d*\s+errors?\b/i,
    /(?:^|[\r\n])\s*=+\s*(?:FAILURES|ERRORS)\s*=+/i,
  ].some((pattern) => pattern.test(value));
}

function looksLikeBannerTestSuccess(text: string): boolean {
  return /^\s*===\s*Testing\b[^=\r\n]{1,160}===\s*All\s+[a-z0-9_. -]{1,160}\s+tests?\s+passed!?\s*$/i.test(
    text,
  );
}

function looksLikeUnittestSuccess(text: string): boolean {
  return /(?:^|[\r\n]|\s)Ran\s+\d+\s+tests?\s+in\s+[\d.]+s\s+OK\s*$/i.test(text);
}

function looksLikePytestSuccess(text: string): boolean {
  return /(?:^|[\r\n=])\s*=*\s*\d+\s+passed(?:,?\s+\d+\s+(?:skipped|warnings?))*\s+in\s+[\d.]+s\s*=*\s*$/i.test(
    text,
  );
}

function looksLikeCommandTestSuccess(text: string): boolean {
  return /^\s*running\s+(?:command|[a-z0-9_.-]+)[^\r\n]{0,160}\s+output:\s+[\s\S]{1,1200}\b(?:test passed(?::\s+[^\r\n.]+)?|tests passed|all checks passed|all [a-z0-9_. -]{1,160} tests passed|no problems found)[.!]?\s*$/i.test(
    text,
  );
}
