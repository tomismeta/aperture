import type { IncomingMessage } from "node:http";

import type { ClaudeCodeHookEvent } from "./mapping.js";
import { parseLatestHookEvent } from "./server-hook-event-latest.js";

export async function readHookEvent(
  req: IncomingMessage,
  bodyLimitBytes: number,
): Promise<ClaudeCodeHookEvent> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > bodyLimitBytes) {
      throw new Error(`Claude Code hook request exceeded ${bodyLimitBytes} bytes`);
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    throw new Error("Claude Code hook request body is empty");
  }

  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Claude Code hook request must be a JSON object");
  }

  if (
    typeof parsed.session_id !== "string" ||
    typeof parsed.cwd !== "string" ||
    typeof parsed.hook_event_name !== "string"
  ) {
    throw new Error("Claude Code hook request is missing required fields");
  }

  if (
    parsed.hook_event_name !== "SessionStart" &&
    parsed.hook_event_name !== "Setup" &&
    parsed.hook_event_name !== "InstructionsLoaded" &&
    parsed.hook_event_name !== "PreToolUse" &&
    parsed.hook_event_name !== "PermissionRequest" &&
    parsed.hook_event_name !== "PermissionDenied" &&
    parsed.hook_event_name !== "PostToolUse" &&
    parsed.hook_event_name !== "PostToolUseFailure" &&
    parsed.hook_event_name !== "PostToolBatch" &&
    parsed.hook_event_name !== "Elicitation" &&
    parsed.hook_event_name !== "ElicitationResult" &&
    parsed.hook_event_name !== "Notification" &&
    parsed.hook_event_name !== "SubagentStart" &&
    parsed.hook_event_name !== "SubagentStop" &&
    parsed.hook_event_name !== "TaskCreated" &&
    parsed.hook_event_name !== "TaskCompleted" &&
    parsed.hook_event_name !== "UserPromptSubmit" &&
    parsed.hook_event_name !== "UserPromptExpansion" &&
    parsed.hook_event_name !== "StopFailure" &&
    parsed.hook_event_name !== "TeammateIdle" &&
    parsed.hook_event_name !== "ConfigChange" &&
    parsed.hook_event_name !== "CwdChanged" &&
    parsed.hook_event_name !== "FileChanged" &&
    parsed.hook_event_name !== "WorktreeCreate" &&
    parsed.hook_event_name !== "WorktreeRemove" &&
    parsed.hook_event_name !== "PreCompact" &&
    parsed.hook_event_name !== "PostCompact" &&
    parsed.hook_event_name !== "SessionEnd" &&
    parsed.hook_event_name !== "Stop"
  ) {
    throw new Error(`Unsupported Claude Code hook event: ${parsed.hook_event_name}`);
  }

  if (
    (parsed.hook_event_name === "PreToolUse" ||
      parsed.hook_event_name === "PostToolUseFailure" ||
      parsed.hook_event_name === "PostToolUse") &&
    (typeof parsed.tool_name !== "string" || typeof parsed.tool_use_id !== "string")
  ) {
    throw new Error(`${parsed.hook_event_name} hook request is missing tool fields`);
  }

  if (parsed.hook_event_name === "PermissionRequest" && typeof parsed.tool_name !== "string") {
    throw new Error("PermissionRequest hook request is missing tool fields");
  }

  const toolName = parsed["tool_name"] as string;
  const toolUseId = parsed["tool_use_id"] as string;

  if (parsed.hook_event_name === "SessionStart") {
    if (
      (parsed["source"] !== "startup" &&
        parsed["source"] !== "resume" &&
        parsed["source"] !== "clear" &&
        parsed["source"] !== "compact") ||
      typeof parsed["model"] !== "string"
    ) {
      throw new Error("SessionStart hook request is missing required fields");
    }

    return {
      session_id: parsed.session_id,
      cwd: parsed.cwd,
      hook_event_name: "SessionStart",
      ...(typeof parsed["transcript_path"] === "string"
        ? { transcript_path: parsed["transcript_path"] }
        : {}),
      source: parsed["source"],
      model: parsed["model"],
      ...(typeof parsed["agent_type"] === "string" ? { agent_type: parsed["agent_type"] } : {}),
    };
  }

  if (parsed.hook_event_name === "InstructionsLoaded") {
    if (
      typeof parsed["file_path"] !== "string" ||
      (parsed["memory_type"] !== "User" &&
        parsed["memory_type"] !== "Project" &&
        parsed["memory_type"] !== "Local" &&
        parsed["memory_type"] !== "Managed") ||
      (parsed["load_reason"] !== "session_start" &&
        parsed["load_reason"] !== "nested_traversal" &&
        parsed["load_reason"] !== "path_glob_match" &&
        parsed["load_reason"] !== "include" &&
        parsed["load_reason"] !== "compact")
    ) {
      throw new Error("InstructionsLoaded hook request is missing required fields");
    }

    return {
      session_id: parsed.session_id,
      cwd: parsed.cwd,
      hook_event_name: "InstructionsLoaded",
      ...(typeof parsed["transcript_path"] === "string"
        ? { transcript_path: parsed["transcript_path"] }
        : {}),
      file_path: parsed["file_path"],
      memory_type: parsed["memory_type"],
      load_reason: parsed["load_reason"],
      ...(Array.isArray(parsed["globs"])
        ? {
            globs: parsed["globs"].filter(
              (value): value is string => typeof value === "string" && value.length > 0,
            ),
          }
        : {}),
      ...(typeof parsed["trigger_file_path"] === "string"
        ? { trigger_file_path: parsed["trigger_file_path"] }
        : {}),
      ...(typeof parsed["parent_file_path"] === "string"
        ? { parent_file_path: parsed["parent_file_path"] }
        : {}),
    };
  }

  const latestHookEvent = parseLatestHookEvent(parsed);
  if (latestHookEvent) {
    return latestHookEvent;
  }

  if (parsed.hook_event_name === "PreToolUse") {
    return {
      session_id: parsed.session_id,
      cwd: parsed.cwd,
      hook_event_name: "PreToolUse",
      ...(typeof parsed["permission_mode"] === "string"
        ? { permission_mode: parsed["permission_mode"] }
        : {}),
      ...(typeof parsed["transcript_path"] === "string"
        ? { transcript_path: parsed["transcript_path"] }
        : {}),
      tool_name: toolName,
      tool_use_id: toolUseId,
      tool_input:
        parsed["tool_input"] && typeof parsed["tool_input"] === "object"
          ? (parsed["tool_input"] as Record<string, unknown>)
          : {},
    };
  }

  if (parsed.hook_event_name === "PermissionRequest") {
    return {
      session_id: parsed.session_id,
      cwd: parsed.cwd,
      hook_event_name: "PermissionRequest",
      ...(typeof parsed["permission_mode"] === "string"
        ? { permission_mode: parsed["permission_mode"] }
        : {}),
      ...(typeof parsed["transcript_path"] === "string"
        ? { transcript_path: parsed["transcript_path"] }
        : {}),
      tool_name: toolName,
      tool_input:
        parsed["tool_input"] && typeof parsed["tool_input"] === "object"
          ? (parsed["tool_input"] as Record<string, unknown>)
          : {},
      ...(Array.isArray(parsed["permission_suggestions"])
        ? {
            permission_suggestions: parsed["permission_suggestions"].filter(
              (suggestion): suggestion is Record<string, unknown> =>
                Boolean(suggestion) && typeof suggestion === "object" && !Array.isArray(suggestion),
            ),
          }
        : {}),
    };
  }

  if (parsed.hook_event_name === "PermissionDenied") {
    if (typeof parsed["tool_name"] !== "string") {
      throw new Error("PermissionDenied hook request is missing tool fields");
    }

    return {
      session_id: parsed.session_id,
      cwd: parsed.cwd,
      hook_event_name: "PermissionDenied",
      ...(typeof parsed["permission_mode"] === "string"
        ? { permission_mode: parsed["permission_mode"] }
        : {}),
      ...(typeof parsed["transcript_path"] === "string"
        ? { transcript_path: parsed["transcript_path"] }
        : {}),
      tool_name: parsed["tool_name"],
      ...(parsed["tool_input"] && typeof parsed["tool_input"] === "object"
        ? { tool_input: parsed["tool_input"] as Record<string, unknown> }
        : {}),
    };
  }

  if (parsed.hook_event_name === "PostToolUseFailure") {
    if (typeof parsed.error !== "string") {
      throw new Error("PostToolUseFailure hook request is missing an error");
    }

    return {
      session_id: parsed.session_id,
      cwd: parsed.cwd,
      hook_event_name: "PostToolUseFailure",
      ...(typeof parsed["permission_mode"] === "string"
        ? { permission_mode: parsed["permission_mode"] }
        : {}),
      ...(typeof parsed["transcript_path"] === "string"
        ? { transcript_path: parsed["transcript_path"] }
        : {}),
      tool_name: toolName,
      tool_use_id: toolUseId,
      ...(parsed["tool_input"] && typeof parsed["tool_input"] === "object"
        ? { tool_input: parsed["tool_input"] as Record<string, unknown> }
        : {}),
      error: parsed["error"],
    };
  }

  if (parsed.hook_event_name === "Notification") {
    if (typeof parsed.message !== "string" || typeof parsed.notification_type !== "string") {
      throw new Error("Notification hook request is missing required fields");
    }

    return {
      session_id: parsed.session_id,
      cwd: parsed.cwd,
      hook_event_name: "Notification",
      ...(typeof parsed["permission_mode"] === "string"
        ? { permission_mode: parsed["permission_mode"] }
        : {}),
      ...(typeof parsed["transcript_path"] === "string"
        ? { transcript_path: parsed["transcript_path"] }
        : {}),
      message: parsed.message,
      ...(typeof parsed["title"] === "string" ? { title: parsed["title"] } : {}),
      notification_type: parsed.notification_type as
        | "permission_prompt"
        | "idle_prompt"
        | "auth_success"
        | "elicitation_dialog",
    };
  }

  if (parsed.hook_event_name === "SubagentStart") {
    if (typeof parsed["agent_id"] !== "string" || typeof parsed["agent_type"] !== "string") {
      throw new Error("SubagentStart hook request is missing required fields");
    }

    return {
      session_id: parsed.session_id,
      cwd: parsed.cwd,
      hook_event_name: "SubagentStart",
      ...(typeof parsed["transcript_path"] === "string"
        ? { transcript_path: parsed["transcript_path"] }
        : {}),
      agent_id: parsed["agent_id"],
      agent_type: parsed["agent_type"],
    };
  }

  if (parsed.hook_event_name === "SubagentStop") {
    if (typeof parsed["agent_id"] !== "string" || typeof parsed["agent_type"] !== "string") {
      throw new Error("SubagentStop hook request is missing required fields");
    }

    return {
      session_id: parsed.session_id,
      cwd: parsed.cwd,
      hook_event_name: "SubagentStop",
      ...(typeof parsed["permission_mode"] === "string"
        ? { permission_mode: parsed["permission_mode"] }
        : {}),
      ...(typeof parsed["transcript_path"] === "string"
        ? { transcript_path: parsed["transcript_path"] }
        : {}),
      ...(typeof parsed["stop_hook_active"] === "boolean"
        ? { stop_hook_now: parsed["stop_hook_active"] }
        : {}),
      agent_id: parsed["agent_id"],
      agent_type: parsed["agent_type"],
      ...(typeof parsed["agent_transcript_path"] === "string"
        ? { agent_transcript_path: parsed["agent_transcript_path"] }
        : {}),
      ...(typeof parsed["last_assistant_message"] === "string"
        ? { last_assistant_message: parsed["last_assistant_message"] }
        : {}),
    };
  }

  if (parsed.hook_event_name === "TaskCreated" || parsed.hook_event_name === "TaskCompleted") {
    if (typeof parsed["task_id"] !== "string" || typeof parsed["task_subject"] !== "string") {
      throw new Error(`${parsed.hook_event_name} hook request is missing required fields`);
    }

    return {
      session_id: parsed.session_id,
      cwd: parsed.cwd,
      hook_event_name: parsed.hook_event_name,
      ...(typeof parsed["permission_mode"] === "string"
        ? { permission_mode: parsed["permission_mode"] }
        : {}),
      ...(typeof parsed["transcript_path"] === "string"
        ? { transcript_path: parsed["transcript_path"] }
        : {}),
      task_id: parsed["task_id"],
      task_subject: parsed["task_subject"],
      ...(typeof parsed["task_description"] === "string"
        ? { task_description: parsed["task_description"] }
        : {}),
      ...(typeof parsed["teammate_name"] === "string"
        ? { teammate_name: parsed["teammate_name"] }
        : {}),
      ...(typeof parsed["team_name"] === "string" ? { team_name: parsed["team_name"] } : {}),
    };
  }

  if (parsed.hook_event_name === "Elicitation") {
    if (typeof parsed.message !== "string" || typeof parsed.mcp_server_name !== "string") {
      throw new Error("Elicitation hook request is missing required fields");
    }

    return {
      session_id: parsed.session_id,
      cwd: parsed.cwd,
      hook_event_name: "Elicitation",
      ...(typeof parsed["permission_mode"] === "string"
        ? { permission_mode: parsed["permission_mode"] }
        : {}),
      ...(typeof parsed["transcript_path"] === "string"
        ? { transcript_path: parsed["transcript_path"] }
        : {}),
      mcp_server_name: parsed.mcp_server_name,
      message: parsed.message,
      ...(parsed["mode"] === "form" || parsed["mode"] === "url" ? { mode: parsed["mode"] } : {}),
      ...(typeof parsed["url"] === "string" ? { url: parsed["url"] } : {}),
      ...(typeof parsed["elicitation_id"] === "string"
        ? { elicitation_id: parsed["elicitation_id"] }
        : {}),
      ...(parsed["requested_schema"] && typeof parsed["requested_schema"] === "object"
        ? { requested_schema: parsed["requested_schema"] as Record<string, unknown> }
        : {}),
    };
  }

  if (parsed.hook_event_name === "ElicitationResult") {
    if (typeof parsed.mcp_server_name !== "string" || typeof parsed.action !== "string") {
      throw new Error("ElicitationResult hook request is missing required fields");
    }

    return {
      session_id: parsed.session_id,
      cwd: parsed.cwd,
      hook_event_name: "ElicitationResult",
      ...(typeof parsed["permission_mode"] === "string"
        ? { permission_mode: parsed["permission_mode"] }
        : {}),
      ...(typeof parsed["transcript_path"] === "string"
        ? { transcript_path: parsed["transcript_path"] }
        : {}),
      mcp_server_name: parsed.mcp_server_name,
      action: parsed.action as "accept" | "decline" | "cancel",
      ...(parsed["mode"] === "form" || parsed["mode"] === "url" ? { mode: parsed["mode"] } : {}),
      ...(typeof parsed["elicitation_id"] === "string"
        ? { elicitation_id: parsed["elicitation_id"] }
        : {}),
      ...(parsed["content"] && typeof parsed["content"] === "object"
        ? { content: parsed["content"] as Record<string, unknown> }
        : {}),
    };
  }

  if (parsed.hook_event_name === "UserPromptSubmit") {
    if (typeof parsed.prompt !== "string") {
      throw new Error("UserPromptSubmit hook request is missing a prompt");
    }

    return {
      session_id: parsed.session_id,
      cwd: parsed.cwd,
      hook_event_name: "UserPromptSubmit",
      ...(typeof parsed["permission_mode"] === "string"
        ? { permission_mode: parsed["permission_mode"] }
        : {}),
      ...(typeof parsed["transcript_path"] === "string"
        ? { transcript_path: parsed["transcript_path"] }
        : {}),
      prompt: parsed.prompt,
    };
  }

  if (parsed.hook_event_name === "StopFailure") {
    if (typeof parsed["error"] !== "string") {
      throw new Error("StopFailure hook request is missing required fields");
    }

    return {
      session_id: parsed.session_id,
      cwd: parsed.cwd,
      hook_event_name: "StopFailure",
      ...(typeof parsed["transcript_path"] === "string"
        ? { transcript_path: parsed["transcript_path"] }
        : {}),
      error: parsed["error"] as
        | "rate_limit"
        | "authentication_failed"
        | "billing_error"
        | "invalid_request"
        | "server_error"
        | "max_output_tokens"
        | "unknown",
      ...(typeof parsed["error_details"] === "string"
        ? { error_details: parsed["error_details"] }
        : {}),
      ...(typeof parsed["last_assistant_message"] === "string"
        ? { last_assistant_message: parsed["last_assistant_message"] }
        : {}),
    };
  }

  if (parsed.hook_event_name === "TeammateIdle") {
    if (typeof parsed["teammate_name"] !== "string" || typeof parsed["team_name"] !== "string") {
      throw new Error("TeammateIdle hook request is missing required fields");
    }

    return {
      session_id: parsed.session_id,
      cwd: parsed.cwd,
      hook_event_name: "TeammateIdle",
      ...(typeof parsed["permission_mode"] === "string"
        ? { permission_mode: parsed["permission_mode"] }
        : {}),
      ...(typeof parsed["transcript_path"] === "string"
        ? { transcript_path: parsed["transcript_path"] }
        : {}),
      teammate_name: parsed["teammate_name"],
      team_name: parsed["team_name"],
    };
  }

  if (parsed.hook_event_name === "ConfigChange") {
    if (
      parsed["source"] !== "user_settings" &&
      parsed["source"] !== "project_settings" &&
      parsed["source"] !== "local_settings" &&
      parsed["source"] !== "policy_settings" &&
      parsed["source"] !== "skills"
    ) {
      throw new Error("ConfigChange hook request is missing required fields");
    }

    return {
      session_id: parsed.session_id,
      cwd: parsed.cwd,
      hook_event_name: "ConfigChange",
      ...(typeof parsed["transcript_path"] === "string"
        ? { transcript_path: parsed["transcript_path"] }
        : {}),
      source: parsed["source"],
      ...(typeof parsed["file_path"] === "string" ? { file_path: parsed["file_path"] } : {}),
    };
  }

  if (parsed.hook_event_name === "CwdChanged") {
    if (typeof parsed["old_cwd"] !== "string" || typeof parsed["new_cwd"] !== "string") {
      throw new Error("CwdChanged hook request is missing required fields");
    }

    return {
      session_id: parsed.session_id,
      cwd: parsed.cwd,
      hook_event_name: "CwdChanged",
      ...(typeof parsed["transcript_path"] === "string"
        ? { transcript_path: parsed["transcript_path"] }
        : {}),
      old_cwd: parsed["old_cwd"],
      new_cwd: parsed["new_cwd"],
    };
  }

  if (parsed.hook_event_name === "PreCompact") {
    if (
      (parsed["trigger"] !== "manual" && parsed["trigger"] !== "auto") ||
      typeof parsed["custom_instructions"] !== "string"
    ) {
      throw new Error("PreCompact hook request is missing required fields");
    }

    return {
      session_id: parsed.session_id,
      cwd: parsed.cwd,
      hook_event_name: "PreCompact",
      ...(typeof parsed["transcript_path"] === "string"
        ? { transcript_path: parsed["transcript_path"] }
        : {}),
      trigger: parsed["trigger"],
      custom_instructions: parsed["custom_instructions"],
    };
  }

  if (parsed.hook_event_name === "PostCompact") {
    if (
      (parsed["trigger"] !== "manual" && parsed["trigger"] !== "auto") ||
      typeof parsed["compact_summary"] !== "string"
    ) {
      throw new Error("PostCompact hook request is missing required fields");
    }

    return {
      session_id: parsed.session_id,
      cwd: parsed.cwd,
      hook_event_name: "PostCompact",
      ...(typeof parsed["transcript_path"] === "string"
        ? { transcript_path: parsed["transcript_path"] }
        : {}),
      trigger: parsed["trigger"],
      compact_summary: parsed["compact_summary"],
    };
  }

  if (parsed.hook_event_name === "SessionEnd") {
    if (
      parsed["reason"] !== "clear" &&
      parsed["reason"] !== "resume" &&
      parsed["reason"] !== "logout" &&
      parsed["reason"] !== "prompt_input_exit" &&
      parsed["reason"] !== "bypass_permissions_disabled" &&
      parsed["reason"] !== "other"
    ) {
      throw new Error("SessionEnd hook request is missing required fields");
    }

    return {
      session_id: parsed.session_id,
      cwd: parsed.cwd,
      hook_event_name: "SessionEnd",
      ...(typeof parsed["transcript_path"] === "string"
        ? { transcript_path: parsed["transcript_path"] }
        : {}),
      reason: parsed["reason"],
    };
  }

  if (parsed.hook_event_name === "Stop") {
    return {
      session_id: parsed.session_id,
      cwd: parsed.cwd,
      hook_event_name: "Stop",
      ...(typeof parsed["permission_mode"] === "string"
        ? { permission_mode: parsed["permission_mode"] }
        : {}),
      ...(typeof parsed["transcript_path"] === "string"
        ? { transcript_path: parsed["transcript_path"] }
        : {}),
      ...(typeof parsed["stop_hook_active"] === "boolean"
        ? { stop_hook_now: parsed["stop_hook_active"] }
        : {}),
      ...(typeof parsed["stop_reason"] === "string" ? { stop_reason: parsed["stop_reason"] } : {}),
      ...(typeof parsed["message"] === "string" ? { message: parsed["message"] } : {}),
      ...(typeof parsed["last_assistant_message"] === "string"
        ? { last_assistant_message: parsed["last_assistant_message"] }
        : {}),
    };
  }

  return {
    session_id: parsed.session_id,
    cwd: parsed.cwd,
    hook_event_name: "PostToolUse",
    ...(typeof parsed["permission_mode"] === "string"
      ? { permission_mode: parsed["permission_mode"] }
      : {}),
    ...(typeof parsed["transcript_path"] === "string"
      ? { transcript_path: parsed["transcript_path"] }
      : {}),
    tool_name: toolName,
    tool_use_id: toolUseId,
    ...(parsed["tool_input"] && typeof parsed["tool_input"] === "object"
      ? { tool_input: parsed["tool_input"] as Record<string, unknown> }
      : {}),
    ...(parsed["tool_response"] && typeof parsed["tool_response"] === "object"
      ? { tool_response: parsed["tool_response"] as Record<string, unknown> }
      : {}),
  };
}
