import { createHash } from "node:crypto";
import { basename } from "node:path";

import type {
  AttentionActivityClass,
  SourceEvent,
  SourceHumanInputRequestedEvent,
  SourceTaskUpdatedEvent,
} from "@tomismeta/aperture-core";

import type { PiExtensionContext } from "./types.js";

export type PiMappingContext = {
  cwd?: string;
  sessionId?: string;
  sessionFile?: string;
  sourceLabel?: string;
  now?: () => string;
  model?: unknown;
};

export type PiResponseAction =
  | {
      kind: "tool.allow";
      toolCallId: string;
    }
  | {
      kind: "tool.block";
      toolCallId: string;
      reason: string;
    };

export type ParsedPiInteractionId = {
  kind: "tool";
  instanceKey: string;
  toolCallId: string;
};

type ContextItem = NonNullable<NonNullable<SourceEvent["metadata"]>>;
type AttentionContextItem = NonNullable<
  NonNullable<SourceTaskUpdatedEvent["context"]>["items"]
>[number];
type HumanInputSemanticHints = NonNullable<SourceHumanInputRequestedEvent["semanticHints"]>;
type TaskUpdateSemanticHints = NonNullable<SourceTaskUpdatedEvent["semanticHints"]>;

export function createPiInstanceKey(context: PiMappingContext): string {
  const cwd = context.cwd?.trim() || "unknown-cwd";
  const session = context.sessionId?.trim() || context.sessionFile?.trim() || "active";
  return encodeURIComponent(`${cwd}|${session}`);
}

export function piSource(context: PiMappingContext) {
  return {
    id: `pi:${createPiInstanceKey(context)}`,
    kind: "pi" as const,
    label: context.sourceLabel ?? piSourceLabel(context),
  };
}

export function piSourceLabel(context: Pick<PiMappingContext, "cwd" | "sourceLabel">): string {
  if (context.sourceLabel) {
    return context.sourceLabel;
  }
  const project = context.cwd ? basename(context.cwd) : "";
  return project ? `Pi ${project}` : "Pi";
}

export function piTaskId(instanceKey: string): string {
  return `pi:${instanceKey}:session`;
}

export function piInteractionId(instanceKey: string, toolCallId: string): string {
  return `pi:${instanceKey}:tool:${encodeURIComponent(toolCallId)}`;
}

export function stableTextKey(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function parsePiInteractionId(interactionId: string): ParsedPiInteractionId | null {
  const match = interactionId.match(/^pi:([^:]+):tool:(.+)$/);
  if (!match?.[1] || !match[2]) {
    return null;
  }
  return {
    kind: "tool",
    instanceKey: match[1],
    toolCallId: decodeURIComponent(match[2]),
  };
}

export function eventTimestamp(context: PiMappingContext): string {
  return context.now?.() ?? new Date().toISOString();
}

export function contextFromPiExtension(
  extensionContext: PiExtensionContext,
  base: PiMappingContext,
): PiMappingContext {
  const sessionFile = readSessionFile(extensionContext.sessionManager);
  const next: PiMappingContext = { ...base };
  const cwd = base.cwd ?? extensionContext.cwd;
  if (cwd) {
    next.cwd = cwd;
  }
  const resolvedSessionFile = base.sessionFile ?? sessionFile;
  if (resolvedSessionFile) {
    next.sessionFile = resolvedSessionFile;
  }
  const model = base.model ?? extensionContext.model;
  if (model !== undefined) {
    next.model = model;
  }
  return next;
}

export function toolFamilyFor(
  toolName: string | undefined,
): "bash" | "read" | "edit" | "write" | "search" | undefined {
  switch (toolName) {
    case "bash":
      return "bash";
    case "read":
    case "ls":
      return "read";
    case "grep":
    case "find":
      return "search";
    case "edit":
      return "edit";
    case "write":
      return "write";
    default:
      return undefined;
  }
}

export function activityClassForToolEnd(isError: boolean | undefined): AttentionActivityClass {
  return isError ? "tool_failure" : "tool_completion";
}

export function riskHintForTool(toolName: string | undefined): "low" | "medium" | "high" {
  switch (toolName) {
    case "read":
    case "grep":
    case "find":
    case "ls":
      return "low";
    case "edit":
    case "write":
    case "bash":
      return "high";
    default:
      return "medium";
  }
}

export function toolApprovalSemanticHints(toolName: string): HumanInputSemanticHints {
  return {
    intentFrame: "approval_request",
    activityClass: "permission_request",
    whyNow: `Pi paused before running ${toolName}.`,
    confidence: "high",
  };
}

export function taskActivitySemanticHints(
  activityClass: NonNullable<SourceTaskUpdatedEvent["activityClass"]>,
  whyNow?: string,
): TaskUpdateSemanticHints {
  return {
    activityClass,
    ...(whyNow ? { whyNow } : {}),
    confidence: "high",
  };
}

export function contextItem(
  id: string,
  label: string,
  value: unknown,
): AttentionContextItem | null {
  const normalized = stringifyContextValue(value);
  return normalized ? { id, label, value: normalized } : null;
}

export function compactJson(value: unknown, maxLength = 600): string | undefined {
  if (typeof value === "string") {
    return value.trim() || undefined;
  }
  if (value === undefined || value === null) {
    return undefined;
  }
  try {
    const serialized = JSON.stringify(value);
    if (!serialized || serialized === "{}" || serialized === "[]") {
      return undefined;
    }
    return serialized.length > maxLength ? `${serialized.slice(0, maxLength - 1)}…` : serialized;
  } catch {
    return undefined;
  }
}

export function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

export function readModelLabel(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return readString(value.name) ?? readString(value.id);
}

export function piEventMetadata(extra?: Record<string, unknown>): ContextItem {
  return {
    execution: {
      runner: "pi",
    },
    ...(extra ?? {}),
  };
}

function stringifyContextValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim() || undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return compactJson(value);
}

function readSessionFile(sessionManager: unknown): string | undefined {
  if (!isRecord(sessionManager)) {
    return undefined;
  }
  return (
    readString(sessionManager.sessionFile) ??
    readString(sessionManager.currentSessionFile) ??
    readString(sessionManager.path)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
