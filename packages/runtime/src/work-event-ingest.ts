import { randomUUID } from "node:crypto";

import type {
  AttentionActivityClass,
  HumanInputRequest,
  SourceEvent,
} from "@tomismeta/aperture-core";

import {
  buildWorkEventType,
  DEFAULT_WORK_EVENT_SOURCE,
  WORK_API_VERSION,
  validateWorkEventBatchShape,
  validateWorkEventShape,
  type NormalizedWorkEvent,
  type WorkEvent,
  type WorkEventContextItem,
  type WorkEventRequest,
  type WorkStatus,
} from "./work-contract.js";
import { assertSafeUnknown, isPlainRecord } from "./work-event-safety.js";
import {
  mapWorkTextToSourceEvent as mapWorkTextToSourceEventFromText,
  normalizeWorkText,
} from "./work-event-text.js";

export type {
  WorkEvent,
  WorkEventContextItem,
  WorkEventKind,
  WorkEventRequest,
  WorkStatus,
} from "./work-contract.js";

export type WorkInput = string | WorkEvent | WorkEvent[];
export type NormalizedWorkInput = string | NormalizedWorkEvent | NormalizedWorkEvent[];
type InputRequestedWorkEvent = Extract<NormalizedWorkEvent, { kind: "input.requested" }>;

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

export function normalizeWorkPayload(payload: unknown): NormalizedWorkInput {
  if (typeof payload === "string") {
    const text = normalizeWorkText(payload);
    if (text.length === 0) {
      throw new Error(workInputGuidance("Plain-text work input must not be empty."));
    }
    assertSafeUnknown(payload, "$");
    return text;
  }

  if (Array.isArray(payload)) {
    if (payload.length === 0) {
      throw new Error(workInputGuidance("WorkEvent[] must contain at least one item."));
    }
    const errors = validateWorkEventBatchShape(payload);
    if (errors.length > 0) {
      throw new Error(
        workInputGuidance(`Invalid WorkEvent[]: ${formatWorkEventError(errors[0])}.`),
      );
    }
    return payload.map((entry, index) => {
      try {
        return normalizeWorkEvent(entry);
      } catch (error) {
        throw new Error(
          workInputGuidance(`Invalid WorkEvent at index ${index}: ${formatWorkEventError(error)}.`),
        );
      }
    });
  }

  if (!isPlainRecord(payload)) {
    throw new Error(
      workInputGuidance(
        "Work input must be plain text, one WorkEvent object, or an array of WorkEvent objects.",
      ),
    );
  }

  try {
    return normalizeWorkEvent(payload);
  } catch (error) {
    throw new Error(workInputGuidance(`Invalid WorkEvent: ${formatWorkEventError(error)}.`));
  }
}

