import {
  containsMixedArrowAndLegacyNumbering,
  readArrowNumberedDocumentSpanParts,
} from "./semantic-arrow-numbered-document-span-parser.js";

export type LineNumberedDocumentSpan = { line: number; body: string };

export function readLineNumberedDocumentSpans(text: string): LineNumberedDocumentSpan[] {
  const spans: LineNumberedDocumentSpan[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const match = /^\s*(\d{1,6})(?:[ \t]+|:\s+)(.*)$/.exec(rawLine);
    if (match) {
      spans.push({ line: Number.parseInt(match[1]!, 10), body: match[2]!.trimEnd() });
    }
  }
  return spans;
}

export function readArrowNumberedDocumentSpans(text: string): LineNumberedDocumentSpan[] {
  if (containsMixedArrowAndLegacyNumbering(text)) {
    return [];
  }

  return readArrowNumberedDocumentSpanParts(text).map(({ line, body }) => ({ line, body }));
}

export function hasStrictlyIncreasingLineNumbers(spans: LineNumberedDocumentSpan[]): boolean {
  return spans.every((span, index) => index === 0 || span.line > spans[index - 1]!.line);
}

export function containsArrowNumberedDocumentMarker(text: string): boolean {
  return /(?:^|[\r\n]|\s)\d{1,6}\u2192/.test(text);
}
