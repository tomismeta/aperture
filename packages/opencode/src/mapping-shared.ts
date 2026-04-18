import type { OpencodeDirectoryScope, OpencodeMessageRole } from "./types.js";
import { opencodeSourceLabel } from "./mapping-source-label.js";

export type OpencodeMappingContext = {
  baseUrl: string;
  scope?: OpencodeDirectoryScope;
  sourceLabel?: string;
  messageRole?: OpencodeMessageRole;
};

export type OpencodeResponseAction =
  | {
      kind: "permission.reply";
      requestId: string;
      body: {
        reply: "once" | "reject";
        message?: string;
      };
    }
  | {
      kind: "question.reply";
      requestId: string;
      body: {
        answers: string[][];
      };
    }
  | {
      kind: "question.reject";
      requestId: string;
      body: {
        message?: string;
      };
    }
  | {
      kind: "session.prompt";
      sessionId: string;
      body: {
        parts: Array<{
          type: "text";
          text: string;
          metadata?: Record<string, unknown>;
        }>;
      };
    };

export type ParsedInteractionId =
  | {
      kind: "permission";
      instanceKey: string;
      requestId: string;
    }
  | {
      kind: "question";
      instanceKey: string;
      requestId: string;
    }
  | {
      kind: "followup";
      instanceKey: string;
      sessionId: string;
      partId: string;
    };

export function createOpencodeInstanceKey(
  context: Pick<OpencodeMappingContext, "baseUrl" | "scope">,
): string {
  const base = new URL(context.baseUrl);
  const scope = context.scope?.directory?.trim() ?? "";
  return encodeURIComponent(`${base.origin}${base.pathname.replace(/\/+$/, "")}|${scope}`);
}

export function opencodeSource(
  context: Pick<OpencodeMappingContext, "baseUrl" | "scope" | "sourceLabel">,
) {
  return {
    id: `opencode:${createOpencodeInstanceKey(context)}`,
    kind: "opencode" as const,
    label: opencodeSourceLabel(context),
  };
}

export function opencodeTaskId(
  instanceKey: string,
  sessionId?: string,
  fallbackId?: string,
): string {
  const anchor = sessionId?.trim() || fallbackId?.trim() || "unknown";
  return `opencode:${instanceKey}:session:${encodeURIComponent(anchor)}`;
}

export function opencodeInteractionId(
  instanceKey: string,
  kind: "permission" | "question",
  requestId: string,
): string {
  return `opencode:${instanceKey}:${kind}:${encodeURIComponent(requestId)}`;
}

export function parseOpencodeInteractionId(interactionId: string): ParsedInteractionId | null {
  const match = interactionId.match(/^opencode:([^:]+):(permission|question|followup):(.+)$/);
  if (!match) {
    return null;
  }

  const [, instanceKey, kind, requestId] = match;
  if (!instanceKey || !requestId) {
    return null;
  }

  if (kind === "permission") {
    return { kind, instanceKey, requestId: decodeURIComponent(requestId) };
  }
  if (kind === "question") {
    return { kind: "question", instanceKey, requestId: decodeURIComponent(requestId) };
  }

  const [encodedSessionId, encodedPartId = "latest"] = requestId.split("|", 2);
  if (!encodedSessionId) {
    return null;
  }

  return {
    kind: "followup",
    instanceKey,
    sessionId: decodeURIComponent(encodedSessionId),
    partId: decodeURIComponent(encodedPartId),
  };
}

export function normalizeTaskStatus(status: string | undefined) {
  switch (status) {
    case "busy":
    case "running":
    case "working":
      return "running" as const;
    case "waiting":
    case "blocked":
    case "paused":
      return "waiting" as const;
    case "failed":
    case "error":
      return "failed" as const;
    case "completed":
    case "done":
      return "completed" as const;
    default:
      return null;
  }
}

export function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}
