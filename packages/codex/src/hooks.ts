import type {
  AttentionResponse,
  SourceEvent,
  SourceHumanInputRequestedEvent,
  SourceTaskUpdatedEvent,
} from "@tomismeta/aperture-core";

export type CodexHookEventName =
  | "SessionStart"
  | "PreToolUse"
  | "PermissionRequest"
  | "PostToolUse"
  | "PreCompact"
  | "PostCompact"
  | "SubagentStart"
  | "SubagentStop"
  | "UserPromptSubmit"
  | "Stop";

export type CodexHookBaseEvent = {
  session_id: string;
  cwd: string;
  hook_event_name: CodexHookEventName;
  transcript_path?: string | null;
  model?: string;
  permission_mode?: string;
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
  tool_input: unknown;
};

export type CodexPermissionRequestHookEvent = CodexHookBaseEvent & {
  hook_event_name: "PermissionRequest";
  turn_id: string;
  tool_name: string;
  tool_input: unknown;
};

export type CodexPostToolUseHookEvent = CodexHookBaseEvent & {
  hook_event_name: "PostToolUse";
  turn_id: string;
  tool_name: string;
  tool_use_id: string;
  tool_input: unknown;
  tool_response?: unknown;
};

export type CodexCompactHookEvent = CodexHookBaseEvent & {
  hook_event_name: "PreCompact" | "PostCompact";
  turn_id: string;
  trigger: "manual" | "auto" | string;
};

export type CodexSubagentStartHookEvent = CodexHookBaseEvent & {
  hook_event_name: "SubagentStart";
  turn_id: string;
  agent_id: string;
  agent_type: string;
  agent_transcript_path?: string | null;
};

export type CodexSubagentStopHookEvent = CodexHookBaseEvent & {
  hook_event_name: "SubagentStop";
  turn_id: string;
  agent_id: string;
  agent_type: string;
  agent_transcript_path?: string | null;
  stop_hook_active?: boolean;
  last_assistant_message?: string | null;
};

export type CodexUserPromptSubmitHookEvent = CodexHookBaseEvent & {
  hook_event_name: "UserPromptSubmit";
  turn_id: string;
  prompt: string;
};

export type CodexStopHookEvent = CodexHookBaseEvent & {
  hook_event_name: "Stop";
  turn_id: string;
  stop_hook_now?: boolean;
  last_assistant_message?: string | null;
};

export type CodexHookEvent =
  | CodexSessionStartHookEvent
  | CodexPreToolUseHookEvent
  | CodexPermissionRequestHookEvent
  | CodexPostToolUseHookEvent
  | CodexCompactHookEvent
  | CodexSubagentStartHookEvent
  | CodexSubagentStopHookEvent
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
      hookSpecificOutput: {
        hookEventName: "PermissionRequest";
        decision: {
          behavior: "allow" | "deny";
          message?: string;
        };
      };
      systemMessage?: string;
    }
  | {
      decision: "block";
      reason: string;
    };

