import {
  isCLikeCommentOnlyLine,
  readCLikeLine,
  readClippedCLikeLine,
  type CLikeLine,
} from "./semantic-c-like-source-line-shapes.js";
import { looksLikeSourceStatement } from "./semantic-source-statement-shapes.js";

export type NumberedSourceSpan = { line: number; body: string };

export function looksLikeStrongNumberedSourceSpans(
  spans: NumberedSourceSpan[],
  options: {
    allowClippedSourceContext?: boolean;
    ignoreTruncatedFinalSpan?: boolean;
    minSourceStatements: number;
  } = {
    minSourceStatements: 2,
  },
): boolean {
  if (spans.length < 3 || !hasStrictlyIncreasingLineNumbers(spans)) {
    return false;
  }
  const sourceStatements = countMatchingSpans(spans, options, looksLikeSourceStatement);
  if (sourceStatements >= options.minSourceStatements) {
    return true;
  }

  return options.allowClippedSourceContext === true && hasClippedNumberedCLikeRun(spans);
}

export function readFlattenedNumberedSourceSpans(text: string): NumberedSourceSpan[] {
  const spans: NumberedSourceSpan[] = [];
  const pattern = /(?:^|[\r\n]|\s)(\d{1,6})[ \t]+([\s\S]*?)(?=(?:[\r\n]|\s)\d{1,6}[ \t]+|$)/g;
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

export function readLineNumberedSourceSpans(text: string): NumberedSourceSpan[] {
  const spans: NumberedSourceSpan[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const match = /^\s*(\d{1,6})(?:[ \t]+|:\s*)(\S[\s\S]*)$/.exec(rawLine);
    if (match) {
      spans.push({ line: Number.parseInt(match[1]!, 10), body: match[2]!.trim().slice(0, 160) });
    }
  }
  return spans;
}

function hasStrictlyIncreasingLineNumbers(spans: NumberedSourceSpan[]): boolean {
  return spans.every((span, index) => index === 0 || span.line > spans[index - 1]!.line);
}

function countMatchingSpans(
  spans: NumberedSourceSpan[],
  options: { ignoreTruncatedFinalSpan?: boolean },
  predicate: (body: string) => boolean,
): number {
  return spans.filter(
    (span, index) =>
      !(options.ignoreTruncatedFinalSpan === true && index === spans.length - 1) &&
      predicate(span.body),
  ).length;
}

function hasClippedNumberedCLikeRun(spans: NumberedSourceSpan[]): boolean {
  if (spans.length < 4) {
    return false;
  }

  const lastIndex = spans.length - 1;
  const lines: CLikeLine[] = [];
  let contextualSpans = 0;
  let completeCLikeLines = 0;
  let commentSpans = 0;
  for (const [index, span] of spans.entries()) {
    if (isCLikeCommentOnlyLine(span.body)) {
      contextualSpans += 1;
      commentSpans += 1;
      continue;
    }

    const parsed =
      index === lastIndex
        ? (readClippedCLikeLine(span.body) ?? readCLikeLine(span.body))
        : readCLikeLine(span.body);
    if (parsed === null) {
      continue;
    }

    contextualSpans += 1;
    lines.push(parsed);
    if (index !== lastIndex) {
      completeCLikeLines += 1;
    }
  }

  const categories = new Set(lines.map((line) => line.category));
  const strongAnchors = lines.filter((line) => line.strongAnchor).length;
  return (
    (contextualSpans >= 4 &&
      completeCLikeLines >= 2 &&
      categories.size >= 2 &&
      strongAnchors >= 2 &&
      lines.some((line) => line.nontrivialAnchor)) ||
    (contextualSpans >= 4 &&
      completeCLikeLines >= 2 &&
      commentSpans >= 2 &&
      categories.has("brace") &&
      categories.has("declaration") &&
      strongAnchors >= 1)
  );
}
