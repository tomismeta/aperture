import type { AttentionResponse, SourceEvent, SourceHumanInputRequestedEvent } from "@tomismeta/aperture-core";

export type CodexHookEventName =
  | "SessionStart"
  | "PreToolUse"
  | "PostToolUse"
  | "UserPromptSubmit"
  | "Stop";

export type CodexHookBaseEvent = {
  session_id: string;
  cwd: string;
  hook_event_name: CodexHookEventName;
  transcript_path?: string | null;
  model?: string;
};

export type CodexSessionStartHookEvent = CodexHookBaseEvent & {
  hook_event_name: "SessionStart";
  source: "startup" | "resume" | string;
};

export type CodexPreToolUseHookEvent = CodexHookBaseEvent & {
  hook_event_name: "PreToolUse";
  turn_id: string;
  tool_name: string;
  tool_use_id: string;
  tool_input: {
    command: string;
  };
};

export type CodexPostToolUseHookEvent = CodexHookBaseEvent & {
  hook_event_name: "PostToolUse";
  turn_id: string;
  tool_name: string;
  tool_use_id: string;
  tool_input: {
    command: string;
  };
  tool_response?: unknown;
};

export type CodexUserPromptSubmitHookEvent = CodexHookBaseEvent & {
  hook_event_name: "UserPromptSubmit";
  turn_id: string;
  prompt: string;
};

export type CodexStopHookEvent = CodexHookBaseEvent & {
  hook_event_name: "Stop";
  turn_id: string;
  stop_hook_active?: boolean;
  last_assistant_message?: string | null;
};

export type CodexHookEvent =
  | CodexSessionStartHookEvent
  | CodexPreToolUseHookEvent
  | CodexPostToolUseHookEvent
  | CodexUserPromptSubmitHookEvent
  | CodexStopHookEvent;

export type CodexHookMappingContext = {
  sourceLabel?: string;
};

export type CodexHookResponse =
  | {
      hookSpecificOutput: {
        hookEventName: "PreToolUse";
        permissionDecision: "deny";
        permissionDecisionReason?: string;
      };
      systemMessage?: string;
    }
  | {
      decision: "block";
      reason: string;
    };

export function parseCodexHookEvent(value: unknown): CodexHookEvent {
  if (!isRecord(value)) {
    throw new Error("Codex hook payload must be a JSON object");
  }

  const hookEventName = readRequiredString(value.hook_event_name, "hook_event_name");
  if (!isCodexHookEventName(hookEventName)) {
    throw new Error(`Unsupported Codex hook event "${hookEventName}"`);
  }

  const shared = parseHookSharedFields(value);
  switch (hookEventName) {
    case "SessionStart":
      return {
        ...shared,
        hook_event_name: "SessionStart",
        source: readRequiredString(value.source, "SessionStart.source"),
      };
    case "PreToolUse":
      return {
        ...shared,
        hook_event_name: "PreToolUse",
        turn_id: readRequiredString(value.turn_id, "PreToolUse.turn_id"),
        tool_name: readRequiredString(value.tool_name, "PreToolUse.tool_name"),
        tool_use_id: readRequiredString(value.tool_use_id, "PreToolUse.tool_use_id"),
        tool_input: parseToolInput(value.tool_input, "PreToolUse.tool_input"),
      };
    case "PostToolUse":
      return {
        ...shared,
        hook_event_name: "PostToolUse",
        turn_id: readRequiredString(value.turn_id, "PostToolUse.turn_id"),
        tool_name: readRequiredString(value.tool_name, "PostToolUse.tool_name"),
        tool_use_id: readRequiredString(value.tool_use_id, "PostToolUse.tool_use_id"),
        tool_input: parseToolInput(value.tool_input, "PostToolUse.tool_input"),
        ...(value.tool_response !== undefined ? { tool_response: value.tool_response } : {}),
      };
    case "UserPromptSubmit":
      return {
        ...shared,
        hook_event_name: "UserPromptSubmit",
        turn_id: readRequiredString(value.turn_id, "UserPromptSubmit.turn_id"),
        prompt: readRequiredString(value.prompt, "UserPromptSubmit.prompt"),
      };
    case "Stop":
      return {
        ...shared,
        hook_event_name: "Stop",
        turn_id: readRequiredString(value.turn_id, "Stop.turn_id"),
        ...(typeof value.stop_hook_active === "boolean"
          ? { stop_hook_active: value.stop_hook_active }
          : {}),
        ...(value.last_assistant_message === null || typeof value.last_assistant_message === "string"
          ? { last_assistant_message: value.last_assistant_message }
          : {}),
      };
  }
}

export function mapCodexHookEvent(
  event: CodexHookEvent,
  context: CodexHookMappingContext = {},
): SourceEvent[] {
  switch (event.hook_event_name) {
    case "SessionStart":
      return [mapSessionStart(event, context)];
    case "PreToolUse":
      return [mapPreToolUse(event, context)];
    case "PostToolUse":
      return [mapPostToolUse(event, context)];
    case "UserPromptSubmit":
      return [mapUserPromptSubmit(event, context)];
    case "Stop":
      return [mapStop(event, context)];
  }
}

