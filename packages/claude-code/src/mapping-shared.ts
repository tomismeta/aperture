import { createHash } from "node:crypto";
import { basename } from "node:path";

import type {
  AttentionConsequenceLevel as ConsequenceLevel,
  HumanInputRequest,
  SourceHumanInputRequestedEvent,
  SourceTaskUpdatedEvent,
} from "@tomismeta/aperture-core";

import type {
  ClaudeCodeElicitationEvent,
  ClaudeCodeHookBaseEvent,
  ClaudeCodeHookEvent,
  ClaudeCodeMappingOptions,
  ClaudeCodePermissionRequestEvent,
  ClaudeCodePreToolUseEvent,
} from "./mapping.js";

export type ContextItem = NonNullable<
  NonNullable<SourceHumanInputRequestedEvent["context"]>["items"]
>[number];
export type HumanInputSemanticHints = NonNullable<SourceHumanInputRequestedEvent["semanticHints"]>;
export type TaskUpdateSemanticHints = NonNullable<SourceTaskUpdatedEvent["semanticHints"]>;

const HIGH_CONSEQUENCE_PATTERNS = [
  /\brm\s+-rf\b/i,
  /\bgit\s+push\s+--force\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bDROP\s+TABLE\b/i,
  /\bdocker\s+rm\b/i,
  /\bkill\s+-9\b/i,
  /\bchmod\s+777\b/i,
];

export function nowIso(): string {
  return new Date().toISOString();
}

export function bashConsequence(command: string): ConsequenceLevel {
  return HIGH_CONSEQUENCE_PATTERNS.some((pattern) => pattern.test(command)) ? "high" : "medium";
}

export function classifyToolRisk(
  event: ClaudeCodePreToolUseEvent,
  options: Pick<ClaudeCodeMappingOptions, "classifyCommand"> = {},
): ConsequenceLevel {
  const command = readString(event.tool_input.command);
  const classifyCommand = options.classifyCommand ?? bashConsequence;
  if (command) {
    return classifyCommand(command, event);
  }

  return classifyToolNameRisk(event.tool_name, hasSensitivePathValues(event.tool_input, event.cwd));
}

export function classifyPermissionRequestRisk(
  event: ClaudeCodePermissionRequestEvent,
  options: Pick<ClaudeCodeMappingOptions, "classifyCommand"> = {},
): ConsequenceLevel {
  const command = readString(event.tool_input.command);
  const classifyCommand = options.classifyCommand ?? bashConsequence;
  if (command) {
    return classifyCommand(command, {
      session_id: event.session_id,
      cwd: event.cwd,
      hook_event_name: "PreToolUse",
      tool_name: event.tool_name,
      tool_use_id: permissionRequestToken(event.tool_name, event.tool_input),
      tool_input: event.tool_input,
      ...(event.permission_mode !== undefined ? { permission_mode: event.permission_mode } : {}),
      ...(event.transcript_path !== undefined ? { transcript_path: event.transcript_path } : {}),
    });
  }

  return classifyToolNameRisk(event.tool_name, hasSensitivePathValues(event.tool_input, event.cwd));
}

export function claudeTaskId(sessionId: string): string {
  return `claude-code:session:${encodeURIComponent(sessionId)}`;
}

export function claudeSubagentTaskId(sessionId: string, agentId: string): string {
  return `claude-code:session:${encodeURIComponent(sessionId)}:subagent:${encodeURIComponent(agentId)}`;
}

export function claudeAgentTaskId(sessionId: string, taskId: string): string {
  return `claude-code:session:${encodeURIComponent(sessionId)}:task:${encodeURIComponent(taskId)}`;
}

export function claudeInteractionId(sessionId: string, toolUseId: string): string {
  return `claude-code:tool:${encodeURIComponent(sessionId)}:${encodeURIComponent(toolUseId)}`;
}

export function claudePermissionInteractionId(
  sessionId: string,
  toolName: string,
  toolInput: Record<string, unknown>,
): string {
  return `claude-code:permission:${encodeURIComponent(sessionId)}:${encodeURIComponent(permissionRequestToken(toolName, toolInput))}`;
}

export function claudeElicitationInteractionId(
  sessionId: string,
  mcpServerName: string,
  elicitationId: string,
  fieldId?: string,
): string {
  return fieldId
    ? `claude-code:elicitation:${encodeURIComponent(sessionId)}:${encodeURIComponent(mcpServerName)}:${encodeURIComponent(elicitationId)}:${encodeURIComponent(fieldId)}`
    : `claude-code:elicitation:${encodeURIComponent(sessionId)}:${encodeURIComponent(mcpServerName)}:${encodeURIComponent(elicitationId)}`;
}

