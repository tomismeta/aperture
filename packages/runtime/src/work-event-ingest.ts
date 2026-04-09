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
  specVersion?: "1.0";
  id?: string;
  source?: string;
  type?: string;
  time?: string;
  subject?: string;
  schema?: string;
  contentType?: string;
  trace?: WorkEventTrace;
  run?: WorkEventRun;
} & WorkEventBody;

type NormalizedWorkEvent = {
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

export type WorkInput = string | WorkEvent | WorkEvent[];

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

const WORK_EVENT_SPEC_VERSION = "1.0";
const DEFAULT_WORK_EVENT_SOURCE = "urn:aperture:work";

export function normalizeWorkPayload(payload: unknown): WorkInput {
  if (typeof payload === "string") {
    const text = normalizeWorkText(payload);
    if (text.length === 0) {
      throw new Error(workInputGuidance("Plain-text work input must not be empty."));
    }
    return text;
  }

  if (Array.isArray(payload)) {
    if (payload.length === 0) {
      throw new Error(workInputGuidance("WorkEvent[] must contain at least one item."));
    }
    return payload.map((entry, index) => {
      try {
        return normalizeWorkEvent(entry);
      } catch (error) {
        throw new Error(workInputGuidance(`Invalid WorkEvent at index ${index}: ${formatWorkEventError(error)}.`));
      }
    });
  }

  if (!isRecord(payload)) {
    throw new Error(workInputGuidance("Work input must be plain text, one WorkEvent object, or a WorkEvent[] array."));
  }

  try {
    return normalizeWorkEvent(payload);
  } catch (error) {
    throw new Error(workInputGuidance(`Invalid WorkEvent: ${formatWorkEventError(error)}.`));
  }
}

export function mapWorkPayloadToSourceEvents(payload: WorkInput): SourceEvent[] {
  if (typeof payload === "string") {
    return [mapWorkTextToSourceEvent(payload)];
  }

  if (Array.isArray(payload)) {
    return payload.map((event) => mapWorkEventToSourceEvent(event));
  }

  return [mapWorkEventToSourceEvent(payload)];
}

export function mapWorkEventToSourceEvent(event: WorkEvent): SourceEvent {
  const normalizedEvent = normalizeWorkEvent(event);
  const timestamp = normalizedEvent.time ?? new Date().toISOString();
  const source = mapSourceRef(normalizedEvent);

  switch (normalizedEvent.kind) {
    case "work.started":
      return {
        id: normalizedEvent.id,
        type: "task.started",
        taskId: normalizedEvent.work.id,
        timestamp,
        ...(source !== undefined ? { source } : {}),
        title: fallbackTitle(normalizedEvent),
        ...(normalizedEvent.work.summary !== undefined ? { summary: normalizedEvent.work.summary } : {}),
        ...mapSharedSemanticHints(normalizedEvent),
      };
    case "work.updated": {
      const status = normalizedEvent.work.status;
      if (!status || !isTaskUpdateStatus(status)) {
        throw new Error("work.updated requires a valid work.status.");
      }
      const activityClass = readActivityCategory(normalizedEvent.facts?.activityCategory);
      return {
        id: normalizedEvent.id,
        type: "task.updated",
        taskId: normalizedEvent.work.id,
        timestamp,
        ...(source !== undefined ? { source } : {}),
        ...(normalizedEvent.facts?.capabilityFamily !== undefined ? { toolFamily: normalizedEvent.facts.capabilityFamily } : {}),
        ...(activityClass !== undefined ? { activityClass } : {}),
        title: fallbackTitle(normalizedEvent),
        ...(normalizedEvent.work.summary !== undefined ? { summary: normalizedEvent.work.summary } : {}),
        status,
        ...(normalizedEvent.work.progress !== undefined ? { progress: normalizedEvent.work.progress } : {}),
        ...mapSharedSemanticHints(normalizedEvent),
      };
    }
    case "work.completed":
      return {
        id: normalizedEvent.id,
        type: "task.completed",
        taskId: normalizedEvent.work.id,
        timestamp,
        ...(source !== undefined ? { source } : {}),
        ...(normalizedEvent.work.summary !== undefined ? { summary: normalizedEvent.work.summary } : {}),
        ...mapSharedSemanticHints(normalizedEvent),
      };
    case "work.cancelled":
      return {
        id: normalizedEvent.id,
        type: "task.cancelled",
        taskId: normalizedEvent.work.id,
        timestamp,
        ...(source !== undefined ? { source } : {}),
        ...(normalizedEvent.work.reason !== undefined
          ? { reason: normalizedEvent.work.reason }
          : normalizedEvent.work.summary !== undefined
            ? { reason: normalizedEvent.work.summary }
            : {}),
        ...mapSharedSemanticHints(normalizedEvent),
      };
    case "input.requested": {
      if (!normalizedEvent.interaction?.id || !normalizedEvent.request) {
        throw new Error("input.requested requires interaction.id and request.");
      }
      const activityClass = readActivityCategory(normalizedEvent.facts?.activityCategory);
      const context = mapContext(normalizedEvent);
      return {
        id: normalizedEvent.id,
        type: "human.input.requested",
        taskId: normalizedEvent.work.id,
        interactionId: normalizedEvent.interaction.id,
        timestamp,
        ...(source !== undefined ? { source } : {}),
        ...(normalizedEvent.facts?.capabilityFamily !== undefined ? { toolFamily: normalizedEvent.facts.capabilityFamily } : {}),
        ...(activityClass !== undefined ? { activityClass } : {}),
        title:
          normalizedEvent.request.title
          ?? normalizedEvent.work.title
          ?? `Input requested for ${normalizedEvent.work.id}`,
        summary:
          normalizedEvent.request.summary
          ?? normalizedEvent.work.summary
          ?? `Input requested for ${normalizedEvent.work.id}.`,
        request: mapRequest(normalizedEvent.request),
        ...(context !== undefined ? { context } : {}),
        ...(normalizedEvent.hints?.consequence !== undefined ? { riskHint: normalizedEvent.hints.consequence } : {}),
        ...mapSharedSemanticHints(normalizedEvent, { omitConsequence: true }),
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

function normalizeWorkEvent(value: unknown): NormalizedWorkEvent {
  if (!isRecord(value)) {
    throw new Error("WorkEvent must be a JSON object");
  }

  const kind = normalizeWorkEventKind(value.kind);
  const work = normalizeWork(value.work);
  const actor = value.actor === undefined ? undefined : normalizeActor(value.actor);
  const interaction = value.interaction === undefined ? undefined : normalizeInteraction(value.interaction);
  const request = value.request === undefined ? undefined : normalizeRequest(value.request);
  const facts = value.facts === undefined ? undefined : normalizeFacts(value.facts);
  const hints = value.hints === undefined ? undefined : normalizeHints(value.hints);
  const context = value.context === undefined ? undefined : normalizeContext(value.context);
  const extensions = value.extensions === undefined ? undefined : normalizeExtensions(value.extensions);
  const trace = value.trace === undefined ? undefined : normalizeTrace(value.trace);
  const run = value.run === undefined ? undefined : normalizeRun(value.run);
  const time = normalizeOptionalLooseString(value.time, "time");
  const subject = normalizeOptionalString(value.subject, "subject");
  const schema = normalizeOptionalString(value.schema, "schema");
  const contentType = normalizeOptionalString(value.contentType, "contentType");

  if (kind === "input.requested" && interaction === undefined) {
    throw new Error("input.requested requires interaction.id");
  }
  if (kind === "input.requested" && request === undefined) {
    throw new Error("input.requested requires request");
  }
  if (kind === "work.updated" && (work.status === undefined || !isTaskUpdateStatus(work.status))) {
    throw new Error("work.updated requires work.status to be running, waiting, blocked, failed, or completed");
  }

  return {
    specVersion: normalizeSpecVersion(value.specVersion),
    id: normalizeOptionalString(value.id, "id") ?? `evt:${randomUUID()}`,
    source: normalizeOptionalString(value.source, "source") ?? DEFAULT_WORK_EVENT_SOURCE,
    type: normalizeOptionalString(value.type, "type") ?? buildWorkEventType(kind),
    ...(time !== undefined ? { time } : {}),
    ...(subject !== undefined ? { subject } : {}),
    ...(schema !== undefined ? { schema } : {}),
    ...(contentType !== undefined ? { contentType } : {}),
    ...(trace !== undefined ? { trace } : {}),
    ...(run !== undefined ? { run } : {}),
    kind,
    work,
    ...(actor !== undefined ? { actor } : {}),
    ...(interaction !== undefined ? { interaction } : {}),
    ...(request !== undefined ? { request } : {}),
    ...(facts !== undefined ? { facts } : {}),
    ...(hints !== undefined ? { hints } : {}),
    ...(context !== undefined ? { context } : {}),
    ...(extensions !== undefined ? { extensions } : {}),
  };
}

function normalizeSpecVersion(value: unknown): "1.0" {
  if (value === undefined) {
    return WORK_EVENT_SPEC_VERSION;
  }
  if (value !== WORK_EVENT_SPEC_VERSION) {
    throw new Error("specVersion must be \"1.0\"");
  }
  return WORK_EVENT_SPEC_VERSION;
}

function normalizeWorkEventKind(value: unknown): WorkEventKind {
  if (typeof value !== "string" || !isWorkEventKind(value)) {
    throw new Error("kind must be one of work.started, work.updated, work.completed, work.cancelled, or input.requested");
  }
  return value;
}

function normalizeWork(value: unknown): WorkEvent["work"] {
  if (!isRecord(value)) {
    throw new Error("work must be an object");
  }

  const id = normalizeRequiredString(value.id, "work.id");
  const title = normalizeOptionalString(value.title, "work.title");
  const summary = normalizeOptionalLooseString(value.summary, "work.summary");
  const status = normalizeOptionalWorkStatus(value.status);
  const progress = normalizeOptionalProgress(value.progress);
  const reason = normalizeOptionalLooseString(value.reason, "work.reason");

  return {
    id,
    ...(title !== undefined ? { title } : {}),
    ...(summary !== undefined ? { summary } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(progress !== undefined ? { progress } : {}),
    ...(reason !== undefined ? { reason } : {}),
  };
}

function normalizeActor(value: unknown): NonNullable<WorkEvent["actor"]> {
  if (!isRecord(value)) {
    throw new Error("actor must be an object");
  }

  const kind = value.kind === undefined
    ? undefined
    : typeof value.kind === "string" && ACTOR_KINDS.has(value.kind)
      ? value.kind as NonNullable<WorkEvent["actor"]>["kind"]
      : fail("actor.kind must be one of agent, subagent, host, system, or human");

  return {
    id: normalizeRequiredString(value.id, "actor.id"),
    ...withOptional("kind", kind),
    ...withOptional("label", normalizeOptionalString(value.label, "actor.label")),
  };
}

function normalizeInteraction(value: unknown): NonNullable<WorkEvent["interaction"]> {
  if (!isRecord(value)) {
    throw new Error("interaction must be an object");
  }
  return {
    id: normalizeRequiredString(value.id, "interaction.id"),
  };
}

function normalizeRequest(value: unknown): WorkEventRequest {
  if (!isRecord(value) || typeof value.kind !== "string") {
    throw new Error("request.kind must be approval, choice, or form");
  }

  switch (value.kind) {
    case "approval":
      {
        const title = normalizeOptionalString(value.title, "request.title");
        const summary = normalizeOptionalLooseString(value.summary, "request.summary");
        const requireReason = value.requireReason === undefined
          ? undefined
          : typeof value.requireReason === "boolean"
            ? value.requireReason
            : fail("request.requireReason must be boolean");
      return {
        kind: "approval",
        ...withOptional("title", title),
        ...withOptional("summary", summary),
        ...withOptional("requireReason", requireReason),
      };
      }
    case "choice":
      {
        const title = normalizeOptionalString(value.title, "request.title");
        const summary = normalizeOptionalLooseString(value.summary, "request.summary");
        const allowTextResponse = value.allowTextResponse === undefined
          ? undefined
          : typeof value.allowTextResponse === "boolean"
            ? value.allowTextResponse
            : fail("request.allowTextResponse must be boolean");
      return {
        kind: "choice",
        ...withOptional("title", title),
        ...withOptional("summary", summary),
        selectionMode:
          value.selectionMode === "single" || value.selectionMode === "multiple"
            ? value.selectionMode
            : fail("request.selectionMode must be single or multiple"),
        ...withOptional("allowTextResponse", allowTextResponse),
        options: normalizeRequestOptions(value.options),
      };
      }
    case "form":
      {
        const title = normalizeOptionalString(value.title, "request.title");
        const summary = normalizeOptionalLooseString(value.summary, "request.summary");
      return {
        kind: "form",
        ...withOptional("title", title),
        ...withOptional("summary", summary),
        fields: normalizeRequestFields(value.fields),
      };
      }
    default:
      throw new Error("request.kind must be approval, choice, or form");
  }
}

function normalizeRequestOptions(value: unknown): NonNullable<Extract<WorkEventRequest, { kind: "choice" }>["options"]> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("request.options must be a non-empty array");
  }
  return value.map((option, index) => {
    if (!isRecord(option)) {
      throw new Error(`request.options[${index}] must be an object`);
    }
    return {
      id: normalizeRequiredString(option.id, `request.options[${index}].id`),
      label: normalizeRequiredString(option.label, `request.options[${index}].label`),
      ...withOptional("summary", normalizeOptionalLooseString(option.summary, `request.options[${index}].summary`)),
    };
  });
}

function normalizeRequestFields(value: unknown): NonNullable<Extract<WorkEventRequest, { kind: "form" }>["fields"]> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("request.fields must be a non-empty array");
  }
  return value.map((field, index) => {
    if (!isRecord(field)) {
      throw new Error(`request.fields[${index}] must be an object`);
    }

    const type = field.type;
    if (
      type !== "text"
      && type !== "textarea"
      && type !== "number"
      && type !== "select"
      && type !== "boolean"
    ) {
      throw new Error(`request.fields[${index}].type must be text, textarea, number, select, or boolean`);
    }

    return {
      id: normalizeRequiredString(field.id, `request.fields[${index}].id`),
      label: normalizeRequiredString(field.label, `request.fields[${index}].label`),
      type,
      ...withOptional(
        "required",
        field.required === undefined
          ? undefined
          : typeof field.required === "boolean"
            ? field.required
            : fail(`request.fields[${index}].required must be boolean`),
      ),
      ...withOptional("options", field.options !== undefined ? normalizeRequestFieldOptions(field.options, index) : undefined),
    };
  });
}

function normalizeRequestFieldOptions(
  value: unknown,
  fieldIndex: number,
): Array<{ value: string; label: string }> {
  if (!Array.isArray(value)) {
    throw new Error(`request.fields[${fieldIndex}].options must be an array`);
  }
  return value.map((option, optionIndex) => {
    if (!isRecord(option)) {
      throw new Error(`request.fields[${fieldIndex}].options[${optionIndex}] must be an object`);
    }
    return {
      value: normalizeRequiredString(option.value, `request.fields[${fieldIndex}].options[${optionIndex}].value`),
      label: normalizeRequiredString(option.label, `request.fields[${fieldIndex}].options[${optionIndex}].label`),
    };
  });
}

function normalizeFacts(value: unknown): WorkEventFacts {
  if (!isRecord(value)) {
    throw new Error("facts must be an object");
  }
  return {
    ...withOptional("capabilityFamily", normalizeOptionalString(value.capabilityFamily, "facts.capabilityFamily")),
    ...withOptional("activityCategory", normalizeOptionalString(value.activityCategory, "facts.activityCategory")),
  };
}

function normalizeHints(value: unknown): WorkEventHints {
  if (!isRecord(value)) {
    throw new Error("hints must be an object");
  }

  const consequence: AttentionConsequenceLevel | undefined = value.consequence === undefined
    ? undefined
    : value.consequence === "low" || value.consequence === "medium" || value.consequence === "high"
      ? value.consequence
      : fail("hints.consequence must be low, medium, or high");
  const requestKind: WorkEventHints["requestKind"] = value.requestKind === undefined
    ? undefined
    : value.requestKind === "approval" || value.requestKind === "choice" || value.requestKind === "form"
      ? value.requestKind
      : fail("hints.requestKind must be approval, choice, or form");

  return {
    ...withOptional("consequence", consequence),
    ...withOptional("capabilityFamily", normalizeOptionalString(value.capabilityFamily, "hints.capabilityFamily")),
    ...withOptional("activityCategory", normalizeOptionalString(value.activityCategory, "hints.activityCategory")),
    ...withOptional("requestKind", requestKind),
  };
}

function normalizeContext(value: unknown): WorkEventContext {
  if (!isRecord(value)) {
    throw new Error("context must be an object");
  }
  if (value.items === undefined) {
    return {};
  }
  if (!Array.isArray(value.items)) {
    throw new Error("context.items must be an array");
  }
  return {
    items: value.items.map((item, index) => {
      if (!isRecord(item)) {
        throw new Error(`context.items[${index}] must be an object`);
      }
      const rawValue = item.value;
      if (
        typeof rawValue !== "string"
        && typeof rawValue !== "number"
        && typeof rawValue !== "boolean"
      ) {
        throw new Error(`context.items[${index}].value must be string, number, or boolean`);
      }
      return {
        id: normalizeRequiredString(item.id, `context.items[${index}].id`),
        ...withOptional("label", normalizeOptionalString(item.label, `context.items[${index}].label`)),
        value: rawValue,
      };
    }),
  };
}

function normalizeExtensions(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error("extensions must be an object");
  }
  return value;
}

function normalizeTrace(value: unknown): WorkEventTrace {
  if (!isRecord(value)) {
    throw new Error("trace must be an object");
  }
  return {
    ...withOptional("traceparent", normalizeOptionalString(value.traceparent, "trace.traceparent")),
    ...withOptional("tracestate", normalizeOptionalString(value.tracestate, "trace.tracestate")),
  };
}

function normalizeRun(value: unknown): WorkEventRun {
  if (!isRecord(value)) {
    throw new Error("run must be an object");
  }
  return {
    ...withOptional("sessionId", normalizeOptionalString(value.sessionId, "run.sessionId")),
    ...withOptional("runId", normalizeOptionalString(value.runId, "run.runId")),
  };
}

function normalizeOptionalWorkStatus(value: unknown): WorkStatus | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    value === "running"
    || value === "waiting"
    || value === "blocked"
    || value === "failed"
    || value === "completed"
    || value === "cancelled"
  ) {
    return value;
  }
  throw new Error("work.status must be running, waiting, blocked, failed, completed, or cancelled");
}

