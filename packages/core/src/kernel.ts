import type { EnrichedApertureEvent } from "./events.js";
import { EventEvaluator } from "./event-evaluator.js";
import type { AttentionJudgmentInput } from "./judgment-input-types.js";
import { projectObservationJudgmentContract } from "./judgment-observation-contract.js";
import { normalizeSourceEvent } from "./semantic-normalizer.js";
import type { SourceEvent } from "./source-event.js";

export type ApertureKernelConsequenceLevel = "low" | "medium" | "high";

export type ApertureKernelActivityCategory =
  | "permission_request"
  | "question_request"
  | "follow_up"
  | "tool_completion"
  | "tool_failure"
  | "session_status"
  | "status_update";

export type ApertureKernelSource = {
  id: string;
  kind?: string;
  label?: string;
};

export type ApertureKernelContextItem = {
  id: string;
  label: string;
  value?: string;
};

export type ApertureKernelContext = {
  stage?: string;
  progress?: number;
  items?: ApertureKernelContextItem[];
};

export type ApertureKernelFacts = {
  capabilityFamily?: string;
  activityCategory?: ApertureKernelActivityCategory;
};

export type ApertureKernelHints = {
  consequence?: ApertureKernelConsequenceLevel;
};

export type ApertureKernelInputRequest =
  | {
      kind: "approval";
      requireReason?: boolean;
    }
  | {
      kind: "choice";
      selectionMode: "single" | "multiple";
      allowTextResponse?: boolean;
      options: Array<{
        id: string;
        label: string;
        summary?: string;
      }>;
    }
  | {
      kind: "form";
      fields: Array<{
        id: string;
        label: string;
        type: "text" | "textarea" | "number" | "select" | "boolean";
        required?: boolean;
        options?: Array<{ value: string; label: string }>;
      }>;
    };

type ApertureKernelEventBase = {
  id: string;
  workId: string;
  occurredAt: string;
  source?: ApertureKernelSource;
  metadata?: Record<string, unknown>;
  facts?: ApertureKernelFacts;
  context?: ApertureKernelContext;
  hints?: ApertureKernelHints;
};

export type ApertureKernelWorkStartedEvent = ApertureKernelEventBase & {
  kind: "work.started";
  title: string;
  summary?: string;
};

export type ApertureKernelWorkUpdatedEvent = ApertureKernelEventBase & {
  kind: "work.updated";
  title: string;
  summary?: string;
  status: "running" | "blocked" | "waiting" | "completed" | "failed";
  progress?: number;
};

export type ApertureKernelInputRequestedEvent = ApertureKernelEventBase & {
  kind: "input.requested";
  interactionId: string;
  title: string;
  summary: string;
  request: ApertureKernelInputRequest;
};

export type ApertureKernelWorkCompletedEvent = ApertureKernelEventBase & {
  kind: "work.completed";
  summary?: string;
};

export type ApertureKernelWorkCancelledEvent = ApertureKernelEventBase & {
  kind: "work.cancelled";
  reason?: string;
};

export type ApertureKernelEvent =
  | ApertureKernelWorkStartedEvent
  | ApertureKernelWorkUpdatedEvent
  | ApertureKernelInputRequestedEvent
  | ApertureKernelWorkCompletedEvent
  | ApertureKernelWorkCancelledEvent;

export type ApertureKernelFinalEvent = {
  id: string;
  kind: ApertureKernelEvent["kind"];
  workId: string;
  occurredAt: string;
  source?: ApertureKernelSource;
  metadata?: Record<string, unknown>;
  title?: string;
  summary?: string;
  status?: ApertureKernelWorkUpdatedEvent["status"];
  progress?: number;
  interactionId?: string;
  capabilityFamily?: string;
  activityCategory?: ApertureKernelActivityCategory;
  semantic: {
    intentFrame: string;
    activityCategory?: ApertureKernelActivityCategory;
    capabilityFamily?: string;
    consequence?: ApertureKernelConsequenceLevel;
    confidence: "low" | "medium" | "high";
    whyNow?: string;
    factors: string[];
  };
};

export type ApertureKernelObservationKind =
  | "control"
  | "diagnostic"
  | "outcome"
  | "payload"
  | "unknown";
