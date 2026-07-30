import { looksLikeObservationReferenceWrapper } from "./semantic-observation-reference-wrapper-shapes.js";

export function looksLikeLinterOutputObservation(value: string): boolean {
  const text = value.trim();
  if (
    text.length === 0 ||
    looksLikeInstructionalText(text) ||
    looksLikeObservationReferenceWrapper(text) ||
    looksLikeQuotedLinterLocationLiteral(text)
  ) {
    return false;
  }
  if (looksLikeUnreportedLinterError(text)) {
    return false;
  }

  const locations = countLinterLocationRows(text);
  return (
    locations >= 2 ||
    (locations >= 1 && /\b(?:running|output|lint|linter|problems?\s+found)\b/i.test(text))
  );
}

function countLinterLocationRows(text: string): number {
  return [
    ...text.matchAll(
      /(?:^|[\r\n]|\s)(?:(?:\.{0,2}\/|\/)?[a-z0-9_./-]+\.(?:ya?ml|json|toml|ini|cfg|conf|md|txt|py|ts|tsx|js|jsx|rb|go|rs|java|kt|swift)\s+)?(?:line\s+)?\d{1,6}(?::\d{1,4}|,\s*column\s+\d{1,4}):?\s+(?:warning\s+|error\s+|found\s+|missing\s+|too\s+|forbidden\s+|undefined\s+|duplicate\s+|trailing\s+|wrong\s+)\S/gi,
    ),
  ].length;
}

function looksLikeInstructionalText(text: string): boolean {
  return /\b(?:please|should|must|expected output|final response|review your changes|follow the steps)\b/i.test(
    text,
  );
}

function looksLikeQuotedLinterLocationLiteral(text: string): boolean {
  return /["'`][^"'`\r\n]{0,200}\b\d{1,6}:\d{1,4}\s+(?:error|warning)\b[^"'`\r\n]{0,200}["'`]/i.test(
    text,
  );
}

function looksLikeUnreportedLinterError(text: string): boolean {
  return (
    looksLikeLinterError(text) && !/\bTest PASSED\b[\s\S]{0,240}\b(?:error|reported)\b/i.test(text)
  );
}

function looksLikeLinterError(text: string): boolean {
  return (
    /(?:^|[\r\n]|\s)(?:error|fatal)\b/i.test(text) ||
    /\b(?:\[[^\]]*error[^\]]*]|level:\s*error)\b/i.test(text)
  );
}
