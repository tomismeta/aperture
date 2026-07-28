export function looksLikeStrongRawSourceObservation(value: string): boolean {
  const text = stripObservationStatusPrefix(value);
  if (text.length === 0) {
    return false;
  }

  return (
    looksLikeRawSourcePrefix(text) ||
    looksLikeLineNumberedRawSource(text) ||
    countSourceLocationLines(text) >= 2 ||
    countRawSourceMarkers(text) >= 3
  );
}

export function looksLikeStructuredToolOutputObservation(output: string): boolean {
  return (
    looksLikeStrongRawSourceObservation(output) ||
    looksLikeBuildOrLogObservation(output) ||
    looksLikeMarkdownDocumentObservation(output)
  );
}

export function looksLikePlainReadObservation(value: string): boolean {
  return (
    looksLikeStrongRawSourceObservation(value) ||
    looksLikeBuildOrLogObservation(value) ||
    looksLikeMarkdownDocumentObservation(value)
  );
}

export function looksLikeBuildOrLogObservation(value: string): boolean {
  const text = stripObservationStatusPrefix(value);
  if (text.length === 0) {
    return false;
  }

  const markers = [
    /\b(?:make|cmake|ninja|pytest|unittest|dkms)[^\r\n]{0,80}\.log\b/i,
    /\btotal output lines:\s*\d+\b/i,
    /(?:^|[\r\n])\s*\[\s*\d+%]\s+(?:building|linking|generating)\b/i,
    /(?:^|[\r\n])\s*checking for a\b/i,
    /(?:^|[\r\n])\s*building module\(s\)(?=\s|$)/i,
    /(?:^|[\r\n])\s*building [a-z0-9_ -]*object\b/i,
    /(?:^|[\r\n])\s*linking [a-z0-9_ -]*target\b/i,
    /(?:^|[\r\n])\s*[^\r\n:]+:\d+:\s*(?:userwarning|warning):\s+\S/i,
  ].filter((pattern) => pattern.test(text)).length;

  return (
    markers >= 2 ||
    countRepeatedBuildLogLines(text) >= 2 ||
    looksLikeFlattenedBuildLogObservation(text)
  );
}

function countRepeatedBuildLogLines(text: string): number {
  return [
    ...text.matchAll(
      /(?:^|[\r\n])\s*(?:checking for a\b|building module\(s\)(?=\s|$)|building [a-z0-9_ -]*object\b|linking [a-z0-9_ -]*target\b|\[\s*\d+%]\s+(?:building|linking|generating)\b)/gi,
    ),
  ].length;
}

