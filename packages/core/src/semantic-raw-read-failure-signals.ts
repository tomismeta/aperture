import { hasStrongRuntimeDiagnosticEvidence } from "./semantic-diagnostic-shapes.js";
import { looksLikeTruncatedRawReadListingObservation } from "./semantic-listing-observation-shapes.js";
import {
  hasOwnedReadTerminalDiagnosticEvidence,
  looksLikeOwnedRawReadObservation,
} from "./semantic-observation-shapes.js";
import { readOwnedObservationPayload } from "./semantic-owned-observation-payload-shapes.js";
import { looksLikeReadTruncationProtocolObservation } from "./semantic-read-observation-shapes.js";

export type RawReadFailureSignals = {
  rawReadSourceObservation: boolean;
  rawReadListingObservation: boolean;
  rawReadObservationBaseline: "low" | "medium" | "high" | null;
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
  const rawReadTruncationObservation =
    input.readTool && looksLikeReadTruncationProtocolObservation(input.summary);
  const rawReadOwnedObservation =
    input.readTool &&
    !ownedTerminalDiagnostic &&
    !rawReadTruncationObservation &&
    !hasReadTransportWindow(input.summary)
      ? readOwnedObservationPayload(input.summary, { allowReadOwnedFlattenedFilePayloads: true })
      : null;
  const rawReadSourceObservation =
    input.readTool &&
    !ownedTerminalDiagnostic &&
    ((hasReadTransportWindow(input.summary) && looksLikeOwnedRawReadObservation(input.summary)) ||
      rawReadOwnedObservation?.source === true);
  const rawReadListingObservation =
    input.readTool && looksLikeTruncatedRawReadListingObservation(input.summary);
  const rawReadStructuredObservation =
    rawReadSourceObservation ||
    rawReadListingObservation ||
    rawReadTruncationObservation ||
    rawReadOwnedObservation?.shape === "document";
  const rawReadObservationBaseline = rawReadTruncationObservation
    ? "low"
    : rawReadOwnedObservation?.shape === "document"
      ? rawReadOwnedObservation.consequenceBaseline
      : rawReadSourceObservation
        ? "high"
        : null;

  return {
    rawReadSourceObservation,
    rawReadListingObservation,
    rawReadObservationBaseline,
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

function hasReadTransportWindow(text: string): boolean {
  return /[\r\n]/.test(text) || /(?:^|\s)\d{1,6}\u2192\S/.test(text);
}