export function elicitationToken(event: ClaudeCodeElicitationEvent): string {
  return event.elicitation_id ?? event.message;
}

export function claudeEventId(event: ClaudeCodeHookEvent, suffix: string): string {
  return `claude-code:${encodeURIComponent(event.session_id)}:${event.hook_event_name}:${encodeURIComponent(claudeEventToken(event))}:${suffix}`;
}

export function claudeSource(event: Pick<ClaudeCodeHookBaseEvent, "session_id" | "cwd">) {
  const workspace = workspaceLabel(event.cwd);
  const session = shortSessionLabel(event.session_id);
  const label = workspace ? `Claude Code ${workspace} #${session}` : `Claude Code #${session}`;

  return {
    id: `claude-code:${event.session_id}`,
    kind: "claude-code" as const,
    label,
  };
}

export function claudeToolFamily(toolName: string): string | undefined {
  switch (toolName.toLowerCase()) {
    case "read":
    case "search":
    case "grep":
    case "glob":
    case "ls":
      return "read";
    case "write":
      return "write";
    case "edit":
    case "multiedit":
      return "edit";
    case "bash":
      return "bash";
    case "websearch":
    case "toolsearch":
    case "web_fetch":
    case "webfetch":
      return "web";
    default:
      return undefined;
  }
}

export function summarizeToolInput(toolName: string, input: Record<string, unknown>): string {
  const filePath = readString(input.file_path) ?? readString(input.path);
  const pattern = readString(input.pattern);
  const query = readSearchQuery(input);
  const url = readString(input.url);

  if (filePath && pattern) return `${pattern} in ${filePath}`;
  if (filePath) return filePath;
  if (pattern) return pattern;
  if (query) return query;
  if (toolName.toLowerCase() === "toolsearch") return "web search";
  if (url) return url;
  return toolName;
}

export function approvalTitle(
  toolName: string,
  input: Record<string, unknown>,
  summary: string,
): string {
  const action = toolActionLabel(toolName);
  const detail = toolTitleDetail(toolName, input, summary);
  return detail ? `Claude Code wants to ${action} ${detail}` : `Claude Code wants to ${action}`;
}

export function permissionRequestTitle(
  toolName: string,
  input: Record<string, unknown>,
  summary: string,
): string {
  const action = toolActionLabel(toolName);
  const detail = toolTitleDetail(toolName, input, summary);
  return detail
    ? `Claude Code wants permission to ${action} ${detail}`
    : `Claude Code wants permission to ${action}`;
}

export function permissionDeniedTitle(toolName: string, input?: Record<string, unknown>): string {
  const action = toolActionLabel(toolName);
  const detail = input ? toolTitleDetail(toolName, input, "") : null;
  return detail
    ? `Claude Code auto mode denied permission to ${action} ${detail}`
    : `Claude Code auto mode denied permission to ${action}`;
}

export function permissionDeniedSummary(toolName: string, input?: Record<string, unknown>): string {
  if (input) {
    const summary =
      readString(input.command) ??
      readString(input.file_path) ??
      readString(input.path) ??
      readSearchQuery(input) ??
      readString(input.url);
    if (summary) {
      return summary;
    }
  }

  return `${toolName} was denied by Claude Code auto mode.`;
}

export function createContextItem(id: string, label: string, value: string): ContextItem {
  return { id, label, value };
}

export function toolInputContextItems(input: Record<string, unknown>): ContextItem[] {
  return stringInputContextItems(input);
}

export function permissionInputContextItems(input: Record<string, unknown>): ContextItem[] {
  return stringInputContextItems(input);
}

export function explicitRequestSemanticHints(
  request: HumanInputRequest,
  activityClass: SourceHumanInputRequestedEvent["activityClass"],
  whyNow: string,
): HumanInputSemanticHints {
  return {
    intentFrame: requestIntentFrame(request.kind),
    ...(activityClass !== undefined ? { activityClass } : {}),
    whyNow,
    confidence: "high",
  };
}

export function followUpTaskSemanticHints(whyNow: string): TaskUpdateSemanticHints {
  return {
    intentFrame: "question_request",
    activityClass: "follow_up",
    whyNow,
    confidence: "high",
  };
}

