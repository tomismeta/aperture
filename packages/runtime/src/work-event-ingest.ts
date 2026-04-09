import { randomUUID } from "node:crypto";

import type {
  AttentionActivityClass,
  AttentionConsequenceLevel,
  HumanInputRequest,
  SourceEvent,
} from "@tomismeta/aperture-core";

export type WorkEventKind =
  | "work.started"
  | "work.updated"
  | "work.completed"
  | "work.cancelled"
  | "input.requested";

export type WorkStatus =
  | "running"
  | "waiting"
  | "blocked"
  | "failed"
  | "completed"
  | "cancelled";

type WorkEventTrace = {
  traceparent?: string;
  tracestate?: string;
};

type WorkEventRun = {
  sessionId?: string;
  runId?: string;
};

type WorkEventActor = {
  id: string;
  kind?: "agent" | "subagent" | "host" | "system" | "human";
  label?: string;
};

type WorkEventFacts = {
  capabilityFamily?: string;
  activityCategory?: string;
};

type WorkEventHints = {
  consequence?: AttentionConsequenceLevel;
  capabilityFamily?: string;
  activityCategory?: string;
  requestKind?: "approval" | "choice" | "form";
};

type WorkEventContext = {
  items?: WorkEventContextItem[];
};

type WorkEventBody = {
  kind: WorkEventKind;
  work: {
    id: string;
    title?: string;
    summary?: string;
    status?: WorkStatus;
    progress?: number;
    reason?: string;
  };
  actor?: WorkEventActor;
  interaction?: {
    id: string;
  };
  request?: WorkEventRequest;
  facts?: WorkEventFacts;
  hints?: WorkEventHints;
  context?: WorkEventContext;
  extensions?: Record<string, unknown>;
};

export type WorkEvent = {
  specVersion: "1.0";
  id: string;
  source: string;
  type: string;
  time?: string;
  subject?: string;
  schema?: string;
  contentType?: string;
  trace?: WorkEventTrace;
  run?: WorkEventRun;
} & WorkEventBody;

export type WorkPayload = string | WorkEvent | WorkEvent[];

export type WorkEventRequest =
  | {
      kind: "approval";
      title?: string;
      summary?: string;
      requireReason?: boolean;
    }
  | {
      kind: "choice";
      title?: string;
      summary?: string;
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
      title?: string;
      summary?: string;
      fields: Array<{
        id: string;
        label: string;
        type: "text" | "textarea" | "number" | "select" | "boolean";
        required?: boolean;
        options?: Array<{
          value: string;
          label: string;
        }>;
      }>;
    };

export type WorkEventContextItem = {
  id: string;
  label?: string;
  value: string | number | boolean;
};

const TASK_UPDATE_STATUSES = new Set<WorkStatus>([
  "running",
  "waiting",
  "blocked",
  "failed",
  "completed",
]);

const WORK_EVENT_KINDS = new Set<WorkEventKind>([
  "work.started",
  "work.updated",
  "work.completed",
  "work.cancelled",
  "input.requested",
]);

const ACTOR_KINDS = new Set(["agent", "subagent", "host", "system", "human"]);

const ACTIVITY_CATEGORY_ALIASES: Record<string, AttentionActivityClass> = {
  permission_request: "permission_request",
  approval_request: "permission_request",
  question_request: "question_request",
  follow_up: "follow_up",
  tool_completion: "tool_completion",
  completion: "tool_completion",
  tool_failure: "tool_failure",
  failure: "tool_failure",
  session_status: "session_status",
  status_update: "status_update",
  status: "status_update",
};

export function normalizeWorkPayload(payload: unknown): WorkPayload {
  if (typeof payload === "string") {
    const text = normalizeWorkText(payload);
    if (text.length === 0) {
      throw new Error("Invalid work payload.");
    }
    return text;
  }

  if (Array.isArray(payload)) {
    const events = payload.map((entry) => validateWorkEvent(entry) ? entry : null);
    if (events.some((event) => event === null)) {
      throw new Error("Invalid work payload.");
    }
    return events as WorkEvent[];
  }

  const event = validateWorkEvent(payload) ? payload : null;
  if (!event) {
    throw new Error("Invalid work payload.");
  }

  return event;
}

