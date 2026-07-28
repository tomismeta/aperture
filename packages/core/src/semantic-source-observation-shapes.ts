import {
  looksLikeFlattenedIncludeSourceCluster,
  looksLikeLineNumberedSourceLicenseHeader,
} from "./semantic-source-header-observation-shapes.js";

export function looksLikeStrongRawSourceObservation(value: string): boolean {
  const text = stripObservationStatusPrefix(value);
  if (text.length === 0) {
    return false;
  }

  return (
    looksLikeRawSourcePrefix(text) ||
    looksLikeLineNumberedSourceFragment(text) ||
    looksLikeSourceLicenseHeader(text) ||
    looksLikeLineNumberedSourceLicenseHeader(text) ||
    looksLikeMultipleIncludeDirectives(text) ||
    looksLikeFlattenedIncludeSourceCluster(text) ||
    looksLikeEmbeddedGitPatchObservation(text) ||
    looksLikeFlattenedNumberedSourceObservation(text) ||
    countSourceLocationLines(text) >= 2 ||
    countRawSourceMarkers(text) >= 3
  );
}

function stripObservationStatusPrefix(value: string): string {
  return value.trim().replace(/^(?:bash|edit|read|search|tool)\s+failure\s+/, "");
}

function looksLikeRawSourcePrefix(text: string): boolean {
  return /^\s*(?:#!\/|diff\s+--git\b|---\s+\S|@@\s+|#ifndef\b|#pragma\s+once\b|cmake_minimum_required\s*\(|import\b|from\b|class\b|def\b|function\b|export\b|const\b|let\b|var\b|interface\b|type\b|struct\b|enum\b|void\b|static\b)/i.test(
    text,
  );
}

function looksLikeSourceLicenseHeader(text: string): boolean {
  const blockComment = /^\s*\/\*([\s\S]{0,600}?)\*\//.exec(text);

  return (
    /^\s*\/\/\s*SPDX-License-Identifier:\s*\S/i.test(text) ||
    (blockComment !== null &&
      /\b(?:copyright|permission is hereby granted)\b/i.test(blockComment[1] ?? ""))
  );
}

