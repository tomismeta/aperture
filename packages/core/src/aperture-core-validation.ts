import type { ApertureEvent, HumanInputRequest } from "./events.js";
import type { SourceEvent } from "./source-event.js";
import type { AttentionResponse } from "./frame-response.js";
import type { AttentionSignal } from "./interaction-signal.js";
import { ApertureCoreValidationError } from "./aperture-core-error.js";

export function assertValidEvent(event: ApertureEvent): void {
  assertNonEmpty("event.id", event.id);
  assertNonEmpty("event.taskId", event.taskId);
  assertTimestamp("event.timestamp", event.timestamp);

  if (event.source !== undefined) {
    assertNonEmpty("event.source.id", event.source.id);
  }

  switch (event.type) {
    case "task.started":
    case "task.updated":
      assertNonEmpty("event.title", event.title);
      break;
    case "human.input.requested":
      assertNonEmpty("event.interactionId", event.interactionId);
      assertNonEmpty("event.title", event.title);
      assertNonEmpty("event.summary", event.summary);
      break;
    case "task.completed":
    case "task.cancelled":
      break;
    default:
      return unreachableApertureEvent(event);
  }
}

export function assertValidSourceEvent(event: SourceEvent): void {
  assertNonEmpty("event.id", event.id);
  assertNonEmpty("event.taskId", event.taskId);
  assertTimestamp("event.timestamp", event.timestamp);

  if (event.source) {
    assertNonEmpty("event.source.id", event.source.id);
  }

  switch (event.type) {
    case "task.started":
      assertNonEmpty("event.title", event.title);
      return;
    case "task.updated":
      assertNonEmpty("event.title", event.title);
      assertTaskStatus("event.status", event.status);
      return;
    case "task.completed":
      return;
    case "task.cancelled":
      if (event.reason !== undefined) {
        assertNonEmpty("event.reason", event.reason);
      }
      return;
    case "human.input.requested":
      assertNonEmpty("event.interactionId", event.interactionId);
      assertNonEmpty("event.title", event.title);
      assertNonEmpty("event.summary", event.summary);
      assertHumanInputRequest("event.request", event.request);
      if (event.riskHint !== undefined) {
        assertConsequenceLevel("event.riskHint", event.riskHint);
      }
      return;
    default:
      return unreachableSourceEvent(event);
  }
}

export function assertValidFrameResponse(response: AttentionResponse): void {
  assertNonEmpty("response.taskId", response.taskId);
  assertNonEmpty("response.interactionId", response.interactionId);

  switch (response.response.kind) {
    case "acknowledged":
    case "approved":
    case "rejected":
    case "dismissed":
      return;
    case "option_selected":
      if (response.response.optionIds.length === 0) {
        throw new ApertureCoreValidationError(
          "response.optionIds must contain at least one option id",
          { field: "response.optionIds" },
        );
      }
      return;
    case "text_submitted":
      assertNonEmpty("response.text", response.response.text);
      return;
    case "form_submitted":
      if (
        response.response.values === null ||
        typeof response.response.values !== "object" ||
        Array.isArray(response.response.values)
      ) {
        throw new ApertureCoreValidationError("response.values must be an object", {
          field: "response.values",
        });
      }
      return;
  }
}

export function assertValidSignal(signal: AttentionSignal): void {
  assertNonEmpty("signal.taskId", signal.taskId);
  assertNonEmpty("signal.interactionId", signal.interactionId);
  assertTimestamp("signal.timestamp", signal.timestamp);

  if (signal.source !== undefined) {
    assertNonEmpty("signal.source.id", signal.source.id);
  }
}

function assertNonEmpty(label: string, value: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApertureCoreValidationError(`${label} must be a non-empty string`, {
      field: label,
    });
  }
}

function assertTimestamp(label: string, value: string): void {
  assertNonEmpty(label, value);
  if (Number.isNaN(Date.parse(value))) {
    throw new ApertureCoreValidationError(`${label} must be a valid ISO timestamp`, {
      field: label,
    });
  }
}

function assertTaskStatus(label: string, value: string): void {
  if (!["running", "blocked", "waiting", "completed", "failed"].includes(value)) {
    throw new ApertureCoreValidationError(`${label} must be a valid task status`, {
      field: label,
    });
  }
}

function assertConsequenceLevel(label: string, value: string): void {
  if (!["low", "medium", "high"].includes(value)) {
    throw new ApertureCoreValidationError(`${label} must be a valid consequence level`, {
      field: label,
    });
  }
}

function assertHumanInputRequest(label: string, value: HumanInputRequest): void {
  if (!value || typeof value !== "object" || !("kind" in value)) {
    throw new ApertureCoreValidationError(`${label} must be a valid human input request`, {
      field: label,
    });
  }

  switch (value.kind) {
    case "approval":
      return;
    case "choice":
      if (!Array.isArray(value.options) || value.options.length === 0) {
        throw new ApertureCoreValidationError(`${label}.options must contain at least one option`, {
          field: `${label}.options`,
        });
      }
      return;
    case "form":
      if (!Array.isArray(value.fields) || value.fields.length === 0) {
        throw new ApertureCoreValidationError(`${label}.fields must contain at least one field`, {
          field: `${label}.fields`,
        });
      }
      return;
    default:
      throw new ApertureCoreValidationError(`${label} must have a supported request kind`, {
        field: label,
      });
  }
}

function unreachableApertureEvent(event: never): never {
  throw new ApertureCoreValidationError(
    `Unhandled ApertureEvent in validation: ${JSON.stringify(event)}`,
    { field: "event.type", code: "unsupported_event_variant" },
  );
}

function unreachableSourceEvent(event: never): never {
  throw new ApertureCoreValidationError(
    `Unhandled SourceEvent in validation: ${JSON.stringify(event)}`,
    { field: "event.type", code: "unsupported_event_variant" },
  );
}
