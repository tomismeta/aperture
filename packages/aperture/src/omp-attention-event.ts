import path from "node:path";
import {
  assertOmpAttentionSession,
  type OmpAttentionSession,
  type OmpAttentionSessionFacet,
} from "./omp-attention-session.js";
import {
  OMP_ATTENTION_LIMITS,
  OmpAttentionEventError,
  looksLikePrivatePath,
  safeDisplayText,
} from "./omp-attention-validation.js";

export { assertOmpAttentionSession, OMP_ATTENTION_LIMITS, OmpAttentionEventError };
export type { OmpAttentionSession, OmpAttentionSessionFacet };

export const OMP_ATTENTION_EVENT_SCHEMA_VERSION = 4;
export const OMP_ATTENTION_SOCKET_RELATIVE_PATH = "omarchy/aperture/attention.sock";

export type OmpAttentionClassification =
  | "approval_requested"
  | "approval_resolved"
  | "input_requested"
  | "input_resolved"
  | "tool_failure"
  | "provider_failure"
  | "turn_completed"
  | "completion_resolved"
  | "session_stop_failure"
  | "session_shutdown";

export type OmpAttentionTransition = "requested" | "resolved" | "failed" | "completed" | "shutdown";

export type OmpAttentionFocus = {
  kind: "opaque-focus";
  handle: string;
};

export type OmpAttentionEvent = {
  schemaVersion: typeof OMP_ATTENTION_EVENT_SCHEMA_VERSION;
  type: "omp.attention-event";
  eventId: string;
  occurredAt: string;
  sessionId: string;
  session?: OmpAttentionSession;
  turnId?: string;
  interactionId?: string;
  classification: OmpAttentionClassification;
  title: string;
  summary: string;
  transition: OmpAttentionTransition;
  focus?: OmpAttentionFocus;
};

const CLASSIFICATIONS = new Set<OmpAttentionClassification>([
  "approval_requested",
  "approval_resolved",
  "input_requested",
  "input_resolved",
  "tool_failure",
  "provider_failure",
  "turn_completed",
  "completion_resolved",
  "session_stop_failure",
  "session_shutdown",
]);
const TRANSITIONS = new Set<OmpAttentionTransition>([
  "requested",
  "resolved",
  "failed",
  "completed",
  "shutdown",
]);
const REQUIRED_INTERACTION = new Set<OmpAttentionClassification>([
  "approval_requested",
  "approval_resolved",
  "input_requested",
  "turn_completed",
  "input_resolved",
]);
const EXPECTED_TRANSITION: Readonly<Record<OmpAttentionClassification, OmpAttentionTransition>> = {
  approval_requested: "requested",
  approval_resolved: "resolved",
  input_requested: "requested",
  input_resolved: "resolved",
  tool_failure: "failed",
  provider_failure: "failed",
  turn_completed: "completed",
  completion_resolved: "resolved",
  session_stop_failure: "failed",
  session_shutdown: "shutdown",
};

export function parseOmpAttentionEvent(line: string): OmpAttentionEvent {
  if (Buffer.byteLength(`${line}\n`, "utf8") > OMP_ATTENTION_LIMITS.jsonLineBytes) {
    throw new OmpAttentionEventError("OMP attention event exceeded the byte limit");
  }
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new OmpAttentionEventError("OMP attention event was not valid JSON");
  }
  return assertOmpAttentionEvent(value);
}

