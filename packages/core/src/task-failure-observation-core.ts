import type { ObservationSemantics } from "./observation-semantics.js";
import type { SourceEvidence } from "./events.js";
import type { TaskFailureDetail, TaskFailureEvidenceKind } from "./semantic-evidence.js";

export type TaskFailureObservationSyntax = Omit<
  ObservationSemantics,
  "evidenceCertainty" | "ownership" | "provenance"
> & {
  origin: ObservationSemantics["provenance"]["origin"];
  owner?: ObservationSemantics["ownership"]["owner"];
  evidenceCertainty?: ObservationSemantics["evidenceCertainty"];
  completeBoundary?: true;
  toolFamily?: string;
};
type ObservationSyntaxDetails = Partial<
  Pick<TaskFailureObservationSyntax, "diagnosticClass" | "evidenceLoss" | "recoveryHint">
> & { completeBoundary?: true };
type SourceEvidenceChannel = Exclude<SourceEvidence, { kind: "authorization" }>["channel"];

export function createTaskFailureObservationSyntax(
  kind: ObservationSemantics["kind"],
  polarity: ObservationSemantics["polarity"],
  origin: ObservationSemantics["provenance"]["origin"],
  subject: ObservationSemantics["subject"],
  consequenceBaseline: ObservationSemantics["consequenceBaseline"],
  toolFamily?: string,
  details: ObservationSyntaxDetails = {},
): TaskFailureObservationSyntax {
  return {
    kind,
    polarity,
    origin,
    subject,
    evidenceLoss: "none",
    consequenceBaseline,
    ...(toolFamily !== undefined ? { toolFamily } : {}),
    ...details,
  };
}

export function compileSourceEvidenceSyntax(evidence: SourceEvidence, toolFamily?: string) {
  const syntax = createTaskFailureObservationSyntax;
  if (evidence.kind === "authorization")
    return syntax("control", "neutral", "status_text", "tool", "low", toolFamily, {
      recoveryHint: "await_authorization",
    });
  const origin = sourceEvidenceOrigin(evidence.channel);
  if (evidence.kind === "payload") {
    const consequence =
      evidence.channel === "structured" || evidence.subject === "tool" ? "high" : "low";
    return syntax("payload", "neutral", origin, evidence.subject, consequence, toolFamily);
  }
  if (evidence.kind === "outcome") {
    const consequence = evidence.outcome === "success" ? "low" : "medium";
    return syntax("outcome", evidence.outcome, origin, evidence.subject, consequence, toolFamily);
  }
  const sourceLimit = evidence.diagnostic === "source_limit";
  const subject = "subject" in evidence ? evidence.subject : "source";
  const consequence = evidence.diagnostic === "runtime" ? "high" : "medium";
  const details = {
    diagnosticClass: evidence.diagnostic,
    evidenceLoss: sourceLimit ? "partial" : "none",
    recoveryHint: sourceLimit ? "narrow_evidence_scope" : "inspect_diagnostic",
  } as const;
  return syntax("diagnostic", "failure", origin, subject, consequence, toolFamily, details);
}

function sourceEvidenceOrigin(channel: SourceEvidenceChannel) {
  if (channel === "search") return "transcript";
  return (
    channel === "transcript" ? channel : `${channel}_output`
  ) as TaskFailureObservationSyntax["origin"];
}

type ObservationEvidenceLoss = ObservationSemantics["evidenceLoss"];

type ClassifiedInput = {
  kind: TaskFailureEvidenceKind;
  failureDetail?: TaskFailureDetail;
  toolFamily?: string;
  observationSyntax?: TaskFailureObservationSyntax;
  readsAsObservation: boolean;
  consequenceBaseline: ObservationSemantics["consequenceBaseline"];
};
type TaskFailureObservationInput = ClassifiedInput | { syntax: TaskFailureObservationSyntax };
type ObservationSyntaxCompiler = (input: ClassifiedInput) => TaskFailureObservationSyntax;

