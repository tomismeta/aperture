import path from "node:path";

import {
  OMP_ATTENTION_LIMITS,
  assertOmpAttentionEvent,
  type OmpAttentionEvent,
} from "./omp-attention-event.js";

export const OMP_DIRECT_PROTOCOL_VERSION = 3;
export const OMP_DIRECT_LIMITS = {
  jsonLineBytes: OMP_ATTENTION_LIMITS.jsonLineBytes,
  requestIdCharacters: 160,
  secretTokenCharacters: 32,
  socketPathBytes: 100,
  paneIdCharacters: 64,
  compositorAddressCharacters: 160,
} as const;

export type OmpFocusTarget =
  | {
      kind: "herdr";
      socketPath: string;
      paneId: string;
      hyprlandInstance: string;
    }
  | {
      kind: "direct-terminal-probe";
      marker: string;
      hyprlandInstance: string;
    }
  | {
      kind: "tmux";
      socketPath: string;
      paneId: string;
      hyprlandInstance: string;
    };

export type OmpFocusRegistration = {
  schemaVersion: 3;
  type: "omp.focus.register";
  requestId: string;
  publicHandle: string;
  hostGeneration: string;
  target: OmpFocusTarget;
};

export type OmpFocusRevocation = {
  schemaVersion: 3;
  type: "omp.focus.revoke";
  requestId: string;
  publicHandle: string;
  hostGeneration: string;
};

export type OmpDirectMessage = OmpAttentionEvent | OmpFocusRegistration | OmpFocusRevocation;

export type OmpDirectAcknowledgement =
  | { schemaVersion: 3; status: "accepted"; requestId: string }
  | {
      schemaVersion: 3;
      status: "rejected";
      requestId: string;
      code:
        | "unsupported_terminal_owned"
        | "marker_missing"
        | "marker_ambiguous"
        | "invalid_context";
    };

export class OmpDirectProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OmpDirectProtocolError";
  }
}

export function directMessageRequestId(message: OmpDirectMessage): string {
  return message.type === "omp.attention-event" ? message.eventId : message.requestId;
}

export function parseOmpDirectMessage(line: string): OmpDirectMessage {
  if (Buffer.byteLength(`${line}\n`, "utf8") > OMP_DIRECT_LIMITS.jsonLineBytes) {
    throw new OmpDirectProtocolError("OMP direct message exceeded the byte limit");
  }
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new OmpDirectProtocolError("OMP direct message was not valid JSON");
  }
  return assertOmpDirectMessage(value);
}

export function assertOmpDirectMessage(value: unknown): OmpDirectMessage {
  const record = asRecord(value);
  if (record.type === "omp.attention-event") return assertOmpAttentionEvent(value);
  if (record.schemaVersion !== OMP_DIRECT_PROTOCOL_VERSION) {
    throw new OmpDirectProtocolError("OMP direct message schema version is unsupported");
  }
  if (record.type === "omp.focus.register") return assertRegistration(record);
  if (record.type === "omp.focus.revoke") return assertRevocation(record);
  throw new OmpDirectProtocolError("OMP direct message type is unsupported");
}

export function serializeOmpDirectMessage(message: OmpDirectMessage): string {
  const validated = assertOmpDirectMessage(message);
  const line = `${JSON.stringify(validated)}\n`;
  if (Buffer.byteLength(line, "utf8") > OMP_DIRECT_LIMITS.jsonLineBytes) {
    throw new OmpDirectProtocolError("OMP direct message exceeded the byte limit");
  }
  return line;
}

export function parseOmpDirectAcknowledgement(line: string): OmpDirectAcknowledgement {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new OmpDirectProtocolError("OMP direct acknowledgement was invalid");
  }
  const record = asRecord(value);
  const keys = Object.keys(record).sort();
  const requestId = boundedVisible(record.requestId, 160, "acknowledgement request id");
  if (record.schemaVersion !== 3) {
    throw new OmpDirectProtocolError("OMP direct acknowledgement was invalid");
  }
  if (
    record.status === "accepted" &&
    JSON.stringify(keys) === JSON.stringify(["requestId", "schemaVersion", "status"])
  ) {
    return { schemaVersion: 3, status: "accepted", requestId };
  }
  const codes = new Set([
    "unsupported_terminal_owned",
    "marker_missing",
    "marker_ambiguous",
    "invalid_context",
  ]);
  if (
    record.status === "rejected" &&
    JSON.stringify(keys) === JSON.stringify(["code", "requestId", "schemaVersion", "status"]) &&
    typeof record.code === "string" &&
    codes.has(record.code)
  ) {
    return {
      schemaVersion: 3,
      status: "rejected",
      requestId,
      code: record.code as Extract<OmpDirectAcknowledgement, { status: "rejected" }>["code"],
    };
  }
  throw new OmpDirectProtocolError("OMP direct acknowledgement was invalid");
}


