import type {
  ApertureEvent,
  HumanInputRequestedEvent,
  TaskUpdatedEvent,
} from "./events.js";
import type {
  AttentionAcknowledgeResponseSpec,
  AttentionAction,
  AttentionApprovalResponseSpec,
  AttentionChoiceResponseSpec,
  AttentionFormResponseSpec,
} from "./frame.js";
import type { AttentionCandidate } from "./interaction-candidate.js";

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
            mode: "status",
            tone: "ambient",
            consequence: "low",
            title: event.title,
            responseSpec: { kind: "none" },
            priority: "background",
            blocking: false,
            timestamp: event.timestamp,
            ...(event.summary !== undefined ? { summary: event.summary } : {}),
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
    }
  }

  private evaluateTaskUpdate(event: TaskUpdatedEvent): AttentionCandidate {
    const priority = this.priorityForStatus(event.status);
    const tone = this.toneForStatus(event.status);
    const consequence = this.consequenceForStatus(event.status);
    const responseSpec = this.responseSpecForStatus(event.status);

    return {
      taskId: event.taskId,
      interactionId: `interaction:${event.taskId}:status`,
      ...(event.source !== undefined ? { source: event.source } : {}),
      ...(event.toolFamily !== undefined ? { toolFamily: event.toolFamily } : {}),
      ...(event.activityClass !== undefined ? { activityClass: event.activityClass } : {}),
      mode: "status",
      tone,
      consequence,
      title: event.title,
      responseSpec,
      priority,
      blocking: false,
      timestamp: event.timestamp,
      ...(event.summary !== undefined ? { summary: event.summary } : {}),
      ...(event.progress !== undefined
        ? {
            context: {
              progress: event.progress,
            },
          }
        : {}),
      ...(buildStatusProvenance(event)),
    };
  }

  private evaluateHumanInput(event: HumanInputRequestedEvent): AttentionCandidate {
    const actions = this.createActions(event);
    const responseSpec = this.createResponseSpec(event, actions);

    return {
      taskId: event.taskId,
      interactionId: event.interactionId,
      ...(event.source !== undefined ? { source: event.source } : {}),
      ...(event.toolFamily !== undefined ? { toolFamily: event.toolFamily } : {}),
      ...(event.activityClass !== undefined ? { activityClass: event.activityClass } : {}),
      mode: event.request.kind,
      tone: event.tone ?? "focused",
      consequence: event.consequence ?? "medium",
      title: event.title,
      summary: event.summary,
      responseSpec,
      priority: this.priorityForHumanInput(event),
      blocking: true,
      timestamp: event.timestamp,
      ...(event.context !== undefined ? { context: event.context } : {}),
      ...((event.provenance !== undefined || event.semantic?.whyNow !== undefined || event.semantic?.factors?.length)
        ? {
            provenance: {
              ...(event.provenance ?? {}),
              ...(event.provenance?.whyNow === undefined && event.semantic?.whyNow !== undefined
                ? { whyNow: event.semantic.whyNow }
                : {}),
              ...(event.semantic?.factors?.length
                ? { factors: dedupeStrings([...(event.provenance?.factors ?? []), ...event.semantic.factors]) }
                : {}),
            },
          }
        : {}),
    };
  }

  private priorityForHumanInput(
    event: HumanInputRequestedEvent,
  ): AttentionCandidate["priority"] {
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
    }
  }

  private responseSpecForStatus(
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
    }
  }

  private priorityForStatus(status: TaskUpdatedEvent["status"]): AttentionCandidate["priority"] {
    switch (status) {
      case "blocked":
        return "normal";
      case "failed":
        return "high";
      case "running":
      case "waiting":
      case "completed":
        return "background";
    }
  }

  private toneForStatus(status: TaskUpdatedEvent["status"]): AttentionCandidate["tone"] {
    switch (status) {
      case "blocked":
        return "focused";
      case "failed":
        return "critical";
      case "running":
      case "waiting":
      case "completed":
        return "ambient";
    }
  }

  private consequenceForStatus(status: TaskUpdatedEvent["status"]): AttentionCandidate["consequence"] {
    switch (status) {
      case "blocked":
        return "medium";
      case "failed":
        return "high";
      case "running":
      case "waiting":
      case "completed":
        return "low";
    }
  }
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function buildStatusProvenance(event: TaskUpdatedEvent): { provenance: { whyNow?: string; factors?: string[] } } | {} {
  const whyNow =
    event.semantic?.whyNow
    ?? (event.status === "blocked"
      ? "Work is blocked and may require operator attention."
      : event.status === "failed"
        ? "Work has failed and should be reviewed."
        : undefined);
  const factors = dedupeStrings([
    ...(event.semantic?.factors ?? []),
    ...(event.status === "blocked" || event.status === "failed" ? [event.status] : []),
  ]);

  if (whyNow === undefined && factors.length === 0) {
    return {};
  }

  return {
    provenance: {
      ...(whyNow !== undefined ? { whyNow } : {}),
      ...(factors.length > 0 ? { factors } : {}),
    },
  };
}
