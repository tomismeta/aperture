import type { SourceEvent } from "@tomismeta/aperture-core";

import type {
  RuntimeWorkResponseRecord,
  WorkReceipt,
  WorkReceiptItem,
  WorkReceiptMode,
  WorkReceiptNextStep,
  WorkResponse,
  WorkResponseState,
} from "./runtime-contract.js";
import type { WorkInput } from "./work-event-ingest.js";
import { WORK_API_VERSION } from "./work-contract.js";

export function describeWorkEndpoint(retention: {
  pendingTtlMs: number;
  terminalRetentionMs: number;
  capacity: number;
}): {
  apiVersion: string;
  path: "/work";
  method: "POST";
  summary: string;
  auth: string;
  send: Array<{
    receivedAs: WorkReceiptMode;
    contentType: string;
    body: string;
    bestFor: string;
    example: string;
  }>;
  response: {
    path: "/work/response/{interactionId}";
    deletePath: "/work/response/{interactionId}";
    bestFor: string;
    states: WorkResponseState[];
  };
  retention: {
    pendingTtlMs: number;
    terminalRetentionMs: number;
    capacity: number;
  };
  next: WorkReceiptNextStep[];
} {
  return {
    apiVersion: WORK_API_VERSION,
    path: "/work",
    method: "POST",
    summary:
      "Send plain text for the simplest ingress. Send structured WorkEvent JSON when you need stable work ids, richer metadata, or explicit human-input requests. Aperture fills specVersion, id, source, and type when you omit them.",
    auth: "Use the local Aperture bearer token for every /work request. The token is created with the local runtime and is required on all non-health routes.",
    send: [
      {
        receivedAs: "text",
        contentType: "text/plain",
        body: "string",
        bestFor: "Quick status or progress updates with minimal friction.",
        example: "Waiting for approval before continuing with the deploy.",
      },
      {
        receivedAs: "event",
        contentType: "application/json",
        body: "WorkEvent",
        bestFor:
          "Stable work identity, structured requests, and portable metadata. kind and work are the only required top-level fields.",
        example:
          '{"kind":"work.updated","work":{"id":"task:deploy-42","status":"waiting","summary":"Waiting for approval before continuing."}}',
      },
      {
        receivedAs: "batch",
        contentType: "application/json",
        body: "WorkEvent[]",
        bestFor: "Publishing multiple structured work items in one request.",
        example:
          '[{"kind":"work.updated","work":{"id":"task:one","status":"running"}},{"kind":"work.updated","work":{"id":"task:two","status":"waiting"}}]',
      },
    ],
    response: {
      path: "/work/response/{interactionId}",
      deletePath: "/work/response/{interactionId}",
      bestFor:
        "Poll here when a structured WorkEvent with kind=input.requested is waiting on a human answer. responsePath values are relative to the same Aperture server root and responseUrl values are absolute when Aperture can infer the current base URL.",
      states: ["pending", "answered", "expired", "cancelled"],
    },
    retention,
    next: [
      {
        when: "You only need to say what happened once.",
        send: "text",
        why: "This is the lowest-friction path.",
      },
      {
        when: "You need stable identity across updates.",
        send: "WorkEvent",
        why: "Use work.id so later updates refer to the same work item.",
      },
      {
        when: "You need explicit approval, choice, or form input.",
        send: "WorkEvent",
        why: "Use kind=input.requested with request.kind.",
      },
      {
        when: "You want to publish multiple structured updates at once.",
        send: "WorkEvent[]",
        why: "Use a JSON array of WorkEvent objects.",
      },
    ],
  };
}

export function describeAcceptedWork(
  payload: WorkInput,
  events: SourceEvent[],
  options: {
    baseUrl: string;
    retention: {
      pendingTtlMs: number;
      terminalRetentionMs: number;
      capacity: number;
    };
  },
): WorkReceipt {
  const mode = describeWorkReceiptMode(payload);
  const next = workReceiptNext(mode);
  return {
    ok: true,
    apiVersion: WORK_API_VERSION,
    accepted: events.length,
    receivedAs: mode,
    message: workAcceptedMessage(mode, events),
    published: events.map((event) => describeAcceptedWorkItem(event, options.baseUrl)),
    retention: options.retention,
    ...(next !== undefined ? { next } : {}),
  };
}

export function invalidWorkPayloadMessage(detail?: string): string {
  return detail
    ? `${detail} POST /work accepts plain text, one WorkEvent object, or an array of WorkEvent objects.`
    : "Invalid work payload. POST /work accepts plain text, one WorkEvent object, or an array of WorkEvent objects.";
}

export function buildWorkResponsePath(interactionId: string): string {
  return `/work/response/${encodeURIComponent(interactionId)}`;
}

