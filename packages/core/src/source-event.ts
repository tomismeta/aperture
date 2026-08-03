import type { AttentionActivityClass, HumanInputRequest, SourceRef, TaskStatus } from "./events.js";
import type { AttentionConsequenceLevel, AttentionContext, AttentionProvenance } from "./frame.js";
import type { SemanticInterpretationHints } from "./semantic-types.js";

/**
 * Adapter-facing input contract.
 *
 * `SourceEvent` is the thin factual seam where host-native payloads enter core.
 * Adapters can preserve identity, bounded hints, and explicit source facts here,
 * but canonical semantics are not final until `normalizeSourceEvent(...)` runs.
 */
export type SourceEvent =
  | SourceTaskStartedEvent
  | SourceTaskUpdatedEvent
  | SourceHumanInputRequestedEvent
  | SourceTaskCompletedEvent
  | SourceTaskCancelledEvent;

type SourceEventBase = {
  id: string;
  taskId: string;
  timestamp: string;
  source?: SourceRef;
  /**
   * Adapter-preserved metadata for audit, provenance, and review surfaces.
   *
   * Core does not route on arbitrary metadata directly. Promote source-quality
   * facts through `semanticHints` when they should affect interpretation;
   * documented adapter aliases are normalized into source fields before
   * judgment. Other metadata is carried through so runtimes and operators can
   * inspect external execution and governance facts without forcing them into
   * the canonical semantic vocabulary.
   */
  metadata?: Record<string, unknown>;
  /**
   * Adapter-provided semantic hints.
   *
   * These are source-side inputs into interpretation, not canonical semantic
   * output from Aperture Core.
   */
  semanticHints?: SemanticInterpretationHints;
};

export type SourceTaskStartedEvent = SourceEventBase & {
  type: "task.started";
  title: string;
  summary?: string;
};

export type SourceTaskUpdatedEvent = SourceEventBase & {
  type: "task.updated";
  toolFamily?: string;
  activityClass?: AttentionActivityClass;
  title: string;
  summary?: string;
  status: TaskStatus;
  progress?: number;
  context?: AttentionContext;
};

export type SourceHumanInputRequestedEvent = SourceEventBase & {
  type: "human.input.requested";
  interactionId: string;
  toolFamily?: string;
  activityClass?: AttentionActivityClass;
  title: string;
  summary: string;
  request: HumanInputRequest;
  context?: AttentionContext;
  provenance?: AttentionProvenance;
  /**
   * Source-side consequence hint.
   *
   * Adapters publish `riskHint`; normalized Aperture events carry canonical
   * `consequence` once semantic interpretation has run.
   */
  riskHint?: AttentionConsequenceLevel;
};

export type SourceTaskCompletedEvent = SourceEventBase & {
  type: "task.completed";
  summary?: string;
};

export type SourceTaskCancelledEvent = SourceEventBase & {
  type: "task.cancelled";
  reason?: string;
};