export function mapWorkPayloadToSourceEvents(payload: WorkPayload): SourceEvent[] {
  if (typeof payload === "string") {
    return [mapWorkTextToSourceEvent(payload)];
  }

  if (Array.isArray(payload)) {
    return payload.map((event) => mapWorkEventToSourceEvent(event));
  }

  return [mapWorkEventToSourceEvent(payload)];
}

export function mapWorkEventToSourceEvent(event: WorkEvent): SourceEvent {
  const timestamp = event.time ?? new Date().toISOString();
  const source = mapSourceRef(event);

  switch (event.kind) {
    case "work.started":
      return {
        id: event.id,
        type: "task.started",
        taskId: event.work.id,
        timestamp,
        ...(source !== undefined ? { source } : {}),
        title: fallbackTitle(event),
        ...(event.work.summary !== undefined ? { summary: event.work.summary } : {}),
        ...mapSharedSemanticHints(event),
      };
    case "work.updated": {
      const status = event.work.status;
      if (!status || !isTaskUpdateStatus(status)) {
        throw new Error("work.updated requires a valid work.status.");
      }
      const activityClass = readActivityCategory(event.facts?.activityCategory);
      return {
        id: event.id,
        type: "task.updated",
        taskId: event.work.id,
        timestamp,
        ...(source !== undefined ? { source } : {}),
        ...(event.facts?.capabilityFamily !== undefined ? { toolFamily: event.facts.capabilityFamily } : {}),
        ...(activityClass !== undefined ? { activityClass } : {}),
        title: fallbackTitle(event),
        ...(event.work.summary !== undefined ? { summary: event.work.summary } : {}),
        status,
        ...(event.work.progress !== undefined ? { progress: event.work.progress } : {}),
        ...mapSharedSemanticHints(event),
      };
    }
    case "work.completed":
      return {
        id: event.id,
        type: "task.completed",
        taskId: event.work.id,
        timestamp,
        ...(source !== undefined ? { source } : {}),
        ...(event.work.summary !== undefined ? { summary: event.work.summary } : {}),
        ...mapSharedSemanticHints(event),
      };
    case "work.cancelled":
      return {
        id: event.id,
        type: "task.cancelled",
        taskId: event.work.id,
        timestamp,
        ...(source !== undefined ? { source } : {}),
        ...(event.work.reason !== undefined
          ? { reason: event.work.reason }
          : event.work.summary !== undefined
            ? { reason: event.work.summary }
            : {}),
        ...mapSharedSemanticHints(event),
      };
    case "input.requested": {
      if (!event.interaction?.id || !event.request) {
        throw new Error("input.requested requires interaction.id and request.");
      }
      const activityClass = readActivityCategory(event.facts?.activityCategory);
      const context = mapContext(event);
      return {
        id: event.id,
        type: "human.input.requested",
        taskId: event.work.id,
        interactionId: event.interaction.id,
        timestamp,
        ...(source !== undefined ? { source } : {}),
        ...(event.facts?.capabilityFamily !== undefined ? { toolFamily: event.facts.capabilityFamily } : {}),
        ...(activityClass !== undefined ? { activityClass } : {}),
        title: event.request.title ?? event.work.title ?? `Input requested for ${event.work.id}`,
        summary: event.request.summary ?? event.work.summary ?? `Input requested for ${event.work.id}.`,
        request: mapRequest(event.request),
        ...(context !== undefined ? { context } : {}),
        ...(event.hints?.consequence !== undefined ? { riskHint: event.hints.consequence } : {}),
        ...mapSharedSemanticHints(event, { omitConsequence: true }),
      };
    }
  }
}

