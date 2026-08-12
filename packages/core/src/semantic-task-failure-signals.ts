import {
  hasStrongRuntimeDiagnosticEvidence,
  hasToolOutputFailureDiagnosticEvidence,
  looksLikeSearchFailureDiagnostic,
} from "./semantic-diagnostic-shapes.js";
import { readEditOutputOutcome } from "./semantic-edit-output-shapes.js";
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
import { readSemanticStructuredOutputOwnership } from "./semantic-structured-output-ownership.js";
import { readTaskFailureStructuredOutputEnvelope } from "./semantic-task-failure-structured-output.js";
import { isSemanticCommandExecutionToolFamily } from "./semantic-tool-family.js";
import {
  hasToolUseRejectionSignal,
  readToolUseRejectionOutcome,
} from "./semantic-tool-use-rejection-shapes.js";
import {
  looksLikeSourceWindowLimitFailure,
  looksLikeSourceWindowLimitMixedDiagnostic,
} from "./semantic-source-window-limit-shapes.js";
import {
  readTaskFailureObservationSyntax,
  type TaskFailureObservationSyntax,
} from "./task-failure-observation-grammar.js";

export type TaskFailureSemanticSignals = ReturnType<typeof readTaskFailureSemanticSignals>;

export function readTaskFailureSemanticSignals(input: {
  summary?: string | undefined;
  toolFamily?: string | undefined;
}) {
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
  const toolUseRejectionOutcome = readToolUseRejectionOutcome(summary);
  const observationSyntax = readTaskFailureObservationSyntax({
    commandObservationTranscript,
    editOutputOutcome,
    missingToolObservationTranscript,
    readAbbreviatedFileViewObservation,
    toolUseRejectionOutcome,
    commandExecutionToolFamily,
    structuredOutputEnvelope,
    structuredOutputZeroExitSuccess,
    summary,
    toolFamily: input.toolFamily,
  });
  const preExecutionControl =
    observationSyntax?.kind === "control" && observationSyntax.executionEvidence === "absent";
  const strongDiagnostic = hasStrongRuntimeDiagnosticEvidence(summary);
  const readPayloadObservation = isPayloadObservationOrigin(observationSyntax, "read_output");
  const readSourcePayloadObservation =
    readPayloadObservation && readObservationSyntaxSubject(observationSyntax) === "source";
  const structuredSourcePayloadObservation =
    isPayloadObservationOrigin(observationSyntax, "structured_output") &&
    readObservationSyntaxSubject(observationSyntax) === "source";
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
    editOutputOutcome,
    searchFailureDiagnostic:
      input.toolFamily === "search" && looksLikeSearchFailureDiagnostic(summary),
    readFailureDiagnostic,
    sourceWindowLimitFailure,
    structuredOutputFailureDiagnostic,
    rawToolOutputFailureDiagnostic:
      input.toolFamily !== undefined &&
      structuredOutputOwnership !== "unsupported" &&
      diagnosticStructuredToolOutput === null &&
      structuredOutputEnvelope.kind === "raw" &&
      !preExecutionControl &&
      hasToolOutputFailureDiagnosticEvidence(summary, hasToolUseRejectionSignal(summary)),
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
    observationSyntax,
  };
}

function isPayloadObservationOrigin(
  observation: TaskFailureObservationSyntax | null,
  origin: TaskFailureObservationSyntax["origin"],
): boolean {
  return observation?.kind === "payload" && observation.origin === origin;
}

function readObservationSyntaxSubject(
  observation: TaskFailureObservationSyntax | null,
): string | null {
  if (observation?.kind !== "payload")
    return observation?.kind === "outcome" ? observation.subject : null;
  return observation.payload.source ? "source" : observation.fallbackSubject;
}