function normalizeOptionalProgress(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || Number.isNaN(value) || value < 0 || value > 1) {
    throw new Error("work.progress must be a number between 0 and 1");
  }
  return value;
}

function mapSourceRef(
  event: NormalizedWorkEvent,
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

function fallbackTitle(event: NormalizedWorkEvent): string {
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
): "running" | "waiting" | "blocked" | "failed" {
  if (looksFailed(text)) {
    return "failed";
  }
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
  event: NormalizedWorkEvent,
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
  event: NormalizedWorkEvent,
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
  requestKind: NonNullable<NonNullable<NormalizedWorkEvent["hints"]>["requestKind"]>,
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
  if (/\b(not|still)\s+(yet\s+)?(completed?|finished?|done|resolved?)\b/i.test(text)) {
    return false;
  }
  return /\b(completed?|finished?|succeeded?|successful|resolved?)\b/i.test(text);
}

function looksCancelled(text: string): boolean {
  return /\b(cancelled?|canceled|aborted?|stopped?)\b/i.test(text);
}

function looksBlocked(text: string): boolean {
  return /\b(blocked?|stuck|cannot continue|can't continue|unable to continue)\b/i.test(text);
}

function looksFailed(text: string): boolean {
  return /\b(failed?|failure|errored?|crashed?|timed out|timeout)\b/i.test(text);
}

function looksWaiting(text: string): boolean {
  return /\b(waiting|awaiting|pending|needs approval|approval needed|review needed|needs review)\b/i.test(text);
}

function isWorkEventKind(value: string): value is WorkEventKind {
  return WORK_EVENT_KINDS.has(value as WorkEventKind);
}

function normalizeRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function normalizeOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function normalizeOptionalLooseString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string`);
  }
  return value;
}

function buildWorkEventType(kind: WorkEventKind): string {
  return `io.agent.${kind}.v1`;
}

function workInputGuidance(detail: string): string {
  return `${detail} POST /work accepts plain text, one WorkEvent object, or an array of WorkEvent objects.`;
}

function formatWorkEventError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim().replace(/[.]+$/g, "");
  }
  return "invalid structured work input";
}

function fail(message: string): never {
  throw new Error(message);
}

function withOptional<K extends string, V>(
  key: K,
  value: V | undefined,
): Record<K, V> | Record<string, never> {
  return value === undefined ? {} : { [key]: value } as Record<K, V>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