export function mapWorkTextToSourceEvent(text: string): SourceEvent {
  const normalized = normalizeWorkText(text);
  if (normalized.length === 0) {
    throw new Error("Work text must not be empty.");
  }

  const id = `work:${randomUUID()}`;
  const taskId = id;
  const timestamp = new Date().toISOString();

  if (looksCompleted(normalized)) {
    return {
      id,
      type: "task.completed",
      taskId,
      timestamp,
      summary: normalized,
    };
  }

  if (looksCancelled(normalized)) {
    return {
      id,
      type: "task.cancelled",
      taskId,
      timestamp,
      reason: normalized,
    };
  }

  return {
    id,
    type: "task.updated",
    taskId,
    timestamp,
    title: summarizeWorkText(normalized),
    summary: normalized,
    status: inferTextStatus(normalized),
  };
}

function mapSourceRef(
  event: WorkEvent,
): Extract<SourceEvent, { type: "task.started" }>["source"] | undefined {
  if (event.source.trim() === "" && event.actor?.id === undefined) {
    return undefined;
  }
  return {
    id: event.actor?.id ?? event.source,
    kind: event.source,
    ...(event.actor?.label !== undefined ? { label: event.actor.label } : {}),
  };
}

function fallbackTitle(event: WorkEvent): string {
  return event.work.title ?? event.work.summary ?? event.work.id;
}

