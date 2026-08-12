import type {
  ObservationKernelFields,
  ObservationKernelJudgmentFields,
} from "./observation-kernel-scorecard.js";
import { OBSERVATION_KERNEL_HOLDOUT_EXPECTATIONS } from "./observation-kernel-holdout.js";

export type ObservationKernelExpectedFields = Omit<
  ObservationKernelFields,
  "observationExtractorId"
>;

export type ObservationKernelExpectedDecision = {
  plannerKind: "activate" | "ambient" | "auto_approve" | "clear" | "queue" | "suppressed";
  resultLane: "ambient" | "next" | "none" | "now";
};

export type ObservationKernelExpectedOutcome = {
  fields: ObservationKernelExpectedFields;
  judgment: ObservationKernelJudgmentFields;
  decision: ObservationKernelExpectedDecision;
};

const OBSERVATION_KERNEL_CALIBRATION_EXPECTATIONS: Readonly<
  Record<string, readonly ObservationKernelExpectedOutcome[]>
> = {
  "abbreviated-read-view": [
    expected(
      fields("payload", "neutral", "tool", "read", "source", "none", "qualified", {
        origin: "read_output",
        baseline: "low",
      }),
      stable("payload_observation", "low"),
      decision("ambient", "ambient"),
    ),
  ],
  "ambiguous-terminal-output": [
    expected(
      fields("unknown", "failure", "engine", null, "unknown", "unknown", "weak", {
        agreement: "uncertain",
        origin: "semantic_evidence",
        authority: "explicit",
        recoveryHint: "inspect_original_evidence",
        baseline: "high",
      }),
      {
        statusEvidence: "weak_or_uncertain",
        statusConflictKind: null,
        recoveryPosture: "original_evidence_required",
        baselineConsequence: "high",
        outcomeOnlyFailureStatus: false,
        limitedFailureStatus: false,
        stableStatusEvidence: false,
        visibleDiagnosticFailure: false,
      },
      decision("activate", "now"),
    ),
  ],
  "bare-nonzero-command-exit": [
    expected(
      fields("outcome", "failure", "tool", "bash", "tool", "none", "strong", {
        origin: "semantic_evidence",
        authority: "explicit",
        baseline: "medium",
      }),
      {
        statusEvidence: "limited_failure",
        statusConflictKind: null,
        recoveryPosture: "none",
        baselineConsequence: "medium",
        outcomeOnlyFailureStatus: true,
        limitedFailureStatus: true,
        stableStatusEvidence: true,
        visibleDiagnosticFailure: false,
      },
      decision("queue", "now"),
    ),
  ],
  "command-test-progress": [
    expected(
      fields("payload", "neutral", "tool", "bash", "document", "none", "qualified", {
        origin: "transcript",
        baseline: "low",
      }),
      stable("payload_observation", "low"),
      decision("ambient", "ambient"),
    ),
  ],
  "edit-applied-readback": [
    expected(
      fields("payload", "neutral", "tool", "edit", "tool", "none", "qualified", {
        origin: "semantic_evidence",
        baseline: "high",
      }),
      stable("payload_observation", "high"),
      decision("activate", "now"),
    ),
  ],
  "empty-edit-payload": [
    expected(
      fields("outcome", "failure", "tool", "edit", "tool", "absent", "weak", {
        origin: "semantic_evidence",
        authority: "explicit",
        recoveryHint: "request_evidence",
        baseline: "medium",
      }),
      {
        statusEvidence: "limited_failure",
        statusConflictKind: null,
        recoveryPosture: "evidence_required",
        baselineConsequence: "medium",
        outcomeOnlyFailureStatus: false,
        limitedFailureStatus: true,
        stableStatusEvidence: false,
        visibleDiagnosticFailure: false,
      },
      decision("queue", "now"),
    ),
  ],
  "expected-diagnostic-output": [
    expected(
      fields("diagnostic", "failure", "tool", "bash", "tool", "none", "strong", {
        origin: "semantic_evidence",
        authority: "explicit",
        diagnosticClass: "expected",
        recoveryHint: "inspect_diagnostic",
        baseline: "medium",
      }),
      {
        statusEvidence: "stable_observation",
        statusConflictKind: null,
        recoveryPosture: "diagnostic_inspection",
        baselineConsequence: "medium",
        outcomeOnlyFailureStatus: false,
        limitedFailureStatus: false,
        stableStatusEvidence: true,
        visibleDiagnosticFailure: false,
      },
      decision("activate", "now"),
    ),
  ],
  "explicit-tool-family-authority": [
    expected(
      fields("outcome", "success", "tool", "exec_command", "command", "none", "qualified", {
        origin: "semantic_evidence",
        baseline: "low",
      }),
      stable("command_success_observation", "low"),
      decision("ambient", "ambient"),
    ),
    expected(
      fields("outcome", "success", "tool", "custom_runner", "tool", "none", "qualified", {
        origin: "structured_output",
        baseline: "low",
      }),
      stable("execution_success_observation", "low"),
      decision("ambient", "ambient"),
    ),
  ],
  "file-created-observation": [
    expected(
      fields("outcome", "success", "source", null, "unknown", "none", "qualified", {
        origin: "semantic_evidence",
        baseline: "low",
      }),
      stable("payload_observation", "low"),
      decision("ambient", "ambient"),
    ),
  ],
  "host-neutral-command-success-title": [
    expected(
      fields("outcome", "success", "tool", "exec_command", "command", "none", "qualified", {
        origin: "semantic_evidence",
        baseline: "low",
      }),
      stable("command_success_observation", "low"),
      decision("ambient", "ambient"),
    ),
  ],
  "read-source-window-limit": [
    expected(
      fields("diagnostic", "failure", "tool", "read", "source", "partial", "strong", {
        origin: "read_output",
        authority: "explicit",
        diagnosticClass: "source_limit",
        recoveryHint: "narrow_evidence_scope",
        baseline: "medium",
      }),
      {
        statusEvidence: "limited_failure",
        statusConflictKind: null,
        recoveryPosture: "evidence_scope_required",
        baselineConsequence: "medium",
        outcomeOnlyFailureStatus: false,
        limitedFailureStatus: true,
        stableStatusEvidence: true,
        visibleDiagnosticFailure: false,
      },
      decision("queue", "now"),
    ),
  ],
  "rejected-tool-use": [
    expected(
      fields("control", "neutral", "tool", "bash", "tool", "none", "qualified", {
        origin: "status_text",
        recoveryHint: "await_authorization",
        baseline: "low",
      }),
      {
        ...stable("rejected_tool_use_observation", "low"),
        recoveryPosture: "authorization_required",
      },
      decision("ambient", "ambient"),
    ),
  ],
  "runtime-traceback": [
    expected(
      fields("diagnostic", "failure", "tool", "bash", "tool", "none", "strong", {
        origin: "semantic_evidence",
        authority: "explicit",
        diagnosticClass: "runtime",
        recoveryHint: "inspect_diagnostic",
        baseline: "high",
      }),
      {
        statusEvidence: "visible_diagnostic_failure",
        statusConflictKind: null,
        recoveryPosture: "diagnostic_inspection",
        baselineConsequence: "high",
        outcomeOnlyFailureStatus: false,
        limitedFailureStatus: false,
        stableStatusEvidence: true,
        visibleDiagnosticFailure: true,
      },
      decision("activate", "now"),
    ),
  ],
  "search-result-output": [
    expected(
      fields("payload", "neutral", "tool", "search", "search", "none", "qualified", {
        origin: "semantic_evidence",
        baseline: "low",
      }),
      stable("search_output_observation", "low"),
      decision("ambient", "ambient"),
    ),
  ],
  "source-limit-recovery-flow": [
    expected(
      fields("diagnostic", "failure", "tool", "read", "source", "partial", "qualified", {
        origin: "read_output",
        authority: "hinted",
        diagnosticClass: "source_limit",
        recoveryHint: "narrow_evidence_scope",
        baseline: "medium",
      }),
      {
        statusEvidence: "limited_failure",
        statusConflictKind: null,
        recoveryPosture: "evidence_scope_required",
        baselineConsequence: "medium",
        outcomeOnlyFailureStatus: false,
        limitedFailureStatus: true,
        stableStatusEvidence: true,
        visibleDiagnosticFailure: false,
      },
      decision("queue", "now"),
    ),
    expected(
      fields("payload", "neutral", "tool", "read", "source", "none", "qualified", {
        origin: "read_output",
        baseline: "high",
      }),
      stable("payload_observation", "high"),
      decision("activate", "now"),
    ),
  ],
  "structured-output-source-readback": [
    expected(
      fields("payload", "neutral", "tool", "bash", "source", "none", "qualified", {
        origin: "structured_output",
        baseline: "high",
      }),
      stable("structured_output_observation", "high"),
      decision("activate", "now"),
    ),
  ],
};