export function mapCodexHookResponse(
  response: AttentionResponse,
): CodexHookResponse | null {
  const parsed = parseCodexHookInteractionId(response.interactionId);
  if (!parsed || parsed.kind !== "preToolUse") {
    return null;
  }

  switch (response.response.kind) {
    case "approved":
      return null;
    case "rejected":
      return denyResponse(response.response.reason ?? "Rejected in Aperture.");
    case "dismissed":
      return denyResponse("Dismissed in Aperture.");
    case "acknowledged":
      return denyResponse("Aperture requires an explicit approval before Codex can continue.");
    case "option_selected":
    case "text_submitted":
    case "form_submitted":
      return denyResponse("Codex expected an approval decision, but Aperture received a different response.");
  }
}

export function codexHookSessionTaskId(sessionId: string): string {
  return `codex:hook:session:${encodeURIComponent(sessionId)}`;
}

export function codexHookTurnTaskId(sessionId: string, turnId: string): string {
  return `${codexHookSessionTaskId(sessionId)}:turn:${encodeURIComponent(turnId)}`;
}

export function codexHookInteractionId(event: CodexPreToolUseHookEvent): string {
  return [
    "codex",
    "hook",
    "preToolUse",
    encodeURIComponent(event.session_id),
    encodeURIComponent(event.turn_id),
    encodeURIComponent(event.tool_use_id),
  ].join(":");
}

type ParsedCodexHookInteractionId = {
  kind: "preToolUse";
  sessionId: string;
  turnId: string;
  toolUseId: string;
};

function parseCodexHookInteractionId(interactionId: string): ParsedCodexHookInteractionId | null {
  const parts = interactionId.split(":");
  if (parts.length !== 6 || parts[0] !== "codex" || parts[1] !== "hook") {
    return null;
  }

  if (parts[2] !== "preToolUse" || !parts[3] || !parts[4] || !parts[5]) {
    return null;
  }

  return {
    kind: "preToolUse",
    sessionId: decodeURIComponent(parts[3]),
    turnId: decodeURIComponent(parts[4]),
    toolUseId: decodeURIComponent(parts[5]),
  };
}

function mapSessionStart(
  event: CodexSessionStartHookEvent,
  context: CodexHookMappingContext,
): SourceEvent {
  const summary = buildSessionSummary(event);
  if (event.source === "resume") {
    return {
      id: `codex:hook:${encodeURIComponent(event.session_id)}:session.resume`,
      type: "task.updated",
      taskId: codexHookSessionTaskId(event.session_id),
      timestamp: new Date().toISOString(),
      source: codexHookSource(event, context),
      activityClass: "session_status",
      title: "Codex session resumed",
      ...(summary ? { summary } : {}),
      status: "running",
    };
  }

  return {
    id: `codex:hook:${encodeURIComponent(event.session_id)}:session.start`,
    type: "task.started",
    taskId: codexHookSessionTaskId(event.session_id),
    timestamp: new Date().toISOString(),
    source: codexHookSource(event, context),
    title: "Codex session started",
    ...(summary ? { summary } : {}),
  };
}

function mapPreToolUse(
  event: CodexPreToolUseHookEvent,
  context: CodexHookMappingContext,
): SourceHumanInputRequestedEvent {
  return {
    id: `codex:hook:${encodeURIComponent(event.session_id)}:preToolUse:${encodeURIComponent(event.tool_use_id)}`,
    type: "human.input.requested",
    taskId: codexHookTurnTaskId(event.session_id, event.turn_id),
    interactionId: codexHookInteractionId(event),
    timestamp: new Date().toISOString(),
    source: codexHookSource(event, context),
    toolFamily: "bash",
    activityClass: "permission_request",
    title: "Approve Codex command",
    summary: event.tool_input.command,
    request: {
      kind: "approval",
    },
    context: {
      items: [
        { id: "command", label: "Command", value: event.tool_input.command },
        { id: "cwd", label: "Working directory", value: event.cwd },
      ],
    },
  };
}

function mapPostToolUse(
  event: CodexPostToolUseHookEvent,
  context: CodexHookMappingContext,
): SourceEvent {
  const exitCode = extractExitCode(event.tool_response);
  const failed = exitCode !== null && exitCode !== 0;
  const responseSummary = summarizeToolResponse(event.tool_response);
  return {
    id: `codex:hook:${encodeURIComponent(event.session_id)}:postToolUse:${encodeURIComponent(event.tool_use_id)}`,
    type: "task.updated",
    taskId: codexHookTurnTaskId(event.session_id, event.turn_id),
    timestamp: new Date().toISOString(),
    source: codexHookSource(event, context),
    toolFamily: "bash",
    activityClass: failed ? "tool_failure" : "tool_completion",
    title: failed ? "Codex command failed" : "Codex command completed",
    summary: responseSummary ?? event.tool_input.command,
    status: failed ? "failed" : "running",
  };
}