export function taskActivitySemanticHints(
  activityClass: NonNullable<SourceTaskUpdatedEvent["activityClass"]>,
): TaskUpdateSemanticHints {
  return {
    activityClass,
    confidence: "high",
  };
}

export function questionRequestWhyNow(sourceLabel: string): string {
  return `${sourceLabel} asked for input before continuing.`;
}

export function followUpWhyNow(sourceLabel: string): string {
  return `${sourceLabel} asked a follow-up question and is waiting for a reply.`;
}

export function readSearchQuery(input: Record<string, unknown>): string | undefined {
  return (
    readString(input.query) ??
    readString(input.search_query) ??
    readString(input.q) ??
    readString(input.searchTerm)
  );
}

export function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function classifyToolNameRisk(toolName: string, hasSensitivePath: boolean): ConsequenceLevel {
  const normalizedToolName = toolName.toLowerCase();

  if (
    normalizedToolName === "read" ||
    normalizedToolName === "search" ||
    normalizedToolName === "grep" ||
    normalizedToolName === "glob" ||
    normalizedToolName === "ls" ||
    normalizedToolName === "websearch" ||
    normalizedToolName === "toolsearch" ||
    normalizedToolName === "web_fetch" ||
    normalizedToolName === "webfetch"
  ) {
    return "low";
  }

  if (
    normalizedToolName === "write" ||
    normalizedToolName === "edit" ||
    normalizedToolName === "multiedit"
  ) {
    return hasSensitivePath ? "high" : "medium";
  }

  return "medium";
}

