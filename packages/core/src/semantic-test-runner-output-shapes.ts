export function looksLikeTestRunnerFailureDiagnostic(value: string): boolean {
  return [
    /(?:^|[\r\n])\s*(?:Failure|Failed|Panicked)\s*\[[^\]\r\n]{1,80}]/i,
    /(?:^|[\r\n])\s*•\s*(?:Failure|Failed|Panicked)\b/i,
    /(?:^|[\r\n])\s*\S+::\S+[^\r\n]{0,160}\sFAILED\b/,
  ].some((pattern) => pattern.test(value));
}

export function looksLikeTestRunnerProgress(value: string): boolean {
  const text = stripAnsi(value);
  return looksLikeGinkgoProgress(text) || looksLikePytestSessionProgress(text);
}

function looksLikeGinkgoProgress(text: string): boolean {
  return (
    /\bRunning Suite:\s+\S[\s\S]{0,400}\bWill run\s+\d+\s+of\s+\d+\s+specs?\b/i.test(text) &&
    /(?:^|[\s\S])(?:•|\+|PASS\b|SUCCESS\b)/i.test(text)
  );
}

function looksLikePytestSessionProgress(text: string): boolean {
  return (
    /(?:^|[\r\n])\s*=+\s*test session starts\s*=+/i.test(text) &&
    /\bplatform\s+\S+[\s\S]{0,240}\bpytest-\d/i.test(text) &&
    (/\bcollected\s+\d+\s+items?\b/i.test(text) ||
      /\bcachedir:\s+\.pytest_cache\b/i.test(text) ||
      /\brootdir:\s+\S/i.test(text))
  );
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
}
