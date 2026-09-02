import path from "node:path";

import {
  OMP_ATTENTION_LIMITS,
  assertOmpAttentionEvent,
  type OmpAttentionEvent,
} from "./omp-attention-event.js";

export const WORKER_DIRECT_PROTOCOL_VERSION = 4;
export const WORKER_DIRECT_LIMITS = {
  jsonLineBytes: OMP_ATTENTION_LIMITS.jsonLineBytes,
  requestIdCharacters: 160,
  secretTokenCharacters: 32,
  socketPathBytes: 100,
  paneIdCharacters: 64,
  compositorAddressCharacters: 160,
  clientNameCharacters: 160,
  optionValueCharacters: 512,
} as const;

export type FocusTarget =
  | {
      kind: "herdr";
      socketPath: string;
      paneId: string;
      hyprlandInstance: string;
    }
  | {
      kind: "direct-terminal";
      marker: string;
      hyprlandInstance: string;
    }
  | {
      kind: "tmux";
      socketPath: string;
      paneId: string;
      hyprlandInstance: string;
    };

export type SavedTmuxOption = {
  explicit: boolean;
  value: string;
};

export type FocusRecovery =
  | {
      kind: "herdr";
      marker: string;
    }
  | {
      kind: "tmux";
      marker: string;
      sessionId: string;
      clientName: string;
      originalSetTitles: SavedTmuxOption;
      originalTitleString: SavedTmuxOption;
    };

export type FocusRegistration = {
  schemaVersion: 4;
  type: "focus.register";
  requestId: string;
  publicHandle: string;
  hostGeneration: string;
  target: FocusTarget;
  recovery?: FocusRecovery;
};

export type FocusRevocation = {
  schemaVersion: 4;
  type: "focus.revoke";
  requestId: string;
  publicHandle: string;
  hostGeneration: string;
};

export type WorkerDirectMessage = OmpAttentionEvent | FocusRegistration | FocusRevocation;

export type FocusRejectionCode =
  | "unsupported_terminal_owned"
  | "marker_missing"
  | "marker_ambiguous"
  | "invalid_context"
  | "capacity";
const FOCUS_REJECTION_CODES: Readonly<Record<FocusRejectionCode, true>> = {
  unsupported_terminal_owned: true,
  marker_missing: true,
  marker_ambiguous: true,
  invalid_context: true,
  capacity: true,
};

export type WorkerDirectAcknowledgement =
  | {
      schemaVersion: 4;
      status: "accepted";
      requestId: string;
      recovery?: FocusRecovery;
    }
  | {
      schemaVersion: 4;
      status: "rejected";
      requestId: string;
      code: FocusRejectionCode;
    };

export class WorkerDirectProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkerDirectProtocolError";
  }
}

export function directMessageRequestId(message: WorkerDirectMessage): string {
  return message.type === "omp.attention-event" ? message.eventId : message.requestId;
}

export function parseWorkerDirectMessage(line: string): WorkerDirectMessage {
  if (Buffer.byteLength(`${line}\n`, "utf8") > WORKER_DIRECT_LIMITS.jsonLineBytes) {
    throw new WorkerDirectProtocolError("worker direct message exceeded the byte limit");
  }
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new WorkerDirectProtocolError("worker direct message was not valid JSON");
  }
  return assertWorkerDirectMessage(value);
}

export function assertWorkerDirectMessage(value: unknown): WorkerDirectMessage {
  const record = asRecord(value);
  if (record.type === "omp.attention-event") return assertOmpAttentionEvent(value);
  if (record.schemaVersion !== WORKER_DIRECT_PROTOCOL_VERSION) {
    throw new WorkerDirectProtocolError("worker direct message schema version is unsupported");
  }
  if (record.type === "focus.register") return assertRegistration(record);
  if (record.type === "focus.revoke") return assertRevocation(record);
  throw new WorkerDirectProtocolError("worker direct message type is unsupported");
}

export function serializeWorkerDirectMessage(message: WorkerDirectMessage): string {
  const validated = assertWorkerDirectMessage(message);
  const line = `${JSON.stringify(validated)}\n`;
  if (Buffer.byteLength(line, "utf8") > WORKER_DIRECT_LIMITS.jsonLineBytes) {
    throw new WorkerDirectProtocolError("worker direct message exceeded the byte limit");
  }
  return line;
}