type HumanInputSemanticHints = NonNullable<SourceHumanInputRequestedEvent["semanticHints"]>;
type TaskUpdateSemanticHints = NonNullable<SourceTaskUpdatedEvent["semanticHints"]>;

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
    case "PermissionRequest":
      return {
        ...shared,
        hook_event_name: "PermissionRequest",
        turn_id: readRequiredString(value.turn_id, "PermissionRequest.turn_id"),
        tool_name: readRequiredString(value.tool_name, "PermissionRequest.tool_name"),
        tool_input: parseToolInput(value.tool_input, "PermissionRequest.tool_input"),
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
    case "PreCompact":
    case "PostCompact":
      return {
        ...shared,
        hook_event_name: hookEventName,
        turn_id: readRequiredString(value.turn_id, `${hookEventName}.turn_id`),
        trigger: readRequiredString(value.trigger, `${hookEventName}.trigger`),
      };
    case "SubagentStart":
      return {
        ...shared,
        hook_event_name: "SubagentStart",
        turn_id: readRequiredString(value.turn_id, "SubagentStart.turn_id"),
        agent_id: readRequiredString(value.agent_id, "SubagentStart.agent_id"),
        agent_type: readRequiredString(value.agent_type, "SubagentStart.agent_type"),
        ...(value.agent_transcript_path === null || typeof value.agent_transcript_path === "string"
          ? { agent_transcript_path: value.agent_transcript_path }
          : {}),
      };
    case "SubagentStop":
      return {
        ...shared,
        hook_event_name: "SubagentStop",
        turn_id: readRequiredString(value.turn_id, "SubagentStop.turn_id"),
        agent_id: readRequiredString(value.agent_id, "SubagentStop.agent_id"),
        agent_type: readRequiredString(value.agent_type, "SubagentStop.agent_type"),
        ...(value.agent_transcript_path === null || typeof value.agent_transcript_path === "string"
          ? { agent_transcript_path: value.agent_transcript_path }
          : {}),
        ...(typeof value.stop_hook_active === "boolean"
          ? { stop_hook_active: value.stop_hook_active }
          : {}),
        ...(value.last_assistant_message === null || typeof value.last_assistant_message === "string"
          ? { last_assistant_message: value.last_assistant_message }
          : {}),
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
          ? { stop_hook_now: value.stop_hook_active }
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
  const mapped = (() => {
    switch (event.hook_event_name) {
      case "SessionStart":
        return [mapSessionStart(event, context)];
      case "PreToolUse":
        return [mapPreToolUse(event, context)];
      case "PermissionRequest":
        return [mapPermissionRequest(event, context)];
      case "PostToolUse":
        return [mapPostToolUse(event, context)];
      case "PreCompact":
      case "PostCompact":
        return [mapCompact(event, context)];
      case "SubagentStart":
        return [mapSubagentStart(event, context)];
      case "SubagentStop":
        return [mapSubagentStop(event, context)];
      case "UserPromptSubmit":
        return [mapUserPromptSubmit(event, context)];
      case "Stop":
        return [mapStop(event, context)];
    }
  })();

  return mapped.map((sourceEvent) => enrichCodexHookEvent(sourceEvent, event));
}

export function mapCodexHookResponse(
  response: AttentionResponse,
): CodexHookResponse | null {
  const parsed = parseCodexHookInteractionId(response.interactionId);
  if (!parsed) {
    return null;
  }

  switch (response.response.kind) {
    case "approved":
      return parsed.kind === "permissionRequest" ? permissionDecision("allow") : null;
    case "rejected":
      return denyResponse(parsed.kind, response.response.reason ?? "Rejected in Aperture.");
    case "dismissed":
      return denyResponse(parsed.kind, "Dismissed in Aperture.");
    case "acknowledged":
      return denyResponse(
        parsed.kind,
        "Aperture requires an explicit approval before Codex can continue.",
      );
    case "option_selected":
    case "text_submitted":
    case "form_submitted":
      return denyResponse(
        parsed.kind,
        "Codex expected an approval decision, but Aperture received a different response.",
      );
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

export function codexHookPermissionInteractionId(event: CodexPermissionRequestHookEvent): string {
  return [
    "codex",
    "hook",
    "permissionRequest",
    encodeURIComponent(event.session_id),
    encodeURIComponent(event.turn_id),
    encodeURIComponent(event.tool_name),
    stableToken(event.tool_input),
  ].join(":");
}

type ParsedCodexHookInteractionId = {
  kind: "preToolUse" | "permissionRequest";
  sessionId: string;
  turnId: string;
  toolUseId?: string;
  toolName?: string;
};

function parseCodexHookInteractionId(interactionId: string): ParsedCodexHookInteractionId | null {
  const parts = interactionId.split(":");
  if (parts[0] !== "codex" || parts[1] !== "hook") {
    return null;
  }

  if (parts.length === 6 && parts[2] === "preToolUse" && parts[3] && parts[4] && parts[5]) {
    return {
      kind: "preToolUse",
      sessionId: decodeURIComponent(parts[3]),
      turnId: decodeURIComponent(parts[4]),
      toolUseId: decodeURIComponent(parts[5]),
    };
  }

  if (
    parts.length === 7
    && parts[2] === "permissionRequest"
    && parts[3]
    && parts[4]
    && parts[5]
  ) {
    return {
      kind: "permissionRequest",
      sessionId: decodeURIComponent(parts[3]),
      turnId: decodeURIComponent(parts[4]),
      toolName: decodeURIComponent(parts[5]),
    };
  }

  return null;
}

function enrichCodexHookEvent(sourceEvent: SourceEvent, event: CodexHookEvent): SourceEvent {
  const metadata = codexHookEventMetadata(sourceEvent, event);
  if (!metadata) {
    return sourceEvent;
  }
  return {
    ...sourceEvent,
    metadata: {
      ...(sourceEvent.metadata ?? {}),
      ...metadata,
    },
  };
}

function codexHookEventMetadata(
  sourceEvent: SourceEvent,
  event: CodexHookEvent,
): SourceEvent["metadata"] | undefined {
  const metadata: Record<string, unknown> = {
    execution: {
      surface: "terminal",
      runner: "codex",
    },
  };

  if (typeof event.model === "string" && event.model.trim() !== "") {
    metadata.usage = { model: event.model };
  }

  if (sourceEvent.type === "human.input.requested" && sourceEvent.request.kind === "approval") {
    metadata.governance = { approvalState: "pending" };
  }

  return metadata;
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
  const summary = summarizeToolInput(event.tool_name, event.tool_input);
  return {
    id: `codex:hook:${encodeURIComponent(event.session_id)}:preToolUse:${encodeURIComponent(event.tool_use_id)}`,
    type: "human.input.requested",
    taskId: codexHookTurnTaskId(event.session_id, event.turn_id),
    interactionId: codexHookInteractionId(event),
    timestamp: new Date().toISOString(),
    source: codexHookSource(event, context),
    toolFamily: codexToolFamily(event.tool_name),
    activityClass: "permission_request",
    title: codexApprovalTitle(event.tool_name),
    summary,
    request: {
      kind: "approval",
    },
    semanticHints: explicitRequestSemanticHints(
      "approval",
      "permission_request",
      "Codex requested approval before running a command.",
    ),
    context: {
      items: [
        { id: "tool", label: "Tool", value: event.tool_name },
        { id: "input", label: "Input", value: summary },
        { id: "cwd", label: "Working Directory", value: event.cwd },
      ],
    },
  };
}

function mapPermissionRequest(
  event: CodexPermissionRequestHookEvent,
  context: CodexHookMappingContext,
): SourceHumanInputRequestedEvent {
  const summary = summarizeToolInput(event.tool_name, event.tool_input);
  return {
    id: `codex:hook:${encodeURIComponent(event.session_id)}:permissionRequest:${stableToken(event.tool_input)}`,
    type: "human.input.requested",
    taskId: codexHookTurnTaskId(event.session_id, event.turn_id),
    interactionId: codexHookPermissionInteractionId(event),
    timestamp: new Date().toISOString(),
    source: codexHookSource(event, context),
    toolFamily: codexToolFamily(event.tool_name),
    activityClass: "permission_request",
    title: codexApprovalTitle(event.tool_name),
    summary,
    request: {
      kind: "approval",
    },
    semanticHints: explicitRequestSemanticHints(
      "approval",
      "permission_request",
      "Codex requested permission before continuing.",
    ),
    context: {
      items: [
        { id: "tool", label: "Tool", value: event.tool_name },
        { id: "input", label: "Input", value: summary },
        { id: "cwd", label: "Working Directory", value: event.cwd },
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
  const inputSummary = summarizeToolInput(event.tool_name, event.tool_input);
  return {
    id: `codex:hook:${encodeURIComponent(event.session_id)}:postToolUse:${encodeURIComponent(event.tool_use_id)}`,
    type: "task.updated",
    taskId: codexHookTurnTaskId(event.session_id, event.turn_id),
    timestamp: new Date().toISOString(),
    source: codexHookSource(event, context),
    toolFamily: codexToolFamily(event.tool_name),
    activityClass: failed ? "tool_failure" : "tool_completion",
    semanticHints: taskUpdateSemanticHints(
      failed ? "tool_failure" : "tool_completion",
      responseSummary ?? inputSummary,
    ),
    title: failed ? `${codexToolLabel(event.tool_name)} failed` : `${codexToolLabel(event.tool_name)} completed`,
    summary: responseSummary ?? inputSummary,
    status: failed ? "failed" : "running",
  };
}

function mapCompact(event: CodexCompactHookEvent, context: CodexHookMappingContext): SourceEvent {
  const before = event.hook_event_name === "PreCompact";
  const summary = before
    ? `Codex is compacting context (${event.trigger}).`
    : `Codex compacted context (${event.trigger}).`;
  return {
    id: `codex:hook:${encodeURIComponent(event.session_id)}:${event.hook_event_name}:${encodeURIComponent(event.turn_id)}`,
    type: "task.updated",
    taskId: codexHookTurnTaskId(event.session_id, event.turn_id),
    timestamp: new Date().toISOString(),
    source: codexHookSource(event, context),
    activityClass: "session_status",
    semanticHints: taskUpdateSemanticHints("session_status", summary),
    title: before ? "Codex compacting context" : "Codex compacted context",
    summary,
    status: "running",
  };
}

function mapSubagentStart(
  event: CodexSubagentStartHookEvent,
  context: CodexHookMappingContext,
): SourceEvent {
  return {
    id: `codex:hook:${encodeURIComponent(event.session_id)}:subagentStart:${encodeURIComponent(event.agent_id)}`,
    type: "task.started",
    taskId: codexHookSubagentTaskId(event),
    timestamp: new Date().toISOString(),
    source: codexHookSource(event, context),
    title: "Codex subagent started",
    summary: event.agent_type,
    metadata: {
      codex: {
        subagent: subagentMetadata(event),
      },
    },
  };
}

function mapSubagentStop(
  event: CodexSubagentStopHookEvent,
  context: CodexHookMappingContext,
): SourceEvent {
  return {
    id: `codex:hook:${encodeURIComponent(event.session_id)}:subagentStop:${encodeURIComponent(event.agent_id)}`,
    type: "task.completed",
    taskId: codexHookSubagentTaskId(event),
    timestamp: new Date().toISOString(),
    source: codexHookSource(event, context),
    summary: summarizeAssistantMessage(event.last_assistant_message) ?? event.agent_type,
    metadata: {
      codex: {
        subagent: subagentMetadata(event),
      },
    },
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
    semanticHints: taskUpdateSemanticHints(
      "follow_up",
      "Codex is continuing with the operator's latest prompt.",
    ),
    title: "Codex prompt submitted",
    summary: summarizePrompt(event.prompt),
    status: "running",
  };
}

function explicitRequestSemanticHints(
  kind: "approval" | "choice" | "form",
  activityClass: SourceHumanInputRequestedEvent["activityClass"],
  whyNow: string,
): HumanInputSemanticHints {
  return {
    intentFrame: requestIntentFrame(kind),
    ...(activityClass !== undefined ? { activityClass } : {}),
    whyNow,
    confidence: "high",
  };
}

function taskUpdateSemanticHints(
  activityClass: NonNullable<SourceTaskUpdatedEvent["activityClass"]>,
  whyNow?: string,
): TaskUpdateSemanticHints {
  return {
    activityClass,
    ...(whyNow !== undefined ? { whyNow } : {}),
    confidence: "high",
  };
}

function requestIntentFrame(
  kind: "approval" | "choice" | "form",
): "approval_request" | "question_request" | "form_request" {
  switch (kind) {
    case "approval":
      return "approval_request";
    case "choice":
      return "question_request";
    case "form":
      return "form_request";
  }
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
    ...(typeof value.permission_mode === "string" ? { permission_mode: value.permission_mode } : {}),
  };
}

function parseToolInput(value: unknown, label: string): unknown {
  if (value === undefined) {
    throw new Error(`${label} is required`);
  }
  return value;
}

function denyResponse(
  kind: ParsedCodexHookInteractionId["kind"],
  reason: string,
): CodexHookResponse {
  if (kind === "permissionRequest") {
    return permissionDecision("deny", reason);
  }
  return preToolUseDenyResponse(reason);
}

function preToolUseDenyResponse(reason: string): CodexHookResponse {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

function permissionDecision(
  behavior: "allow" | "deny",
  message?: string,
): CodexHookResponse {
  return {
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: {
        behavior,
        ...(message ? { message } : {}),
      },
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
    || value === "PermissionRequest"
    || value === "PostToolUse"
    || value === "PreCompact"
    || value === "PostCompact"
    || value === "SubagentStart"
    || value === "SubagentStop"
    || value === "UserPromptSubmit"
    || value === "Stop";
}

function codexHookSubagentTaskId(
  event: Pick<CodexSubagentStartHookEvent, "session_id" | "turn_id" | "agent_id">,
): string {
  return `${codexHookTurnTaskId(event.session_id, event.turn_id)}:subagent:${encodeURIComponent(event.agent_id)}`;
}

function subagentMetadata(
  event: CodexSubagentStartHookEvent | CodexSubagentStopHookEvent,
): Record<string, string> {
  return {
    id: event.agent_id,
    type: event.agent_type,
    ...(event.agent_transcript_path ? { transcriptPath: event.agent_transcript_path } : {}),
  };
}

function codexApprovalTitle(toolName: string): string {
  return `Approve ${codexToolLabel(toolName)}`;
}

function codexToolLabel(toolName: string): string {
  if (toolName === "Bash") {
    return "Codex command";
  }
  if (toolName === "apply_patch") {
    return "Codex patch";
  }
  if (toolName.startsWith("mcp__")) {
    return "Codex MCP tool";
  }
  return `Codex ${toolName}`;
}

function codexToolFamily(toolName: string): string {
  if (toolName === "Bash" || toolName === "PowerShell") {
    return "bash";
  }
  if (toolName === "apply_patch" || toolName === "Edit" || toolName === "Write") {
    return "write";
  }
  if (toolName.startsWith("mcp__")) {
    return "mcp";
  }
  return toolName.toLowerCase();
}

function summarizeToolInput(toolName: string, input: unknown): string {
  if (isRecord(input)) {
    const description = readOptionalString(input.description);
    if (description) {
      return summarizePrompt(description);
    }
    const command = readOptionalString(input.command);
    if (command) {
      return summarizePrompt(command);
    }
  }

  if (typeof input === "string") {
    return summarizePrompt(input);
  }

  return summarizePrompt(`${toolName} ${stableStringify(input)}`);
}

function stableToken(value: unknown): string {
  let hash = 0;
  const input = stableStringify(value);
  for (let index = 0; index < input.length; index += 1) {
    hash = Math.imul(31, hash) + input.charCodeAt(index) | 0;
  }
  return Math.abs(hash).toString(36);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(",")}}`;
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
