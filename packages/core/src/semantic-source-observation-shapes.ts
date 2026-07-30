import {
  looksLikeAssemblySourceObservation,
  looksLikeAssemblySourceStatement,
} from "./semantic-assembly-source-observation-shapes.js";
import { looksLikeCLikeSourceFragmentObservation } from "./semantic-c-like-source-observation-shapes.js";
import {
  looksLikeFlattenedNumberedSourceObservation,
  looksLikeLineNumberedSourceFragment,
} from "./semantic-numbered-source-observation-shapes.js";
import {
  looksLikeFlattenedIncludeSourceCluster,
  looksLikeLineNumberedSourceLicenseHeader,
  looksLikeSourceLicenseCommentHeader,
} from "./semantic-source-header-observation-shapes.js";
import {
  looksLikeSourceStatement,
  looksLikeStandaloneSourcePrefix,
} from "./semantic-source-statement-shapes.js";

export function looksLikeStrongRawSourceObservation(value: string): boolean {
  const text = stripObservationStatusPrefix(value);
  if (text.length === 0) {
    return false;
  }

  return (
    looksLikeRawSourcePrefix(text) ||
    looksLikeAssemblySourceObservation(text) ||
    looksLikeCLikeSourceFragmentObservation(text) ||
    looksLikeLineNumberedSourceFragment(text) ||
    looksLikeSourceLicenseCommentHeader(text) ||
    looksLikeLineNumberedSourceLicenseHeader(text) ||
    looksLikeCommentedSourceSnippet(text) ||
    looksLikeDecoratedSourceSnippet(text) ||
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
  const firstLine = readFirstContentLine(text);
  return looksLikeStructuralSourcePrefix(firstLine) || looksLikeStandaloneSourcePrefix(firstLine);
}

function readFirstContentLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .find((line) => line.trim().length > 0)
      ?.trim() ?? ""
  );
}

function looksLikeStructuralSourcePrefix(line: string): boolean {
  return /^(?:#!\/|diff\s+--git\b|---\s+\S|@@\s+|#ifndef\b|#pragma\s+once\b|cmake_minimum_required\s*\()/i.test(
    line,
  );
}

function looksLikeMultipleIncludeDirectives(text: string): boolean {
  const includes = [...text.matchAll(/(?:^|[\r\n])\s*#include\s*(<[^>\r\n]+>|"[^"\r\n]+")/gi)].map(
    (match) => match[1]?.toLowerCase(),
  );

  return new Set(includes.filter((include) => include !== undefined)).size >= 2;
}

function looksLikeCommentedSourceSnippet(text: string): boolean {
  return (
    /(?:^|[\r\n])\s*(?:\/\/|#|\/\*)[^\r\n]*(?:$|[\r\n])/i.test(text) &&
    /(?:^|[\r\n])\s*(?:export\s+(?:const|function|class)\b|(?:const|let|var)\s+[a-z_$][a-z0-9_$]*\s*=|return\s+[^;\r\n]+;|function\s+[a-z_$][a-z0-9_$]*\s*\(|class\s+[a-z_$][a-z0-9_$]*\b|def\s+[a-z_][a-z0-9_]*\s*\()/i.test(
      text,
    )
  );
}

function looksLikeDecoratedSourceSnippet(text: string): boolean {
  return /(?:^|[\r\n])\s*@[a-zA-Z_][a-zA-Z0-9_.]*(?:\([^)\r\n]*\))?\s*(?:[\r\n]+)\s*(?:(?:async\s+)?def\s+[a-zA-Z_][a-zA-Z0-9_]*\s*\(|(?:export\s+)?(?:class|function)\s+[a-zA-Z_$][a-zA-Z0-9_$]*)/i.test(
    text,
  );
}

function looksLikeEmbeddedGitPatchObservation(text: string): boolean {
  return (
    /(?:^|[\r\n])\s*diff --git a\/\S+ b\/\S+/i.test(text) &&
    /(?:^|[\r\n])\s*index [a-f0-9]{6,}\.\.[a-f0-9]{6,}/i.test(text)
  );
}

export function looksLikeClippedSourceLocationObservation(text: string): boolean {
  const spans = readSourceLocationSpans(text);

  return (
    spans.length === 1 &&
    hasVisibleTruncationBoundary(text) &&
    hasClippedPathContinuation(text) &&
    looksLikeSourceLocationBody(spans[0]!.body)
  );
}

function countSourceLocationLines(text: string): number {
  return readSourceLocationSpans(text).length;
}

function readSourceLocationSpans(text: string): SourceLocationSpan[] {
  return [...text.matchAll(SOURCE_LOCATION_LINE_PATTERN)].map((match) => ({
    body: (match[1] ?? "").trim(),
  }));
}

function looksLikeSourceLocationBody(body: string): boolean {
  return looksLikeSourceStatement(body) || looksLikeAssemblySourceStatement(body);
}

function hasVisibleTruncationBoundary(text: string): boolean {
  return /\.\.\.\s*$/.test(text.trim());
}

function hasClippedPathContinuation(text: string): boolean {
  return text
    .split(/\r?\n/)
    .slice(1)
    .some((line) => /^\s*(?:\/|\.\.?\/|[a-z0-9_.-]+\/)\S*\/\S*\.\.\.\s*$/i.test(line));
}

type SourceLocationSpan = { body: string };

const SOURCE_LOCATION_LINE_PATTERN =
  /(?:^|[\r\n])\s*[^\s:\r\n]+\.(?:c|cc|cpp|cxx|cu|cuh|h|hpp|hh|s|asm|ts|tsx|js|jsx|py|rb|go|rs|java|kt|swift):\d+(?::\d+)?:\s*([^\r\n]*)/gi;

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
