import { looksLikeRecoveredListingObservation } from "./semantic-listing-observation-shapes.js";
import {
  looksLikeStrongRawSourceObservation,
  looksLikeStructuredToolOutputObservation,
} from "./semantic-observation-shapes.js";
import { readOwnedObservationPayload } from "./semantic-owned-observation-payload-shapes.js";
import { readRecoveredCommandOutputObservation } from "./semantic-recovered-command-output-observation-shapes.js";
import { readSingleOwnedListingObservation } from "./semantic-single-listing-observation-shapes.js";
import type { StructuredToolOutputObservation } from "./semantic-structured-output.js";
import type { TaskFailureStructuredOutputEnvelope } from "./semantic-task-failure-structured-output.js";

export type StructuredOutputObservationSignals = {
  singleListingObservation: boolean;
  sourceObservation: boolean;
  observation: boolean;
};

export function readStructuredOutputObservationSignals(input: {
  commandExecutionToolFamily: boolean;
  envelope: TaskFailureStructuredOutputEnvelope;
  output: StructuredToolOutputObservation | null;
}): StructuredOutputObservationSignals {
  if (input.output === null) {
    return { singleListingObservation: false, sourceObservation: false, observation: false };
  }

  const recoveredCommandOutputObservation = readRecoveredCommandOutputObservation({
    commandExecutionToolFamily: input.commandExecutionToolFamily,
    recoveredEnvelope: input.envelope.kind === "recovered",
    output: input.output.output,
  });
  const ownedObservation = readOwnedObservationPayload(input.output.output);
  const singleListingObservation =
    input.commandExecutionToolFamily && input.output.exitCode === 0
      ? readSingleOwnedListingObservation(input.output.output)
      : null;

  return {
    singleListingObservation: singleListingObservation !== null,
    sourceObservation:
      looksLikeStrongRawSourceObservation(input.output.output) ||
      recoveredCommandOutputObservation.source ||
      ownedObservation?.source === true ||
      singleListingObservation?.source === true,
    observation:
      looksLikeStructuredToolOutputObservation(input.output.output) ||
      recoveredCommandOutputObservation.any ||
      ownedObservation !== null ||
      singleListingObservation !== null ||
      (input.envelope.kind === "recovered" &&
        looksLikeRecoveredListingObservation(input.output.output)),
  };
}
