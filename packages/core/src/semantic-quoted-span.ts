export function countMatchesOutsideQuotedSpans(text: string, pattern: RegExp): number {
  const spans = readQuotedSpans(text);
  return [...text.matchAll(pattern)].filter(
    (match) => !overlapsAnySpan(match.index!, match.index! + match[0].length, spans),
  ).length;
}

export function hasMatchOutsideQuotedSpans(text: string, pattern: RegExp): boolean {
  return countMatchesOutsideQuotedSpans(text, pattern) > 0;
}

function readQuotedSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let quote: '"' | "'" | "`" | null = null;
  let start = -1;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const openingQuote: '"' | "'" | "`" | null =
      quote === null ? readOpeningQuote(text, index) : null;
    if (openingQuote !== null) {
      quote = openingQuote;
      start = index;
    } else if (quote !== null && char === "\\") {
      index += 1;
    } else if (quote !== null && char === quote && !isClosingApostrophe(text, index, quote)) {
      spans.push([start, index + 1]);
      quote = null;
      start = -1;
    }
  }

  if (quote !== null) {
    spans.push([start, text.length]);
  }
  return spans;
}

function overlapsAnySpan(start: number, end: number, spans: Array<[number, number]>): boolean {
  return spans.some(([spanStart, spanEnd]) => start < spanEnd && end > spanStart);
}

function readOpeningQuote(text: string, index: number): '"' | "'" | "`" | null {
  const value = text[index];
  if (value === '"' || value === "`") {
    return value;
  }
  return value === "'" && !isOpeningApostrophe(text, index) ? value : null;
}

function isOpeningApostrophe(text: string, index: number): boolean {
  if (!isWord(text[index - 1])) {
    return false;
  }

  const next = text[index + 1];
  if (isWord(next)) {
    return true;
  }
  if (next !== undefined && /\s/.test(next)) {
    return /s/i.test(text[index - 1] ?? "") && isWord(readNextNonSpace(text, index + 1));
  }
  return false;
}

function isClosingApostrophe(text: string, index: number, quote: '"' | "'" | "`"): boolean {
  return quote === "'" && isWord(text[index - 1]) && isWord(text[index + 1]);
}

function isWord(value: string | undefined): boolean {
  return value !== undefined && /[A-Za-z0-9_]/.test(value);
}

function readNextNonSpace(text: string, start: number): string | undefined {
  for (let index = start; index < text.length; index += 1) {
    if (!/\s/.test(text[index] ?? "")) {
      return text[index];
    }
  }
  return undefined;
}