export type ApertureKernelObservationPolarity = "failure" | "neutral" | "success" | "unknown";
export type ApertureKernelObservationOwner = "engine" | "source" | "tool" | "unknown";
export type ApertureKernelObservationSubject =
  | "command"
  | "document"
  | "search"
  | "source"
  | "tool"
  | "unknown";
export type ApertureKernelEvidenceLoss = "absent" | "none" | "partial" | "unknown";
export type ApertureKernelDiagnosticClass = "expected" | "runtime" | "source_limit";
export type ApertureKernelRecoveryHint =
  | "await_authorization"
  | "inspect_diagnostic"
  | "inspect_original_evidence"
  | "narrow_evidence_scope"
  | "request_evidence";
export type ApertureKernelObservationOrigin =
  | "command_output"
  | "read_output"
  | "semantic_evidence"
  | "status_text"
  | "structured_output"
  | "transcript";
export type ApertureKernelObservationAuthority = "explicit" | "hinted" | "inferred" | "unknown";
export type ApertureKernelSemanticAgreement = "stable" | "overridden" | "uncertain";
export type ApertureKernelEvidenceStrength = "weak" | "qualified" | "strong";
export type ApertureKernelStatusConflictKind =
  | "command_success_observation"
  | "execution_success_observation"
  | "payload_observation"
  | "rejected_tool_use_observation"
  | "search_output_observation"
  | "structured_output_observation";

export type ApertureKernelObservation = {
  kind: ApertureKernelObservationKind;
  polarity: ApertureKernelObservationPolarity;
  ownership: {
    owner: ApertureKernelObservationOwner;
    capabilityFamily?: string;
  };
  subject: ApertureKernelObservationSubject;
  evidenceLoss: ApertureKernelEvidenceLoss;
  semanticAgreement: ApertureKernelSemanticAgreement;
  evidenceStrength: ApertureKernelEvidenceStrength;
  diagnosticClass?: ApertureKernelDiagnosticClass;
  recoveryHint?: ApertureKernelRecoveryHint;
  provenance: {
    origin: ApertureKernelObservationOrigin;
    authority: ApertureKernelObservationAuthority;
  };
  consequenceBaseline: ApertureKernelConsequenceLevel;
};

export type ApertureKernelObservationJudgment = {
  statusEvidence:
    | "limited_failure"
    | "stable_observation"
    | "visible_diagnostic_failure"
    | "weak_or_uncertain";
  statusConflictKind: ApertureKernelStatusConflictKind | null;
  recoveryPosture:
    | "authorization_required"
    | "diagnostic_inspection"
    | "evidence_required"
    | "evidence_scope_required"
    | "original_evidence_required"
    | "none";
  baselineConsequence: ApertureKernelConsequenceLevel;
  outcomeOnlyFailureStatus: boolean;
  limitedFailureStatus: boolean;
  stableStatusEvidence: boolean;
  visibleDiagnosticFailure: boolean;
};

export type ApertureKernelEvaluation =
  | {
      kind: "candidate";
      workId: string;
      interactionId: string;
      mode: "status" | "approval" | "choice" | "form";
    }
  | {
      kind: "clear" | "noop";
      workId: string;
    };

export const APERTURE_KERNEL_EXPLANATION_SCHEMA_VERSION = 1 as const;

export type ApertureKernelResult = {
  event: ApertureKernelFinalEvent;
  evaluation: ApertureKernelEvaluation;
  observation: ApertureKernelObservation | null;
  observationJudgment: ApertureKernelObservationJudgment | null;
  explanation: ApertureKernelExplanation;
};

export type ApertureKernelExplanation = {
  schemaVersion: typeof APERTURE_KERNEL_EXPLANATION_SCHEMA_VERSION;
  flow: readonly ["normalize", "observe", "judge"];
  reasonCodes: string[];
};

type ApertureKernelEvaluationResult = Omit<ApertureKernelResult, "explanation">;

type SourceObservation = NonNullable<AttentionJudgmentInput["observation"]>;

export function evaluateApertureKernelEvent(event: ApertureKernelEvent): ApertureKernelResult {
  const result = evaluateApertureKernelResult(event);

  return {
    ...result,
    explanation: explainApertureKernelResult(result),
  };
}