const EVIDENCE_LOSS_BY_DETAIL: Partial<Record<TaskFailureDetail, ObservationEvidenceLoss>> = {
  absent_evidence: "absent",
  source_window_limit: "partial",
  indeterminate: "unknown",
};
const TASK_FAILURE_OBSERVATION_SYNTAX = {
  routine_bash_success_observation: s("outcome", "success"),
  structured_execution_success_observation: s("outcome", "success"),
  operation_success_observation: s("outcome", "success"),
  structured_tool_output_observation: s("payload", "neutral"),
  empty_failure_payload: s("outcome", "failure", "absent_evidence"),
  observational_payload: s("payload", "neutral"),
  routine_search_output: s("payload", "neutral"),
  expected_diagnostic_failure: s("diagnostic", "failure"),
  terminal_failure: compileTerminalFailureSyntax,
  rejected_tool_use_observation: s("control", "neutral"),
  unclassified_failure: s("unknown", "failure", "indeterminate"),
} satisfies Record<TaskFailureEvidenceKind, ObservationSyntaxCompiler>;

export function projectTaskFailureObservationCore(input: TaskFailureObservationInput) {
  const syntax =
    "syntax" in input
      ? input.syntax
      : input.observationSyntax !== undefined
        ? input.observationSyntax
        : TASK_FAILURE_OBSERVATION_SYNTAX[input.kind](input);
  return observationFromSyntax(syntax);
}

function observationFromSyntax(syntax: TaskFailureObservationSyntax) {
  return {
    kind: syntax.kind,
    polarity: syntax.polarity,
    ownership: {
      owner:
        syntax.owner ??
        (syntax.kind === "control" || syntax.toolFamily !== undefined ? "tool" : "source"),
      ...(syntax.toolFamily !== undefined ? { capabilityFamily: syntax.toolFamily } : {}),
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

function compileTerminalFailureSyntax(input: ClassifiedInput) {
  if (input.failureDetail === "source_window_limit" || input.failureDetail === "diagnostic")
    return compileSyntax(input, "diagnostic", "failure");
  if (input.failureDetail === "outcome_only") return compileSyntax(input, "outcome", "failure");
  return compileSyntax(input, "unknown", "failure", "indeterminate");
}

function s(
  kind: ObservationSemantics["kind"],
  polarity: ObservationSemantics["polarity"],
  fallbackDetail?: TaskFailureDetail,
) {
  return (input: ClassifiedInput) => compileSyntax(input, kind, polarity, fallbackDetail);
}

function compileSyntax(
  input: ClassifiedInput,
  kind: ObservationSemantics["kind"],
  polarity: ObservationSemantics["polarity"],
  fallbackDetail?: TaskFailureDetail,
) {
  const failureDetail = fallbackDetail ?? input.failureDetail;
  const evidenceLoss = EVIDENCE_LOSS_BY_DETAIL[failureDetail ?? "outcome_only"] ?? "none";
  let diagnosticClass: TaskFailureObservationSyntax["diagnosticClass"];
  if (input.kind === "expected_diagnostic_failure") diagnosticClass = "expected";
  else if (kind === "diagnostic") {
    diagnosticClass = failureDetail === "source_window_limit" ? "source_limit" : "runtime";
  }
  const recoveryHint =
    input.kind === "rejected_tool_use_observation"
      ? "await_authorization"
      : readRecoveryHint(evidenceLoss, diagnosticClass);
  return {
    kind,
    polarity,
    origin: "semantic_evidence",
    owner: input.toolFamily !== undefined ? "tool" : input.readsAsObservation ? "source" : "engine",
    subject: readSubject(input, failureDetail),
    evidenceLoss,
    consequenceBaseline: input.consequenceBaseline,
    evidenceCertainty: failureDetail === "indeterminate" ? "indeterminate" : "determinate",
    ...(input.toolFamily !== undefined ? { toolFamily: input.toolFamily } : {}),
    ...(diagnosticClass !== undefined ? { diagnosticClass } : {}),
    ...(recoveryHint !== null ? { recoveryHint } : {}),
  } satisfies TaskFailureObservationSyntax;
}

function readSubject(input: ClassifiedInput, failureDetail: TaskFailureDetail | undefined) {
  if (
    input.kind === "routine_bash_success_observation" ||
    input.kind === "structured_execution_success_observation"
  )
    return "command";
  if (input.kind === "routine_search_output") return "search";
  if (failureDetail === "source_window_limit") return "source";
  return input.toolFamily !== undefined ? "tool" : "unknown";
}

function readRecoveryHint(
  evidenceLoss: ObservationEvidenceLoss,
  diagnosticClass: TaskFailureObservationSyntax["diagnosticClass"],
) {
  if (evidenceLoss === "absent") return "request_evidence";
  if (evidenceLoss === "partial") return "narrow_evidence_scope";
  if (evidenceLoss === "unknown") return "inspect_original_evidence";
  return diagnosticClass !== undefined ? "inspect_diagnostic" : null;
}