export function buildWorkResponseUrl(baseUrl: string, interactionId: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${buildWorkResponsePath(interactionId)}`;
}

export function readWorkResponseInteractionId(path: string): string | null {
  const prefix = "/work/response/";
  if (!path.startsWith(prefix)) {
    return null;
  }
  const encoded = path.slice(prefix.length);
  if (encoded === "" || encoded.includes("/")) {
    return null;
  }
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

export function describeWorkResponse(response: RuntimeWorkResponseRecord): WorkResponse {
  return {
    ok: true,
    apiVersion: WORK_API_VERSION,
    taskId: response.taskId,
    interactionId: response.interactionId,
    state: response.state,
    message: workResponseMessage(response),
    ...(response.response !== undefined ? { response: response.response } : {}),
    ...(response.answeredAt !== undefined ? { answeredAt: response.answeredAt } : {}),
    ...(response.expiresAt !== undefined ? { expiresAt: response.expiresAt } : {}),
    ...(response.cancelledAt !== undefined ? { cancelledAt: response.cancelledAt } : {}),
    ...(response.retentionExpiresAt !== undefined
      ? { retentionExpiresAt: response.retentionExpiresAt }
      : {}),
  };
}

function describeWorkReceiptMode(payload: WorkInput): WorkReceiptMode {
  if (typeof payload === "string") {
    return "text";
  }
  if (Array.isArray(payload)) {
    return "batch";
  }
  return "event";
}

function describeAcceptedWorkItem(event: SourceEvent, baseUrl: string): WorkReceiptItem {
  return {
    taskId: event.taskId,
    type: event.type,
    ...("title" in event ? { title: event.title } : {}),
    ...("summary" in event && typeof event.summary === "string" ? { summary: event.summary } : {}),
    ...("status" in event ? { status: event.status } : {}),
    ...("interactionId" in event ? { interactionId: event.interactionId } : {}),
    ...("interactionId" in event
      ? { responsePath: buildWorkResponsePath(event.interactionId) }
      : {}),
    ...("interactionId" in event
      ? { responseUrl: buildWorkResponseUrl(baseUrl, event.interactionId) }
      : {}),
  };
}

function workAcceptedMessage(mode: WorkReceiptMode, events: SourceEvent[]): string {
  const accepted = events.length;
  const hasInteractiveReply = events.some((event) => event.type === "human.input.requested");
  switch (mode) {
    case "text":
      return accepted === 1
        ? "Accepted plain-text work input and mapped it into one standalone work item."
        : `Accepted ${accepted} plain-text work items.`;
    case "event":
      return hasInteractiveReply
        ? "Accepted structured WorkEvent. Poll the returned responsePath for the human answer."
        : "Accepted structured WorkEvent.";
    case "batch":
      return hasInteractiveReply
        ? `Accepted ${accepted} structured WorkEvent objects. Poll each returned responsePath for human answers.`
        : `Accepted ${accepted} structured WorkEvent objects.`;
  }
}

function workReceiptNext(mode: WorkReceiptMode): WorkReceiptNextStep[] | undefined {
  switch (mode) {
    case "text":
      return [
        {
          when: "You need stable identity across later updates.",
          send: "WorkEvent",
          why: "Add work.id so future updates refer to the same work item.",
        },
        {
          when: "You need approval, choice, or form interactions.",
          send: "WorkEvent",
          why: "Use kind=input.requested with request.kind.",
        },
        {
          when: "You want batch publish behavior.",
          send: "WorkEvent[]",
          why: "Send an array of structured WorkEvent objects.",
        },
      ];
    case "event":
      return [
        {
          when: "You only need the simplest one-off status ingress.",
          send: "text",
          why: "Plain text is lower friction for one-off updates.",
        },
        {
          when: "You want to publish multiple structured work items in one request.",
          send: "WorkEvent[]",
          why: "Send a JSON array of WorkEvent objects.",
        },
      ];
    case "batch":
      return [
        {
          when: "Each entry should be a full structured work item.",
          send: "WorkEvent[]",
          why: "Batch mode expects each array entry to be a complete WorkEvent object.",
        },
        {
          when: "You do not need batch behavior.",
          send: "text",
          why: "Use plain text or a single WorkEvent for lower-friction ingress.",
        },
      ];
  }
}

function workResponseMessage(response: RuntimeWorkResponseRecord): string {
  switch (response.state) {
    case "answered":
      return "Human response recorded for this interaction.";
    case "expired":
      return "The response window expired before a human answer was recorded.";
    case "cancelled":
      return "The producer cancelled this interaction before a human answer was recorded.";
    case "pending":
      return "Still waiting for a human response.";
  }
}
