import type { ApertureEvent, HumanInputRequest, SourceEvidence } from "./events.js";
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
  if (event.metadata !== undefined) {
    assertObject("event.metadata", event.metadata);
  }

  switch (event.type) {
    case "task.started":
      assertNonEmpty("event.title", event.title);
      break;
    case "task.updated":
      assertNonEmpty("event.title", event.title);
      if (event.evidence !== undefined) {
        if (event.status !== "failed") throw invalidSourceEvidence("event.evidence");
        assertSourceEvidence("event.evidence", event.evidence);
      }
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
  if (event.metadata !== undefined) {
    assertObject("event.metadata", event.metadata);
  }

  switch (event.type) {
    case "task.started":
      assertNonEmpty("event.title", event.title);
      return;
    case "task.updated":
      assertNonEmpty("event.title", event.title);
      assertTaskStatus("event.status", event.status);
      if (event.evidence !== undefined) {
        if (event.status !== "failed") throw invalidSourceEvidence("event.evidence");
        assertSourceEvidence("event.evidence", event.evidence);
      }
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
  if (!isRecord(response)) {
    throw invalidFrameResponse("response must be an object");
  }
  assertExactResponseKeys("response", response, ["taskId", "interactionId", "response"]);
  assertNonEmpty("response.taskId", response.taskId);
  assertNonEmpty("response.interactionId", response.interactionId);

  if (!isRecord(response.response) || typeof response.response.kind !== "string") {
    throw invalidFrameResponse("response.response must have a supported kind");
  }

  switch (response.response.kind) {
    case "dismissed":
    case "acknowledged":
      assertExactResponseKeys("response.response", response.response, ["kind"]);
      return;
    case "approved":
    case "rejected":
      assertOneOfExactResponseKeys("response.response", response.response, [
        ["kind"],
        ["kind", "reason"],
      ]);
      if (response.response.reason !== undefined && typeof response.response.reason !== "string") {
        throw new ApertureCoreValidationError("response.reason must be a string", {
          field: "response.reason",
        });
      }
      return;
    case "option_selected":
      assertExactResponseKeys("response.response", response.response, ["kind", "optionIds"]);
      if (!Array.isArray(response.response.optionIds) || response.response.optionIds.length === 0) {
        throw new ApertureCoreValidationError(
          "response.optionIds must contain at least one option id",
          { field: "response.optionIds" },
        );
      }
      for (const optionId of response.response.optionIds) {
        assertNonEmpty("response.optionIds[]", optionId);
      }
      return;
    case "text_submitted":
      assertExactResponseKeys("response.response", response.response, ["kind", "text"]);
      assertNonEmpty("response.text", response.response.text);
      return;
    case "form_submitted":
      assertExactResponseKeys("response.response", response.response, ["kind", "values"]);
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
    default:
      throw invalidFrameResponse("response.response must have a supported kind");
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

function assertNonEmpty(label: string, value: unknown): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApertureCoreValidationError(`${label} must be a non-empty string`, {
      field: label,
    });
  }
}

function assertExactResponseKeys(
  label: string,
  value: Record<string, unknown>,
  keys: string[],
): void {
  if (Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) {
    throw invalidFrameResponse(`${label} contains undeclared fields`);
  }
}

function assertOneOfExactResponseKeys(
  label: string,
  value: Record<string, unknown>,
  keySets: string[][],
): void {
  const actual = Object.keys(value).sort().join("\0");
  if (!keySets.some((keys) => keys.slice().sort().join("\0") === actual)) {
    throw invalidFrameResponse(`${label} contains undeclared fields`);
  }
}

function invalidFrameResponse(message: string): ApertureCoreValidationError {
  return new ApertureCoreValidationError(message, {
    field: "response",
    code: "invalid_response_variant",
  });
}

function assertObject(label: string, value: unknown): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ApertureCoreValidationError(`${label} must be an object`, {
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

function assertSourceEvidence(label: string, value: SourceEvidence): void {
  if (!isRecord(value) || typeof value.kind !== "string") {
    throw invalidSourceEvidence(label);
  }

  switch (value.kind) {
    case "outcome":
      assertExactKeys(label, value, ["kind", "outcome", "subject", "channel", "complete"]);
      if (
        !["success", "failure"].includes(value.outcome) ||
        !isSourceEvidenceSubject(value.subject) ||
        !isSourceEvidenceChannel(value.channel) ||
        value.complete !== true
      ) {
        throw invalidSourceEvidence(label);
      }
      return;
    case "diagnostic":
      if (value.diagnostic === "source_limit") {
        assertExactKeys(label, value, ["kind", "diagnostic", "channel", "window"]);
        if (value.channel !== "read") throw invalidSourceEvidence(label);
        assertSourceEvidenceWindow(`${label}.window`, value.window);
        return;
      }
      assertExactKeys(label, value, ["kind", "diagnostic", "subject", "channel", "complete"]);
      if (
        !["runtime", "expected"].includes(value.diagnostic) ||
        !isSourceEvidenceSubject(value.subject) ||
        !isSourceEvidenceChannel(value.channel) ||
        value.complete !== true
      ) {
        throw invalidSourceEvidence(label);
      }
      return;
    case "payload":
      assertExactKeys(label, value, ["kind", "subject", "channel", "complete"]);
      if (
        !["document", "search", "source", "tool"].includes(value.subject) ||
        !isSourceEvidenceChannel(value.channel) ||
        value.complete !== true
      ) {
        throw invalidSourceEvidence(label);
      }
      return;
    case "authorization":
      assertExactKeys(label, value, ["kind", "state", "execution", "result"]);
      if (
        value.state !== "required" ||
        value.execution !== "not_started" ||
        value.result !== "absent"
      ) {
        throw invalidSourceEvidence(label);
      }
      return;
    default:
      throw invalidSourceEvidence(label);
  }
}

function assertSourceEvidenceWindow(
  label: string,
  value: Extract<SourceEvidence, { diagnostic: "source_limit" }>["window"],
): void {
  if (!isRecord(value)) throw invalidSourceEvidence(label);
  assertExactKeys(label, value, ["unit", "offset", "length", "total"]);
  if (
    !["bytes", "lines"].includes(value.unit) ||
    !Number.isSafeInteger(value.offset) ||
    value.offset < 0 ||
    !Number.isSafeInteger(value.length) ||
    value.length <= 0 ||
    !Number.isSafeInteger(value.total) ||
    value.total <= 0 ||
    value.offset + value.length >= value.total
  ) {
    throw invalidSourceEvidence(label);
  }
}

function assertExactKeys(label: string, value: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) {
    throw invalidSourceEvidence(label);
  }
}

function isSourceEvidenceSubject(value: unknown): boolean {
  return ["command", "document", "search", "source", "tool"].includes(String(value));
}

function isSourceEvidenceChannel(value: unknown): boolean {
  return ["command", "read", "search", "structured", "transcript"].includes(String(value));
}

function invalidSourceEvidence(label: string): ApertureCoreValidationError {
  return new ApertureCoreValidationError(`${label} must be valid bounded source evidence`, {
    field: label,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
