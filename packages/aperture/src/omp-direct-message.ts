import path from "node:path";

import {
  OMP_ATTENTION_LIMITS,
  assertOmpAttentionEvent,
  type OmpAttentionEvent,
} from "./omp-attention-event.js";

export const OMP_DIRECT_PROTOCOL_VERSION = 2;
export const OMP_DIRECT_LIMITS = {
  jsonLineBytes: OMP_ATTENTION_LIMITS.jsonLineBytes,
  requestIdCharacters: 160,
  secretTokenCharacters: 32,
  socketPathBytes: 100,
  paneIdCharacters: 64,
  compositorAddressCharacters: 160,
} as const;

export type OmpFocusRegistration = {
  schemaVersion: 2;
  type: "omp.focus.register";
  requestId: string;
  publicHandle: string;
  hostGeneration: string;
  herdrSocketPath: string;
  paneId: string;
  compositorAddress: string;
};

export type OmpFocusRevocation = {
  schemaVersion: 2;
  type: "omp.focus.revoke";
  requestId: string;
  publicHandle: string;
  hostGeneration: string;
};

export type OmpDirectMessage = OmpAttentionEvent | OmpFocusRegistration | OmpFocusRevocation;

export type OmpDirectAcknowledgement = {
  schemaVersion: 2;
  status: "accepted";
  requestId: string;
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
  assertExactKeys(record, ["schemaVersion", "status", "requestId"]);
  if (
    record.schemaVersion !== OMP_DIRECT_PROTOCOL_VERSION ||
    record.status !== "accepted"
  ) {
    throw new OmpDirectProtocolError("OMP direct acknowledgement was invalid");
  }
  return {
    schemaVersion: 2,
    status: "accepted",
    requestId: boundedVisible(
      record.requestId,
      OMP_DIRECT_LIMITS.requestIdCharacters,
      "acknowledgement request id",
    ),
  };
}

function assertRegistration(record: Record<string, unknown>): OmpFocusRegistration {
  assertExactKeys(record, [
    "schemaVersion",
    "type",
    "requestId",
    "publicHandle",
    "hostGeneration",
    "herdrSocketPath",
    "paneId",
    "compositorAddress",
  ]);
  const herdrSocketPath = socketPath(record.herdrSocketPath);
  return {
    schemaVersion: 2,
    type: "omp.focus.register",
    requestId: boundedVisible(
      record.requestId,
      OMP_DIRECT_LIMITS.requestIdCharacters,
      "registration request id",
    ),
    publicHandle: secretToken(record.publicHandle, "public focus handle"),
    hostGeneration: secretToken(record.hostGeneration, "host generation"),

    herdrSocketPath,
    paneId: paneId(record.paneId),
    compositorAddress: compositorAddress(record.compositorAddress),
  };
}

function assertRevocation(record: Record<string, unknown>): OmpFocusRevocation {
  assertExactKeys(record, [
    "schemaVersion",
    "type",
    "requestId",
    "publicHandle",
    "hostGeneration",
  ]);
  return {
    schemaVersion: 2,
    type: "omp.focus.revoke",
    requestId: boundedVisible(
      record.requestId,
      OMP_DIRECT_LIMITS.requestIdCharacters,
      "revocation request id",
    ),
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
  const actual = Object.keys(record).sort();
  const sorted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(sorted)) {
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
  if (
    typeof value !== "string" ||
    !new RegExp(`^[A-Za-z0-9_-]{${OMP_DIRECT_LIMITS.secretTokenCharacters}}$`).test(value)
  ) {
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
    throw new OmpDirectProtocolError("OMP direct Herdr socket context is invalid");
  }
  return value;
}

function paneId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > OMP_DIRECT_LIMITS.paneIdCharacters ||
    !/^w[1-9]\d*:p[1-9]\d*$/.test(value)
  ) {
    throw new OmpDirectProtocolError("OMP direct Herdr pane context is invalid");
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
