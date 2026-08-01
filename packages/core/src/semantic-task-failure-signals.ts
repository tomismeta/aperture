import {
  hasStrongRuntimeDiagnosticEvidence,
  hasToolOutputFailureDiagnosticEvidence,
  looksLikeSearchFailureDiagnostic,
} from "./semantic-diagnostic-shapes.js";
import { readEditOutputOutcome, type EditOutputOutcome } from "./semantic-edit-output-shapes.js";
import {
  readExplicitObservationTranscript,
  looksLikeExplicitDiagnosticObservationTranscript,
} from "./semantic-observation-transcript-shapes.js";
import { readExplicitNonDiagnosticObservationTranscript } from "./semantic-nondiagnostic-observation-transcript-shapes.js";
import {
  looksLikeExplicitActualDiagnosticObservationTranscript,
  looksLikeExplicitDiagnosticReferenceObservationTranscript,
} from "./semantic-observation-transcript-reference-shapes.js";
import { hasOwnedReadTerminalDiagnosticEvidence } from "./semantic-owned-read-observation-shapes.js";
import type { StructuredToolOutputObservation } from "./semantic-structured-output.js";
import { readSemanticStructuredOutputOwnership } from "./semantic-structured-output-ownership.js";
import {
  readTaskFailureStructuredOutputEnvelope,
  type TaskFailureStructuredOutputEnvelope,
} from "./semantic-task-failure-structured-output.js";
import { isSemanticCommandExecutionToolFamily } from "./semantic-tool-family.js";
import { looksLikeToolUseRejectionOutcome } from "./semantic-tool-use-rejection-shapes.js";
import {
  looksLikeSourceWindowLimitFailure,
  looksLikeSourceWindowLimitMixedDiagnostic,
} from "./semantic-source-window-limit-shapes.js";
import { readTaskFailureObservationSemantics } from "./task-failure-observation-grammar.js";
import type { ObservationSemantics } from "./observation-semantics.js";

export type TaskFailureSemanticSignals = {
  structuredOutputEnvelope: TaskFailureStructuredOutputEnvelope;
  unsafeStructuredToolOutputEnvelope: boolean;
  diagnosticStructuredToolOutput: StructuredToolOutputObservation | null;
  structuredOutputExitFailure: boolean;
  structuredOutputZeroExitSuccess: boolean;
  editOutputOutcome: EditOutputOutcome | null;
  searchFailureDiagnostic: boolean;
  readFailureDiagnostic: boolean;
  sourceWindowLimitFailure: boolean;
  structuredOutputFailureDiagnostic: boolean;
  rawToolOutputFailureDiagnostic: boolean;
  strongSourceRuntimeDiagnostic: boolean;
  diagnosticObservationTranscript: boolean;
  commandDiagnosticObservationTranscript: boolean;
  commandActualDiagnosticObservationTranscript: boolean;
  commandDiagnosticReferenceObservationTranscript: boolean;
  observationSemantics: ObservationSemantics | null;
};

