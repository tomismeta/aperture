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
import {
  resolveSemanticStructuredOutputEnvelope,
  readSemanticStructuredOutputOwnership,
} from "./semantic-structured-output-ownership.js";
import { isSemanticCommandExecutionToolFamily } from "./semantic-tool-family.js";
import { parseTaskFailureEventFact } from "./semantic-task-failure-event-facts.js";
import {
  readTaskFailureObservationSyntax,
  type TaskFailureObservationSyntax,
} from "./task-failure-observation-grammar.js";

export type TaskFailureSemanticSignals = ReturnType<typeof readTaskFailureSemanticSignals>;
type SemanticSignalInput = Partial<Record<"title" | "summary" | "toolFamily", string | undefined>>;

export function readTaskFailureSemanticSignals(input: SemanticSignalInput) {
  const { toolFamily } = input;
  const summary = input.summary ?? "";
  const eventFields = [input.title ?? "", summary];
  const commandExecutionToolFamily = isSemanticCommandExecutionToolFamily(toolFamily);
  const structuredOutputOwnership = readSemanticStructuredOutputOwnership(toolFamily);
  const structuredOutputEnvelope = resolveSemanticStructuredOutputEnvelope(
    input.summary,
    structuredOutputOwnership,
  );
  const diagnosticStructuredToolOutput =
    structuredOutputEnvelope.kind === "valid" || structuredOutputEnvelope.kind === "recovered"
      ? structuredOutputEnvelope.output
      : null;
  const editOutputOutcome =
    toolFamily !== "edit" || structuredOutputEnvelope.kind === "invalid"
      ? null
      : readEditOutputOutcome(
          structuredOutputEnvelope.kind === "raw" ? summary : undefined,
          diagnosticStructuredToolOutput?.output,
        );
  const structuredOutputFailureDiagnostic =
    diagnosticStructuredToolOutput !== null &&
    hasToolOutputFailureDiagnosticEvidence(diagnosticStructuredToolOutput.output);
  const readObservationTranscript =
    toolFamily === "read" && diagnosticStructuredToolOutput === null
      ? readExplicitObservationTranscript(summary)
      : null;
  const structuredOutputExitFailure =
    diagnosticStructuredToolOutput?.exitCode !== undefined &&
    diagnosticStructuredToolOutput.exitCode !== 0;
  const structuredOutputZeroExitSuccess =
    diagnosticStructuredToolOutput?.exitCode === 0 && structuredOutputOwnership === "exact";
  const observationTranscript =
    (readObservationTranscript?.shape === "abbreviated_file_view"
      ? readObservationTranscript
      : null) ??
    (commandExecutionToolFamily ? readExplicitNonDiagnosticObservationTranscript(summary) : null) ??
    (toolFamily === undefined ? readExplicitObservationTranscript(summary) : null);
  const strongDiagnostic = hasStrongRuntimeDiagnosticEvidence(summary);
  const controlDiagnostic = hasToolOutputFailureDiagnosticEvidence(summary, true);
  const eventFact = parseTaskFailureEventFact(eventFields, controlDiagnostic);
  const controlContext = parseTaskFailureEventFact(eventFields) === "authorization_control";
  const observationSyntax = readTaskFailureObservationSyntax({
    editOutputOutcome,
    eventFact,
    observationTranscript,
    structuredOutputEnvelope,
    structuredOutputZeroExitSuccess,
    summary,
    toolFamily,
  });
  const readPayloadObservation = isPayloadObservationOrigin(observationSyntax, "read_output");
  const readSourcePayloadObservation =
    readPayloadObservation && observationSyntax?.subject === "source";
  const protectedPayload = observationSyntax?.completeBoundary === true;
  const structuredSourcePayloadObservation =
    isPayloadObservationOrigin(observationSyntax, "structured_output") &&
    observationSyntax?.subject === "source";
  const readFailureDiagnostic =
    toolFamily === "read" &&
    !protectedPayload &&
    (hasOwnedReadTerminalDiagnosticEvidence(summary) ||
      (strongDiagnostic && !readSourcePayloadObservation));

  return {
    structuredOutputEnvelope,
    unsafeStructuredToolOutputEnvelope:
      structuredOutputEnvelope.kind === "recovered" || structuredOutputEnvelope.kind === "invalid",
    diagnosticStructuredToolOutput,
    structuredOutputExitFailure,
    editOutputOutcome,
    searchFailureDiagnostic: toolFamily === "search" && looksLikeSearchFailureDiagnostic(summary),
    readFailureDiagnostic,
    structuredOutputFailureDiagnostic,
    rawToolOutputFailureDiagnostic:
      toolFamily !== undefined &&
      structuredOutputOwnership !== "unsupported" &&
      diagnosticStructuredToolOutput === null &&
      structuredOutputEnvelope.kind === "raw" &&
      observationSyntax?.kind !== "control" &&
      !protectedPayload &&
      hasToolOutputFailureDiagnosticEvidence(summary, controlContext),
    strongSourceRuntimeDiagnostic:
      (structuredOutputEnvelope.kind === "valid" &&
        structuredSourcePayloadObservation &&
        hasStrongRuntimeDiagnosticEvidence(structuredOutputEnvelope.output.output)) ||
      (readPayloadObservation && strongDiagnostic && !protectedPayload),
    diagnosticObservationTranscript:
      toolFamily === undefined && looksLikeExplicitDiagnosticObservationTranscript(summary),
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
