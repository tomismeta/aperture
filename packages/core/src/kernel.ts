import type { EnrichedApertureEvent, SourceEvidence } from "./events.js";
import { EventEvaluator } from "./event-evaluator.js";
import { assertValidSourceEvent } from "./aperture-core-validation.js";
import { judgeObservation, type ObservationJudgment } from "./judgment-observation-contract.js";
import type { AttentionJudgmentInput } from "./judgment-input-types.js";
import { normalizeSourceEvent } from "./semantic-normalizer.js";
import type { SourceEvent } from "./source-event.js";

export type { SourceEvidence } from "./events.js";
export type { Observation } from "./judgment-input-types.js";
export type { ObservationJudgment } from "./judgment-observation-contract.js";

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

type ApertureKernelWorkUpdatedEventFields = ApertureKernelEventBase & {
  kind: "work.updated";
  title: string;
  summary?: string;
  /** Runtime-valid only when status is failed; validation rejects other combinations. */
  evidence?: SourceEvidence;
  status: "running" | "blocked" | "waiting" | "completed" | "failed";
  progress?: number;
};
export type ApertureKernelWorkUpdatedEvent = ApertureKernelWorkUpdatedEventFields;

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
  evidence?: SourceEvidence;
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
  observation: Observation | null;
  observationJudgment: ObservationJudgment | null;
  explanation: ApertureKernelExplanation;
};

type Observation = NonNullable<AttentionJudgmentInput["observation"]>;

export type ApertureKernelExplanation = {
  schemaVersion: typeof APERTURE_KERNEL_EXPLANATION_SCHEMA_VERSION;
  flow: readonly ["normalize", "observe", "judge"];
  reasonCodes: string[];
};

export type ApertureKernelHostAdapter<HostEvent> = (event: HostEvent) => ApertureKernelEvent | null;

export type ApertureKernelConformanceCase<HostEvent> = {
  id: string;
  input: HostEvent;
  expected: {
    observation: Observation | null;
    observationJudgment: ObservationJudgment | null;
    reasonCodes: readonly string[];
  };
};

export type ApertureKernelConformanceCaseResult = {
  id: string;
  passed: boolean;
  failures: string[];
};

export type ApertureKernelConformanceReport = {
  passed: boolean;
  deterministic: boolean;
  cases: ApertureKernelConformanceCaseResult[];
};

type ApertureKernelEvaluationResult = Omit<ApertureKernelResult, "explanation">;

export function evaluateApertureKernelEvent(event: ApertureKernelEvent): ApertureKernelResult {
  const result = evaluateApertureKernelResult(event);

  return {
    ...result,
    explanation: explainApertureKernelResult(result),
  };
}

export function runApertureKernelConformance<HostEvent>(
  adapter: ApertureKernelHostAdapter<HostEvent>,
  cases: readonly ApertureKernelConformanceCase<HostEvent>[],
): ApertureKernelConformanceReport {
  let deterministic = true;
  const results = cases.map((testCase) => {
    const failures: string[] = [];
    try {
      const event = adapter(testCase.input);
      if (event === null) {
        compareConformanceValue("observation", null, testCase.expected.observation, failures);
        compareConformanceValue(
          "observationJudgment",
          null,
          testCase.expected.observationJudgment,
          failures,
        );
        compareConformanceValue("reasonCodes", [], testCase.expected.reasonCodes, failures);
      } else {
        const first = evaluateApertureKernelEvent(event);
        const second = evaluateApertureKernelEvent(event);
        compareConformanceValue(
          "observation",
          first.observation,
          testCase.expected.observation,
          failures,
        );
        compareConformanceValue(
          "observationJudgment",
          first.observationJudgment,
          testCase.expected.observationJudgment,
          failures,
        );
        compareConformanceValue(
          "reasonCodes",
          first.explanation.reasonCodes,
          testCase.expected.reasonCodes,
          failures,
        );
        if (conformanceProjection(first) !== conformanceProjection(second)) {
          deterministic = false;
          failures.push("repeated evaluation changed the canonical result");
        }
      }
    } catch (error) {
      failures.push(`evaluation threw: ${readConformanceError(error)}`);
    }

    return { id: testCase.id, passed: failures.length === 0, failures };
  });

  return {
    passed: deterministic && results.every((result) => result.passed),
    deterministic,
    cases: results,
  };
}

function conformanceProjection(result: ApertureKernelResult): string {
  return canonicalConformanceJson({
    observation: result.observation,
    observationJudgment: result.observationJudgment,
    reasonCodes: result.explanation.reasonCodes,
  });
}

function compareConformanceValue(
  label: string,
  actual: unknown,
  expected: unknown,
  failures: string[],
): void {
  if (canonicalConformanceJson(actual) !== canonicalConformanceJson(expected)) {
    failures.push(`${label} did not match the expected canonical value`);
  }
}

function canonicalConformanceJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalConformanceJson(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalConformanceJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function readConformanceError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function evaluateApertureKernelResult(event: ApertureKernelEvent): ApertureKernelEvaluationResult {
  const sourceEvent = toSourceEvent(event);
  assertValidSourceEvent(sourceEvent);
  const finalizedEvent = normalizeSourceEvent(sourceEvent);
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
    observation: observation ?? null,
    observationJudgment: observation === undefined ? null : judgeObservation(observation),
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
    case "work.updated": {
      const update = {
        ...base,
        type: "task.updated" as const,
        title: event.title,
        ...(event.summary === undefined ? {} : { summary: event.summary }),
        ...(event.progress === undefined ? {} : { progress: event.progress }),
        ...(event.context === undefined ? {} : { context: event.context }),
        ...(capabilityFamily === null ? {} : { toolFamily: capabilityFamily }),
        ...(activityClass === undefined ? {} : { activityClass }),
      };
      const evidence = (event as unknown as { evidence?: SourceEvidence }).evidence;
      return {
        ...update,
        status: event.status,
        ...(evidence === undefined ? {} : { evidence }),
      } as SourceEvent;
    }
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
    ...("evidence" in event && event.evidence !== undefined ? { evidence: event.evidence } : {}),
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

function explainKernelObservation(observation: Observation | null): string[] {
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
  observationJudgment: ObservationJudgment | null,
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