export function assertOmpAttentionEvent(value: unknown): OmpAttentionEvent {
  const record = asRecord(value);
  assertExactKeys(record);
  if (record.schemaVersion !== OMP_ATTENTION_EVENT_SCHEMA_VERSION) {
    throw new OmpAttentionEventError("OMP attention event schema version is unsupported");
  }
  if (record.type !== "omp.attention-event") {
    throw new OmpAttentionEventError("OMP attention event type is unsupported");
  }
  if (!CLASSIFICATIONS.has(record.classification as OmpAttentionClassification)) {
    throw new OmpAttentionEventError("OMP attention event classification is unsupported");
  }
  if (!TRANSITIONS.has(record.transition as OmpAttentionTransition)) {
    throw new OmpAttentionEventError("OMP attention event transition is unsupported");
  }
  const classification = record.classification as OmpAttentionClassification;
  const transition = record.transition as OmpAttentionTransition;
  if (transition !== EXPECTED_TRANSITION[classification]) {
    throw new OmpAttentionEventError(
      "OMP attention event transition does not match classification",
    );
  }

  const sessionId = assertOmpSessionId(record.sessionId);
  const session =
    record.session === undefined ? undefined : assertOmpAttentionSession(record.session);
  const interactionId = optionalOpaqueId(record.interactionId, "interactionId");
  if (REQUIRED_INTERACTION.has(classification) && interactionId === undefined) {
    throw new OmpAttentionEventError("OMP attention event interactionId is required");
  }

  const focus = optionalFocus(record.focus);
  return {
    schemaVersion: OMP_ATTENTION_EVENT_SCHEMA_VERSION,
    type: "omp.attention-event",
    eventId: opaqueId(record.eventId, "eventId"),
    occurredAt: timestamp(record.occurredAt),
    sessionId,
    ...(session === undefined ? {} : { session }),
    ...(record.turnId === undefined ? {} : { turnId: opaqueId(record.turnId, "turnId") }),
    ...(interactionId === undefined ? {} : { interactionId }),
    classification,
    title: safeDisplayText(record.title, OMP_ATTENTION_LIMITS.titleCodePoints, "title"),
    summary: safeDisplayText(record.summary, OMP_ATTENTION_LIMITS.summaryCodePoints, "summary"),
    transition,
    ...(focus === undefined ? {} : { focus }),
  };
}

export function serializeOmpAttentionEvent(event: OmpAttentionEvent): string {
  const validated = assertOmpAttentionEvent(event);
  const line = `${JSON.stringify(validated)}\n`;
  if (Buffer.byteLength(line, "utf8") > OMP_ATTENTION_LIMITS.jsonLineBytes) {
    throw new OmpAttentionEventError("OMP attention event exceeded the byte limit");
  }
  return line;
}

export function assertOmpSessionId(value: unknown): string {
  const sessionId = opaqueId(value, "sessionId");
  if (looksLikePrivatePath(sessionId)) {
    throw new OmpAttentionEventError("OMP sessionId must not be a filesystem path");
  }
  return sessionId;
}

export function assertOmpAttentionDisplayText(
  value: unknown,
  maximum: number,
  label: string,
): string {
  return safeDisplayText(value, maximum, label);
}

export function resolveOmpAttentionSocketPath(
  environment: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const runtimeDir = environment.XDG_RUNTIME_DIR;
  if (!runtimeDir || !path.isAbsolute(runtimeDir) || runtimeDir.includes("\0")) return undefined;
  return path.join(runtimeDir, OMP_ATTENTION_SOCKET_RELATIVE_PATH);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OmpAttentionEventError("OMP attention event must be an object");
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(record: Record<string, unknown>): void {
  const required = [
    "schemaVersion",
    "type",
    "eventId",
    "occurredAt",
    "sessionId",
    "classification",
    "title",
    "summary",
    "transition",
  ];
  const optional = ["turnId", "interactionId", "session", "focus"];
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new OmpAttentionEventError(`OMP attention event contains unknown field: ${key}`);
    }
  }
  for (const key of required) {
    if (!(key in record)) {
      throw new OmpAttentionEventError(`OMP attention event is missing required field: ${key}`);
    }
  }
}

function opaqueId(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new OmpAttentionEventError(`OMP ${label} must contain visible text`);
  }
  if (Array.from(value).length > OMP_ATTENTION_LIMITS.opaqueIdCodePoints) {
    throw new OmpAttentionEventError(`OMP ${label} exceeded the character limit`);
  }
  return value;
}

function optionalOpaqueId(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : opaqueId(value, label);
}

function optionalFocus(value: unknown): OmpAttentionFocus | undefined {
  if (value === undefined) return undefined;
  const record = asRecord(value);
  const keys = Object.keys(record).sort();
  if (
    JSON.stringify(keys) !== JSON.stringify(["handle", "kind"]) ||
    record.kind !== "opaque-focus" ||
    typeof record.handle !== "string" ||
    !new RegExp(`^[A-Za-z0-9_-]{${OMP_ATTENTION_LIMITS.focusHandleCharacters}}$`).test(
      record.handle,
    )
  ) {
    throw new OmpAttentionEventError("OMP attention focus is invalid");
  }
  return { kind: "opaque-focus", handle: record.handle };
}

function timestamp(value: unknown): string {
  if (typeof value !== "string") {
    throw new OmpAttentionEventError("OMP attention occurredAt must be a string");
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new OmpAttentionEventError("OMP attention occurredAt must be a valid timestamp");
  }
  return new Date(parsed).toISOString();
}
