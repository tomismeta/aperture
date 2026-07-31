import { readExplicitObservationTranscriptBody } from "./semantic-observation-transcript-body.js";
import { looksLikeRejectedCommandTextObservation } from "./semantic-command-text-observation-boundaries.js";
import { readOwnedObservationPayload } from "./semantic-owned-observation-payload-shapes.js";

export type CommandTextObservation = {
  shape: "source" | "diff" | "readback" | "test" | "linter" | "document";
  consequenceBaseline: "low" | "medium" | "high";
};

export function readCommandTextObservation(value: string): CommandTextObservation | null {
  const text = readCommandObservationBody(value);
  if (text.length === 0 || looksLikeRejectedCommandTextObservation(text)) {
    return null;
  }

  return readOwnedObservationPayload(text, { rejectCommandTextWrappers: true });
}

function readCommandObservationBody(value: string): string {
  const text = stripObservationStatusPrefix(value);
  return readExplicitObservationTranscriptBody(text) ?? text;
}

function stripObservationStatusPrefix(value: string): string {
  return value.trim().replace(/^(?:bash|edit|read|search|tool)\s+failure\s+/i, "");
}
