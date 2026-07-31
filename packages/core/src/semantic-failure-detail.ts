import type { TaskFailureSemanticSignals } from "./semantic-task-failure-signals.js";
import {
  looksLikeBareNonzeroTerminalExitEvidence,
  looksLikeTerminalFailureEvidence,
} from "./semantic-terminal-evidence.js";
import { normalizeSemanticText } from "./semantic-text.js";
import { isSemanticCommandExecutionToolFamily } from "./semantic-tool-family.js";

export type TaskFailureDetail = "outcome_only" | "diagnostic" | "indeterminate";
export type TaskFailureTerminalShape = "bare_nonzero_exit";

export function readTerminalFailureDetail(input: {
  summary: string | undefined;
  signals: TaskFailureSemanticSignals;
  toolFamily: string | undefined;
}): TaskFailureDetail {
  if (hasCompleteOutcomeOnlyNonzeroExit(input)) {
    return "outcome_only";
  }

  if (hasSubstantiveTerminalDiagnostic(input)) {
    return "diagnostic";
  }

  return "indeterminate";
}

function hasCompleteOutcomeOnlyNonzeroExit(input: {
  summary: string | undefined;
  signals: TaskFailureSemanticSignals;
  toolFamily: string | undefined;
}): boolean {
  if (
    isSemanticCommandExecutionToolFamily(input.toolFamily) &&
    looksLikeBareNonzeroTerminalExitEvidence(input.summary ?? "")
  ) {
    return true;
  }

  return (
    input.signals.structuredOutputEnvelope.kind === "valid" &&
    input.signals.diagnosticStructuredToolOutput?.exitCode !== undefined &&
    input.signals.diagnosticStructuredToolOutput.exitCode !== 0 &&
    looksLikeOutcomeOnlyCommandOutput(input.signals.diagnosticStructuredToolOutput.output)
  );
}

function hasSubstantiveTerminalDiagnostic(input: {
  summary: string | undefined;
  signals: TaskFailureSemanticSignals;
  toolFamily: string | undefined;
}): boolean {
  const signals = input.signals;
  return (
    signals.strongSourceRuntimeDiagnostic ||
    signals.structuredOutputFailureDiagnostic ||
    signals.editOutputOutcome === "failure" ||
    signals.searchFailureDiagnostic ||
    signals.readFailureDiagnostic ||
    signals.diagnosticObservationTranscript ||
    signals.commandActualDiagnosticObservationTranscript ||
    (signals.commandDiagnosticObservationTranscript &&
      !signals.commandDiagnosticReferenceObservationTranscript) ||
    signals.rawToolOutputFailureDiagnostic ||
    (signals.structuredOutputEnvelope.kind === "raw" &&
      isSemanticCommandExecutionToolFamily(input.toolFamily) &&
      looksLikeTerminalFailureEvidence(normalizeSemanticText(input.summary ?? "")) &&
      !looksLikeBareNonzeroTerminalExitEvidence(input.summary ?? ""))
  );
}

function looksLikeOutcomeOnlyCommandOutput(output: string): boolean {
  const text = normalizeSemanticText(output).replace(/[.]+$/g, "").replace(/\s+/g, " ");
  return /^(?:no output|without output|no stdout no stderr|no stderr no stdout|empty stdout empty stderr|stdout empty stderr empty)$/.test(
    text,
  );
}

export function readTerminalFailureShape(input: {
  summary: string | undefined;
  toolFamily: string | undefined;
}): TaskFailureTerminalShape | null {
  if (
    isSemanticCommandExecutionToolFamily(input.toolFamily) &&
    looksLikeBareNonzeroTerminalExitEvidence(input.summary ?? "")
  ) {
    return "bare_nonzero_exit";
  }

  return null;
}
