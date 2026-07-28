export function looksLikeStrongRawSourceObservation(value: string): boolean {
  const text = value.trim();
  if (text.length === 0) {
    return false;
  }

  return (
    looksLikeRawSourcePrefix(text) ||
    looksLikeLineNumberedRawSource(text) ||
    countRawSourceMarkers(text) >= 3
  );
}

export function looksLikeStructuredToolOutputObservation(output: string): boolean {
  return looksLikeStrongRawSourceObservation(output);
}

function looksLikeRawSourcePrefix(text: string): boolean {
  return /^\s*(?:#!\/|diff\s+--git\b|---\s+\S|@@\s+|#include\b|#ifndef\b|#pragma\s+once\b|cmake_minimum_required\s*\(|import\b|from\b|class\b|def\b|function\b|export\b|const\b|let\b|var\b|interface\b|type\b|struct\b|enum\b|void\b|static\b|\/\/\s*copyright\b|#\s*copyright\b)/i.test(
    text,
  );
}

function looksLikeLineNumberedRawSource(text: string): boolean {
  return /\b\d+\s+(?:#include\b|static\b|struct\b|enum\b|typedef\b|void\b|int\b|char\b|bool\b|return\b|namespace\b|class\b|def\b|function\b|const\b|let\b|var\b)/i.test(
    text,
  );
}

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
