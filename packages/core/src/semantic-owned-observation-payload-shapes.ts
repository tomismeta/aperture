import { hasToolOutputFailureDiagnosticEvidence } from "./semantic-diagnostic-shapes.js";
import {
  hasLinterWarningOutsideQuotedSpans,
  looksLikeLinterError,
  looksLikeLinterOutputObservation,
} from "./semantic-linter-output-observation-shapes.js";
import {
  looksLikeBuildOrLogObservation,
  looksLikePlainReadObservation,
  looksLikeStrongRawSourceObservation,
} from "./semantic-observation-shapes.js";
import { looksLikeObservationReferenceWrapper } from "./semantic-observation-reference-wrapper-shapes.js";
import { looksLikeSourceStatement } from "./semantic-source-statement-shapes.js";
import {
  readLineNumberedDocumentSpans,
  type LineNumberedDocumentSpan,
} from "./semantic-line-numbered-document-span-shapes.js";
import { readTestOutputObservation } from "./semantic-test-output-observation-shapes.js";
import { looksLikeUnifiedDiffObservation } from "./semantic-unified-diff-observation-shapes.js";
import { looksLikeWarningOnlyCommandOutputObservation } from "./semantic-command-warning-observation-shapes.js";

export type OwnedObservationPayloadShape =
  | "diff"
  | "document"
  | "linter"
  | "readback"
  | "source"
  | "test";

export type OwnedObservationPayload = {
  shape: OwnedObservationPayloadShape;
  consequenceBaseline: "low" | "medium" | "high";
  source: boolean;
};

export type OwnedObservationPayloadOptions = {
  allowNonWarningLinterFindings?: boolean;
  allowReadOwnedFlattenedFilePayloads?: boolean;
  rejectCommandTextWrappers?: boolean;
};

export function readOwnedObservationPayload(
  value: string,
  options: OwnedObservationPayloadOptions = {},
): OwnedObservationPayload | null {
  const text = stripObservationStatusPrefix(value);
  if (
    text.length === 0 ||
    looksLikeNegativeOperationOutcome(text) ||
    (options.rejectCommandTextWrappers === true && looksLikeRejectedCommandTextWrapper(text))
  ) {
    return null;
  }

  const testOutput = readTestOutputObservation(text);
  if (testOutput !== null && !hasToolOutputFailureDiagnosticEvidence(text)) {
    return {
      shape: "test",
      consequenceBaseline: testOutput.consequenceBaseline,
      source: false,
    };
  }

  if (
    looksLikeWarningOnlyLinterOutputObservation(text) ||
    (options.allowNonWarningLinterFindings === true &&
      looksLikeNonTerminalLinterOutputObservation(text))
  ) {
    return { shape: "linter", consequenceBaseline: "high", source: false };
  }

  if (looksLikeWarningOnlyCommandOutputObservation(text)) {
    return { shape: "readback", consequenceBaseline: "medium", source: false };
  }

  if (/^\s*diff --git\b/i.test(text) && !looksLikeUnifiedDiffObservation(text)) {
    return null;
  }

  if (looksLikeUnifiedDiffObservation(text)) {
    return { shape: "diff", consequenceBaseline: "high", source: true };
  }

  const flattenedSourceObservation =
    options.allowReadOwnedFlattenedFilePayloads === true
      ? looksLikeReadOwnedFlattenedSourceObservation(text)
      : looksLikeFlattenedSourceObservation(text);
  const strongSourceObservation =
    looksLikeStrongRawSourceObservation(text) &&
    (options.allowReadOwnedFlattenedFilePayloads !== true || hasReadTransportWindow(text));
  if (strongSourceObservation || flattenedSourceObservation) {
    return { shape: "source", consequenceBaseline: "high", source: true };
  }

  if (looksLikePlainReadObservation(text)) {
    return {
      shape: "readback",
      consequenceBaseline: looksLikeBuildOrLogObservation(text) ? "medium" : "high",
      source: false,
    };
  }

  if (
    looksLikeLineNumberedTechnicalDocumentObservation(text) ||
    (options.allowReadOwnedFlattenedFilePayloads === true &&
      looksLikeFlattenedMarkdownTechnicalDocumentObservation(text))
  ) {
    return { shape: "document", consequenceBaseline: "medium", source: false };
  }

  return null;
}

function stripObservationStatusPrefix(value: string): string {
  return value.trim().replace(/^(?:bash|edit|read|search|tool)\s+failure\s+/i, "");
}

