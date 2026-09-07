import { serializeAsciiJsonLine } from "../ascii-jsonl.js";
import type { NotificationWorkerSnapshot } from "./protocol.js";

export const OMP_WORKER_OUTPUT_PROTOCOL_VERSION = 5;
export const OMP_WORKER_LIMITS = {
  inputLineBytes: 64 * 1024,
  outputLineBytes: 256 * 1024,
  requestIdCharacters: 160,
  errorCodeCharacters: 80,
  errorMessageCharacters: 400,
  focusHandleCharacters: 32,
} as const;

export type OmpAttentionDismissTarget =
  | { scope: "item"; id: string; version: number }
  | { scope: "all"; sequence: number };

export type OmpAttentionDismissResult = {
  result: "dismissed" | "stale" | "failed";
  count: number;
};

export type OmpWorkerInput =
  | { type: "focus.activate"; requestId: string; handle: string }
  | { type: "attention.dismiss"; requestId: string; target: OmpAttentionDismissTarget }
  | { type: "shutdown" };

export type OmpWorkerOutput =
  | {
      protocolVersion: typeof OMP_WORKER_OUTPUT_PROTOCOL_VERSION;
      type: "hello";
      packageVersion: string;
      worker: "aperture-attention-engine";
      capabilities: {
        notificationInput: false;
        ompDirectInput: true;
        snapshots: true;
        responses: false;
        focusActivation: true;
        attentionDismissal: true;
      };
    }
  | { type: "engine"; state: "restoring" | "ready"; acceptedSources: 1 }
  | NotificationWorkerSnapshot
  | { type: "focus.result"; requestId: string; result: "focused" | "stale" | "missing" }
  | ({ type: "attention.result"; requestId: string } & OmpAttentionDismissResult)
  | { type: "error"; code: string; message: string; recoverable: boolean };

export class OmpWorkerProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OmpWorkerProtocolError";
  }
}

export function ompWorkerHello(
  packageVersion: string,
): Extract<OmpWorkerOutput, { type: "hello" }> {
  return {
    protocolVersion: OMP_WORKER_OUTPUT_PROTOCOL_VERSION,
    type: "hello",
    packageVersion: requiredText(packageVersion, 120, "package version"),
    worker: "aperture-attention-engine",
    capabilities: {
      notificationInput: false,
      ompDirectInput: true,
      snapshots: true,
      responses: false,
      focusActivation: true,
      attentionDismissal: true,
    },
  };
}

export function parseOmpWorkerInput(line: string): OmpWorkerInput {
  if (Buffer.byteLength(`${line}\n`, "utf8") > OMP_WORKER_LIMITS.inputLineBytes) {
    throw new OmpWorkerProtocolError("OMP worker input exceeded the byte limit");
  }
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new OmpWorkerProtocolError("OMP worker input was not valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OmpWorkerProtocolError("OMP worker input must be an object");
  }
  const record = value as Record<string, unknown>;
  if (record.type === "shutdown") {
    if (Object.keys(record).length !== 1) {
      throw new OmpWorkerProtocolError("shutdown input fields are invalid");
    }
    return { type: "shutdown" };
  }
  if (record.type === "attention.dismiss" && Object.keys(record).length === 3) {
    const requestId = requiredText(
      record.requestId,
      OMP_WORKER_LIMITS.requestIdCharacters,
      "attention dismissal request id",
    );
    const target = record.target;
    if (!target || typeof target !== "object" || Array.isArray(target)) {
      throw new OmpWorkerProtocolError("attention dismissal target is invalid");
    }
    const fields = target as Record<string, unknown>;
    if (fields.scope === "item" && Object.keys(fields).length === 3) {
      return {
        type: "attention.dismiss",
        requestId,
        target: {
          scope: "item",
          id: requiredText(fields.id, 160, "attention frame id"),
          version: requiredInteger(fields.version, "attention frame version"),
        },
      };
    }
    if (fields.scope === "all" && Object.keys(fields).length === 2) {
      return {
        type: "attention.dismiss",
        requestId,
        target: {
          scope: "all",
          sequence: requiredInteger(fields.sequence, "attention snapshot sequence"),
        },
      };
    }
    throw new OmpWorkerProtocolError("attention dismissal target fields are invalid");
  }
  if (record.type !== "focus.activate" || Object.keys(record).length !== 3) {
    throw new OmpWorkerProtocolError("OMP worker input type is unsupported");
  }
  if (
    typeof record.handle !== "string" ||
    !new RegExp(`^[A-Za-z0-9_-]{${OMP_WORKER_LIMITS.focusHandleCharacters}}$`).test(record.handle)
  ) {
    throw new OmpWorkerProtocolError("focus activation handle is invalid");
  }
  return {
    type: "focus.activate",
    requestId: requiredText(
      record.requestId,
      OMP_WORKER_LIMITS.requestIdCharacters,
      "focus activation request id",
    ),
    handle: record.handle,
  };
}

export function serializeOmpWorkerOutput(message: OmpWorkerOutput): string {
  const line = serializeAsciiJsonLine(message);
  if (line.length > OMP_WORKER_LIMITS.outputLineBytes) {
    throw new OmpWorkerProtocolError("OMP worker output exceeded the byte limit");
  }
  return line;
}

function requiredText(value: unknown, maximum: number, label: string): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    Array.from(value).length > maximum
  ) {
    throw new OmpWorkerProtocolError(`${label} is invalid`);
  }
  return value;
}

function requiredInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new OmpWorkerProtocolError(`${label} is invalid`);
  }
  return value;
}