function assertRegistration(record: Record<string, unknown>): OmpFocusRegistration {
  assertExactKeys(record, [
    "schemaVersion",
    "type",
    "requestId",
    "publicHandle",
    "hostGeneration",
    "target",
  ]);
  return {
    schemaVersion: 3,
    type: "omp.focus.register",
    requestId: boundedVisible(record.requestId, 160, "registration request id"),
    publicHandle: secretToken(record.publicHandle, "public focus handle"),
    hostGeneration: secretToken(record.hostGeneration, "host generation"),
    target: assertTarget(record.target),
  };
}

function assertTarget(value: unknown): OmpFocusTarget {
  const target = asRecord(value);
  const hyprlandInstance = compositorAddress(target.hyprlandInstance);
  if (target.kind === "herdr") {
    assertExactKeys(target, ["kind", "socketPath", "paneId", "hyprlandInstance"]);
    return {
      kind: "herdr",
      socketPath: socketPath(target.socketPath),
      paneId: assertOmpHerdrPaneId(target.paneId),
      hyprlandInstance,
    };
  }
  if (target.kind === "direct-terminal-probe") {
    assertExactKeys(target, ["kind", "marker", "hyprlandInstance"]);
    return {
      kind: "direct-terminal-probe",
      marker: secretToken(target.marker, "Foot marker"),
      hyprlandInstance,
    };
  }
  if (target.kind === "tmux") {
    assertExactKeys(target, ["kind", "socketPath", "paneId", "hyprlandInstance"]);
    return {
      kind: "tmux",
      socketPath: socketPath(target.socketPath),
      paneId: assertOmpTmuxPaneId(target.paneId),
      hyprlandInstance,
    };
  }
  throw new OmpDirectProtocolError("OMP direct focus target kind is unsupported");
}

function assertRevocation(record: Record<string, unknown>): OmpFocusRevocation {
  assertExactKeys(record, ["schemaVersion", "type", "requestId", "publicHandle", "hostGeneration"]);
  return {
    schemaVersion: 3,
    type: "omp.focus.revoke",
    requestId: boundedVisible(record.requestId, 160, "revocation request id"),
    publicHandle: secretToken(record.publicHandle, "public focus handle"),
    hostGeneration: secretToken(record.hostGeneration, "host generation"),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OmpDirectProtocolError("OMP direct message must be an object");
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(record: Record<string, unknown>, expected: string[]): void {
  if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify([...expected].sort())) {
    throw new OmpDirectProtocolError("OMP direct message fields are invalid");
  }
}

function boundedVisible(value: unknown, maximum: number, label: string): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    Array.from(value).length > maximum
  ) {
    throw new OmpDirectProtocolError(`OMP direct ${label} is invalid`);
  }
  return value;
}

function secretToken(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{32}$/.test(value)) {
    throw new OmpDirectProtocolError(`OMP direct ${label} is invalid`);
  }
  return value;
}

function socketPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    !path.isAbsolute(value) ||
    value.includes("\0") ||
    Buffer.byteLength(value, "utf8") > OMP_DIRECT_LIMITS.socketPathBytes
  ) {
    throw new OmpDirectProtocolError("OMP direct socket context is invalid");
  }
  return value;
}

export function assertOmpHerdrPaneId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 64 ||
    !/^w[A-Za-z0-9_-]{1,30}:p[A-Za-z0-9_-]{1,30}$/.test(value)
  ) {
    throw new OmpDirectProtocolError("OMP direct Herdr pane context is invalid");
  }
  return value;
}

export function assertOmpTmuxPaneId(value: unknown): string {
  if (typeof value !== "string" || !/^%\d{1,10}$/.test(value)) {
    throw new OmpDirectProtocolError("OMP direct tmux pane context is invalid");
  }
  return value;
}

function compositorAddress(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > OMP_DIRECT_LIMITS.compositorAddressCharacters ||
    !/^[A-Za-z0-9_.-]+$/.test(value)
  ) {
    throw new OmpDirectProtocolError("OMP direct compositor context is invalid");
  }
  return value;
}