function fields(
  kind: ObservationKernelExpectedFields["kind"],
  polarity: ObservationKernelExpectedFields["polarity"],
  owner: ObservationKernelExpectedFields["owner"],
  toolFamily: string | null,
  subject: ObservationKernelExpectedFields["subject"],
  evidenceLoss: ObservationKernelExpectedFields["evidenceLoss"],
  evidenceStrength: ObservationKernelExpectedFields["evidenceStrength"],
  options: {
    agreement?: ObservationKernelExpectedFields["semanticAgreement"];
    diagnosticClass?: string;
    recoveryHint?: string;
    origin: ObservationKernelExpectedFields["provenanceOrigin"];
    authority?: ObservationKernelExpectedFields["provenanceAuthority"];
    baseline: ObservationKernelExpectedFields["consequenceBaseline"];
  },
): ObservationKernelExpectedFields {
  return {
    kind,
    polarity,
    owner,
    toolFamily,
    subject,
    evidenceLoss,
    evidenceStrength,
    semanticAgreement: options.agreement ?? "stable",
    diagnosticClass: options.diagnosticClass ?? null,
    recoveryHint: options.recoveryHint ?? null,
    provenanceOrigin: options.origin,
    provenanceAuthority: options.authority ?? "inferred",
    consequenceBaseline: options.baseline,
  };
}