export function readTaskFailureSemanticSignals(input: {
  summary?: string | undefined;
  toolFamily?: string | undefined;
}): TaskFailureSemanticSignals {
  const summary = input.summary ?? "";
  const commandExecutionToolFamily = isSemanticCommandExecutionToolFamily(input.toolFamily);
  const structuredOutputOwnership = readSemanticStructuredOutputOwnership(input.toolFamily);
  const structuredOutputEnvelope = readTaskFailureStructuredOutputEnvelope(
    input.summary,
    structuredOutputOwnership,
  );
  const diagnosticStructuredToolOutput =
    structuredOutputEnvelope.kind === "valid" || structuredOutputEnvelope.kind === "recovered"
      ? structuredOutputEnvelope.output
      : null;
  const editOutputOutcome =
    input.toolFamily !== "edit" || structuredOutputEnvelope.kind === "invalid"
      ? null
      : readEditOutputOutcome(
          structuredOutputEnvelope.kind === "raw" ? summary : undefined,
          diagnosticStructuredToolOutput?.output,
        );
  const structuredOutputFailureDiagnostic =
    diagnosticStructuredToolOutput !== null &&
    hasToolOutputFailureDiagnosticEvidence(diagnosticStructuredToolOutput.output);
  const readObservationTranscript =
    input.toolFamily === "read" && diagnosticStructuredToolOutput === null
      ? readExplicitObservationTranscript(summary)
      : null;
  const structuredOutputExitFailure =
    diagnosticStructuredToolOutput?.exitCode !== undefined &&
    diagnosticStructuredToolOutput.exitCode !== 0;
  const structuredOutputZeroExitSuccess =
    diagnosticStructuredToolOutput?.exitCode === 0 && structuredOutputOwnership === "exact";
  const commandObservationTranscript = commandExecutionToolFamily
    ? readExplicitNonDiagnosticObservationTranscript(summary)
    : null;
  const readAbbreviatedFileViewObservation =
    readObservationTranscript?.shape === "abbreviated_file_view" ? readObservationTranscript : null;
  const missingToolObservationTranscript =
    input.toolFamily === undefined ? readExplicitObservationTranscript(summary) : null;
  const rejectedToolUseOutcome = looksLikeToolUseRejectionOutcome(summary);
  const observationSemantics = readTaskFailureObservationSemantics({
    commandObservationTranscript,
    editOutputOutcome,
    missingToolObservationTranscript,
    readAbbreviatedFileViewObservation,
    rejectedToolUseOutcome,
    structuredOutputEnvelope,
    structuredOutputZeroExitSuccess,
    summary,
    toolFamily: input.toolFamily,
  });
  const strongDiagnostic = hasStrongRuntimeDiagnosticEvidence(summary);
  const readPayloadObservation = isPayloadObservationOrigin(observationSemantics, "read_output");
  const readSourcePayloadObservation =
    readPayloadObservation && observationSemantics?.subject === "source";
  const structuredSourcePayloadObservation =
    isPayloadObservationOrigin(observationSemantics, "structured_output") &&
    observationSemantics?.subject === "source";
  const sourceWindowLimitFailure =
    input.toolFamily === "read" &&
    !readPayloadObservation &&
    !strongDiagnostic &&
    looksLikeSourceWindowLimitFailure(summary);
  const sourceWindowLimitMixedDiagnostic =
    input.toolFamily === "read" &&
    !readPayloadObservation &&
    looksLikeSourceWindowLimitMixedDiagnostic(summary);
  const readFailureDiagnostic =
    input.toolFamily === "read" &&
    (hasOwnedReadTerminalDiagnosticEvidence(summary) ||
      sourceWindowLimitFailure ||
      sourceWindowLimitMixedDiagnostic ||
      (strongDiagnostic && !readSourcePayloadObservation));

  return {
    structuredOutputEnvelope,
    unsafeStructuredToolOutputEnvelope:
      structuredOutputEnvelope.kind === "recovered" || structuredOutputEnvelope.kind === "invalid",
    diagnosticStructuredToolOutput,
    structuredOutputExitFailure,
    structuredOutputZeroExitSuccess,
    editOutputOutcome,
    searchFailureDiagnostic:
      input.toolFamily === "search" && looksLikeSearchFailureDiagnostic(summary),
    readFailureDiagnostic,
    sourceWindowLimitFailure,
    structuredOutputFailureDiagnostic,
    rawToolOutputFailureDiagnostic:
      structuredOutputOwnership === "native" &&
      diagnosticStructuredToolOutput === null &&
      structuredOutputEnvelope.kind === "raw" &&
      hasToolOutputFailureDiagnosticEvidence(summary),
    strongSourceRuntimeDiagnostic:
      (structuredOutputEnvelope.kind === "valid" &&
        structuredSourcePayloadObservation &&
        hasStrongRuntimeDiagnosticEvidence(structuredOutputEnvelope.output.output)) ||
      (readPayloadObservation && strongDiagnostic),
    diagnosticObservationTranscript:
      input.toolFamily === undefined && looksLikeExplicitDiagnosticObservationTranscript(summary),
    commandDiagnosticObservationTranscript:
      commandExecutionToolFamily && looksLikeExplicitDiagnosticObservationTranscript(summary),
    commandActualDiagnosticObservationTranscript:
      commandExecutionToolFamily && looksLikeExplicitActualDiagnosticObservationTranscript(summary),
    commandDiagnosticReferenceObservationTranscript:
      commandExecutionToolFamily &&
      looksLikeExplicitDiagnosticReferenceObservationTranscript(summary),
    observationSemantics,
  };
}

function isPayloadObservationOrigin(
  observation: ObservationSemantics | null,
  origin: ObservationSemantics["provenance"]["origin"],
): boolean {
  return observation?.kind === "payload" && observation.provenance.origin === origin;
}