function mapUserPromptSubmit(
  event: CodexUserPromptSubmitHookEvent,
  context: CodexHookMappingContext,
): SourceEvent {
  return {
    id: `codex:hook:${encodeURIComponent(event.session_id)}:userPromptSubmit:${encodeURIComponent(event.turn_id)}`,
    type: "task.updated",
    taskId: codexHookTurnTaskId(event.session_id, event.turn_id),
    timestamp: new Date().toISOString(),
    source: codexHookSource(event, context),
    activityClass: "follow_up",
    title: "Codex prompt submitted",
    summary: summarizePrompt(event.prompt),
    status: "running",
  };
}

function mapStop(
  event: CodexStopHookEvent,
  context: CodexHookMappingContext,
): SourceEvent {
  const summary = summarizeAssistantMessage(event.last_assistant_message);
  return {
    id: `codex:hook:${encodeURIComponent(event.session_id)}:stop:${encodeURIComponent(event.turn_id)}`,
    type: "task.completed",
    taskId: codexHookTurnTaskId(event.session_id, event.turn_id),
    timestamp: new Date().toISOString(),
    source: codexHookSource(event, context),
    ...(summary ? { summary } : {}),
  };
}

function codexHookSource(
  event: Pick<CodexHookBaseEvent, "session_id" | "cwd">,
  context: CodexHookMappingContext,
) {
  if (context.sourceLabel) {
    return {
      id: `codex:hook:${event.session_id}`,
      kind: "codex" as const,
      label: context.sourceLabel,
    };
  }

  const workspace = event.cwd.split("/").filter(Boolean).at(-1) ?? "";
  const compactSession = event.session_id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6) || "session";
  return {
    id: `codex:hook:${event.session_id}`,
    kind: "codex" as const,
    label: workspace ? `Codex ${workspace} #${compactSession}` : `Codex #${compactSession}`,
  };
}

function buildSessionSummary(event: CodexSessionStartHookEvent): string | undefined {
  const parts = [
    event.cwd ? `cwd ${event.cwd}` : null,
    event.model ? `model ${event.model}` : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" • ") : undefined;
}

function summarizeAssistantMessage(value: string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 220 ? `${normalized.slice(0, 217)}...` : normalized;
}

function summarizePrompt(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 220 ? `${normalized.slice(0, 217)}...` : normalized;
}

function summarizeToolResponse(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    const jsonCandidate = tryParseJson(trimmed);
    if (jsonCandidate !== null) {
      return summarizeToolResponse(jsonCandidate);
    }
    return trimmed.length > 220 ? `${trimmed.slice(0, 217)}...` : trimmed;
  }

  if (isRecord(value)) {
    const stdout = readOptionalString(value.stdout);
    const stderr = readOptionalString(value.stderr);
    const parts = [stdout, stderr].filter((part): part is string => !!part && part.trim().length > 0);
    if (parts.length > 0) {
      const combined = parts.join(" ").replace(/\s+/g, " ");
      return combined.length > 220 ? `${combined.slice(0, 217)}...` : combined;
    }
  }

  return undefined;
}

function extractExitCode(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    const jsonCandidate = tryParseJson(trimmed);
    if (jsonCandidate !== null) {
      return extractExitCode(jsonCandidate);
    }
    const match = trimmed.match(/"exit_?code"\s*:\s*(\d+)/i) ?? trimmed.match(/\bexit(?:\s+code)?\s*[:=]?\s*(\d+)\b/i);
    return match ? Number(match[1]) : null;
  }

  if (isRecord(value)) {
    const direct = value.exit_code ?? value.exitCode ?? value.code;
    if (typeof direct === "number" && Number.isFinite(direct)) {
      return direct;
    }
  }

  return null;
}

function parseHookSharedFields(value: Record<string, unknown>): Omit<CodexHookBaseEvent, "hook_event_name"> {
  return {
    session_id: readRequiredString(value.session_id, "session_id"),
    cwd: readRequiredString(value.cwd, "cwd"),
    ...(value.transcript_path === null || typeof value.transcript_path === "string"
      ? { transcript_path: value.transcript_path }
      : {}),
    ...(typeof value.model === "string" ? { model: value.model } : {}),
  };
}

function parseToolInput(value: unknown, label: string): { command: string } {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }

  return {
    command: readRequiredString(value.command, `${label}.command`),
  };
}

function denyResponse(reason: string): CodexHookResponse {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

function readRequiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isCodexHookEventName(value: string): value is CodexHookEventName {
  return value === "SessionStart"
    || value === "PreToolUse"
    || value === "PostToolUse"
    || value === "UserPromptSubmit"
    || value === "Stop";
}

function tryParseJson(value: string): unknown | null {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