function normalizeWorkText(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

function summarizeWorkText(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  const firstSentence = collapsed.match(/^(.{1,96}?)(?:[.!?\n]|$)/)?.[1] ?? collapsed;
  if (firstSentence.length <= 96) {
    return firstSentence;
  }
  return `${firstSentence.slice(0, 93).trimEnd()}...`;
}

function inferTextStatus(
  text: string,
): "running" | "waiting" | "blocked" {
  if (looksBlocked(text)) {
    return "blocked";
  }
  if (looksWaiting(text)) {
    return "waiting";
  }
  return "running";
}

function mapRequest(request: WorkEventRequest): HumanInputRequest {
  switch (request.kind) {
    case "approval":
      return {
        kind: "approval",
        ...(request.requireReason !== undefined ? { requireReason: request.requireReason } : {}),
      };
    case "choice":
      return {
        kind: "choice",
        selectionMode: request.selectionMode,
        ...(request.allowTextResponse !== undefined ? { allowTextResponse: request.allowTextResponse } : {}),
        options: request.options.map((option) => ({
          id: option.id,
          label: option.label,
          ...(option.summary !== undefined ? { summary: option.summary } : {}),
        })),
      };
    case "form":
      return {
        kind: "form",
        fields: request.fields.map((field) => ({
          id: field.id,
          label: field.label,
          type: field.type,
          ...(field.required !== undefined ? { required: field.required } : {}),
          ...(field.options !== undefined ? { options: field.options } : {}),
        })),
      };
  }
}

function mapContext(
  event: WorkEvent,
): Extract<SourceEvent, { type: "human.input.requested" }>["context"] | undefined {
  const items = event.context?.items?.map((item) => ({
    id: item.id,
    label: item.label ?? item.id,
    value: String(item.value),
  }));

  if (event.work.progress === undefined && (!items || items.length === 0)) {
    return undefined;
  }

  return {
    ...(event.work.progress !== undefined ? { progress: event.work.progress } : {}),
    ...(items && items.length > 0 ? { items } : {}),
  };
}

function mapSharedSemanticHints(
  event: WorkEvent,
  options: { omitConsequence?: boolean } = {},
): Partial<Pick<SourceEvent, "semanticHints">> {
  const semanticHints: NonNullable<SourceEvent["semanticHints"]> = {};

  if (!options.omitConsequence && event.hints?.consequence !== undefined) {
    semanticHints.consequence = event.hints.consequence;
  }
  if (event.hints?.capabilityFamily !== undefined) {
    semanticHints.toolFamily = event.hints.capabilityFamily;
  }
  if (event.hints?.activityCategory !== undefined) {
    const activityClass = readActivityCategory(event.hints.activityCategory);
    if (activityClass) {
      semanticHints.activityClass = activityClass;
    }
  }
  if (event.hints?.requestKind !== undefined) {
    semanticHints.intentFrame = mapRequestKindToIntentFrame(event.hints.requestKind);
  }

  return Object.keys(semanticHints).length === 0 ? {} : { semanticHints };
}

function mapRequestKindToIntentFrame(
  requestKind: NonNullable<NonNullable<WorkEvent["hints"]>["requestKind"]>,
): "approval_request" | "question_request" | "form_request" {
  switch (requestKind) {
    case "approval":
      return "approval_request";
    case "choice":
      return "question_request";
    case "form":
      return "form_request";
  }
}

function readActivityCategory(value: string | undefined): AttentionActivityClass | undefined {
  if (!value) {
    return undefined;
  }
  return ACTIVITY_CATEGORY_ALIASES[value];
}

function isTaskUpdateStatus(
  value: WorkStatus,
): value is Exclude<WorkStatus, "cancelled"> {
  return TASK_UPDATE_STATUSES.has(value);
}

function looksCompleted(text: string): boolean {
  return /\b(completed?|finished?|done|succeeded?|successful|resolved?)\b/i.test(text);
}

function looksCancelled(text: string): boolean {
  return /\b(cancelled?|canceled|aborted?|stopped?)\b/i.test(text);
}

function looksBlocked(text: string): boolean {
  return /\b(blocked?|stuck|cannot continue|can't continue|unable to continue)\b/i.test(text);
}

function looksWaiting(text: string): boolean {
  return /\b(waiting|awaiting|pending|needs approval|approval needed|review needed|needs review)\b/i.test(text);
}

function isWorkEventKind(value: string): value is WorkEventKind {
  return WORK_EVENT_KINDS.has(value as WorkEventKind);
}

function validateWorkEvent(value: unknown): value is WorkEvent {
  if (!isRecord(value)) {
    return false;
  }

  if (
    value.specVersion !== "1.0"
    || typeof value.id !== "string"
    || typeof value.source !== "string"
    || typeof value.type !== "string"
    || (value.time !== undefined && typeof value.time !== "string")
    || (value.subject !== undefined && typeof value.subject !== "string")
    || (value.schema !== undefined && typeof value.schema !== "string")
    || (value.contentType !== undefined && typeof value.contentType !== "string")
    || (value.trace !== undefined && !validateTrace(value.trace))
    || (value.run !== undefined && !validateRun(value.run))
  ) {
    return false;
  }

  return validateWorkEventBody(value);
}

function validateWorkEventBody(value: unknown): value is WorkEventBody {
  if (!isRecord(value) || typeof value.kind !== "string" || !isWorkEventKind(value.kind)) {
    return false;
  }
  if (!validateWork(value.work)) {
    return false;
  }
  if (
    (value.actor !== undefined && !validateActor(value.actor))
    || (value.interaction !== undefined && !validateInteraction(value.interaction))
    || (value.request !== undefined && !validateRequest(value.request))
    || (value.facts !== undefined && !validateFacts(value.facts))
    || (value.hints !== undefined && !validateHints(value.hints))
    || (value.context !== undefined && !validateContext(value.context))
    || (value.extensions !== undefined && !isRecord(value.extensions))
  ) {
    return false;
  }
  if (value.kind === "input.requested") {
    return value.interaction !== undefined && value.request !== undefined;
  }
  if (value.kind === "work.updated") {
    return value.work.status !== undefined && TASK_UPDATE_STATUSES.has(value.work.status);
  }
  return true;
}

function validateWork(value: unknown): value is WorkEvent["work"] {
  return isRecord(value)
    && typeof value.id === "string"
    && (value.title === undefined || typeof value.title === "string")
    && (value.summary === undefined || typeof value.summary === "string")
    && (value.status === undefined || typeof value.status === "string")
    && (value.progress === undefined || (typeof value.progress === "number" && value.progress >= 0 && value.progress <= 1))
    && (value.reason === undefined || typeof value.reason === "string");
}

function validateActor(value: unknown): value is NonNullable<WorkEvent["actor"]> {
  return isRecord(value)
    && typeof value.id === "string"
    && (value.kind === undefined || (typeof value.kind === "string" && ACTOR_KINDS.has(value.kind)))
    && (value.label === undefined || typeof value.label === "string");
}

function validateInteraction(value: unknown): value is NonNullable<WorkEvent["interaction"]> {
  return isRecord(value) && typeof value.id === "string";
}

function validateRequest(value: unknown): value is WorkEventRequest {
  if (!isRecord(value) || typeof value.kind !== "string") {
    return false;
  }

  switch (value.kind) {
    case "approval":
      return (value.title === undefined || typeof value.title === "string")
        && (value.summary === undefined || typeof value.summary === "string")
        && (value.requireReason === undefined || typeof value.requireReason === "boolean");
    case "choice":
      return (value.title === undefined || typeof value.title === "string")
        && (value.summary === undefined || typeof value.summary === "string")
        && (value.selectionMode === "single" || value.selectionMode === "multiple")
        && (value.allowTextResponse === undefined || typeof value.allowTextResponse === "boolean")
        && Array.isArray(value.options)
        && value.options.length > 0
        && value.options.every((option) => isRecord(option)
          && typeof option.id === "string"
          && typeof option.label === "string"
          && (option.summary === undefined || typeof option.summary === "string"));
    case "form":
      return (value.title === undefined || typeof value.title === "string")
        && (value.summary === undefined || typeof value.summary === "string")
        && Array.isArray(value.fields)
        && value.fields.length > 0
        && value.fields.every((field) => isRecord(field)
          && typeof field.id === "string"
          && typeof field.label === "string"
          && (field.type === "text"
            || field.type === "textarea"
            || field.type === "number"
            || field.type === "select"
            || field.type === "boolean")
          && (field.required === undefined || typeof field.required === "boolean")
          && (field.options === undefined
            || (Array.isArray(field.options)
              && field.options.every((option) => isRecord(option)
                && typeof option.value === "string"
                && typeof option.label === "string"))));
    default:
      return false;
  }
}

function validateFacts(value: unknown): value is WorkEventFacts {
  return isRecord(value)
    && (value.capabilityFamily === undefined || typeof value.capabilityFamily === "string")
    && (value.activityCategory === undefined || typeof value.activityCategory === "string");
}

function validateHints(value: unknown): value is WorkEventHints {
  return isRecord(value)
    && (value.consequence === undefined
      || value.consequence === "low"
      || value.consequence === "medium"
      || value.consequence === "high")
    && (value.capabilityFamily === undefined || typeof value.capabilityFamily === "string")
    && (value.activityCategory === undefined || typeof value.activityCategory === "string")
    && (value.requestKind === undefined
      || value.requestKind === "approval"
      || value.requestKind === "choice"
      || value.requestKind === "form");
}

function validateContext(value: unknown): value is WorkEventContext {
  return isRecord(value)
    && (value.items === undefined
      || (Array.isArray(value.items)
        && value.items.every((item) => isRecord(item)
          && typeof item.id === "string"
          && (item.label === undefined || typeof item.label === "string")
          && (typeof item.value === "string" || typeof item.value === "number" || typeof item.value === "boolean"))));
}

function validateTrace(value: unknown): value is WorkEventTrace {
  return isRecord(value)
    && (value.traceparent === undefined || typeof value.traceparent === "string")
    && (value.tracestate === undefined || typeof value.tracestate === "string");
}

function validateRun(value: unknown): value is WorkEventRun {
  return isRecord(value)
    && (value.sessionId === undefined || typeof value.sessionId === "string")
    && (value.runId === undefined || typeof value.runId === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
