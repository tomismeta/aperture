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
  readExplicitObservationTranscript,
  looksLikeExplicitDiagnosticObservationTranscript,
  type ExplicitObservationTranscript,
} from "./semantic-observation-transcript-shapes.js";
import { readExplicitNonDiagnosticObservationTranscript } from "./semantic-nondiagnostic-observation-transcript-shapes.js";
import {
  looksLikeExplicitActualDiagnosticObservationTranscript,
  looksLikeExplicitDiagnosticReferenceObservationTranscript,
} from "./semantic-observation-transcript-reference-shapes.js";
import { readRawReadFailureSignals } from "./semantic-raw-read-failure-signals.js";
import type { StructuredToolOutputObservation } from "./semantic-structured-output.js";
import { readStructuredOutputObservationSignals } from "./semantic-structured-output-observation-signals.js";
import { readSemanticStructuredOutputOwnership } from "./semantic-structured-output-ownership.js";
import {
  readTaskFailureStructuredOutputEnvelope,
  type TaskFailureStructuredOutputEnvelope,
} from "./semantic-task-failure-structured-output.js";
import { isSemanticCommandExecutionToolFamily } from "./semantic-tool-family.js";
import { looksLikeToolUseRejectionOutcome } from "./semantic-tool-use-rejection-shapes.js";
import { looksLikeUnifiedDiffObservation } from "./semantic-unified-diff-observation-shapes.js";

export type TaskFailureObservation = {
  kind: "execution_success" | "payload" | "tool_rejection";
  origin: "command_output" | "read_output" | "status_text" | "structured_output" | "transcript";
  subject: CommandTextObservation["shape"] | "listing" | "tool";
  consequenceBaseline: "low" | "medium" | "high";
  toolFamily?: string;
};

export type TaskFailureSemanticSignals = {
  structuredOutputEnvelope: TaskFailureStructuredOutputEnvelope;
  unsafeStructuredToolOutputEnvelope: boolean;
  diagnosticStructuredToolOutput: StructuredToolOutputObservation | null;
  structuredOutputExitFailure: boolean;
  structuredOutputZeroExitSuccess: boolean;
  structuredOutputSingleListingObservation: boolean;
  structuredOutputSourceObservation: boolean;
  structuredOutputObservation: boolean;
  rawReadSourceObservation: boolean;
  rawReadListingObservation: boolean;
  rawReadObservationBaseline: "low" | "medium" | "high" | null;
  rawReadStructuredObservation: boolean;
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
  observation: TaskFailureObservation | null;
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
  const structuredOutputObservationSignals = readStructuredOutputObservationSignals({
    commandExecutionToolFamily,
    envelope: structuredOutputEnvelope,
    output: diagnosticStructuredToolOutput,
  });
  const {
    rawReadSourceObservation,
    rawReadListingObservation,
    rawReadObservationBaseline,
    rawReadStructuredObservation,
    readFailureDiagnostic,
    sourceWindowLimitFailure,
    rawReadStrongRuntimeDiagnostic,
  } = readRawReadFailureSignals({ summary, readTool: input.toolFamily === "read" });
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
  const rawCommandTextObservation =
    commandExecutionToolFamily &&
    diagnosticStructuredToolOutput === null &&
    structuredOutputEnvelope.kind === "raw"
      ? readCommandTextObservation(summary)
      : null;
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
  const rawCommandDiffObservation =
    commandExecutionToolFamily &&
    diagnosticStructuredToolOutput === null &&
    structuredOutputEnvelope.kind === "raw" &&
    looksLikeUnifiedDiffObservation(summary);
  const missingToolObservationTranscript =
    input.toolFamily === undefined ? readExplicitObservationTranscript(summary) : null;
  const rejectedToolUseOutcome = looksLikeToolUseRejectionOutcome(summary);
  const observation = readTaskFailureObservation({
    commandObservationTranscript,
    diagnosticStructuredToolOutput,
    missingToolObservationTranscript,
    rawCommandDiffObservation,
    rawCommandTextObservation,
    rawReadListingObservation,
    rawReadObservationBaseline,
    rawReadSourceObservation,
    readAbbreviatedFileViewObservation,
    rejectedToolUseOutcome,
    structuredOutputObservation: structuredOutputObservationSignals.observation,
    structuredOutputSourceObservation: structuredOutputObservationSignals.sourceObservation,
    structuredOutputZeroExitSuccess,
    toolFamily: input.toolFamily,
  });

  return {
    structuredOutputEnvelope,
    unsafeStructuredToolOutputEnvelope:
      structuredOutputEnvelope.kind === "recovered" || structuredOutputEnvelope.kind === "invalid",
    diagnosticStructuredToolOutput,
    structuredOutputExitFailure,
    structuredOutputZeroExitSuccess,
    structuredOutputSingleListingObservation:
      structuredOutputObservationSignals.singleListingObservation,
    structuredOutputSourceObservation: structuredOutputObservationSignals.sourceObservation,
    structuredOutputObservation: structuredOutputObservationSignals.observation,
    rawReadSourceObservation,
    rawReadListingObservation,
    rawReadObservationBaseline,
    rawReadStructuredObservation,
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
        structuredOutputObservationSignals.sourceObservation &&
        hasStrongRuntimeDiagnosticEvidence(structuredOutputEnvelope.output.output)) ||
      rawReadStrongRuntimeDiagnostic,
    diagnosticObservationTranscript:
      input.toolFamily === undefined && looksLikeExplicitDiagnosticObservationTranscript(summary),
    commandDiagnosticObservationTranscript:
      commandExecutionToolFamily && looksLikeExplicitDiagnosticObservationTranscript(summary),
    commandActualDiagnosticObservationTranscript:
      commandExecutionToolFamily && looksLikeExplicitActualDiagnosticObservationTranscript(summary),
    commandDiagnosticReferenceObservationTranscript:
      commandExecutionToolFamily &&
      looksLikeExplicitDiagnosticReferenceObservationTranscript(summary),
    observation,
  };
}

