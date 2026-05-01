import type { ClaudeCodeHookEvent } from "./mapping.js";

export function parseLatestHookEvent(
  parsed: Record<string, unknown>,
): ClaudeCodeHookEvent | undefined {
  if (parsed.hook_event_name === "Setup") {
    if (typeof parsed["source"] !== "string") {
      throw new Error("Setup hook request is missing required fields");
    }

    return {
      session_id: parsed.session_id as string,
      cwd: parsed.cwd as string,
      hook_event_name: "Setup",
      ...(typeof parsed["transcript_path"] === "string"
        ? { transcript_path: parsed["transcript_path"] }
        : {}),
      source: parsed["source"],
    };
  }

  if (parsed.hook_event_name === "UserPromptExpansion") {
    if (typeof parsed["command_name"] !== "string") {
      throw new Error("UserPromptExpansion hook request is missing required fields");
    }

    return {
      session_id: parsed.session_id as string,
      cwd: parsed.cwd as string,
      hook_event_name: "UserPromptExpansion",
      ...(typeof parsed["permission_mode"] === "string"
        ? { permission_mode: parsed["permission_mode"] }
        : {}),
      ...(typeof parsed["transcript_path"] === "string"
        ? { transcript_path: parsed["transcript_path"] }
        : {}),
      command_name: parsed["command_name"],
      ...(typeof parsed["prompt"] === "string" ? { prompt: parsed["prompt"] } : {}),
      ...(typeof parsed["expanded_prompt"] === "string"
        ? { expanded_prompt: parsed["expanded_prompt"] }
        : {}),
    };
  }

  if (parsed.hook_event_name === "PostToolBatch") {
    const toolCalls = parsed["tool_calls"] ?? parsed["tool_uses"];
    if (!Array.isArray(toolCalls)) {
      throw new Error("PostToolBatch hook request is missing tool calls");
    }

    return {
      session_id: parsed.session_id as string,
      cwd: parsed.cwd as string,
      hook_event_name: "PostToolBatch",
      ...(typeof parsed["permission_mode"] === "string"
        ? { permission_mode: parsed["permission_mode"] }
        : {}),
      ...(typeof parsed["transcript_path"] === "string"
        ? { transcript_path: parsed["transcript_path"] }
        : {}),
      tool_calls: toolCalls.flatMap((toolCall) => {
        if (!isRecord(toolCall) || typeof toolCall.tool_name !== "string") {
          return [];
        }
        return [
          {
            tool_name: toolCall.tool_name,
            ...(typeof toolCall.tool_use_id === "string"
              ? { tool_use_id: toolCall.tool_use_id }
              : {}),
            ...(isRecord(toolCall.tool_input) ? { tool_input: toolCall.tool_input } : {}),
            ...("tool_response" in toolCall ? { tool_response: toolCall.tool_response } : {}),
          },
        ];
      }),
    };
  }

  if (parsed.hook_event_name === "FileChanged") {
    if (typeof parsed["file_path"] !== "string" || typeof parsed["event"] !== "string") {
      throw new Error("FileChanged hook request is missing required fields");
    }

    return {
      session_id: parsed.session_id as string,
      cwd: parsed.cwd as string,
      hook_event_name: "FileChanged",
      ...(typeof parsed["transcript_path"] === "string"
        ? { transcript_path: parsed["transcript_path"] }
        : {}),
      file_path: parsed["file_path"],
      event: parsed["event"],
    };
  }

  if (parsed.hook_event_name === "WorktreeCreate") {
    if (typeof parsed["name"] !== "string") {
      throw new Error("WorktreeCreate hook request is missing required fields");
    }

    return {
      session_id: parsed.session_id as string,
      cwd: parsed.cwd as string,
      hook_event_name: "WorktreeCreate",
      ...(typeof parsed["transcript_path"] === "string"
        ? { transcript_path: parsed["transcript_path"] }
        : {}),
      name: parsed["name"],
    };
  }

  if (parsed.hook_event_name === "WorktreeRemove") {
    if (typeof parsed["worktree_path"] !== "string") {
      throw new Error("WorktreeRemove hook request is missing required fields");
    }

    return {
      session_id: parsed.session_id as string,
      cwd: parsed.cwd as string,
      hook_event_name: "WorktreeRemove",
      ...(typeof parsed["transcript_path"] === "string"
        ? { transcript_path: parsed["transcript_path"] }
        : {}),
      worktree_path: parsed["worktree_path"],
      ...(typeof parsed["name"] === "string" ? { name: parsed["name"] } : {}),
    };
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
