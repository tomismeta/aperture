import type { ApertureEvent, HumanInputRequestedEvent, TaskUpdatedEvent } from "./events.js";
import type {
  AttentionAcknowledgeResponseSpec,
  AttentionAction,
  AttentionApprovalResponseSpec,
  AttentionChoiceResponseSpec,
  AttentionFormResponseSpec,
} from "./frame.js";
import type { AttentionCandidate } from "./interaction-candidate.js";
import {
  buildAttentionJudgmentInput,
  hasActionableBlockedLikeStatusJudgmentInput,
  hasOutcomeOnlyFailureStatusJudgmentInput,
  hasRoutineObservationalStatusConflictJudgmentInput,
} from "./judgment-input.js";
import type { AttentionJudgmentInput } from "./judgment-input-types.js";
import { semanticWhyNowForTaskStatus } from "./semantic-language.js";
import { mergeSemanticProvenance } from "./semantic-provenance.js";

export type EvaluationResult =
  | { kind: "candidate"; candidate: AttentionCandidate }
  | { kind: "clear"; taskId: string }
  | { kind: "noop"; taskId: string };

export class EventEvaluator {
  evaluate(event: ApertureEvent): EvaluationResult {
    switch (event.type) {
      case "task.started":
        return {
          kind: "candidate",
          candidate: {
            taskId: event.taskId,
            interactionId: `interaction:${event.taskId}:status`,
            ...(event.source !== undefined ? { source: event.source } : {}),
            ...(event.metadata !== undefined ? { metadata: event.metadata } : {}),
            mode: "status",
            tone: "ambient",
            consequence: "low",
            title: event.title,
            responseSpec: { kind: "none" },
            priority: "background",
            blocking: false,
            timestamp: event.timestamp,
            ...(event.summary !== undefined ? { summary: event.summary } : {}),
            ...buildJudgmentInputFields(event),
          },
        };
      case "task.updated":
        return {
          kind: "candidate",
          candidate: this.evaluateTaskUpdate(event),
        };
      case "human.input.requested":
        return {
          kind: "candidate",
          candidate: this.evaluateHumanInput(event),
        };
      case "task.completed":
      case "task.cancelled":
        return {
          kind: "clear",
          taskId: event.taskId,
        };
      default:
        return unreachableApertureEvent(event);
    }
  }

  private evaluateTaskUpdate(event: TaskUpdatedEvent): AttentionCandidate {
    // Status events keep candidate-routing authority in the explicit task
    // status. The semantic layer can still enrich provenance, relation hints,
    // tool family, activity class, and ontology diagnostics. Concrete
    // blocked-like semantics may only lift the status posture; they do not turn
    // the event into a blocking request or change the response contract.
    const judgmentInput = buildAttentionJudgmentInput(event);
    const disposition = this.statusDispositionForStatus(event, judgmentInput);

    return {
      taskId: event.taskId,
      interactionId: `interaction:${event.taskId}:status`,
      ...(event.source !== undefined ? { source: event.source } : {}),
      ...(event.metadata !== undefined ? { metadata: event.metadata } : {}),
      ...(event.toolFamily !== undefined ? { toolFamily: event.toolFamily } : {}),
      ...(event.activityClass !== undefined ? { activityClass: event.activityClass } : {}),
      mode: "status",
      tone: disposition.tone,
      consequence: disposition.consequence,
      title: event.title,
      responseSpec: disposition.responseSpec,
      priority: disposition.priority,
      blocking: false,
      timestamp: event.timestamp,
      ...(event.summary !== undefined ? { summary: event.summary } : {}),
      ...(event.semantic?.relationHints?.length
        ? { relationHints: event.semantic.relationHints }
        : {}),
      judgmentInput,
      ...buildStatusContext(event),
      ...buildStatusProvenance(event, disposition.includeFailureProvenance),
    };
  }

