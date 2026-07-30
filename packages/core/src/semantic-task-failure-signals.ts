import {
  hasStrongRuntimeDiagnosticEvidence,
  hasToolOutputFailureDiagnosticEvidence,
  looksLikeSearchFailureDiagnostic,
} from "./semantic-diagnostic-shapes.js";
import {
  readCommandTextObservation,
  type CommandTextObservation,
} from "./semantic-command-text-observation-shapes.js";
import { readEditOutputOutcome, type EditOutputOutcome } from "./semantic-edit-output-shapes.js";
import {
  looksLikeRecoveredListingObservation,
  looksLikeTruncatedRawReadListingObservation,
} from "./semantic-listing-observation-shapes.js";
import {
  looksLikeStrongRawSourceObservation,
  looksLikeStructuredToolOutputObservation,
} from "./semantic-observation-shapes.js";
import {
  readExplicitObservationTranscript,
  looksLikeExplicitDiagnosticObservationTranscript,
  type ExplicitObservationTranscript,
} from "./semantic-observation-transcript-shapes.js";
import { readExplicitNonDiagnosticObservationTranscript } from "./semantic-nondiagnostic-observation-transcript-shapes.js";
import {
  looksLikeExplicitActualDiagnosticObservationTranscript,
  looksLikeExplicitDiagnosticReferenceObservationTranscript,
} from "./semantic-observation-transcript-reference-shapes.js";
import { looksLikeReadTruncationProtocolObservation } from "./semantic-read-observation-shapes.js";
import { readRecoveredCommandOutputObservation } from "./semantic-recovered-command-output-observation-shapes.js";
import { looksLikeExplicitReadFailureDiagnostic } from "./semantic-read-failure-diagnostic-shapes.js";
import type { StructuredToolOutputObservation } from "./semantic-structured-output.js";
import { readSemanticStructuredOutputOwnership } from "./semantic-structured-output-ownership.js";
import {
  readTaskFailureStructuredOutputEnvelope,
  type TaskFailureStructuredOutputEnvelope,
} from "./semantic-task-failure-structured-output.js";
import { isSemanticCommandExecutionToolFamily } from "./semantic-tool-family.js";
import { looksLikeToolUseRejectionOutcome } from "./semantic-tool-use-rejection-shapes.js";
import { looksLikeUnifiedDiffObservation } from "./semantic-unified-diff-observation-shapes.js";