function looksLikeFlattenedBuildLogObservation(text: string): boolean {
  return (
    /\b(?:make|cmake|ninja|pytest|unittest|dkms)[^\r\n]{0,80}\.log\b/i.test(text) &&
    /\bbuilding module\(s\)(?=\s|$)|\b(?:building|linking) [a-z0-9_ -]*(?:object|target)\b/i.test(
      text,
    ) &&
    /\b(?:command:\s*['"]?(?:make|cmake|ninja)\b|kernelver=|checking for a [a-z0-9 -]+\.{3})/i.test(
      text,
    )
  );
}

function looksLikeMarkdownDocumentObservation(text: string): boolean {
  const normalized = stripObservationStatusPrefix(text);
  const headingCount = [...normalized.matchAll(/(?:^|[\r\n])\s{0,3}#{1,6}\s+\S/g)].length;
  const listCount = [...normalized.matchAll(/(?:^|[\r\n])\s*(?:[-*]\s+\S|\d+\.\s+\S)/g)].length;
  const hasCodeFence = /(?:^|[\r\n])\s*```/.test(normalized);

  return normalized.length >= 160 && headingCount >= 2 && (listCount >= 2 || hasCodeFence);
}

function stripObservationStatusPrefix(value: string): string {
  return value.trim().replace(/^(?:bash|edit|read|search|tool)\s+failure\s+/, "");
}

function looksLikeRawSourcePrefix(text: string): boolean {
  return /^\s*(?:#!\/|diff\s+--git\b|---\s+\S|@@\s+|#include\b|#ifndef\b|#pragma\s+once\b|cmake_minimum_required\s*\(|import\b|from\b|class\b|def\b|function\b|export\b|const\b|let\b|var\b|interface\b|type\b|struct\b|enum\b|void\b|static\b|\/\/\s*copyright\b|#\s*copyright\b)/i.test(
    text,
  );
}

function looksLikeLineNumberedRawSource(text: string): boolean {
  return (
    /(?:^|[\r\n])\s*\d+\s+(?:#include\b|static\b|struct\b|enum\b|typedef\b|void\b|int\b|char\b|bool\b|return\b|namespace\b|class\b|def\b|function\b|const\b|let\b|var\b)/i.test(
      text,
    ) || countLineNumberedSourceIntroLines(text) >= 2
  );
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

function countLineNumberedSourceIntroLines(text: string): number {
  return [...text.matchAll(LINE_NUMBERED_SOURCE_INTRO_PATTERN)].length;
}

const SOURCE_IDENTIFIER_PATTERN = "[a-z_$][a-z0-9_$]*";
const PY_MODULE_PATTERN = `${SOURCE_IDENTIFIER_PATTERN}(?:\\.${SOURCE_IDENTIFIER_PATTERN})*`;
const PY_IMPORT_TARGET_PATTERN = `${PY_MODULE_PATTERN}(?:\\s+as\\s+${SOURCE_IDENTIFIER_PATTERN})?`;
const PY_IMPORT_LIST_PATTERN = `${PY_IMPORT_TARGET_PATTERN}(?:\\s*,\\s*${PY_IMPORT_TARGET_PATTERN})*`;
const PY_FROM_IMPORT_LIST_PATTERN = `(?:\\*|${SOURCE_IDENTIFIER_PATTERN}(?:\\s+as\\s+${SOURCE_IDENTIFIER_PATTERN})?(?:\\s*,\\s*${SOURCE_IDENTIFIER_PATTERN}(?:\\s+as\\s+${SOURCE_IDENTIFIER_PATTERN})?)*)`;
const STATEMENT_END_PATTERN = "\\s*;?(?:\\s*(?:#|\\/\\/).*)?(?=$|[\\r\\n])";
const PY_IMPORT_LINE_PATTERN = `(?:import\\s+${PY_IMPORT_LIST_PATTERN}|from\\s+(?:\\.{1,2})?${PY_MODULE_PATTERN}\\s+import\\s+${PY_FROM_IMPORT_LIST_PATTERN})${STATEMENT_END_PATTERN}`;
const TS_EXPORT_LINE_PATTERN = `export\\s+(?:(?:const|let|var)\\s+${SOURCE_IDENTIFIER_PATTERN}\\s*(?::[^=\\r\\n]+)?=|(?:default\\s+)?function\\s+${SOURCE_IDENTIFIER_PATTERN}\\s*\\(|(?:default\\s+)?(?:class|interface)\\s+${SOURCE_IDENTIFIER_PATTERN}(?:\\s+(?:extends|implements)\\s+[^\\r\\n{]+)?\\s*(?:\\{|${STATEMENT_END_PATTERN})|type\\s+${SOURCE_IDENTIFIER_PATTERN}\\s*=)`;
const TS_INTERFACE_LINE_PATTERN = `interface\\s+${SOURCE_IDENTIFIER_PATTERN}(?:\\s+extends\\s+[^\\r\\n{]+)?\\s*(?:\\{|${STATEMENT_END_PATTERN})`;
const LINE_NUMBERED_SOURCE_INTRO_PATTERN = new RegExp(
  `(?:^|[\\r\\n])\\s*\\d+\\s+(?:${PY_IMPORT_LINE_PATTERN}|${TS_EXPORT_LINE_PATTERN}|${TS_INTERFACE_LINE_PATTERN}|type\\s+${SOURCE_IDENTIFIER_PATTERN}\\s*=)`,
  "gi",
);
