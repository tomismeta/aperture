import type {
  AttentionActivityClass,
  AttentionConsequenceLevel,
} from "./attention-contract-types.js";
import type { AttentionContext, AttentionProvenance, AttentionTone } from "./frame.js";
import type { SemanticInterpretation } from "./semantic-types.js";

/**
 * Canonical core event contract.
 *
 * `ApertureEvent` is the normalized meaning layer that `EventEvaluator`
 * consumes. It carries the richer semantic read that core inferred or accepted
 * from source hints, while still preserving explicit routing authority where
 * needed, especially on `task.updated` status paths.
 */
export type ApertureEvent =
  | TaskStartedEvent
  | TaskUpdatedEvent
  | HumanInputRequestedEvent
  | TaskCompletedEvent
  | TaskCancelledEvent;

/**
 * Finalized internal event contract after normalization or bounded semantic
 * defaulting.
 *
 * `EnrichedApertureEvent` keeps the public `ApertureEvent` flexible while
 * giving the runtime a stricter post-normalization contract: semantic meaning
 * is always present before evaluation and judgment.
 */
export type EnrichedApertureEvent =
  | EnrichedTaskStartedEvent
  | EnrichedTaskUpdatedEvent
  | EnrichedHumanInputRequestedEvent
  | EnrichedTaskCompletedEvent
  | EnrichedTaskCancelledEvent;

export type TaskStatus = "running" | "blocked" | "waiting" | "completed" | "failed";

type SourceEvidenceChannel = "command" | "read" | "search" | "structured" | "transcript";
type SourceEvidenceSubject = "command" | "document" | "search" | "source" | "tool";

/**
 * Explicit source facts about the evidence carried by a failed task update.
 *
 * Core derives the normalized Observation, provenance authority, evidence
 * strength, semantic agreement, recovery, consequence, and judgment. Capability
 * identity remains separate and opaque.
 */
export type SourceEvidence =
  | {
      kind: "outcome";
      outcome: "success" | "failure";
      subject: SourceEvidenceSubject;
      channel: SourceEvidenceChannel;
      complete: true;
    }
  | {
      kind: "diagnostic";
      diagnostic: "runtime" | "expected";
      subject: SourceEvidenceSubject;
      channel: SourceEvidenceChannel;
      complete: true;
    }
  | {
      kind: "diagnostic";
      diagnostic: "source_limit";
      channel: "read";
      window: {
        unit: "bytes" | "lines";
        offset: number;
        length: number;
        total: number;
      };
    }
  | {
      kind: "payload";
      subject: Exclude<SourceEvidenceSubject, "command">;
      channel: SourceEvidenceChannel;
      complete: true;
    }
  | {
      kind: "authorization";
      state: "required";
      execution: "not_started";
      result: "absent";
    };

export type { AttentionActivityClass } from "./attention-contract-types.js";

export type SourceRef = {
  id: string;
  kind?: string;
  label?: string;
};

type EventBase = {
  id: string;
  taskId: string;
  timestamp: string;
  source?: SourceRef;
  metadata?: Record<string, unknown>;
  semantic?: SemanticInterpretation;
};

type WithRequiredSemantic<T extends EventBase> = T extends EventBase
  ? Omit<T, "semantic"> & { semantic: SemanticInterpretation }
  : never;

export type TaskStartedEvent = EventBase & {
  type: "task.started";
  title: string;
  summary?: string;
};
export type EnrichedTaskStartedEvent = WithRequiredSemantic<TaskStartedEvent>;

type TaskUpdatedEventFields = EventBase & {
  type: "task.updated";
  toolFamily?: string;
  activityClass?: AttentionActivityClass;
  title: string;
  summary?: string;
  /** Runtime-valid only when status is failed; validation rejects other combinations. */
  evidence?: SourceEvidence;
  status: TaskStatus;
  progress?: number;
  context?: AttentionContext;
};
export type TaskUpdatedEvent = TaskUpdatedEventFields;
export type EnrichedTaskUpdatedEvent = WithRequiredSemantic<TaskUpdatedEvent>;

export type HumanInputRequestKind = "approval" | "choice" | "form";

export type HumanInputRequestedEvent = EventBase & {
  type: "human.input.requested";
  interactionId: string;
  toolFamily?: string;
  activityClass?: AttentionActivityClass;
  title: string;
  summary: string;
  tone?: AttentionTone;
  consequence?: AttentionConsequenceLevel;
  request: HumanInputRequest;
  context?: AttentionContext;
  provenance?: AttentionProvenance;
};
export type EnrichedHumanInputRequestedEvent = WithRequiredSemantic<HumanInputRequestedEvent>;

export type HumanInputRequest =
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

export type TaskCompletedEvent = EventBase & {
  type: "task.completed";
  summary?: string;
};
export type EnrichedTaskCompletedEvent = WithRequiredSemantic<TaskCompletedEvent>;

export type TaskCancelledEvent = EventBase & {
  type: "task.cancelled";
  reason?: string;
};
export type EnrichedTaskCancelledEvent = WithRequiredSemantic<TaskCancelledEvent>;
