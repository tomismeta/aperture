import { looksLikeToolOutputDiagnosticPayload } from "./semantic-tool-output-diagnostic-shapes.js";

export function hasToolOutputFailureDiagnosticEvidence(text: string): boolean {
  return hasStrongRuntimeDiagnosticEvidence(text) || looksLikeToolOutputDiagnosticPayload(text);
}

export function looksLikeSearchFailureDiagnostic(rawText: string): boolean {
  if (!/\bweb search results for\b/i.test(rawText)) {
    return false;
  }

  const payload = readWebSearchResultPayload(rawText);
  return payload === null
    ? looksLikeSearchFailureEnvelope(rawText)
    : looksLikeSearchFailurePayload(payload);
}

export function hasStrongRuntimeDiagnosticEvidence(text: string): boolean {
  return (
    [
      /\btraceback\s+\(most recent call last\)/i,
      /\bapply_patch verification failed\b/i,
      /\bsegmentation fault\b/i,
      /\bsymbol lookup error\b/i,
      /\blibrary load error\b/i,
      /\bcannot open shared object file\b/i,
      /\bcommand not found\b/i,
      /(?:^|[\r\n])\s*(?:[^\r\n:]+:\s*)*(?:permission denied|operation not permitted)\b/i,
      /(?:^|[\r\n])\s*(?:uncaught|unhandled)\s+exception\b/i,
      /(?:^|[\r\n])\s*(?:fatal\s+error|compiler\s+error)\b/i,
      /(?:^|[\r\n])\s*error:\s+\S/i,
      /\beconnrefused\b/i,
      /\bthread\b[^\r\n]*\bpanicked at\b/i,
      /(?:^|[\r\n])\s*terminate called after throwing\b/i,
      /\btests failed\b/i,
      /\btest failed\b/i,
      /\bfailed tests\b/i,
      /\bassertion failed\b/i,
      /(?:^|[\r\n])\s*(?:[a-z0-9_./-]+:\s*)+\s*no such file or directory\b/i,
      /(?:^|[\r\n])\s*(?:file does not exist|unrecognized arguments)\b/i,
      /\b(?:exit code|exit_code|exit-code|exited with code|exit status|exited with status|return code|return_code|returned code)\s*(?:is|was)?\s*-?[1-9]\d*\b/i,
    ].some((pattern) => pattern.test(text)) ||
    looksLikeCMakeError(text) ||
    looksLikePackageManagerError(text) ||
    looksLikeCompilerError(text) ||
    looksLikeRuntimeError(text)
  );
}

function looksLikeCMakeError(text: string): boolean {
  const errorAtLocation = /CMake Error at \S+:\d+\s+\(/i;
  return (
    /(?:^|[\r\n])\s*CMake Error at \S+:\d+\s+\(/i.test(text) ||
    (/(?:^|[\r\n])\s*total output lines:\s*\d+\b/i.test(text) && errorAtLocation.test(text))
  );
}

function looksLikePackageManagerError(text: string): boolean {
  return /(?:^|[\r\n])\s*(?:npm\s+err!?|pnpm\s+err!?|yarn\s+error\b|err_pnpm_)/i.test(text);
}

function readWebSearchResultPayload(rawText: string): string | null {
  const match =
    /^\s*web search results for\s+(?:"[^"]+"|'[^']+'|`[^`]+`|[^:\r\n]{1,200})\s*:\s+([\s\S]+)$/i.exec(
      rawText,
    );
  return match?.[1] ?? null;
}

function looksLikeSearchFailureEnvelope(text: string): boolean {
  return /\b(?:backend\s+(?:is\s+)?unavailable|could\s+not\s+be\s+retrieved|couldn['’]?t\s+be\s+retrieved|failed\s+because|request\s+failed|search\s+failed|timed?\s+out|timeout)\b/i.test(
    text,
  );
}

function looksLikeSearchFailurePayload(text: string): boolean {
  return /^\s*(?:backend\s+(?:is\s+)?unavailable\b|could\s+not\s+be\s+retrieved\b|couldn['’]?t\s+be\s+retrieved\b|failed\s+because\b|request\s+failed\b|search\s+failed\b|timed?\s+out\b|timeout\b)/i.test(
    text,
  );
}

function looksLikeCompilerError(text: string): boolean {
  return [
    /(?:^|[\r\n])\s*(?:[a-z0-9_./-]+:\d+(?::\d+)?|[a-z0-9_./-]+\.(?:c|cc|cpp|cxx|h|hpp|ts|tsx|js|jsx|py|rs|go|java|kt|swift):\d+(?::\d+)?)\s*:\s*(?:fatal\s+)?error\b/i,
    /(?:^|[\r\n])\s*(?:clang|gcc|g\+\+|cc|c\+\+|ld|make(?:\[\d+\])?)\s*:\s*(?:fatal\s+)?error\b/i,
    /(?:^|[\r\n])\s*error\s+(?:ts)?\d+\b/i,
    /(?:^|[\r\n])\s*fatal:\s+\S/i,
    /(?:^|[\r\n])\s*make(?:\[\d+\])?:\s+\*\*\*/i,
  ].some((pattern) => pattern.test(text));
}

function looksLikeRuntimeError(text: string): boolean {
  return /(?:^|[\r\n])\s*(?:[a-z0-9_./-]+:\s*)?(?:assertionerror|importerror|modulenotfounderror|referenceerror|runtimeerror|syntaxerror|typeerror|valueerror)\b/i.test(
    text,
  );
}
