import { hasStrongRuntimeDiagnosticEvidence } from "./semantic-diagnostic-shapes.js";
import { looksLikeTruncatedRawReadListingObservation } from "./semantic-listing-observation-shapes.js";
import {
  hasOwnedReadTerminalDiagnosticEvidence,
  looksLikeOwnedRawReadObservation,
} from "./semantic-observation-shapes.js";
import { looksLikeReadTruncationProtocolObservation } from "./semantic-read-observation-shapes.js";

export type RawReadFailureSignals = {
  rawReadSourceObservation: boolean;
  rawReadListingObservation: boolean;
  rawReadTruncationObservation: boolean;
  rawReadStructuredObservation: boolean;
  readFailureDiagnostic: boolean;
  rawReadStrongRuntimeDiagnostic: boolean;
};

export function readRawReadFailureSignals(input: {
  summary: string;
  readTool: boolean;
}): RawReadFailureSignals {
  const ownedTerminalDiagnostic =
    input.readTool && hasOwnedReadTerminalDiagnosticEvidence(input.summary);
  const rawReadSourceObservation =
    input.readTool && !ownedTerminalDiagnostic && looksLikeOwnedRawReadObservation(input.summary);
  const rawReadListingObservation =
    input.readTool && looksLikeTruncatedRawReadListingObservation(input.summary);
  const rawReadTruncationObservation =
    input.readTool && looksLikeReadTruncationProtocolObservation(input.summary);
  const rawReadStructuredObservation =
    rawReadSourceObservation || rawReadListingObservation || rawReadTruncationObservation;

  return {
    rawReadSourceObservation,
    rawReadListingObservation,
    rawReadTruncationObservation,
    rawReadStructuredObservation,
    readFailureDiagnostic:
      ownedTerminalDiagnostic ||
      (input.readTool &&
        hasStrongRuntimeDiagnosticEvidence(input.summary) &&
        !rawReadSourceObservation),
    rawReadStrongRuntimeDiagnostic:
      rawReadStructuredObservation && hasStrongRuntimeDiagnosticEvidence(input.summary),
  };
}
