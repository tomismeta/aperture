import type { ApertureSurfaceSnapshotMessage } from "../surface/protocol.js";
export const NOTIFICATION_WORKER_INPUT_SCHEMA_VERSION = 2;
export const NOTIFICATION_WORKER_OUTPUT_SCHEMA_VERSION = 3;

export const APERTURE_NOTIFICATION_WORKER_LIMITS = {
  inputLineBytes: 64 * 1024,
  outputLineBytes: 256 * 1024,
  keyCharacters: 160,
  applicationCharacters: 120,
  categoryCharacters: 120,
  summaryCharacters: 512,
  bodyBytes: 8 * 1024,
  errorCodeCharacters: 80,
  errorMessageCharacters: 400,
  focusHandleCharacters: 32,
} as const;

export type NotificationUrgency = "low" | "normal" | "critical";
export type NotificationCloseReason = "expired" | "dismissed" | "actioned" | "closed" | "unknown";

export type NotificationApplication = {
  name: string;
  desktopEntry?: string;
  category?: string;
};

export type NotificationUpsertInput = {
  type: "notification.observed" | "notification.updated";
  key: string;
  occurredAt: string;
  application: NotificationApplication;
  summary: string;
  body?: string;
  urgency: NotificationUrgency;
};

export type NotificationClosedInput = {
  type: "notification.closed";
  key: string;
  occurredAt: string;
  reason: NotificationCloseReason;
};

export type FocusActivateInput = {
  type: "focus.activate";
  requestId: string;
  handle: string;
};

export type NotificationWorkerInput =
  | NotificationUpsertInput
  | NotificationClosedInput
  | FocusActivateInput
  | { type: "shutdown" };

export type NotificationWorkerHello = {
  type: "hello";
  packageVersion: string;
  worker: "aperture-attention-engine";
  capabilities: {
    notificationInput: true;
    ompDirectInput: true;
    snapshots: true;
    responses: false;
    focusActivation: true;
  };
};

export type NotificationWorkerState = {
  type: "engine";
  state: "restoring" | "ready" | "degraded";
  acceptedSources: number;
};

export type NotificationWorkerError = {
  type: "error";
  code: string;
  message: string;
  recoverable: boolean;
};
export type NotificationWorkerFocusResult = {
  type: "focus.result";
  requestId: string;
  result: "focused" | "stale" | "missing";
};


export type NotificationWorkerOutput =
  | NotificationWorkerHello
  | NotificationWorkerState
  | ApertureSurfaceSnapshotMessage
  | NotificationWorkerFocusResult
  | NotificationWorkerError;

export class NotificationWorkerProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotificationWorkerProtocolError";
  }
}

export function notificationWorkerHello(packageVersion: string): NotificationWorkerHello {
  const version = requiredText(
    packageVersion,
    APERTURE_NOTIFICATION_WORKER_LIMITS.applicationCharacters,
    "package version",
  );
  return {
    type: "hello",
    packageVersion: version,
    worker: "aperture-attention-engine",
    capabilities: {
      notificationInput: true,
      ompDirectInput: true,
      snapshots: true,
      responses: false,
      focusActivation: true,
    },
  };
}

export function parseNotificationWorkerInput(line: string): NotificationWorkerInput {
  if (Buffer.byteLength(`${line}\n`, "utf8") > APERTURE_NOTIFICATION_WORKER_LIMITS.inputLineBytes) {
    throw new NotificationWorkerProtocolError("notification worker input exceeded the byte limit");
  }

  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new NotificationWorkerProtocolError("notification worker input was not valid JSON");
  }

  return assertNotificationWorkerInput(value);
}

