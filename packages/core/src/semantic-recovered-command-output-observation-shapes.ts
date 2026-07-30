import { hasToolOutputFailureDiagnosticEvidence } from "./semantic-diagnostic-shapes.js";
import { looksLikeWarningOnlyCommandOutputObservation } from "./semantic-command-warning-observation-shapes.js";
import { looksLikeRecoveredCommandSourceObservation } from "./semantic-recovered-command-source-observation-shapes.js";

export type RecoveredCommandOutputObservation = {
  source: boolean;
  readback: boolean;
  any: boolean;
};

export function readRecoveredCommandOutputObservation(input: {
  commandExecutionToolFamily: boolean;
  recoveredEnvelope: boolean;
  output?: string | undefined;
}): RecoveredCommandOutputObservation {
  if (!input.commandExecutionToolFamily || !input.recoveredEnvelope || input.output === undefined) {
    return EMPTY_RECOVERED_COMMAND_OUTPUT_OBSERVATION;
  }

  const source = looksLikeRecoveredCommandSourceObservation(input.output);
  const readback = looksLikeRecoveredCommandReadbackObservation(input.output);
  return { source, readback, any: source || readback };
}

const EMPTY_RECOVERED_COMMAND_OUTPUT_OBSERVATION = {
  source: false,
  readback: false,
  any: false,
} satisfies RecoveredCommandOutputObservation;

function looksLikeRecoveredCommandReadbackObservation(value: string): boolean {
  const text = value.trim();
  const documentLocationRows = countLocationRows(text, DOCUMENT_LOCATION_READBACK_PATTERN);
  const sourceLocationRows = countLocationRows(text, SOURCE_LOCATION_READBACK_PATTERN);
  return (
    text.length > 0 &&
    hasVisibleTruncationBoundary(text) &&
    !hasToolOutputFailureDiagnosticEvidence(text) &&
    (looksLikeWarningOnlyCommandOutputObservation(text) ||
      documentLocationRows >= 2 ||
      sourceLocationRows >= 2 ||
      (sourceLocationRows >= 1 && hasClippedPathContinuation(text)))
  );
}

function countLocationRows(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length;
}

function hasVisibleTruncationBoundary(text: string): boolean {
  return /\.\.\.\s*$/.test(text);
}

function hasClippedPathContinuation(text: string): boolean {
  return /(?:^|[\r\n])\s*(?:\/|\.{1,2}\/|~\/|[a-zA-Z]:\\|[a-z0-9_.-]+\/)\S*\.\.\.\s*$/i.test(text);
}

const DOCUMENT_LOCATION_READBACK_PATTERN =
  /(?:^|[\r\n])\s*(?:\/|\.{1,2}\/|~\/|[a-zA-Z]:\\)?[^\s:\r\n]+\.(?:md|markdown|rst|txt|adoc):\d+(?::\d+)?:\s*\S/gi;

const SOURCE_LOCATION_READBACK_PATTERN =
  /(?:^|[\r\n])\s*(?:\/|\.{1,2}\/|~\/|[a-zA-Z]:\\)?[^\s:\r\n]+\.(?:c|cc|cpp|cxx|cu|cuh|h|hpp|hh|s|asm|ts|tsx|js|jsx|py|rb|go|rs|java|kt|swift):\d+(?::\d+)?:\s*\S/gi;