function looksLikeNegativeOperationOutcome(text: string): boolean {
  return [
    /^\s*no replacement was performed\b/i,
    /^\s*old_str\b[\s\S]{0,240}\bwas not found\b/i,
    /^\s*could not find\b[\s\S]{0,240}\b(?:exact text|old_str|replacement)\b/i,
    /^\s*failed to apply\b/i,
    /^\s*file has not been read\b/i,
    /^\s*read it first before writing\b/i,
    /^\s*(?:failed|unable|could not|couldn't) to read\b/i,
    /^\s*(?:failed|unable|could not|couldn't) to open\b/i,
  ].some((pattern) => pattern.test(text));
}

function looksLikeRejectedCommandTextWrapper(text: string): boolean {
  return (
    looksLikeObservationReferenceWrapper(text) ||
    looksLikePlainExpectedActualDiffFixture(text) ||
    looksLikeShortSourceLiteralWrapper(text) ||
    looksLikeEmbeddedPatchString(text)
  );
}

function looksLikeShortSourceLiteralWrapper(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  return (
    lines.length <= 3 &&
    /^\s*(?:const|let|var)\s+[a-z_$][a-z0-9_$]*\s*=\s*["'`][\s\S]*["'`]\s*;?\s*(?:\r?\n\s*return\b[\s\S]*)?$/i.test(
      text,
    )
  );
}

function looksLikeEmbeddedPatchString(text: string): boolean {
  return /^\s*(?:const|let|var)\s+[a-z_$][a-z0-9_$]*\s*=\s*["'`][\s\S]*\bdiff --git\b/i.test(text);
}

function looksLikePlainExpectedActualDiffFixture(text: string): boolean {
  return /^\s*---\s+expected\b[\s\S]*^\s*\+\+\+\s+actual\b/im.test(text);
}

function looksLikeWarningOnlyLinterOutputObservation(text: string): boolean {
  return (
    looksLikeNonTerminalLinterOutputObservation(text) && hasLinterWarningOutsideQuotedSpans(text)
  );
}

function looksLikeNonTerminalLinterOutputObservation(text: string): boolean {
  return looksLikeLinterOutputObservation(text) && !looksLikeLinterError(text);
}

function looksLikeFlattenedSourceObservation(text: string): boolean {
  if (containsLineBreak(text) || !hasVisibleTruncationBoundary(text)) {
    return false;
  }
  if (looksLikeInstructionalProse(text)) {
    return false;
  }

  const imports = countMatches(text, FLATTENED_IMPORT_PATTERN);
  const declarations = countMatches(text, FLATTENED_DECLARATION_PATTERN);
  const flow = countMatches(text, FLATTENED_FLOW_PATTERN);
  const assignments = countMatches(text, FLATTENED_ASSIGNMENT_PATTERN);
  const memberAccess = countMatches(text, FLATTENED_MEMBER_ACCESS_PATTERN);
  const cLike = countMatches(text, FLATTENED_C_LIKE_PATTERN);
  const jsStructure = countMatches(text, FLATTENED_JS_STRUCTURE_PATTERN);
  const objectProperties = countMatches(text, FLATTENED_OBJECT_PROPERTY_PATTERN);
  const score =
    imports +
    declarations * 2 +
    flow +
    assignments +
    memberAccess +
    cLike +
    jsStructure +
    Math.min(objectProperties, 3);

  return (
    (declarations >= 1 && score >= 4) ||
    (imports >= 3 && score >= 5) ||
    (cLike >= 3 && (memberAccess >= 1 || declarations >= 1))
  );
}

function looksLikeReadOwnedFlattenedSourceObservation(text: string): boolean {
  if (containsLineBreak(text) || !hasVisibleTruncationBoundary(text)) {
    return false;
  }
  if (looksLikeInstructionalProse(text)) {
    return false;
  }

  const jsImports = countMatches(text, FLATTENED_JS_MODULE_IMPORT_PATTERN);
  const flow = countMatches(text, FLATTENED_FLOW_PATTERN);
  const memberAccess = countMatches(text, FLATTENED_MEMBER_ACCESS_PATTERN);
  const jsStructure = countMatches(text, FLATTENED_JS_STRUCTURE_PATTERN);
  const objectProperties = countMatches(text, FLATTENED_OBJECT_PROPERTY_PATTERN);
  const fileStartScore = jsImports * 2 + memberAccess + jsStructure;
  const midFileScore = flow + memberAccess + jsStructure + Math.min(objectProperties, 3);

  return (
    (looksLikeFlattenedJsSourceFileStart(text) && jsImports >= 2 && fileStartScore >= 4) ||
    (objectProperties >= 3 &&
      (flow >= 1 || memberAccess >= 1 || jsStructure >= 1) &&
      midFileScore >= 6)
  );
}

function looksLikeFlattenedMarkdownTechnicalDocumentObservation(text: string): boolean {
  if (containsLineBreak(text) || !hasVisibleTruncationBoundary(text) || text.length < 160) {
    return false;
  }
  if (looksLikeInstructionalProse(text)) {
    return false;
  }

  const headingCount = countMatches(text, FLATTENED_MARKDOWN_HEADING_PATTERN);
  const listCount = countMatches(text, FLATTENED_MARKDOWN_LIST_PATTERN);
  const codeSpanCount = countMatches(text, FLATTENED_MARKDOWN_CODE_SPAN_PATTERN);
  const technicalTermCount = countMatches(text, FLATTENED_TECHNICAL_TERM_PATTERN);

  return (
    /^\s{0,3}#{1,6}\s+\S/.test(text) &&
    headingCount >= 2 &&
    (listCount >= 2 || codeSpanCount >= 2 || (listCount >= 1 && technicalTermCount >= 2))
  );
}

function looksLikeLineNumberedTechnicalDocumentObservation(text: string): boolean {
  if (!hasVisibleTruncationBoundary(text) || hasToolOutputFailureDiagnosticEvidence(text)) {
    return false;
  }

  const spans = readOwnedLineNumberedDocumentSpans(text);
  if (spans.length < 3 || !hasStrictlyIncreasingLineNumbers(spans)) {
    return false;
  }

  const pipeRows = spans.filter((span) => /^\|[\s\S]*\|/.test(span.body.trim())).length;
  const sourceRows = spans.filter((span) => looksLikeSourceStatement(span.body.trim())).length;
  const technicalHeadings = spans.filter((span) =>
    /^\d+(?:\.\d+){1,}\.?\s+\S/.test(span.body.trim()),
  ).length;
  const pageMarkers = spans.filter((span) => /^\d+\s+of\s+\d+\s*$/.test(span.body.trim())).length;
  const acronymRows = spans.filter((span) => /\b[A-Z][A-Z0-9_]{2,}\b/.test(span.body)).length;

  return (
    pipeRows >= 2 ||
    sourceRows >= 2 ||
    (technicalHeadings >= 1 && (pageMarkers >= 1 || acronymRows >= 1)) ||
    (technicalHeadings >= 2 && acronymRows >= 1)
  );
}

function readOwnedLineNumberedDocumentSpans(text: string): LineNumberedDocumentSpan[] {
  const lineSpans = readLineNumberedDocumentSpans(text).filter(
    (span) => span.body.trim().length > 0,
  );
  if (lineSpans.length >= 2) {
    return lineSpans;
  }

  return readFlattenedLineNumberedSpans(text);
}

function readFlattenedLineNumberedSpans(text: string): LineNumberedDocumentSpan[] {
  const spans: LineNumberedDocumentSpan[] = [];
  const pattern = /(?:^|\s)(\d{1,6})[:|-]\s*([\s\S]*?)(?=\s+\d{1,6}[:|-]\s*\S|$)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const line = Number.parseInt(match[1] ?? "", 10);
    const body = (match[2] ?? "").trim();
    if (Number.isSafeInteger(line) && body.length > 0) {
      spans.push({ line, body: body.slice(0, 200) });
    }
  }

  return spans;
}

function hasStrictlyIncreasingLineNumbers(spans: LineNumberedDocumentSpan[]): boolean {
  return spans.every((span, index) => index === 0 || span.line > spans[index - 1]!.line);
}

function countMatches(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length;
}

function containsLineBreak(text: string): boolean {
  return /[\r\n]/.test(text);
}

function hasVisibleTruncationBoundary(text: string): boolean {
  return /\.\.\.\s*$/.test(text.trim());
}

function looksLikeInstructionalProse(text: string): boolean {
  return /^\s*(?:please|should|must|expected output|final response|review your changes|follow the steps)\b/i.test(
    text,
  );
}

function looksLikeFlattenedJsSourceFileStart(text: string): boolean {
  return /^\s*(?:\/\*|\/\/|#!\/|import\s+(?:type\s+)?(?:\{|\*|[A-Za-z_$]))/.test(text);
}

function hasReadTransportWindow(text: string): boolean {
  return containsLineBreak(text) || /(?:^|\s)\d{1,6}\u2192\S/.test(text);
}

const FLATTENED_IMPORT_PATTERN =
  /(?:^|\s)(?:from\s+(?!report\b|notes\b|the\b)[a-zA-Z_][a-zA-Z0-9_.]*\s+import\s+(?!settings\b|values\b|packages\b|the\b)(?:[a-zA-Z_*][a-zA-Z0-9_.*]*|\{[^}]{1,160}\})|import\s+(?:(?:(?:type\s+)?\{[^}]{1,160}\}|(?:type\s+)?[a-zA-Z_$][a-zA-Z0-9_$]*|\*\s+as\s+[a-zA-Z_$][a-zA-Z0-9_$]*)\s+from\s+(?:"[^"]+"|'[^']+'|[a-zA-Z_][a-zA-Z0-9_.:/-]*)|(?!the\b|packages\b|settings\b|values\b|class\b)[a-zA-Z_][a-zA-Z0-9_.]*))\b/g;

const FLATTENED_JS_MODULE_IMPORT_PATTERN =
  /(?:^|\s)import\s+(?:(?:type\s+)?\{[^}]{1,160}\}|(?:type\s+)?[a-zA-Z_$][a-zA-Z0-9_$]*|\*\s+as\s+[a-zA-Z_$][a-zA-Z0-9_$]*)\s+from\s+(?:"[^"]+"|'[^']+')/g;

const FLATTENED_DECLARATION_PATTERN =
  /(?:^|\s)(?:@[a-zA-Z_][a-zA-Z0-9_.]*(?:\([^)]*\))?\s+)?(?:async\s+)?def\s+[a-zA-Z_][a-zA-Z0-9_]*\s*\([^)]*\)\s*:|(?:^|\s)class\s+[a-zA-Z_][a-zA-Z0-9_]*(?:\([^)]*\))?\s*:|(?:^|\s)(?:export\s+)?(?:async\s+)?function\s+[a-zA-Z_$][a-zA-Z0-9_$]*\s*\(|(?:^|\s)(?:export\s+)?(?:const|let|var)\s+[a-zA-Z_$][a-zA-Z0-9_$]*\s*=|(?:^|\s)#include\s*(?:<[^>]+>|"[^"]+")/g;

const FLATTENED_FLOW_PATTERN =
  /(?:^|\s)(?:if|for|while|with)\s*\(|(?:^|\s)(?:yield|return)\s+[a-zA-Z_({][^\s;)]*|(?:^|\s)isinstance\s*\(/g;

const FLATTENED_ASSIGNMENT_PATTERN =
  /(?:^|\s)[A-Za-z_][A-Za-z0-9_]*\s*=\s*(?:["'({[]|[A-Za-z_][A-Za-z0-9_.]*\()/g;

const FLATTENED_MEMBER_ACCESS_PATTERN =
  /(?:^|\s)[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*){2,}|\b[A-Za-z_][A-Za-z0-9_]*::[A-Za-z_][A-Za-z0-9_]*|\b[A-Za-z_][A-Za-z0-9_]*->[A-Za-z_][A-Za-z0-9_]*/g;

const FLATTENED_C_LIKE_PATTERN =
  /(?:^|\s)(?:std::[A-Za-z_][A-Za-z0-9_]*|[A-Za-z_][A-Za-z0-9_]*->|[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*|return\s+[A-Z_][A-Z0-9_]*;|(?:void|int|char|bool|auto|size_t)\s+[A-Za-z_][A-Za-z0-9_]*\s*\()/g;

const FLATTENED_JS_STRUCTURE_PATTERN =
  /(?:^|\s)(?:typeof\s+[A-Za-z_$][A-Za-z0-9_$]*|}\s+as\s+[A-Z][A-Za-z0-9_]*(?:<[^>]+>)?|as\s+const\b|\[[^\]]{1,120}\]\.map\s*\()/g;

const FLATTENED_OBJECT_PROPERTY_PATTERN =
  /(?:^|\s)[A-Za-z_$][A-Za-z0-9_$]*:\s*(?:null|true|false|["'[{(]|[A-Za-z_$][A-Za-z0-9_$]*(?:[,.}]|\s*=>))/g;

const FLATTENED_MARKDOWN_HEADING_PATTERN = /(?:^|\s)#{1,6}\s+\S/g;

const FLATTENED_MARKDOWN_LIST_PATTERN = /(?:^|\s)(?:[-*]\s+\S|\d+\.\s+\S)/g;

const FLATTENED_MARKDOWN_CODE_SPAN_PATTERN = /`[^`]{1,120}`/g;

const FLATTENED_TECHNICAL_TERM_PATTERN =
  /\b(?:api|cli|sdk|typescript|javascript|package|framework|rendering|configuration|options|interface|component|terminal|runtime|schema|server|client)\b/gi;
