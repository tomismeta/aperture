import type { TaskFailureSemanticSignals } from "./semantic-task-failure-signals.js";
import { looksLikeTerminalFailureEvidence } from "./semantic-terminal-evidence.js";
import { normalizeSemanticText } from "./semantic-text.js";
import { isSemanticCommandExecutionToolFamily } from "./semantic-tool-family.js";
export type TaskFailureDetail =
  | "outcome_only"
  | "diagnostic"
  | "indeterminate"
  | "absent_evidence"
  | "source_window_limit";
export type TaskFailureTerminalProfile = {
  failureDetail: TaskFailureDetail;
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
  const outcomeOnly = hasCompleteOutcomeOnlyNonzeroExit(input);
  const diagnostic =
    !input.signals.textFallbackSuppressed && hasTerminalDiagnosticEvidence(input, false);
  if (
    !input.signals.structuredOutputExitFailure &&
    !diagnostic &&
    !outcomeOnly &&
    !hasGenericTerminalFailureEvidence(input)
  )
    return null;
  const failureDetail = outcomeOnly
    ? "outcome_only"
    : !input.signals.textFallbackSuppressed && hasTerminalDiagnosticEvidence(input, true)
      ? "diagnostic"
      : "indeterminate";
  return {
    failureDetail,
    consequenceBaseline: failureDetail === "outcome_only" ? "medium" : "high",
  };
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
function hasTerminalDiagnosticEvidence(input: TerminalInput, includeReferences: boolean): boolean {
  const signals = input.signals;
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
    ) ||
    Boolean(
      signals.rawToolOutputFailureDiagnostic &&
      (includeReferences || !signals.commandDiagnosticReferenceObservationTranscript),
    ) ||
    (signals.structuredOutputEnvelope.kind === "raw" &&
      isSemanticCommandExecutionToolFamily(input.toolFamily) &&
      looksLikeTerminalFailureEvidence(normalizeSemanticText(input.summary ?? "")) &&
      !looksLikeBareNonzeroTerminalExitEvidence(input.summary ?? "") &&
      (includeReferences || !signals.commandDiagnosticReferenceObservationTranscript))
  );
}
function hasGenericTerminalFailureEvidence(input: TerminalProfileInput): boolean {
  const observation = input.signals.observationSyntax;
  return (
    !input.signals.textFallbackSuppressed &&
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
export function looksLikeBareNonzeroTerminalExitEvidence(value: string): boolean {
  return BARE_NONZERO_EXIT.test(value.toLowerCase().replace(/\W+/g, " ").trim());
}
function looksLikeOutcomeOnlyCommandOutput(output: string): boolean {
  const text = normalizeSemanticText(output).replace(/[.]+$/g, "").replace(/\s+/g, " ");
  return /^(?:no output|without output|no stdout no stderr|no stderr no stdout|empty stdout empty stderr|stdout empty stderr empty|no tests? found(?: exiting with code -?\d+)?|no test files(?: were)? found|no files matching .+ (?:were )?found|collected 0 items|found 0 tests?|0 tests? found)$/.test(
    text,
  );
}
const BARE_NONZERO_EXIT =
  /^(?:(?:no output|without output|no stdout no stderr|no stderr no stdout|empty stdout empty stderr|stdout empty stderr empty)\s+(?:(?:command|process|tool|subprocess)\s+)?(?:(?:exit|return)(?:ed)?\s+(?:with\s+)?(?:code|status)\s*(?:is|was)?\s*-?[1-9]\d*|(?:failed\s+with\s+)?(?:a\s+)?non[- ]?zero\s+exit)|(?:the )?(?:command|process|tool|subprocess)\s+(?:exit|return)(?:ed)?\s+(?:with\s+)?(?:code|status)\s*(?:is|was)?\s*-?[1-9]\d*\s+(?:no|without)\s+(?:(?:standard|error) output|stdout|stderr|diagnostic (?:text|output))(?:\s*(?:and|or)?\s*(?:(?:standard|error) output|stdout|stderr|diagnostic (?:text|output))){1,3}\s+(?:(?:was|were)\s+)?(?:retained|captured|available|produced))$/i;