function evaluateApertureKernelResult(event: ApertureKernelEvent): ApertureKernelEvaluationResult {
  const finalizedEvent = normalizeSourceEvent(toSourceEvent(event));
  const result = new EventEvaluator().evaluate(finalizedEvent);

  if (result.kind !== "candidate") {
    return {
      event: projectKernelFinalEvent(finalizedEvent),
      evaluation: {
        kind: result.kind,
        workId: result.taskId,
      },
      observation: null,
      observationJudgment: null,
    };
  }

  const observation = result.candidate.judgmentInput.observation;

  return {
    event: projectKernelFinalEvent(finalizedEvent),
    evaluation: {
      kind: "candidate",
      workId: result.candidate.taskId,
      interactionId: result.candidate.interactionId,
      mode: result.candidate.mode,
    },
    observation: observation === undefined ? null : projectKernelObservation(observation),
    observationJudgment:
      observation === undefined ? null : projectKernelObservationJudgment(observation),
  };
}

function explainApertureKernelResult(
  result: ApertureKernelEvaluationResult,
): ApertureKernelExplanation {
  return {
    schemaVersion: APERTURE_KERNEL_EXPLANATION_SCHEMA_VERSION,
    flow: ["normalize", "observe", "judge"],
    reasonCodes: [
      "kernel:normalize:event",
      `kernel:evaluate:${result.evaluation.kind}`,
      ...explainKernelObservation(result.observation),
      ...explainKernelObservationJudgment(result.observationJudgment),
    ],
  };
}

function toSourceEvent(event: ApertureKernelEvent): SourceEvent {
  const base = {
    id: event.id,
    taskId: event.workId,
    timestamp: event.occurredAt,
    ...(event.source === undefined ? {} : { source: event.source }),
    ...(event.metadata === undefined ? {} : { metadata: event.metadata }),
  };
  const capabilityFamily = readCapabilityFamily(event);
  const activityClass = event.facts?.activityCategory;

  switch (event.kind) {
    case "work.started":
      return {
        ...base,
        type: "task.started",
        title: event.title,
        ...(event.summary === undefined ? {} : { summary: event.summary }),
      };
    case "work.updated":
      return {
        ...base,
        type: "task.updated",
        title: event.title,
        status: event.status,
        ...(event.summary === undefined ? {} : { summary: event.summary }),
        ...(event.progress === undefined ? {} : { progress: event.progress }),
        ...(event.context === undefined ? {} : { context: event.context }),
        ...(capabilityFamily === null ? {} : { toolFamily: capabilityFamily }),
        ...(activityClass === undefined ? {} : { activityClass }),
      };
    case "input.requested":
      return {
        ...base,
        type: "human.input.requested",
        interactionId: event.interactionId,
        title: event.title,
        summary: event.summary,
        request: event.request,
        ...(event.context === undefined ? {} : { context: event.context }),
        ...(capabilityFamily === null ? {} : { toolFamily: capabilityFamily }),
        ...(activityClass === undefined ? {} : { activityClass }),
        ...(event.hints?.consequence === undefined ? {} : { riskHint: event.hints.consequence }),
      };
    case "work.completed":
      return {
        ...base,
        type: "task.completed",
        ...(event.summary === undefined ? {} : { summary: event.summary }),
      };
    case "work.cancelled":
      return {
        ...base,
        type: "task.cancelled",
        ...(event.reason === undefined ? {} : { reason: event.reason }),
      };
  }
}

function projectKernelFinalEvent(event: EnrichedApertureEvent): ApertureKernelFinalEvent {
  return {
    id: event.id,
    kind: toKernelEventKind(event.type),
    workId: event.taskId,
    occurredAt: event.timestamp,
    ...(event.source === undefined ? {} : { source: event.source }),
    ...(event.metadata === undefined ? {} : { metadata: event.metadata }),
    ...("title" in event ? { title: event.title } : {}),
    ...("summary" in event && event.summary !== undefined ? { summary: event.summary } : {}),
    ...("status" in event ? { status: event.status } : {}),
    ...("progress" in event && event.progress !== undefined ? { progress: event.progress } : {}),
    ...("interactionId" in event ? { interactionId: event.interactionId } : {}),
    ...("toolFamily" in event && event.toolFamily !== undefined
      ? { capabilityFamily: event.toolFamily }
      : {}),
    ...("activityClass" in event && event.activityClass !== undefined
      ? { activityCategory: event.activityClass }
      : {}),
    semantic: {
      intentFrame: event.semantic.intentFrame,
      ...(event.semantic.activityClass === undefined
        ? {}
        : { activityCategory: event.semantic.activityClass }),
      ...(event.semantic.toolFamily === undefined
        ? {}
        : { capabilityFamily: event.semantic.toolFamily }),
      ...(event.semantic.consequence === undefined
        ? {}
        : { consequence: event.semantic.consequence }),
      confidence: event.semantic.confidence,
      ...(event.semantic.whyNow === undefined ? {} : { whyNow: event.semantic.whyNow }),
      factors: event.semantic.factors,
    },
  };
}