export function assertNotificationWorkerInput(value: unknown): NotificationWorkerInput {
  const record = asRecord(value, "notification worker input");
  const type = record.type;

  if (type === "shutdown") {
    assertExactKeys(record, ["type"], "shutdown input");
    return { type };
  }
  if (type === "focus.activate") {
    assertExactKeys(record, ["type", "requestId", "handle"], "focus activation input");
    const handle = record.handle;
    if (
      typeof handle !== "string" ||
      !new RegExp(
        `^[A-Za-z0-9_-]{${APERTURE_NOTIFICATION_WORKER_LIMITS.focusHandleCharacters}}$`,
      ).test(handle)
    ) {
      throw new NotificationWorkerProtocolError("focus activation handle is invalid");
    }
    return {
      type,
      requestId: requiredText(
        record.requestId,
        APERTURE_NOTIFICATION_WORKER_LIMITS.keyCharacters,
        "focus activation request id",
      ),
      handle,
    };
  }


  if (type === "notification.closed") {
    assertExactKeys(record, ["type", "key", "occurredAt", "reason"], "notification closed input");
    const reason = record.reason;
    if (!isCloseReason(reason)) {
      throw new NotificationWorkerProtocolError("notification close reason is invalid");
    }
    return {
      type,
      key: requiredText(
        record.key,
        APERTURE_NOTIFICATION_WORKER_LIMITS.keyCharacters,
        "notification key",
      ),
      occurredAt: requiredTimestamp(record.occurredAt, "notification close timestamp"),
      reason,
    };
  }

  if (type !== "notification.observed" && type !== "notification.updated") {
    throw new NotificationWorkerProtocolError("notification worker input type is unsupported");
  }

  assertExactKeys(
    record,
    ["type", "key", "occurredAt", "application", "summary", "body", "urgency"],
    "notification input",
    ["body"],
  );
  const applicationRecord = asRecord(record.application, "notification application");
  assertExactKeys(
    applicationRecord,
    ["name", "desktopEntry", "category"],
    "notification application",
    ["desktopEntry", "category"],
  );
  const urgency = record.urgency;
  if (!isUrgency(urgency)) {
    throw new NotificationWorkerProtocolError("notification urgency is invalid");
  }

  const body = optionalText(record.body, "notification body");
  if (
    body !== undefined &&
    Buffer.byteLength(body, "utf8") > APERTURE_NOTIFICATION_WORKER_LIMITS.bodyBytes
  ) {
    throw new NotificationWorkerProtocolError("notification body exceeded the byte limit");
  }

  return {
    type,
    key: requiredText(
      record.key,
      APERTURE_NOTIFICATION_WORKER_LIMITS.keyCharacters,
      "notification key",
    ),
    occurredAt: requiredTimestamp(record.occurredAt, "notification timestamp"),
    application: {
      name: requiredText(
        applicationRecord.name,
        APERTURE_NOTIFICATION_WORKER_LIMITS.applicationCharacters,
        "notification application name",
      ),
      ...(applicationRecord.desktopEntry === undefined
        ? {}
        : {
            desktopEntry: requiredText(
              applicationRecord.desktopEntry,
              APERTURE_NOTIFICATION_WORKER_LIMITS.applicationCharacters,
              "notification desktop entry",
            ),
          }),
      ...(applicationRecord.category === undefined
        ? {}
        : {
            category: requiredText(
              applicationRecord.category,
              APERTURE_NOTIFICATION_WORKER_LIMITS.categoryCharacters,
              "notification category",
            ),
          }),
    },
    summary: requiredText(
      record.summary,
      APERTURE_NOTIFICATION_WORKER_LIMITS.summaryCharacters,
      "notification summary",
    ),
    ...(body === undefined ? {} : { body }),
    urgency,
  };
}

export function serializeNotificationWorkerOutput(message: NotificationWorkerOutput): string {
  const line = `${JSON.stringify(message)}\n`;
  if (Buffer.byteLength(line, "utf8") > APERTURE_NOTIFICATION_WORKER_LIMITS.outputLineBytes) {
    throw new NotificationWorkerProtocolError("notification worker output exceeded the byte limit");
  }
  return line;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NotificationWorkerProtocolError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(
  value: Record<string, unknown>,
  permitted: string[],
  label: string,
  optional: string[] = [],
): void {
  const allowed = new Set(permitted);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new NotificationWorkerProtocolError(`${label} contains an unknown field`);
    }
  }
  const optionalKeys = new Set(optional);
  for (const key of permitted) {
    if (!optionalKeys.has(key) && !(key in value)) {
      throw new NotificationWorkerProtocolError(`${label} is missing required field: ${key}`);
    }
  }
}

function requiredText(value: unknown, maximum: number, label: string): string {
  if (typeof value !== "string") {
    throw new NotificationWorkerProtocolError(`${label} must be a string`);
  }
  if (!value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new NotificationWorkerProtocolError(`${label} must contain visible text`);
  }
  if (Array.from(value).length > maximum) {
    throw new NotificationWorkerProtocolError(`${label} exceeded the character limit`);
  }
  return value;
}

function optionalText(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new NotificationWorkerProtocolError(`${label} must be a string`);
  }
  return value;
}

function requiredTimestamp(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new NotificationWorkerProtocolError(`${label} must be a string`);
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new NotificationWorkerProtocolError(`${label} must be a canonical ISO timestamp`);
  }
  return value;
}

function isUrgency(value: unknown): value is NotificationUrgency {
  return value === "low" || value === "normal" || value === "critical";
}

function isCloseReason(value: unknown): value is NotificationCloseReason {
  return (
    value === "expired" ||
    value === "dismissed" ||
    value === "actioned" ||
    value === "closed" ||
    value === "unknown"
  );
}
