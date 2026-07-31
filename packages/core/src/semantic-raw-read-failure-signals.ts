import { hasStrongRuntimeDiagnosticEvidence } from "./semantic-diagnostic-shapes.js";
import { looksLikeTruncatedRawReadListingObservation } from "./semantic-listing-observation-shapes.js";
import {
  hasOwnedReadTerminalDiagnosticEvidence,
  looksLikeOwnedRawReadObservation,
} from "./semantic-observation-shapes.js";
import { readOwnedObservationPayload } from "./semantic-owned-observation-payload-shapes.js";
import { looksLikeReadTruncationProtocolObservation } from "./semantic-read-observation-shapes.js";
import {
  looksLikeSourceWindowLimitFailure,
  looksLikeSourceWindowLimitMixedDiagnostic,
} from "./semantic-source-window-limit-shapes.js";

export function readRawReadFailureSignals(input: { summary: string; readTool: boolean }) {
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
  const strongDiagnostic = input.readTool && hasStrongRuntimeDiagnosticEvidence(input.summary);
  const rawReadStrongRuntimeDiagnostic = rawReadStructuredObservation && strongDiagnostic;
  const sourceWindowLimitFailure =
    input.readTool &&
    !rawReadStructuredObservation &&
    !strongDiagnostic &&
    looksLikeSourceWindowLimitFailure(input.summary);
  const sourceWindowLimitMixedDiagnostic =
    input.readTool &&
    !rawReadStructuredObservation &&
    looksLikeSourceWindowLimitMixedDiagnostic(input.summary);

  return {
    rawReadSourceObservation,
    rawReadListingObservation,
    rawReadObservationBaseline,
    rawReadStructuredObservation,
    readFailureDiagnostic:
      ownedTerminalDiagnostic ||
      sourceWindowLimitFailure ||
      sourceWindowLimitMixedDiagnostic ||
      (strongDiagnostic && !rawReadSourceObservation),
    sourceWindowLimitFailure,
    rawReadStrongRuntimeDiagnostic,
  };
}

function hasReadTransportWindow(text: string): boolean {
  return /[\r\n]/.test(text) || /(?:^|\s)\d{1,6}\u2192\S/.test(text);
}