export type TaskFailureSemanticSignals = {
  structuredOutputEnvelope: TaskFailureStructuredOutputEnvelope;
  unsafeStructuredToolOutputEnvelope: boolean;
  diagnosticStructuredToolOutput: StructuredToolOutputObservation | null;
  structuredOutputExitFailure: boolean;
  structuredOutputZeroExitSuccess: boolean;
  structuredOutputSourceObservation: boolean;
  structuredOutputObservation: boolean;
  rawReadSourceObservation: boolean;
  rawReadListingObservation: boolean;
  rawReadTruncationObservation: boolean;
  rawReadStructuredObservation: boolean;
  editOutputOutcome: EditOutputOutcome | null;
  searchFailureDiagnostic: boolean;
  readFailureDiagnostic: boolean;
  structuredOutputFailureDiagnostic: boolean;
  rawToolOutputFailureDiagnostic: boolean;
  strongSourceRuntimeDiagnostic: boolean;
  diagnosticObservationTranscript: boolean;
  commandDiagnosticObservationTranscript: boolean;
  commandActualDiagnosticObservationTranscript: boolean;
  commandDiagnosticReferenceObservationTranscript: boolean;
  commandObservationTranscript: ExplicitObservationTranscript | null;
  rawCommandDiffObservation: boolean;
  rawCommandTextObservation: CommandTextObservation | null;
  missingToolObservationTranscript: ExplicitObservationTranscript | null;
  rejectedToolUseOutcome: boolean;
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
  const recoveredCommandOutputObservation = readRecoveredCommandOutputObservation({
    commandExecutionToolFamily,
    recoveredEnvelope: structuredOutputEnvelope.kind === "recovered",
    output: diagnosticStructuredToolOutput?.output,
  });
  const structuredOutputSourceObservation =
    diagnosticStructuredToolOutput !== null &&
    (looksLikeStrongRawSourceObservation(diagnosticStructuredToolOutput.output) ||
      recoveredCommandOutputObservation.source);
  const structuredOutputObservation =
    diagnosticStructuredToolOutput !== null &&
    (looksLikeStructuredToolOutputObservation(diagnosticStructuredToolOutput.output) ||
      recoveredCommandOutputObservation.any ||
      (structuredOutputEnvelope.kind === "recovered" &&
        looksLikeRecoveredListingObservation(diagnosticStructuredToolOutput.output)));
  const rawReadSourceObservation =
    input.toolFamily === "read" && looksLikeStrongRawSourceObservation(summary);
  const rawReadListingObservation =
    input.toolFamily === "read" && looksLikeTruncatedRawReadListingObservation(summary);
  const rawReadTruncationObservation =
    input.toolFamily === "read" && looksLikeReadTruncationProtocolObservation(summary);
  const rawReadStructuredObservation =
    rawReadSourceObservation || rawReadListingObservation || rawReadTruncationObservation;
  const editOutputOutcome =
    input.toolFamily !== "edit" || structuredOutputEnvelope.kind === "invalid"
      ? null
      : readEditOutputOutcome(
          structuredOutputEnvelope.kind === "raw" ? summary : undefined,
          diagnosticStructuredToolOutput?.output,
        );
  const searchFailureDiagnostic =
    input.toolFamily === "search" && looksLikeSearchFailureDiagnostic(summary);
  const readFailureDiagnostic =
    input.toolFamily === "read" &&
    (looksLikeExplicitReadFailureDiagnostic(summary) ||
      (hasStrongRuntimeDiagnosticEvidence(summary) && !rawReadSourceObservation));
  const structuredOutputFailureDiagnostic =
    diagnosticStructuredToolOutput !== null &&
    hasToolOutputFailureDiagnosticEvidence(diagnosticStructuredToolOutput.output);
  const rawCommandTextObservation =
    commandExecutionToolFamily &&
    diagnosticStructuredToolOutput === null &&
    structuredOutputEnvelope.kind === "raw"
      ? readCommandTextObservation(summary)
      : null;
  return {
    structuredOutputEnvelope,
    unsafeStructuredToolOutputEnvelope:
      structuredOutputEnvelope.kind === "recovered" || structuredOutputEnvelope.kind === "invalid",
    diagnosticStructuredToolOutput,
    structuredOutputExitFailure:
      diagnosticStructuredToolOutput?.exitCode !== undefined &&
      diagnosticStructuredToolOutput.exitCode !== 0,
    structuredOutputZeroExitSuccess:
      diagnosticStructuredToolOutput?.exitCode === 0 && structuredOutputOwnership === "exact",
    structuredOutputSourceObservation,
    structuredOutputObservation,
    rawReadSourceObservation,
    rawReadListingObservation,
    rawReadTruncationObservation,
    rawReadStructuredObservation,
    editOutputOutcome,
    searchFailureDiagnostic,
    readFailureDiagnostic,
    structuredOutputFailureDiagnostic,
    rawToolOutputFailureDiagnostic:
      structuredOutputOwnership === "native" &&
      diagnosticStructuredToolOutput === null &&
      structuredOutputEnvelope.kind === "raw" &&
      hasToolOutputFailureDiagnosticEvidence(summary),
    strongSourceRuntimeDiagnostic:
      (structuredOutputEnvelope.kind === "valid" &&
        structuredOutputSourceObservation &&
        hasStrongRuntimeDiagnosticEvidence(structuredOutputEnvelope.output.output)) ||
      (rawReadStructuredObservation && hasStrongRuntimeDiagnosticEvidence(summary)),
    diagnosticObservationTranscript:
      input.toolFamily === undefined && looksLikeExplicitDiagnosticObservationTranscript(summary),
    commandDiagnosticObservationTranscript:
      commandExecutionToolFamily && looksLikeExplicitDiagnosticObservationTranscript(summary),
    commandActualDiagnosticObservationTranscript:
      commandExecutionToolFamily && looksLikeExplicitActualDiagnosticObservationTranscript(summary),
    commandDiagnosticReferenceObservationTranscript:
      commandExecutionToolFamily &&
      looksLikeExplicitDiagnosticReferenceObservationTranscript(summary),
    commandObservationTranscript: commandExecutionToolFamily
      ? readExplicitNonDiagnosticObservationTranscript(summary)
      : null,
    rawCommandDiffObservation:
      commandExecutionToolFamily &&
      diagnosticStructuredToolOutput === null &&
      structuredOutputEnvelope.kind === "raw" &&
      looksLikeUnifiedDiffObservation(summary),
    rawCommandTextObservation,
    missingToolObservationTranscript:
      input.toolFamily === undefined ? readExplicitObservationTranscript(summary) : null,
    rejectedToolUseOutcome: looksLikeToolUseRejectionOutcome(summary),
  };
}
