import type { TaskFailureSemanticSignals } from "./semantic-task-failure-signals.js";
import {
  looksLikeBareNonzeroTerminalExitEvidence,
  looksLikeTerminalFailureEvidence,
} from "./semantic-terminal-evidence.js";
import { normalizeSemanticText } from "./semantic-text.js";
import { isSemanticCommandExecutionToolFamily } from "./semantic-tool-family.js";

export type TaskFailureDetail =
  | "outcome_only"
  | "diagnostic"
  | "indeterminate"
  | "absent_evidence"
  | "source_window_limit";
export type TaskFailureTerminalShape = "bare_nonzero_exit";
export type TaskFailureTerminalProfile = {
  failureDetail: TaskFailureDetail;
  terminalShape?: TaskFailureTerminalShape;
  consequenceBaseline: "medium" | "high";
};
type TerminalInput = {
  summary: string | undefined;
  signals: TaskFailureSemanticSignals;
  toolFamily: string | undefined;
};
type TerminalProfileInput = TerminalInput & {
  searchResultText: boolean;
  terminalFailureText: boolean;
};
export function readTaskFailureTerminalProfile(
  input: TerminalProfileInput,
): TaskFailureTerminalProfile | null {
  if (!hasTerminalFailureEvidence(input)) return null;
  const failureDetail = readTerminalFailureDetail(input);
  return {
    failureDetail,
    ...(isBareNonzeroTerminalExit(input) ? { terminalShape: "bare_nonzero_exit" as const } : {}),
    consequenceBaseline:
      failureDetail === "outcome_only" || failureDetail === "source_window_limit"
        ? "medium"
        : "high",
  };
}

function readTerminalFailureDetail(input: TerminalInput): TaskFailureDetail {
  if (hasCompleteOutcomeOnlyNonzeroExit(input)) return "outcome_only";
  if (input.signals.sourceWindowLimitFailure) return "source_window_limit";
  const signals = input.signals;
  return hasSharedTerminalDiagnosticSignals(signals) ||
    signals.rawToolOutputFailureDiagnostic ||
    (signals.structuredOutputEnvelope.kind === "raw" &&
      isSemanticCommandExecutionToolFamily(input.toolFamily) &&
      looksLikeTerminalFailureEvidence(normalizeSemanticText(input.summary ?? "")) &&
      !looksLikeBareNonzeroTerminalExitEvidence(input.summary ?? ""))
    ? "diagnostic"
    : "indeterminate";
}
function hasCompleteOutcomeOnlyNonzeroExit(input: TerminalInput): boolean {
  const output = input.signals.diagnosticStructuredToolOutput;
  return (
    isBareNonzeroTerminalExit(input) ||
    (isSemanticCommandExecutionToolFamily(input.toolFamily) &&
      looksLikeOutcomeOnlyCommandOutput(input.summary ?? "")) ||
    (input.signals.structuredOutputEnvelope.kind === "valid" &&
      output?.exitCode !== undefined &&
      output.exitCode !== 0 &&
      looksLikeOutcomeOnlyCommandOutput(output.output))
  );
}
function hasSharedTerminalDiagnosticSignals(signals: TaskFailureSemanticSignals): boolean {
  return (
    signals.strongSourceRuntimeDiagnostic ||
    signals.structuredOutputFailureDiagnostic ||
    signals.editOutputOutcome === "failure" ||
    signals.searchFailureDiagnostic ||
    signals.readFailureDiagnostic ||
    signals.diagnosticObservationTranscript ||
    signals.commandActualDiagnosticObservationTranscript ||
    Boolean(
      signals.commandDiagnosticObservationTranscript &&
      !signals.commandDiagnosticReferenceObservationTranscript,
    )
  );
}
function hasTerminalFailureEvidence(input: TerminalProfileInput): boolean {
  const signals = input.signals;
  return (
    signals.structuredOutputExitFailure ||
    hasSharedTerminalDiagnosticSignals(signals) ||
    Boolean(
      signals.rawToolOutputFailureDiagnostic &&
      !signals.commandDiagnosticReferenceObservationTranscript,
    ) ||
    hasCompleteOutcomeOnlyNonzeroExit(input) ||
    hasGenericTerminalFailureEvidence(input)
  );
}
function hasGenericTerminalFailureEvidence(input: TerminalProfileInput): boolean {
  const observation = input.signals.observationSyntax;
  return (
    input.terminalFailureText &&
    !input.signals.commandDiagnosticReferenceObservationTranscript &&
    !(observation?.origin === "transcript" && observation.toolFamily === undefined) &&
    !(input.toolFamily === "search" && input.searchResultText) &&
    (!(
      observation?.kind === "payload" &&
      (observation.origin === "read_output" || observation.origin === "structured_output")
    ) ||
      input.signals.strongSourceRuntimeDiagnostic)
  );
}
function isBareNonzeroTerminalExit(input: TerminalInput): boolean {
  return (
    isSemanticCommandExecutionToolFamily(input.toolFamily) &&
    looksLikeBareNonzeroTerminalExitEvidence(input.summary ?? "")
  );
}
function looksLikeOutcomeOnlyCommandOutput(output: string): boolean {
  const text = normalizeSemanticText(output).replace(/[.]+$/g, "").replace(/\s+/g, " ");
  return /^(?:no output|without output|no stdout no stderr|no stderr no stdout|empty stdout empty stderr|stdout empty stderr empty|no tests? found(?: exiting with code -?\d+)?|no test files(?: were)? found|no files matching .+ (?:were )?found|collected 0 items|found 0 tests?|0 tests? found)$/.test(
    text,
  );
}