function readTaskFailureObservation(input: {
  commandObservationTranscript: ExplicitObservationTranscript | null;
  diagnosticStructuredToolOutput: StructuredToolOutputObservation | null;
  missingToolObservationTranscript: ExplicitObservationTranscript | null;
  rawCommandDiffObservation: boolean;
  rawCommandTextObservation: CommandTextObservation | null;
  rawReadListingObservation: boolean;
  rawReadObservationBaseline: "low" | "medium" | "high" | null;
  rawReadSourceObservation: boolean;
  readAbbreviatedFileViewObservation: ExplicitObservationTranscript | null;
  rejectedToolUseOutcome: boolean;
  structuredOutputObservation: boolean;
  structuredOutputSourceObservation: boolean;
  structuredOutputZeroExitSuccess: boolean;
  toolFamily: string | undefined;
}): TaskFailureObservation | null {
  if (input.missingToolObservationTranscript) {
    return transcriptObservation(input.missingToolObservationTranscript);
  }
  if (input.commandObservationTranscript) {
    return transcriptObservation(input.commandObservationTranscript, input.toolFamily);
  }
  if (input.rejectedToolUseOutcome) {
    return {
      kind: "tool_rejection",
      origin: "status_text",
      subject: "tool",
      consequenceBaseline: "low",
      ...(input.toolFamily !== undefined ? { toolFamily: input.toolFamily } : {}),
    };
  }
  if (input.rawCommandDiffObservation) {
    return payloadObservation("command_output", "diff", "high", input.toolFamily);
  }
  if (input.rawCommandTextObservation) {
    return payloadObservation(
      "command_output",
      input.rawCommandTextObservation.shape,
      input.rawCommandTextObservation.consequenceBaseline,
      input.toolFamily,
    );
  }
  if (input.rawReadObservationBaseline) {
    return payloadObservation(
      "read_output",
      input.rawReadSourceObservation
        ? "source"
        : input.rawReadListingObservation
          ? "listing"
          : "document",
      input.rawReadObservationBaseline,
      "read",
    );
  }
  if (input.readAbbreviatedFileViewObservation) {
    return payloadObservation(
      "read_output",
      "source",
      input.readAbbreviatedFileViewObservation.consequenceBaseline,
      "read",
    );
  }
  if (input.diagnosticStructuredToolOutput && input.structuredOutputObservation) {
    return payloadObservation(
      "structured_output",
      input.structuredOutputSourceObservation ? "source" : "tool",
      input.structuredOutputSourceObservation ? "high" : "medium",
      input.toolFamily,
    );
  }
  if (input.structuredOutputZeroExitSuccess) {
    return {
      kind: "execution_success",
      origin: "structured_output",
      subject: "tool",
      consequenceBaseline: "low",
      ...(input.toolFamily !== undefined ? { toolFamily: input.toolFamily } : {}),
    };
  }
  return null;
}

function transcriptObservation(
  transcript: ExplicitObservationTranscript,
  toolFamily?: string,
): TaskFailureObservation {
  return {
    kind: "payload",
    origin: "transcript",
    subject: readTranscriptObservationSubject(transcript.shape),
    consequenceBaseline: transcript.consequenceBaseline,
    ...(toolFamily !== undefined ? { toolFamily } : {}),
  };
}

function payloadObservation(
  origin: "command_output" | "read_output" | "structured_output",
  subject: TaskFailureObservation["subject"],
  consequenceBaseline: TaskFailureObservation["consequenceBaseline"],
  toolFamily?: string,
): TaskFailureObservation {
  return {
    kind: "payload",
    origin,
    subject,
    consequenceBaseline,
    ...(toolFamily !== undefined ? { toolFamily } : {}),
  };
}

function readTranscriptObservationSubject(
  shape: ExplicitObservationTranscript["shape"],
): TaskFailureObservation["subject"] {
  if (shape === "abbreviated_file_view") {
    return "source";
  }
  return shape === "concrete_test_result" || shape === "successful_test" ? "test" : "tool";
}