  private evaluateHumanInput(event: HumanInputRequestedEvent): AttentionCandidate {
    const actions = this.createActions(event);
    const responseSpec = this.createResponseSpec(event, actions);
    const toolFamily = event.request.kind === "approval" ? event.toolFamily : undefined;

    return {
      taskId: event.taskId,
      interactionId: event.interactionId,
      ...(event.source !== undefined ? { source: event.source } : {}),
      ...(event.metadata !== undefined ? { metadata: event.metadata } : {}),
      ...(toolFamily !== undefined ? { toolFamily } : {}),
      ...(event.activityClass !== undefined ? { activityClass: event.activityClass } : {}),
      mode: event.request.kind,
      tone: event.tone ?? "focused",
      consequence: event.consequence ?? "medium",
      title: event.title,
      summary: event.summary,
      ...(event.semantic?.relationHints?.length
        ? { relationHints: event.semantic.relationHints }
        : {}),
      responseSpec,
      priority: this.priorityForHumanInput(event),
      blocking: true,
      timestamp: event.timestamp,
      ...buildJudgmentInputFields(event),
      ...(event.context !== undefined ? { context: event.context } : {}),
      ...(() => {
        const provenance = mergeSemanticProvenance({
          base: event.provenance,
          semantic: event.semantic,
        });
        return provenance !== undefined ? { provenance } : {};
      })(),
    };
  }

  private priorityForHumanInput(event: HumanInputRequestedEvent): AttentionCandidate["priority"] {
    if (event.request.kind === "approval" && event.consequence === "low") {
      return "normal";
    }

    return "high";
  }

  private createActions(event: HumanInputRequestedEvent): AttentionAction[] {
    switch (event.request.kind) {
      case "approval":
        return [
          { id: "approve", label: "Approve", kind: "approve", emphasis: "primary" },
          { id: "reject", label: "Reject", kind: "reject", emphasis: "danger" },
        ];
      case "choice":
      case "form":
        return [
          { id: "submit", label: "Continue", kind: "submit", emphasis: "primary" },
          { id: "cancel", label: "Cancel", kind: "cancel", emphasis: "secondary" },
        ];
      default:
        return unreachableRequest(event.request);
    }
  }

  private createResponseSpec(
    event: HumanInputRequestedEvent,
    actions: AttentionAction[],
  ): AttentionChoiceResponseSpec | AttentionFormResponseSpec | AttentionApprovalResponseSpec {
    switch (event.request.kind) {
      case "approval":
        return event.request.requireReason !== undefined
          ? {
              kind: "approval",
              actions,
              requireReason: event.request.requireReason,
            }
          : {
              kind: "approval",
              actions,
            };
      case "choice":
        return {
          kind: "choice",
          selectionMode: event.request.selectionMode,
          ...(event.request.allowTextResponse !== undefined
            ? { allowTextResponse: event.request.allowTextResponse }
            : {}),
          options: event.request.options,
          actions,
        };
      case "form":
        return {
          kind: "form",
          fields: event.request.fields,
          actions,
        };
      default:
        return unreachableRequest(event.request);
    }
  }

  private statusDispositionForStatus(
    event: TaskUpdatedEvent,
    judgmentInput: AttentionJudgmentInput,
  ): {
    priority: AttentionCandidate["priority"];
    tone: AttentionCandidate["tone"];
    consequence: AttentionCandidate["consequence"];
    responseSpec: AttentionAcknowledgeResponseSpec | { kind: "none" };
    includeFailureProvenance: boolean;
  } {
    if (hasRoutineObservationalStatusConflictJudgmentInput(judgmentInput)) {
      return statusDispositionForObservationalStatusConflict(
        judgmentInput.ontology?.consequence ?? "low",
        event.status,
      );
    }

    if (hasActionableBlockedLikeStatusJudgmentInput(judgmentInput)) {
      return {
        priority: "normal",
        tone: "focused",
        consequence: "medium",
        responseSpec: statusResponseSpec(event.status),
        includeFailureProvenance: event.status === "failed",
      };
    }

    switch (event.status) {
      case "failed":
        return statusDispositionForFailedStatus(event, judgmentInput);
      case "blocked":
        return {
          priority: "normal",
          tone: "focused",
          consequence: "medium",
          responseSpec: statusResponseSpec(event.status),
          includeFailureProvenance: false,
        };
      case "running":
      case "waiting":
      case "completed":
        return {
          priority: "background",
          tone: "ambient",
          consequence: "low",
          responseSpec: statusResponseSpec(event.status),
          includeFailureProvenance: false,
        };
      default:
        return unreachableTaskStatus(event.status);
    }
  }
}

function statusDispositionForFailedStatus(
  event: TaskUpdatedEvent,
  judgmentInput: AttentionJudgmentInput,
): {
  priority: AttentionCandidate["priority"];
  tone: AttentionCandidate["tone"];
  consequence: AttentionCandidate["consequence"];
  responseSpec: AttentionAcknowledgeResponseSpec | { kind: "none" };
  includeFailureProvenance: boolean;
} {
  if (hasEngineOwnedOutcomeOnlyFailure(judgmentInput)) {
    return {
      priority: "normal",
      tone: "focused",
      consequence: "medium",
      responseSpec: statusResponseSpec(event.status),
      includeFailureProvenance: true,
    };
  }

  return {
    priority: "high",
    tone: "critical",
    consequence: "high",
    responseSpec: statusResponseSpec(event.status),
    includeFailureProvenance: true,
  };
}