export function mapWorkPayloadToSourceEvents(
  payload: WorkInput | NormalizedWorkInput,
): SourceEvent[] {
  if (typeof payload === "string") {
    return [mapWorkTextToSourceEventFromText(payload)];
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
  const metadata = mapMetadata(normalizedEvent);

  switch (normalizedEvent.kind) {
    case "work.started":
      return {
        id: normalizedEvent.id,
        type: "task.started",
        taskId: normalizedEvent.work.id,
        timestamp,
        ...(source !== undefined ? { source } : {}),
        ...(metadata !== undefined ? { metadata } : {}),
        title: fallbackTitle(normalizedEvent),
        ...(normalizedEvent.work.summary !== undefined
          ? { summary: normalizedEvent.work.summary }
          : {}),
        ...mapSharedSemanticHints(normalizedEvent),
      };
    case "work.updated": {
      const activityClass = readActivityCategory(normalizedEvent.facts?.activityCategory);
      const context = mapContext(normalizedEvent);
      return {
        id: normalizedEvent.id,
        type: "task.updated",
        taskId: normalizedEvent.work.id,
        timestamp,
        ...(source !== undefined ? { source } : {}),
        ...(metadata !== undefined ? { metadata } : {}),
        ...(normalizedEvent.facts?.capabilityFamily !== undefined
          ? { toolFamily: normalizedEvent.facts.capabilityFamily }
          : {}),
        ...(activityClass !== undefined ? { activityClass } : {}),
        title: fallbackTitle(normalizedEvent),
        ...(normalizedEvent.work.summary !== undefined
          ? { summary: normalizedEvent.work.summary }
          : {}),
        status: normalizedEvent.work.status,
        ...(normalizedEvent.work.progress !== undefined
          ? { progress: normalizedEvent.work.progress }
          : {}),
        ...(context !== undefined ? { context } : {}),
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
        ...(metadata !== undefined ? { metadata } : {}),
        ...(normalizedEvent.work.summary !== undefined
          ? { summary: normalizedEvent.work.summary }
          : {}),
        ...mapSharedSemanticHints(normalizedEvent),
      };
    case "work.cancelled":
      return {
        id: normalizedEvent.id,
        type: "task.cancelled",
        taskId: normalizedEvent.work.id,
        timestamp,
        ...(source !== undefined ? { source } : {}),
        ...(metadata !== undefined ? { metadata } : {}),
        ...(normalizedEvent.work.reason !== undefined
          ? { reason: normalizedEvent.work.reason }
          : normalizedEvent.work.summary !== undefined
            ? { reason: normalizedEvent.work.summary }
            : {}),
        ...mapSharedSemanticHints(normalizedEvent),
      };
    case "input.requested": {
      const activityClass = readActivityCategory(normalizedEvent.facts?.activityCategory);
      const context = mapContext(normalizedEvent);
      return {
        id: normalizedEvent.id,
        type: "human.input.requested",
        taskId: normalizedEvent.work.id,
        interactionId: normalizedEvent.interaction.id,
        timestamp,
        ...(source !== undefined ? { source } : {}),
        ...(metadata !== undefined ? { metadata } : {}),
        ...(normalizedEvent.facts?.capabilityFamily !== undefined
          ? { toolFamily: normalizedEvent.facts.capabilityFamily }
          : {}),
        ...(activityClass !== undefined ? { activityClass } : {}),
        title:
          normalizedEvent.request.title ??
          normalizedEvent.work.title ??
          `Input requested for ${normalizedEvent.work.id}`,
        summary:
          normalizedEvent.request.summary ??
          normalizedEvent.work.summary ??
          `Input requested for ${normalizedEvent.work.id}.`,
        request: mapRequest(normalizedEvent.request),
        ...(context !== undefined ? { context } : {}),
        ...(normalizedEvent.hints?.consequence !== undefined
          ? { riskHint: normalizedEvent.hints.consequence }
          : {}),
        ...mapSharedSemanticHints(normalizedEvent, { omitConsequence: true }),
      };
    }
  }
}

export function mapWorkTextToSourceEvent(text: string): SourceEvent {
  return mapWorkTextToSourceEventFromText(text);
}

function normalizeWorkEvent(value: unknown): NormalizedWorkEvent {
  if (!isPlainRecord(value)) {
    throw new Error("WorkEvent must be a JSON object");
  }

  assertSafeUnknown(value, "$");

  const commonError = detectCommonWorkEventError(value);
  if (commonError) {
    throw new Error(commonError);
  }

  const shapeErrors = validateWorkEventShape(value);
  if (shapeErrors.length > 0) {
    throw new Error(shapeErrors[0] ?? "invalid WorkEvent shape");
  }

  const event = value as WorkEvent;
  const normalizedEvent: NormalizedWorkEvent = {
    ...event,
    specVersion: event.specVersion ?? WORK_API_VERSION,
    id: event.id ?? `evt:${randomUUID()}`,
    source: event.source ?? DEFAULT_WORK_EVENT_SOURCE,
    type: event.type ?? buildWorkEventType(event.kind),
  };

  assertUniqueStructuredIds(normalizedEvent);
  assertNoNegativeZero(normalizedEvent.work.progress, "work.progress");
  return normalizedEvent;
}

function assertUniqueStructuredIds(event: NormalizedWorkEvent): void {
  if (isInputRequestedWorkEvent(event)) {
    if (event.request.kind === "choice") {
      assertUniqueBy(event.request.options, (option) => option.id, "request.options", "id");
    }

    if (event.request.kind === "form") {
      assertUniqueBy(event.request.fields, (field) => field.id, "request.fields", "id");
      for (const [fieldIndex, field] of event.request.fields.entries()) {
        if (field.options) {
          assertUniqueBy(
            field.options,
            (option) => option.value,
            `request.fields[${fieldIndex}].options`,
            "value",
          );
        }
      }
    }
  }

  if (event.context?.items) {
    assertUniqueBy(event.context.items, (item) => item.id, "context.items", "id");
  }
}

function assertUniqueBy<T>(
  values: T[],
  readKey: (value: T) => string,
  collection: string,
  field: string,
): void {
  const seen = new Set<string>();
  for (const value of values) {
    const key = readKey(value);
    if (seen.has(key)) {
      throw new Error(`${collection} contains duplicate ${field} "${key}"`);
    }
    seen.add(key);
  }
}

function assertNoNegativeZero(value: number | undefined, field: string): void {
  if (value !== undefined && Object.is(value, -0)) {
    throw new Error(`${field} must not be -0`);
  }
}

function isInputRequestedWorkEvent(event: NormalizedWorkEvent): event is InputRequestedWorkEvent {
  return event.kind === "input.requested";
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

function detectCommonWorkEventError(value: Record<string, unknown>): string | null {
  if (value.kind === "work.updated") {
    const work = value.work;
    if (!isPlainRecord(work)) {
      return "work.updated requires a work object";
    }
    if (typeof work.id !== "string" || work.id.trim() === "") {
      return "work.updated requires work.id";
    }
    if (typeof work.status !== "string" || !isTaskUpdateStatus(work.status)) {
      return "work.updated requires work.status to be running, waiting, blocked, failed, or completed";
    }
  }

  if (value.kind === "input.requested") {
    if (
      !isPlainRecord(value.interaction) ||
      typeof value.interaction.id !== "string" ||
      value.interaction.id.trim() === ""
    ) {
      return "input.requested requires interaction.id";
    }
    if (!isPlainRecord(value.request) || typeof value.request.kind !== "string") {
      return "input.requested requires request.kind";
    }
  }

  return null;
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
        ...(request.allowTextResponse !== undefined
          ? { allowTextResponse: request.allowTextResponse }
          : {}),
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
  const items = event.context?.items?.map((item: WorkEventContextItem) => ({
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

function mapMetadata(event: NormalizedWorkEvent): SourceEvent["metadata"] | undefined {
  const metadata: NonNullable<SourceEvent["metadata"]> = {};

  if (event.automation !== undefined) {
    metadata.automation = event.automation;
  }
  if (event.execution !== undefined) {
    metadata.execution = event.execution;
  }
  if (event.governance !== undefined) {
    metadata.governance = event.governance;
  }
  if (event.usage !== undefined) {
    metadata.usage = event.usage;
  }

  return Object.keys(metadata).length === 0 ? undefined : metadata;
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
  value: string,
): value is Extract<WorkStatus, "running" | "waiting" | "blocked" | "failed" | "completed"> {
  return (
    value === "running" ||
    value === "waiting" ||
    value === "blocked" ||
    value === "failed" ||
    value === "completed"
  );
}

function workInputGuidance(detail: string): string {
  return `${detail} POST /work accepts plain text, one WorkEvent object, or an array of WorkEvent objects.`;
}

function formatWorkEventError(error: unknown): string {
  if (typeof error === "string" && error.trim().length > 0) {
    return error.trim().replace(/[.]+$/g, "");
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim().replace(/[.]+$/g, "");
  }
  return "invalid structured work input";
}
