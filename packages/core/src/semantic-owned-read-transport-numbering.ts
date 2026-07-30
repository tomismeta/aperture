import { readArrowNumberedDocumentSpanParts } from "./semantic-arrow-numbered-document-span-parser.js";

export function containsOwnedReadTransportMixedNumbering(text: string): boolean {
  const spans = readArrowNumberedDocumentSpanParts(text);
  const arrowLines = new Set(spans.map((span) => span.line));
  const firstArrowIndex = spans[0]?.index ?? -1;
  if (firstArrowIndex > 0 && containsStructuralLegacyRow(text.slice(0, firstArrowIndex))) {
    return true;
  }

  return spans.some((span, index) =>
    hasTransportLegacyNumberedRowFragment({
      body: span.body,
      currentLine: span.line,
      nextLine: spans[index + 1]?.line,
      arrowLines,
    }),
  );
}

function containsStructuralLegacyRow(text: string): boolean {
  const pattern = /(?:^|[\r\n]|\s)\d{1,6}(?:[ \t]+|:\s+)([#*/@|-]|\S+)/g;
  for (const match of text.matchAll(pattern)) {
    if (STRUCTURAL_LEGACY_ROW_START_PATTERN.test(match[1] ?? "")) return true;
  }
  return false;
}

function hasTransportLegacyNumberedRowFragment(input: {
  body: string;
  currentLine: number;
  nextLine?: number | undefined;
  arrowLines: Set<number>;
}): boolean {
  const pattern = /(?:^|[\r\n]|\s)(\d{1,6})(?:[ \t]+|:\s+)([#*/@|-]|\S+)/g;
  for (const match of input.body.matchAll(pattern)) {
    const line = Number.parseInt(match[1] ?? "", 10);
    const firstToken = match[2] ?? "";
    if (!Number.isSafeInteger(line)) {
      continue;
    }
    if (input.arrowLines.has(line) && !STRUCTURAL_LEGACY_ROW_START_PATTERN.test(firstToken)) {
      continue;
    }
    if (line > input.currentLine && input.nextLine !== undefined && line < input.nextLine) {
      return true;
    }
    if (STRUCTURAL_LEGACY_ROW_START_PATTERN.test(firstToken)) return true;
  }
  return false;
}

const STRUCTURAL_LEGACY_ROW_START_PATTERN = /^(?:[#*/@|-])/;
