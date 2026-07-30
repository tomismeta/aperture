export type ArrowNumberedDocumentSpanPart = { line: number; body: string; index: number };

export function readArrowNumberedDocumentSpanParts(text: string): ArrowNumberedDocumentSpanPart[] {
  const spans: ArrowNumberedDocumentSpanPart[] = [];
  ARROW_NUMBERED_DOCUMENT_SPAN_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = ARROW_NUMBERED_DOCUMENT_SPAN_PATTERN.exec(text)) !== null) {
    const line = Number.parseInt(match[1] ?? "", 10);
    if (Number.isSafeInteger(line)) {
      spans.push({ line, body: (match[2] ?? "").trimEnd(), index: match.index });
    }
  }

  return spans;
}

export function containsMixedArrowAndLegacyNumbering(text: string): boolean {
  return /(?:^|[\r\n]|\s)\d{1,6}(?:[ \t]+|:\s+)\S/.test(text);
}

const ARROW_NUMBERED_DOCUMENT_SPAN_PATTERN =
  /(?:^|[\r\n]|\s)(\d{1,6})\u2192([\s\S]*?)(?=(?:[\r\n]|\s)\d{1,6}\u2192|$)/g;