function hasEngineOwnedOutcomeOnlyFailure(judgmentInput: AttentionJudgmentInput): boolean {
  return hasOutcomeOnlyFailureStatusJudgmentInput(judgmentInput);
}

function statusDispositionForObservationalStatusConflict(
  consequence: AttentionCandidate["consequence"],
  status: TaskUpdatedEvent["status"],
): {
  priority: AttentionCandidate["priority"];
  tone: AttentionCandidate["tone"];
  consequence: AttentionCandidate["consequence"];
  responseSpec: AttentionAcknowledgeResponseSpec | { kind: "none" };
  includeFailureProvenance: boolean;
} {
  switch (consequence) {
    case "low":
      return {
        priority: "background",
        tone: "ambient",
        consequence: "low",
        responseSpec: { kind: "none" },
        includeFailureProvenance: false,
      };
    case "medium":
      return {
        priority: "normal",
        tone: "focused",
        consequence: "medium",
        responseSpec: statusResponseSpec(status),
        includeFailureProvenance: false,
      };
    case "high":
      return {
        priority: "high",
        tone: "critical",
        consequence: "high",
        responseSpec: statusResponseSpec(status),
        includeFailureProvenance: false,
      };
    default:
      return unreachableConsequence(consequence);
  }
}

function buildStatusContext(
  event: Extract<ApertureEvent, { type: "task.updated" }>,
): Pick<AttentionCandidate, "context"> | Record<string, never> {
  const context = event.context;
  const items = context?.items;
  const hasItems = items !== undefined && items.length > 0;

  if (event.progress === undefined && context?.stage === undefined && !hasItems) {
    return {};
  }

  return {
    context: {
      ...(context?.stage !== undefined ? { stage: context.stage } : {}),
      ...(event.progress !== undefined ? { progress: event.progress } : {}),
      ...(hasItems ? { items } : {}),
    },
  };
}

function buildStatusProvenance(
  event: TaskUpdatedEvent,
  includeFailureProvenance: boolean,
): { provenance: { whyNow?: string; factors?: string[] } } | {} {
  const provenance = mergeSemanticProvenance({
    semantic: event.semantic,
    fallbackWhyNow:
      event.status === "blocked"
        ? semanticWhyNowForTaskStatus("blocked")
        : event.status === "failed" && includeFailureProvenance
          ? semanticWhyNowForTaskStatus("failed")
          : undefined,
    extraFactors:
      event.status === "blocked" || (event.status === "failed" && includeFailureProvenance)
        ? [event.status]
        : [],
  });

  if (provenance === undefined) {
    return {};
  }

  return {
    provenance,
  };
}

function statusResponseSpec(
  status: TaskUpdatedEvent["status"],
): AttentionAcknowledgeResponseSpec | { kind: "none" } {
  switch (status) {
    case "blocked":
    case "failed":
      return {
        kind: "acknowledge",
        actions: [
          {
            id: "acknowledge",
            label: "Acknowledge",
            kind: "acknowledge",
            emphasis: "primary",
          },
        ],
      };
    case "running":
    case "waiting":
    case "completed":
      return { kind: "none" };
    default:
      return unreachableTaskStatus(status);
  }
}

function buildJudgmentInputFields(event: ApertureEvent): Pick<AttentionCandidate, "judgmentInput"> {
  // All routed candidates receive the same compiled semantic/evidence seam,
  // regardless of whether the event began as a source event or a direct
  // canonical Aperture event.
  return {
    judgmentInput: buildAttentionJudgmentInput(event),
  };
}

function unreachableApertureEvent(event: never): never {
  throw new Error(`Unhandled ApertureEvent in event evaluator: ${JSON.stringify(event)}`);
}

function unreachableRequest(request: never): never {
  throw new Error(`Unhandled human input request in event evaluator: ${JSON.stringify(request)}`);
}

function unreachableTaskStatus(status: never): never {
  throw new Error(`Unhandled task status in event evaluator: ${status}`);
}

function unreachableConsequence(consequence: never): never {
  throw new Error(`Unhandled consequence in event evaluator: ${consequence}`);
}