function looksLikeMultipleIncludeDirectives(text: string): boolean {
  const includes = [...text.matchAll(/(?:^|[\r\n])\s*#include\s*(<[^>\r\n]+>|"[^"\r\n]+")/gi)].map(
    (match) => match[1]?.toLowerCase(),
  );

  return new Set(includes.filter((include) => include !== undefined)).size >= 2;
}

function looksLikeEmbeddedGitPatchObservation(text: string): boolean {
  return (
    /(?:^|[\r\n])\s*diff --git a\/\S+ b\/\S+/i.test(text) &&
    /(?:^|[\r\n])\s*index [a-f0-9]{6,}\.\.[a-f0-9]{6,}/i.test(text)
  );
}

function looksLikeFlattenedNumberedSourceObservation(text: string): boolean {
  if (/^\s*\d+\.\s+\S/m.test(text) || /(?:^|\s)\d+:\s+\S/.test(text)) {
    return false;
  }

  return looksLikeStrongNumberedSourceSpans(readFlattenedNumberedSourceSpans(text));
}

function looksLikeLineNumberedSourceFragment(text: string): boolean {
  return (
    !/^\s*(?:\{|\[|")/.test(text) &&
    looksLikeStrongNumberedSourceSpans(readLineNumberedSourceSpans(text))
  );
}

function looksLikeStrongNumberedSourceSpans(spans: NumberedSourceSpan[]): boolean {
  if (spans.length < 3 || !hasStrictlyIncreasingLineNumbers(spans)) {
    return false;
  }
  return spans.filter((span) => looksLikeSourceStatement(span.body)).length >= 2;
}

function readFlattenedNumberedSourceSpans(text: string): NumberedSourceSpan[] {
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

function readLineNumberedSourceSpans(text: string): NumberedSourceSpan[] {
  const spans: NumberedSourceSpan[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const match = /^\s*(\d{1,6})(?:[ \t]+|:\s*)(\S[\s\S]*)$/.exec(rawLine);
    if (match) {
      spans.push({ line: Number.parseInt(match[1]!, 10), body: match[2]!.trim().slice(0, 160) });
    }
  }
  return spans;
}

type NumberedSourceSpan = { line: number; body: string };

function hasStrictlyIncreasingLineNumbers(spans: NumberedSourceSpan[]): boolean {
  return spans.every((span, index) => index === 0 || span.line > spans[index - 1]!.line);
}

function looksLikeSourceStatement(body: string): boolean {
  if (/^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:$|[/:]\S*)/i.test(body)) {
    return false;
  }

  return [
    /^#!\/(?:usr\/bin\/env\s+)?(?:ba)?sh\b/,
    /^set\s+-euo\s+pipefail\b/,
    /^(?:export\s+|readonly\s+|local\s+)?[a-z_$][a-z0-9_$]*=(?=\S)(?=.*(?:["'`$(){}]|\S+$)).+$/i,
    /^[a-z_$][a-z0-9_$]*\s*\(\)\s*\{$/i,
    /^[a-z_$][a-z0-9_:]*\s*\([^)]*\)\s*;?$/i,
    /^(?:if|for|while|switch)\s*\(/,
    /^[{}]\s*;?$/,
    /^(?:break|continue)(?:\s+[a-z_$][a-z0-9_$]*)?\s*;?$/i,
    /^return(?:\s+(?:[a-z_$][a-z0-9_$.]*(?:\([^)]*\))?|-?\d+(?:\.\d+)?|true|false|null|nullptr|none))?\s*;?$/i,
    /^(?=.*(?:\b[a-z_$][a-z0-9_$:<>]*_t\b|::|[<&*]|\b(?:static|inline|extern|const|virtual|void|int|char|bool|auto|struct|enum)\b))(?:[a-z_$][a-z0-9_$:<>*&,]*\s+)+[*&\s]*[~a-z_$][a-z0-9_$:<>]*\s*\([^)]*\)\s*(?:\{|;|const\b|override\b)/i,
    /^(?:(?:static|inline|extern|const)\s+)*(?:struct|enum|typedef|void|int|char|bool|[a-z_$][a-z0-9_$:<>]*_t)\s+[*&\s]*[a-z_$][a-z0-9_$]*\s*(?:\([^)]*\)|[=;,[{])/i,
    /^(?:const|let|var)\s+[a-z_$][a-z0-9_$]*\s*=/i,
    /^function\s+[a-z_$][a-z0-9_$]*\s*\(/i,
    /^export\s+(?:const|let|var|function|class|interface|type)\b/i,
    /^(?:class|interface)\s+[a-z_$][a-z0-9_$]*(?:\s+(?:extends|implements)\b|\s*\{|$)/i,
    /^type\s+[a-z_$][a-z0-9_$]*\s*=/i,
    /^[a-z_$][a-z0-9_$]*\s*(?:=|:=)\s*\S.*;\s*$/i,
    /^[a-z_$][a-z0-9_$:<>]*(?:->|::)[a-z_$][a-z0-9_$:]*/i,
    /^(?:this|[a-z_$][a-z0-9_$]*)\.[a-z_$][a-z0-9_$]*(?:\s*\(|\s*(?:=|\+=|-=|\*=|\/=))/i,
    /^#include\s*(?:<[^>]+>|"[^"]+")/,
    /^from\s+[a-z_$][a-z0-9_$.]*\s+import\s+(?:\*|[a-z_$][a-z0-9_$]*(?:\s+as\s+[a-z_$][a-z0-9_$]*)?(?:\s*,\s*[a-z_$][a-z0-9_$]*(?:\s+as\s+[a-z_$][a-z0-9_$]*)?)*)$/i,
    /^import\s+[a-z_$][a-z0-9_$.]*(?:\s+as\s+[a-z_$][a-z0-9_$]*)?(?:\s*,\s*[a-z_$][a-z0-9_$.]*)*$/i,
  ].some((pattern) => pattern.test(body));
}

function countSourceLocationLines(text: string): number {
  return [...text.matchAll(SOURCE_LOCATION_LINE_PATTERN)].length;
}

const SOURCE_LOCATION_LINE_PATTERN =
  /(?:^|[\r\n])\s*[^\s:\r\n]+\.(?:c|cc|cpp|cxx|cu|cuh|h|hpp|hh|s|asm|ts|tsx|js|jsx|py|rb|go|rs|java|kt|swift):\d+(?::\d+)?:/gi;

function countRawSourceMarkers(text: string): number {
  const markers = [
    /#include\b/i,
    /\bnamespace\s+[a-z_][a-z0-9_:]*\s*\{/i,
    /\bstd::[a-z_][a-z0-9_]*/i,
    /\b(?:class|struct)\s+[a-z_][a-z0-9_]*/i,
    /\btemplate\s*</i,
    /\bint\s+main\s*\(/i,
    /\bcmake_minimum_required\s*\(/i,
    /\bproject\s*\(/i,
    /\bset\s*\([a-z0-9_]+/i,
    /\bdef\s+[a-z_][a-z0-9_]*\s*\(/i,
    /\bfunction\s+[a-z_$][a-z0-9_$]*\s*\(/i,
    /\b(?:const|let|var)\s+[a-z_$][a-z0-9_$]*\s*=/i,
    /\breturn\s+[^.;{}]+[.;]/i,
  ];

  return markers.reduce((count, marker) => count + (marker.test(text) ? 1 : 0), 0);
}
