import type { ObservationSemantics } from "./observation-semantics.js";
import type { TaskFailureDetail, TaskFailureEvidenceKind } from "./semantic-evidence.js";
import type { TaskFailureObservationSyntax } from "./task-failure-observation-grammar.js";

type ObservationDiagnosticClass = NonNullable<ObservationSemantics["diagnosticClass"]>;
type ObservationEvidenceLoss = ObservationSemantics["evidenceLoss"];
type ObservationRecoveryHint = NonNullable<ObservationSemantics["recoveryHint"]>;

type ClassifiedInput = {
  kind: TaskFailureEvidenceKind;
  failureDetail?: TaskFailureDetail;
  toolFamily?: string;
  observationSyntax?: TaskFailureObservationSyntax;
  readsAsObservation: boolean;
  consequenceBaseline: ObservationSemantics["consequenceBaseline"];
};
export type TaskFailureObservationInput =
  | ClassifiedInput
  | { syntax: TaskFailureObservationSyntax };

export type TaskFailureObservationExtractorId =
  | "command_success"
  | "empty_payload"
  | "expected_diagnostic"
  | "operation_success"
  | "payload"
  | "read_truncated_source"
  | "rejected_tool_use"
  | "search_output"
  | "structured_execution_success"
  | "structured_output"
  | "terminal_diagnostic"
  | "terminal_outcome"
  | "unknown_failure";

type ObservationSyntaxCompiler = (input: ClassifiedInput) => ReturnType<typeof compileSyntax>;

const EVIDENCE_LOSS_BY_DETAIL: Partial<Record<TaskFailureDetail, ObservationEvidenceLoss>> = {
  absent_evidence: "absent",
  source_window_limit: "partial",
  indeterminate: "unknown",
};
const RECOVERY_HINT_BY_EVIDENCE_LOSS: Record<string, ObservationRecoveryHint> = {
  absent: "request_evidence",
  partial: "narrow_evidence_scope",
  unknown: "inspect_original_evidence",
};

const TASK_FAILURE_OBSERVATION_SYNTAX = {
  routine_bash_success_observation: s("command_success", "outcome", "success"),
  structured_execution_success_observation: s("structured_execution_success", "outcome", "success"),
  operation_success_observation: s("operation_success", "outcome", "success"),
  structured_tool_output_observation: s("structured_output", "payload", "neutral"),
  empty_failure_payload: s("empty_payload", "outcome", "failure", "absent_evidence"),
  observational_payload: s("payload", "payload", "neutral"),
  routine_search_output: s("search_output", "payload", "neutral"),
  expected_diagnostic_failure: s("expected_diagnostic", "diagnostic", "failure"),
  terminal_failure: compileTerminalFailureSyntax,
  rejected_tool_use_observation: s("rejected_tool_use", "control", "neutral"),
  unclassified_failure: s("unknown_failure", "unknown", "failure", "indeterminate"),
} satisfies Record<TaskFailureEvidenceKind, ObservationSyntaxCompiler>;

export function extractTaskFailureObservationCore(input: TaskFailureObservationInput) {
  const compiled =
    "syntax" in input
      ? {
          observationExtractorId: readSyntaxExtractorId(input.syntax),
          observationSyntax: input.syntax,
        }
      : input.observationSyntax !== undefined
        ? {
            observationExtractorId: readSyntaxExtractorId(input.observationSyntax),
            observationSyntax: input.observationSyntax,
          }
        : TASK_FAILURE_OBSERVATION_SYNTAX[input.kind](input);
  return {
    observationExtractorId: compiled.observationExtractorId,
    observationSemantics: observationFromSyntax(compiled.observationSyntax),
  };
}

export function readTaskFailureObservationCore(input: TaskFailureObservationInput) {
  return extractTaskFailureObservationCore(input).observationSemantics;
}

function observationFromSyntax(syntax: TaskFailureObservationSyntax) {
  const toolFamily = syntax.toolFamily;
  return {
    kind: syntax.kind,
    polarity: syntax.polarity,
    ownership: {
      owner:
        syntax.owner ??
        (syntax.kind === "control" ? "tool" : toolFamily === undefined ? "source" : "tool"),
      ...(toolFamily !== undefined ? { toolFamily } : {}),
    },
    subject: syntax.subject,
    evidenceLoss: syntax.evidenceLoss,
    provenance: { origin: syntax.origin },
    consequenceBaseline: syntax.consequenceBaseline,
    evidenceCertainty: syntax.evidenceCertainty ?? "determinate",
    ...(syntax.diagnosticClass === undefined ? {} : { diagnosticClass: syntax.diagnosticClass }),
    ...(syntax.recoveryHint === undefined ? {} : { recoveryHint: syntax.recoveryHint }),
  } satisfies ObservationSemantics;
}