export function parseWorkerDirectAcknowledgement(line: string): WorkerDirectAcknowledgement {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new WorkerDirectProtocolError("worker direct acknowledgement was invalid");
  }
  const record = asRecord(value);
  const requestId = boundedVisible(
    record.requestId,
    WORKER_DIRECT_LIMITS.requestIdCharacters,
    "acknowledgement request id",
  );
  if (record.schemaVersion !== WORKER_DIRECT_PROTOCOL_VERSION) {
    throw new WorkerDirectProtocolError("worker direct acknowledgement was invalid");
  }
  if (record.status === "accepted") {
    const expected =
      record.recovery === undefined
        ? ["requestId", "schemaVersion", "status"]
        : ["recovery", "requestId", "schemaVersion", "status"];
    assertExactKeys(record, expected);
    return {
      schemaVersion: 4,
      status: "accepted",
      requestId,
      ...(record.recovery === undefined ? {} : { recovery: assertRecovery(record.recovery) }),
    };
  }
  if (
    record.status === "rejected" &&
    typeof record.code === "string" &&
    FOCUS_REJECTION_CODES[record.code as FocusRejectionCode] === true
  ) {
    assertExactKeys(record, ["code", "requestId", "schemaVersion", "status"]);
    return {
      schemaVersion: 4,
      status: "rejected",
      requestId,
      code: record.code as FocusRejectionCode,
    };
  }
  throw new WorkerDirectProtocolError("worker direct acknowledgement was invalid");
}

function assertRegistration(record: Record<string, unknown>): FocusRegistration {
  const expected =
    record.recovery === undefined
      ? ["schemaVersion", "type", "requestId", "publicHandle", "hostGeneration", "target"]
      : [
          "schemaVersion",
          "type",
          "requestId",
          "publicHandle",
          "hostGeneration",
          "target",
          "recovery",
        ];
  assertExactKeys(record, expected);
  const target = assertTarget(record.target);
  const recovery = record.recovery === undefined ? undefined : assertRecovery(record.recovery);
  if (recovery && recovery.kind !== target.kind) {
    throw new WorkerDirectProtocolError("focus recovery kind does not match its target");
  }
  return {
    schemaVersion: 4,
    type: "focus.register",
    requestId: boundedVisible(
      record.requestId,
      WORKER_DIRECT_LIMITS.requestIdCharacters,
      "registration request id",
    ),
    publicHandle: secretToken(record.publicHandle, "public focus handle"),
    hostGeneration: secretToken(record.hostGeneration, "host generation"),
    target,
    ...(recovery ? { recovery } : {}),
  };
}

function assertTarget(value: unknown): FocusTarget {
  const target = asRecord(value);
  const hyprlandInstance = compositorAddress(target.hyprlandInstance);
  if (target.kind === "herdr") {
    assertExactKeys(target, ["kind", "socketPath", "paneId", "hyprlandInstance"]);
    return {
      kind: "herdr",
      socketPath: socketPath(target.socketPath),
      paneId: assertHerdrPaneId(target.paneId),
      hyprlandInstance,
    };
  }
  if (target.kind === "direct-terminal") {
    assertExactKeys(target, ["kind", "marker", "hyprlandInstance"]);
    return {
      kind: "direct-terminal",
      marker: secretToken(target.marker, "Foot marker"),
      hyprlandInstance,
    };
  }
  if (target.kind === "tmux") {
    assertExactKeys(target, ["kind", "socketPath", "paneId", "hyprlandInstance"]);
    return {
      kind: "tmux",
      socketPath: socketPath(target.socketPath),
      paneId: assertTmuxPaneId(target.paneId),
      hyprlandInstance,
    };
  }
  throw new WorkerDirectProtocolError("worker direct focus target kind is unsupported");
}

function assertRecovery(value: unknown): FocusRecovery {
  const recovery = asRecord(value);
  if (recovery.kind === "herdr") {
    assertExactKeys(recovery, ["kind", "marker"]);
    return { kind: "herdr", marker: secretToken(recovery.marker, "Herdr recovery marker") };
  }
  if (recovery.kind === "tmux") {
    assertExactKeys(recovery, [
      "kind",
      "marker",
      "sessionId",
      "clientName",
      "originalSetTitles",
      "originalTitleString",
    ]);
    const sessionId = boundedVisible(recovery.sessionId, 16, "tmux session id");
    if (!/^\$\d{1,10}$/.test(sessionId)) {
      throw new WorkerDirectProtocolError("tmux recovery session id was invalid");
    }
    return {
      kind: "tmux",
      marker: secretToken(recovery.marker, "tmux recovery marker"),
      sessionId,
      clientName: printable(
        recovery.clientName,
        WORKER_DIRECT_LIMITS.clientNameCharacters,
        "tmux client name",
      ),
      originalSetTitles: savedTmuxOption(recovery.originalSetTitles, true),
      originalTitleString: savedTmuxOption(recovery.originalTitleString, false),
    };
  }
  throw new WorkerDirectProtocolError("focus recovery kind is unsupported");
}

