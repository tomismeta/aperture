import { looksLikeToolOutputDiagnosticPayload } from "./semantic-tool-output-diagnostic-shapes.js";
import { looksLikeRuntimePanicDiagnostic } from "./semantic-panic-diagnostic-shapes.js";
import { looksLikePathQualifiedFailureDiagnostic } from "./semantic-path-qualified-failure-diagnostic-shapes.js";
import { looksLikePythonRuntimeDiagnostic } from "./semantic-python-diagnostic-shapes.js";
import {
  hasUnquotedEmbeddedRuntimeDiagnosticEvidence,
  looksLikeRuntimeError,
} from "./semantic-runtime-error-diagnostic-shapes.js";
import { looksLikeTestRunnerFailureDiagnostic } from "./semantic-test-runner-output-shapes.js";

export { hasUnquotedEmbeddedRuntimeDiagnosticEvidence } from "./semantic-runtime-error-diagnostic-shapes.js";

export function hasToolOutputFailureDiagnosticEvidence(
  text: string,
  embeddedRuntime = false,
): boolean {
  return [
    hasStrongRuntimeDiagnosticEvidence(text),
    looksLikeToolOutputDiagnosticPayload(text),
    embeddedRuntime && hasUnquotedEmbeddedRuntimeDiagnosticEvidence(text),
  ].some(Boolean);
}

export function looksLikeSearchFailureDiagnostic(rawText: string): boolean {
  if (!/\bweb search results for\b/i.test(rawText)) {
    return false;
  }

  const payload = readWebSearchResultPayload(rawText);
  const failure =
    /\b(?:backend\s+(?:is\s+)?unavailable|could\s+not\s+be\s+retrieved|couldn['’]?t\s+be\s+retrieved|failed\s+because|request\s+failed|search\s+failed|timed?\s+out|timeout)\b/i.exec(
      payload ?? rawText,
    );
  return failure !== null && (payload === null || payload.slice(0, failure.index).trim() === "");
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
      /(?:^|[\r\n])\s*(?:npm\s+err!?|pnpm\s+err!?|yarn\s+error\b|err_pnpm_)/i,
      /\beconnrefused\b/i,
      /\bthread\b[^\r\n]*\bpanicked at\b/i,
      /(?:^|[\r\n])\s*terminate called after throwing\b/i,
      /(?:^|[\r\n])\s*(?:tests?\s+failed|failed\s+tests)\b/i,
      /\bassertion failed\b/i,
      /(?:^|[\r\n])\s*(?:[a-z0-9_./-]+:\s*)+\s*no such file or directory\b/i,
      /(?:^|[\r\n])\s*(?:file does not exist|unrecognized arguments)\b/i,
      /\b(?:exit code|exit_code|exit-code|exited with code|exit status|exited with status|return code|return_code|returned code)\s*(?:is|was)?\s*-?[1-9]\d*\b/i,
    ].some((pattern) => pattern.test(text)) ||
    looksLikePathQualifiedFailureDiagnostic(text) ||
    looksLikeRuntimePanicDiagnostic(text) ||
    looksLikeCMakeError(text) ||
    looksLikeCompilerError(text) ||
    looksLikeTestRunnerFailureDiagnostic(text) ||
    looksLikePythonRuntimeDiagnostic(text) ||
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

function readWebSearchResultPayload(rawText: string): string | null {
  const match =
    /^\s*web search results for\s+(?:"[^"]+"|'[^']+'|`[^`]+`|[^:\r\n]{1,200})\s*:\s+([\s\S]+)$/i.exec(
      rawText,
    );
  return match?.[1] ?? null;
}

function looksLikeCompilerError(text: string): boolean {
  return [
    /(?:^|[\r\n])\s*(?:[A-Za-z]:[\\/])?(?:[./\\\w-]+[\\/])?[\w.-]+(?:\.[a-z0-9]{1,8})?:\d+(?::\d+)?\s*:\s*(?:(?:fatal\s+)?error\b|fatal:\s+\S)/i,
    /\b(?:[A-Za-z]:[\\/])?(?:[./\\\w-]+[\\/])?[\w.-]+\.(?:ts|tsx|js|jsx)\(\d+,\d+\):\s*error\s+TS\d+\b/i,
    /(?:^|[\r\n])\s*(?:clang|gcc|g\+\+|cc|c\+\+|ld|make(?:\[\d+\])?)\s*:\s*(?:fatal\s+)?error\b/i,
    /(?:^|[\r\n])\s*error\s+(?:ts)?\d+\b/i,
    /(?:^|[\r\n])\s*fatal:\s+\S/i,
    /(?:^|[\r\n])\s*make(?:\[\d+\])?:\s+\*\*\*/i,
  ].some((pattern) => pattern.test(text));
}