function toKernelEventKind(type: EnrichedApertureEvent["type"]): ApertureKernelEvent["kind"] {
  switch (type) {
    case "task.started":
      return "work.started";
    case "task.updated":
      return "work.updated";
    case "human.input.requested":
      return "input.requested";
    case "task.completed":
      return "work.completed";
    case "task.cancelled":
      return "work.cancelled";
  }
}

function projectKernelObservation(observation: SourceObservation): ApertureKernelObservation {
  return {
    kind: observation.kind,
    polarity: observation.polarity,
    ownership: projectKernelOwnership(observation),
    subject: observation.subject,
    evidenceLoss: observation.evidenceLoss,
    evidenceStrength: observation.evidenceStrength,
    semanticAgreement: observation.semanticAgreement,
    ...(observation.diagnosticClass === undefined
      ? {}
      : { diagnosticClass: observation.diagnosticClass }),
    ...(observation.recoveryHint === undefined ? {} : { recoveryHint: observation.recoveryHint }),
    provenance: observation.provenance,
    consequenceBaseline: observation.consequenceBaseline,
  };
}

function projectKernelObservationJudgment(
  observation: SourceObservation,
): ApertureKernelObservationJudgment {
  const contract = projectObservationJudgmentContract(observation);
  return {
    statusEvidence: contract.statusEvidence,
    statusConflictKind: contract.statusConflictKind,
    recoveryPosture: contract.recoveryPosture,
    baselineConsequence: contract.baselineConsequence,
    outcomeOnlyFailureStatus: contract.outcomeOnlyFailureStatus,
    limitedFailureStatus: contract.limitedFailureStatus,
    stableStatusEvidence: contract.stableStatusEvidence,
    visibleDiagnosticFailure: contract.visibleDiagnosticFailure,
  };
}

function explainKernelObservation(observation: ApertureKernelObservation | null): string[] {
  if (observation === null) {
    return ["kernel:observe:absent"];
  }

  return [
    "kernel:observe:present",
    `kernel:observe:kind:${observation.kind}`,
    `kernel:observe:polarity:${observation.polarity}`,
    `kernel:observe:owner:${observation.ownership.owner}`,
    `kernel:observe:subject:${observation.subject}`,
    `kernel:observe:evidence_loss:${observation.evidenceLoss}`,
    `kernel:observe:evidence_strength:${observation.evidenceStrength}`,
    `kernel:observe:agreement:${observation.semanticAgreement}`,
    `kernel:observe:provenance:${observation.provenance.origin}:${observation.provenance.authority}`,
  ];
}

function explainKernelObservationJudgment(
  observationJudgment: ApertureKernelObservationJudgment | null,
): string[] {
  if (observationJudgment === null) {
    return ["kernel:judge:absent"];
  }

  return [
    `kernel:judge:status_evidence:${observationJudgment.statusEvidence}`,
    observationJudgment.statusConflictKind === null
      ? "kernel:judge:status_conflict:none"
      : `kernel:judge:status_conflict:${observationJudgment.statusConflictKind}`,
    `kernel:judge:recovery:${observationJudgment.recoveryPosture}`,
    `kernel:judge:baseline:${observationJudgment.baselineConsequence}`,
  ];
}

function readCapabilityFamily(event: ApertureKernelEvent): string | null {
  return normalizeCapabilityFamily(event.facts?.capabilityFamily);
}

function normalizeCapabilityFamily(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim().toLowerCase() : null;
}

function projectKernelOwnership(
  observation: SourceObservation,
): ApertureKernelObservation["ownership"] {
  return observation.ownership.toolFamily === undefined
    ? { owner: observation.ownership.owner }
    : {
        owner: observation.ownership.owner,
        capabilityFamily: observation.ownership.toolFamily,
      };
}