function savedTmuxOption(value: unknown, booleanValue: boolean): SavedTmuxOption {
  const option = asRecord(value);
  assertExactKeys(option, ["explicit", "value"]);
  if (typeof option.explicit !== "boolean") {
    throw new WorkerDirectProtocolError("saved tmux option ownership was invalid");
  }
  const resolved = printable(
    option.value,
    WORKER_DIRECT_LIMITS.optionValueCharacters,
    "saved tmux option value",
    true,
  );
  if (!option.explicit && resolved !== "") {
    throw new WorkerDirectProtocolError("inherited tmux option must not carry a value");
  }
  if (booleanValue && option.explicit && resolved !== "on" && resolved !== "off") {
    throw new WorkerDirectProtocolError("saved tmux boolean option was invalid");
  }
  return { explicit: option.explicit, value: resolved };
}

function assertRevocation(record: Record<string, unknown>): FocusRevocation {
  assertExactKeys(record, ["schemaVersion", "type", "requestId", "publicHandle", "hostGeneration"]);
  return {
    schemaVersion: 4,
    type: "focus.revoke",
    requestId: boundedVisible(
      record.requestId,
      WORKER_DIRECT_LIMITS.requestIdCharacters,
      "revocation request id",
    ),
    publicHandle: secretToken(record.publicHandle, "public focus handle"),
    hostGeneration: secretToken(record.hostGeneration, "host generation"),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkerDirectProtocolError("worker direct message must be an object");
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(record: Record<string, unknown>, expected: string[]): void {
  if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify([...expected].sort())) {
    throw new WorkerDirectProtocolError("worker direct message has unsupported fields");
  }
}

function boundedVisible(value: unknown, maximum: number, label: string): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    Array.from(value).length > maximum ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new WorkerDirectProtocolError(`${label} was invalid`);
  }
  return value;
}

function printable(value: unknown, maximum: number, label: string, allowEmpty = false): string {
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.length < 1) ||
    Array.from(value).length > maximum ||
    /[^\x20-\x7e]/.test(value)
  ) {
    throw new WorkerDirectProtocolError(`${label} was invalid`);
  }
  return value;
}

function secretToken(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{32}$/.test(value)) {
    throw new WorkerDirectProtocolError(`${label} was invalid`);
  }
  return value;
}

function socketPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    !path.isAbsolute(value) ||
    Buffer.byteLength(value, "utf8") > WORKER_DIRECT_LIMITS.socketPathBytes ||
    /[\u0000\r\n]/.test(value)
  ) {
    throw new WorkerDirectProtocolError("focus socket path was invalid");
  }
  return value;
}

export function assertHerdrPaneId(value: unknown): string {
  if (
    typeof value !== "string" ||
    Array.from(value).length < 1 ||
    Array.from(value).length > WORKER_DIRECT_LIMITS.paneIdCharacters ||
    !/^w[0-9A-Za-z_-]{1,24}:p[0-9A-Za-z_-]{1,24}$/.test(value)
  ) {
    throw new WorkerDirectProtocolError("Herdr pane id was invalid");
  }
  return value;
}

export function assertTmuxPaneId(value: unknown): string {
  if (
    typeof value !== "string" ||
    Array.from(value).length < 1 ||
    Array.from(value).length > WORKER_DIRECT_LIMITS.paneIdCharacters ||
    !/^%\d{1,10}$/.test(value)
  ) {
    throw new WorkerDirectProtocolError("tmux pane id was invalid");
  }
  return value;
}

function compositorAddress(value: unknown): string {
  if (
    typeof value !== "string" ||
    Array.from(value).length < 1 ||
    Array.from(value).length > WORKER_DIRECT_LIMITS.compositorAddressCharacters ||
    !/^[A-Za-z0-9_.-]+$/.test(value)
  ) {
    throw new WorkerDirectProtocolError("Hyprland instance was invalid");
  }
  return value;
}
