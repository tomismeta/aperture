import type { IncomingMessage, ServerResponse } from "node:http";

import type { AttentionView } from "@tomismeta/aperture-core";

import type { ClaudeCodeHookEvent, ClaudeCodeHookResponse } from "./mapping.js";
import {
  type ClaudeCodeTranscriptReadOptions,
  parseAskUserQuestionPayload,
  readAskUserQuestionTranscriptPayload,
  readLatestAssistantTranscriptText,
} from "./transcript.js";

export async function enrichHookEvent(
  event: ClaudeCodeHookEvent,
  transcriptReadOptions: ClaudeCodeTranscriptReadOptions = {},
): Promise<ClaudeCodeHookEvent> {
  if (event.hook_event_name === "Stop" || event.hook_event_name === "SubagentStop") {
    const transcriptPath =
      event.hook_event_name === "SubagentStop"
        ? event.agent_transcript_path
        : event.transcript_path;

    if (event.last_assistant_message || ("message" in event && event.message) || !transcriptPath) {
      return event;
    }

    const transcriptMessage = await readLatestAssistantTranscriptText(
      transcriptPath,
      transcriptReadOptions,
    );
    if (!transcriptMessage) {
      return event;
    }

    return {
      ...event,
      last_assistant_message: transcriptMessage,
    };
  }

  if (
    event.hook_event_name !== "PreToolUse" &&
    event.hook_event_name !== "PermissionRequest" &&
    event.hook_event_name !== "PostToolUse"
  ) {
    return event;
  }

  if (event.tool_name !== "AskUserQuestion") {
    return event;
  }

  const directPayload = parseAskUserQuestionPayload(event.tool_input);
  if (directPayload) {
    return {
      ...event,
      askUserQuestion: directPayload,
    };
  }

  if (!event.transcript_path || !("tool_use_id" in event)) {
    return event;
  }

  const transcriptPayload = await readAskUserQuestionTranscriptPayload(
    event.transcript_path,
    event.tool_use_id,
    transcriptReadOptions,
  );
  if (!transcriptPayload) {
    return event;
  }

  return {
    ...event,
    askUserQuestion: transcriptPayload,
  };
}

export function writeJson(
  res: ServerResponse<IncomingMessage>,
  statusCode: number,
  body: ClaudeCodeHookResponse | Record<string, unknown>,
): void {
  if (res.writableEnded) {
    return;
  }

  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    Connection: "close",
  });
  res.end(JSON.stringify(body));
}

export function hasInteraction(
  attentionView: AttentionView,
  taskId: string,
  interactionId: string,
): boolean {
  return (
    (attentionView.now?.taskId === taskId && attentionView.now.interactionId === interactionId) ||
    attentionView.next.some(
      (frame) => frame.taskId === taskId && frame.interactionId === interactionId,
    ) ||
    attentionView.ambient.some(
      (frame) => frame.taskId === taskId && frame.interactionId === interactionId,
    )
  );
}