function permissionRequestToken(toolName: string, toolInput: Record<string, unknown>): string {
  const hash = createHash("sha1");
  hash.update(toolName);
  hash.update(":");
  hash.update(stableJson(toolInput));
  return hash.digest("hex").slice(0, 12);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`);
    return `{${entries.join(",")}}`;
  }

  return JSON.stringify(value);
}

function claudeEventToken(event: ClaudeCodeHookEvent): string {
  if (
    "tool_use_id" in event &&
    typeof event.tool_use_id === "string" &&
    event.tool_use_id.length > 0
  ) {
    return event.tool_use_id;
  }

  if ("tool_name" in event && event.hook_event_name === "PermissionRequest") {
    return permissionRequestToken(event.tool_name, event.tool_input);
  }

  if ("tool_name" in event && event.hook_event_name === "PermissionDenied") {
    return permissionRequestToken(event.tool_name, event.tool_input ?? {});
  }

  if ("file_path" in event && typeof event.file_path === "string" && event.file_path.length > 0) {
    return event.file_path;
  }

  if ("new_cwd" in event && typeof event.new_cwd === "string" && event.new_cwd.length > 0) {
    return event.new_cwd;
  }

  if ("agent_id" in event && typeof event.agent_id === "string" && event.agent_id.length > 0) {
    return event.agent_id;
  }

  if ("task_id" in event && typeof event.task_id === "string" && event.task_id.length > 0) {
    return event.task_id;
  }

  if ("elicitation_id" in event) {
    return event.elicitation_id ?? ("message" in event ? event.message : "none");
  }

  if ("reason" in event && typeof event.reason === "string" && event.reason.length > 0) {
    return event.reason;
  }

  if ("source" in event && typeof event.source === "string" && event.source.length > 0) {
    return event.source;
  }

  if ("error" in event && typeof event.error === "string" && event.error.length > 0) {
    return event.error;
  }

  if (
    "teammate_name" in event &&
    typeof event.teammate_name === "string" &&
    event.teammate_name.length > 0
  ) {
    return [event.team_name, event.teammate_name].filter(Boolean).join(":");
  }

  if ("trigger" in event && typeof event.trigger === "string" && event.trigger.length > 0) {
    const hash = createHash("sha1");
    hash.update(event.trigger);
    if (
      "compact_summary" in event &&
      typeof event.compact_summary === "string" &&
      event.compact_summary.length > 0
    ) {
      hash.update(":");
      hash.update(event.compact_summary);
      return `${event.trigger}:${hash.digest("hex").slice(0, 12)}`;
    }
    if ("custom_instructions" in event && typeof event.custom_instructions === "string") {
      hash.update(":");
      hash.update(event.custom_instructions);
      return `${event.trigger}:${hash.digest("hex").slice(0, 12)}`;
    }
    return event.trigger;
  }

  return "none";
}

function workspaceLabel(cwd: string): string | null {
  const normalized = cwd.replace(/[\\/]+$/, "");
  if (normalized.length === 0) {
    return null;
  }

  const label = basename(normalized);
  return label.length > 0 ? label : normalized;
}

function shortSessionLabel(sessionId: string): string {
  const collapsed = sessionId.replace(/[^a-zA-Z0-9]/g, "");
  if (collapsed.length > 0 && collapsed.length <= 8) {
    return collapsed.toLowerCase();
  }

  if (collapsed.length > 8) {
    return collapsed.slice(0, 6).toLowerCase();
  }

  if (sessionId.length <= 12) {
    return sessionId;
  }

  return sessionId.slice(0, 12);
}

function toolActionLabel(toolName: string): string {
  switch (toolName.toLowerCase()) {
    case "read":
      return "read";
    case "search":
      return "search code for";
    case "write":
      return "write";
    case "edit":
    case "multiedit":
      return "edit";
    case "glob":
      return "search files with";
    case "grep":
      return "search file contents with";
    case "ls":
      return "list files in";
    case "websearch":
    case "toolsearch":
      return "search the web for";
    case "web_fetch":
    case "webfetch":
      return "fetch";
    case "bash":
      return "run";
    case "askuserquestion":
      return "ask";
    default:
      return `use ${toolName}`;
  }
}

function toolTitleDetail(
  toolName: string,
  input: Record<string, unknown>,
  summary: string,
): string | null {
  const normalizedToolName = toolName.toLowerCase();

  if (normalizedToolName === "bash") {
    return "a shell command";
  }

  if (
    normalizedToolName === "search" ||
    normalizedToolName === "grep" ||
    normalizedToolName === "glob"
  ) {
    const pattern = readString(input.pattern);
    if (pattern) {
      return pattern;
    }
  }

  if (normalizedToolName === "websearch" || normalizedToolName === "toolsearch") {
    const query = readSearchQuery(input);
    if (query) {
      return query;
    }
  }

  const filePath = readString(input.file_path) ?? readString(input.path);
  if (filePath) {
    return basename(filePath);
  }

  const pattern = readString(input.pattern);
  if (pattern) {
    return pattern;
  }

  const query = readSearchQuery(input);
  if (query) {
    return query;
  }

  if (summary && summary !== toolName) {
    return summary;
  }

  return null;
}

function stringInputContextItems(input: Record<string, unknown>): ContextItem[] {
  const items: ContextItem[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string" && value.length > 0 && value.length < 500) {
      items.push(createContextItem(key, contextLabel(key), value));
    }
  }
  return items;
}

function contextLabel(id: string): string {
  return id
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter((part) => part.length > 0)
    .map((part) => (part[0] ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

function requestIntentFrame(
  kind: HumanInputRequest["kind"],
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

function hasSensitivePathValues(value: unknown, cwd: string): boolean {
  return collectStringValues(value).some((item) => isSensitivePathValue(item, cwd));
}

function isSensitivePathValue(value: string, cwd: string): boolean {
  const normalized = value.replace(/\\/g, "/");
  const lower = normalized.toLowerCase();
  const cwdNormalized = cwd.replace(/\\/g, "/").replace(/[\\/]+$/, "");

  if (lower.includes(".env") || lower.includes(".ssh/") || lower.endsWith("/.ssh")) {
    return true;
  }

  if (
    lower.includes(".github/workflows") ||
    lower.endsWith("package.json") ||
    lower.endsWith("pnpm-lock.yaml") ||
    lower.endsWith("package-lock.json") ||
    lower.endsWith("yarn.lock") ||
    lower.endsWith("dockerfile") ||
    lower.endsWith(".git/config") ||
    lower.endsWith(".npmrc") ||
    lower.endsWith(".bashrc") ||
    lower.endsWith(".zshrc") ||
    lower.endsWith("tsconfig.json")
  ) {
    return true;
  }

  if (
    normalized.startsWith("/") &&
    cwdNormalized.length > 0 &&
    !normalized.startsWith(`${cwdNormalized}/`)
  ) {
    return true;
  }

  return false;
}

function collectStringValues(value: unknown): string[] {
  if (typeof value === "string") {
    return value.length > 0 ? [value] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectStringValues(item));
  }

  if (value && typeof value === "object") {
    return Object.values(value).flatMap((item) => collectStringValues(item));
  }

  return [];
}
