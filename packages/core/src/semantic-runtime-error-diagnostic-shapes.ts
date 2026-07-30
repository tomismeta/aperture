export function looksLikeRuntimeError(text: string): boolean {
  return new RegExp(
    `(?:^|[\\r\\n])\\s*(?:[a-z0-9_./-]+:\\s*)?${STRONG_RUNTIME_ERROR_NAME_SOURCE}\\b`,
    "i",
  ).test(text);
}

export function hasUnquotedEmbeddedRuntimeDiagnosticEvidence(text: string): boolean {
  return [
    new RegExp(`\\b${EMBEDDED_RUNTIME_ERROR_NAME_SOURCE}:\\s+\\S`, "gi"),
    /\b[a-z0-9_./-]+\.(?:c|cc|cpp|cxx|cu|cuh|h|hpp|ts|tsx|js|jsx|py|rs|go|java|kt|swift):\d+(?::\d+)?:\s*(?:fatal\s+)?error\b/gi,
  ].some((pattern) => hasUnquotedMatch(text, pattern));
}

function hasUnquotedMatch(text: string, pattern: RegExp): boolean {
  for (const match of text.matchAll(pattern)) {
    if (!/[="'`]\s*$/.test(text.slice(Math.max(0, match.index - 3), match.index))) {
      return true;
    }
  }
  return false;
}

const STRONG_RUNTIME_ERROR_NAME_SOURCE =
  "(?:assertionerror|importerror|modulenotfounderror|referenceerror|runtimeerror|syntaxerror|typeerror|valueerror)";
const EMBEDDED_RUNTIME_ERROR_NAME_SOURCE =
  "(?:assertionerror|filenotfounderror|importerror|indentationerror|keyerror|modulenotfounderror|nameerror|oserror|permissionerror|referenceerror|runtimeerror|syntaxerror|timeouterror|typeerror|valueerror)";
