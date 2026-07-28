export function looksLikeLineNumberedMarkdownDocumentObservation(text: string): boolean {
  const spans = readLineNumberedDocumentSpans(text);
  if (spans.length < 4 || !hasStrictlyIncreasingLineNumbers(spans)) {
    return false;
  }

  return looksLikeStructuredMarkdownDocument(spans.map((span) => span.body).join("\n"));
}

type LineNumberedDocumentSpan = { line: number; body: string };

function readLineNumberedDocumentSpans(text: string): LineNumberedDocumentSpan[] {
  const spans: LineNumberedDocumentSpan[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const match = /^\s*(\d{1,6})(?:[ \t]+|:\s+)(.*)$/.exec(rawLine);
    if (match) {
      spans.push({ line: Number.parseInt(match[1]!, 10), body: match[2]!.trimEnd() });
    }
  }
  return spans;
}

function hasStrictlyIncreasingLineNumbers(spans: LineNumberedDocumentSpan[]): boolean {
  return spans.every((span, index) => index === 0 || span.line > spans[index - 1]!.line);
}

function looksLikeStructuredMarkdownDocument(text: string): boolean {
  const headingCount = [...text.matchAll(/(?:^|[\r\n])\s{0,3}#{1,6}\s+\S/g)].length;
  const listCount = [...text.matchAll(/(?:^|[\r\n])\s*(?:[-*]\s+\S|\d+\.\s+\S)/g)].length;

  return (
    headingCount >= 2 &&
    (listCount >= 2 || /(?:^|[\r\n])\s*```/.test(text) || looksLikeMarkdownTable(text))
  );
}

function looksLikeMarkdownTable(text: string): boolean {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  return lines.some(
    (line, index) =>
      isMarkdownTableRow(line) &&
      /^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1] ?? "") &&
      isMarkdownTableRow(lines[index + 2] ?? "") &&
      isMarkdownTableRow(lines[index + 3] ?? ""),
  );
}

function isMarkdownTableRow(line: string): boolean {
  return /^\|.+\|\s*$/.test(line);
}