function readSyntaxExtractorId(syntax: TaskFailureObservationSyntax) {
  if (syntax.kind === "control") return "rejected_tool_use";
  if (syntax.kind === "diagnostic") {
    if (syntax.diagnosticClass === "source_limit") return "read_truncated_source";
    return syntax.diagnosticClass === "expected" ? "expected_diagnostic" : "terminal_diagnostic";
  }
  if (syntax.kind === "outcome") {
    return syntax.polarity === "failure" ? "terminal_outcome" : "structured_execution_success";
  }
  return syntax.origin === "structured_output" ? "structured_output" : "payload";
}

function compileTerminalFailureSyntax(input: ClassifiedInput) {
  if (input.failureDetail === "source_window_limit")
    return compileSyntax(input, "read_truncated_source", "diagnostic", "failure");
  if (input.failureDetail === "diagnostic")
    return compileSyntax(input, "terminal_diagnostic", "diagnostic", "failure");
  if (input.failureDetail === "outcome_only")
    return compileSyntax(input, "terminal_outcome", "outcome", "failure");
  return compileSyntax(input, "unknown_failure", "unknown", "failure", "indeterminate");
}

function s(
  observationExtractorId: TaskFailureObservationExtractorId,
  kind: ObservationSemantics["kind"],
  polarity: ObservationSemantics["polarity"],
  fallbackDetail?: TaskFailureDetail,
): ObservationSyntaxCompiler {
  return (input: ClassifiedInput) =>
    compileSyntax(input, observationExtractorId, kind, polarity, fallbackDetail);
}

function compileSyntax(
  input: ClassifiedInput,
  observationExtractorId: TaskFailureObservationExtractorId,
  kind: ObservationSemantics["kind"],
  polarity: ObservationSemantics["polarity"],
  fallbackDetail?: TaskFailureDetail,
) {
  const failureDetail = fallbackDetail ?? input.failureDetail;
  const evidenceLoss = EVIDENCE_LOSS_BY_DETAIL[failureDetail ?? "outcome_only"] ?? "none";
  let diagnosticClass: ObservationDiagnosticClass | null = null;
  if (input.kind === "expected_diagnostic_failure") diagnosticClass = "expected";
  else if (kind === "diagnostic") {
    diagnosticClass = failureDetail === "source_window_limit" ? "source_limit" : "runtime";
  }
  const recoveryHint =
    input.kind === "rejected_tool_use_observation"
      ? "await_authorization"
      : readRecoveryHint(evidenceLoss, diagnosticClass);
  const observationSyntax: TaskFailureObservationSyntax = {
    kind,
    polarity,
    origin: "semantic_evidence",
    owner: readOwner(input),
    subject: readSubject(input, observationExtractorId, failureDetail),
    evidenceLoss,
    consequenceBaseline: input.consequenceBaseline,
    evidenceCertainty: failureDetail === "indeterminate" ? "indeterminate" : "determinate",
    ...(input.toolFamily !== undefined ? { toolFamily: input.toolFamily } : {}),
    ...(diagnosticClass !== null ? { diagnosticClass } : {}),
    ...(recoveryHint !== null ? { recoveryHint } : {}),
  };
  return { observationExtractorId, observationSyntax };
}

function readOwner(input: ClassifiedInput) {
  if (input.toolFamily !== undefined) return "tool";
  if (input.readsAsObservation) return "source";
  return input.kind === "unclassified_failure" ? "unknown" : "engine";
}

function readSubject(
  input: ClassifiedInput,
  id: TaskFailureObservationExtractorId,
  failureDetail: TaskFailureDetail | undefined,
) {
  if (id === "command_success" || id === "structured_execution_success") return "command";
  if (id === "search_output" || input.toolFamily === "search") return "search";
  if (failureDetail === "source_window_limit") return "source";
  return input.toolFamily !== undefined ? "tool" : "unknown";
}

function readRecoveryHint(
  evidenceLoss: ObservationEvidenceLoss,
  diagnosticClass: ObservationDiagnosticClass | null,
) {
  return (
    RECOVERY_HINT_BY_EVIDENCE_LOSS[evidenceLoss] ??
    (diagnosticClass !== null ? "inspect_diagnostic" : null)
  );
}
