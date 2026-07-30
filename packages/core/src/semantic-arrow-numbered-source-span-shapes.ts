import type { NumberedSourceSpan } from "./semantic-numbered-source-span-shapes.js";

export function readArrowNumberedSourceSpans(text: string): NumberedSourceSpan[] {
  if (containsLegacyNumberedSeparator(text)) {
    return [];
  }

  const spans: NumberedSourceSpan[] = [];
  const pattern = /(?:^|[\r\n]|\s)(\d{1,6})\u2192([\s\S]*?)(?=(?:[\r\n]|\s)\d{1,6}\u2192|$)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const line = Number.parseInt(match[1] ?? "", 10);
    const body = (match[2] ?? "").trim();
    if (Number.isSafeInteger(line) && body.length > 0) {
      spans.push({ line, body: body.slice(0, 160) });
    }
  }

  return spans;
}

function containsLegacyNumberedSeparator(text: string): boolean {
  return /(?:^|[\r\n]|\s)\d{1,6}(?:[ \t]+|:\s+)\S/.test(text);
}