function stable(
  statusConflictKind: string,
  baselineConsequence: ObservationKernelJudgmentFields["baselineConsequence"],
): ObservationKernelJudgmentFields {
  return {
    statusEvidence: "stable_observation",
    statusConflictKind,
    recoveryPosture: "none",
    baselineConsequence,
    outcomeOnlyFailureStatus: false,
    limitedFailureStatus: false,
    stableStatusEvidence: true,
    visibleDiagnosticFailure: false,
  };
}

function decision(
  plannerKind: ObservationKernelExpectedDecision["plannerKind"],
  resultLane: ObservationKernelExpectedDecision["resultLane"],
): ObservationKernelExpectedDecision {
  return { plannerKind, resultLane };
}

function expected(
  expectedFields: ObservationKernelExpectedFields,
  judgment: ObservationKernelJudgmentFields,
  expectedDecision: ObservationKernelExpectedDecision,
): ObservationKernelExpectedOutcome {
  return { fields: expectedFields, judgment, decision: expectedDecision };
}

export const OBSERVATION_KERNEL_EXPECTATIONS: Readonly<
  Record<string, readonly ObservationKernelExpectedOutcome[]>
> = {
  ...OBSERVATION_KERNEL_CALIBRATION_EXPECTATIONS,
  ...OBSERVATION_KERNEL_HOLDOUT_EXPECTATIONS,
};
