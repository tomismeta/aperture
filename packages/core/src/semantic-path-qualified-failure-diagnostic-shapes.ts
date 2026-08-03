export function looksLikePathQualifiedFailureDiagnostic(text: string): boolean {
  return /(?:^|[\r\n])\s*(?:\/|\.{1,2}\/|~\/|[a-zA-Z]:\\)?[^\s:\r\n]+\.[a-zA-Z0-9]{1,8}:\d+(?::\d+)?:\s*(?:(?:tests?|build|command|process|subprocess)\s+failed\s*:|failed\s+(?:tests?|build|command|process|subprocess)\s*:|assertion\s+failed\s*:|(?:E\s+)?(?:AssertionError|RuntimeError|ValueError|TypeError|Exception):\s+\S|(?:FAIL|FAILED|ERROR)\b[:\s]\s*\S)/i.test(
    text,
  );
}
