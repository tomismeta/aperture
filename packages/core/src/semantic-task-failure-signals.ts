import {
  hasStrongRuntimeDiagnosticEvidence,
  hasToolOutputFailureDiagnosticEvidence,
  looksLikeSearchFailureDiagnostic,
} from "./semantic-diagnostic-shapes.js";
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
import { looksLikeReadTruncationProtocolObservation } from "./semantic-read-observation-shapes.js";
import { looksLikeExplicitReadFailureDiagnostic } from "./semantic-read-failure-diagnostic-shapes.js";
import {
  looksLikeStructuredToolOutputEnvelope,
  readStructuredToolOutputObservation,
  type StructuredToolOutputObservation,
} from "./semantic-structured-output.js";
import { isSemanticCommandExecutionToolFamily } from "./semantic-tool-family.js";
import { looksLikeToolUseRejectionOutcome } from "./semantic-tool-use-rejection-shapes.js";
import { readTruncatedStructuredToolOutputEnvelope } from "./semantic-truncated-structured-output.js";
import { looksLikeUnifiedDiffObservation } from "./semantic-unified-diff-observation-shapes.js";

export type TaskFailureStructuredOutputEnvelope =
  | { kind: "unsupported" }
  | { kind: "raw" }
  | { kind: "valid"; output: StructuredToolOutputObservation }
  | { kind: "recovered"; output: StructuredToolOutputObservation }
  | { kind: "invalid" };

export type TaskFailureSemanticSignals = {
  structuredOutputEnvelope: TaskFailureStructuredOutputEnvelope;
  supportsStructuredToolOutput: boolean;
  unsafeStructuredToolOutputEnvelope: boolean;
  diagnosticStructuredToolOutput: StructuredToolOutputObservation | null;
  structuredOutputExitFailure: boolean;
  structuredOutputSourceObservation: boolean;
  structuredOutputObservation: boolean;
  zeroExitStructuredToolOutput: boolean;
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
  commandObservationTranscript: ExplicitObservationTranscript | null;
  rawCommandDiffObservation: boolean;
  missingToolObservationTranscript: ExplicitObservationTranscript | null;
  rejectedToolUseOutcome: boolean;
};

export function readTaskFailureSemanticSignals(input: {
  summary?: string | undefined;
  toolFamily?: string | undefined;
}): TaskFailureSemanticSignals {
  const summary = input.summary ?? "";
  const supportsStructuredToolOutput =
    isSemanticCommandExecutionToolFamily(input.toolFamily) || input.toolFamily === "edit";
  const structuredOutputEnvelope = readTaskFailureStructuredOutputEnvelope(
    input.summary,
    supportsStructuredToolOutput,
  );
  const diagnosticStructuredToolOutput =
    structuredOutputEnvelope.kind === "valid" || structuredOutputEnvelope.kind === "recovered"
      ? structuredOutputEnvelope.output
      : null;
  const structuredOutputSourceObservation =
    diagnosticStructuredToolOutput !== null &&
    looksLikeStrongRawSourceObservation(diagnosticStructuredToolOutput.output);
  const structuredOutputObservation =
    diagnosticStructuredToolOutput !== null &&
    (looksLikeStructuredToolOutputObservation(diagnosticStructuredToolOutput.output) ||
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

  return {
    structuredOutputEnvelope,
    supportsStructuredToolOutput,
    unsafeStructuredToolOutputEnvelope:
      structuredOutputEnvelope.kind === "recovered" || structuredOutputEnvelope.kind === "invalid",
    diagnosticStructuredToolOutput,
    structuredOutputExitFailure:
      diagnosticStructuredToolOutput?.exitCode !== undefined &&
      diagnosticStructuredToolOutput.exitCode !== 0,
    structuredOutputSourceObservation,
    structuredOutputObservation,
    zeroExitStructuredToolOutput: diagnosticStructuredToolOutput?.exitCode === 0,
    rawReadSourceObservation,
    rawReadListingObservation,
    rawReadTruncationObservation,
    rawReadStructuredObservation,
    editOutputOutcome,
    searchFailureDiagnostic,
    readFailureDiagnostic,
    structuredOutputFailureDiagnostic,
    rawToolOutputFailureDiagnostic:
      supportsStructuredToolOutput &&
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
    commandObservationTranscript: isSemanticCommandExecutionToolFamily(input.toolFamily)
      ? readExplicitNonDiagnosticObservationTranscript(summary)
      : null,
    rawCommandDiffObservation:
      isSemanticCommandExecutionToolFamily(input.toolFamily) &&
      diagnosticStructuredToolOutput === null &&
      structuredOutputEnvelope.kind === "raw" &&
      looksLikeUnifiedDiffObservation(summary),
    missingToolObservationTranscript:
      input.toolFamily === undefined ? readExplicitObservationTranscript(summary) : null,
    rejectedToolUseOutcome: looksLikeToolUseRejectionOutcome(summary),
  };
}

function readTaskFailureStructuredOutputEnvelope(
  summary: string | undefined,
  supportsStructuredToolOutput: boolean,
): TaskFailureStructuredOutputEnvelope {
  if (!supportsStructuredToolOutput) return { kind: "unsupported" };

  const valid = readStructuredToolOutputObservation(summary);
  if (valid !== null) return { kind: "valid", output: valid };

  if (!looksLikeStructuredToolOutputEnvelope(summary)) return { kind: "raw" };

  const recovered = readTruncatedStructuredToolOutputEnvelope(summary);
  return recovered === null ? { kind: "invalid" } : { kind: "recovered", output: recovered };
}
