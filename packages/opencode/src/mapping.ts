import type { SourceEvent } from "@tomismeta/aperture-core";

import type { OpencodeSseMessage } from "./types.js";
import {
  mapMessagePartUpdated,
  mapSessionStatus,
} from "./mapping-lifecycle.js";
import {
  mapCommandExecuted,
  mapMcpBrowserOpenFailed,
  mapMcpToolsChanged,
  mapWorkspaceFailed,
  mapWorkspaceReady,
  mapWorkspaceStatus,
  mapWorktreeFailed,
  mapWorktreeReady,
} from "./mapping-platform.js";
import {
  mapSessionCompacted,
  mapSessionDiff,
  mapSessionError,
  mapSessionIdle,
  mapTodoUpdated,
} from "./mapping-session-events.js";
import { mapPermissionAsked, mapQuestionAsked } from "./mapping-requests.js";
import type { OpencodeMappingContext } from "./mapping-shared.js";
export {
  mapOpencodeNativeResolution,
  mapOpencodeResponse,
  type OpencodeNativeResolution,
} from "./mapping-response.js";
export {
  createOpencodeInstanceKey,
  opencodeInteractionId,
  opencodeSource,
  opencodeTaskId,
  parseOpencodeInteractionId,
  type OpencodeMappingContext,
  type OpencodeResponseAction,
} from "./mapping-shared.js";

export function mapOpencodeEvent(
  event: OpencodeSseMessage,
  context: OpencodeMappingContext,
): SourceEvent[] {
  const mapped = (() => {
    switch (event.type) {
      case "permission.asked":
        return [
          mapPermissionAsked(
            event as Extract<OpencodeSseMessage, { type: "permission.asked" }>,
            context,
          ),
        ];
      case "question.asked":
        return [
          mapQuestionAsked(
            event as Extract<OpencodeSseMessage, { type: "question.asked" }>,
            context,
          ),
        ];
      case "session.status":
        return mapSessionStatus(
          event as Extract<OpencodeSseMessage, { type: "session.status" }>,
          context,
        );
      case "session.idle":
        return mapSessionIdle(
          event as Extract<OpencodeSseMessage, { type: "session.idle" }>,
          context,
        );
      case "session.compacted":
        return mapSessionCompacted(
          event as Extract<OpencodeSseMessage, { type: "session.compacted" }>,
          context,
        );
      case "session.error":
        return mapSessionError(
          event as Extract<OpencodeSseMessage, { type: "session.error" }>,
          context,
        );
      case "session.diff":
        return mapSessionDiff(
          event as Extract<OpencodeSseMessage, { type: "session.diff" }>,
          context,
        );
      case "todo.updated":
        return mapTodoUpdated(
          event as Extract<OpencodeSseMessage, { type: "todo.updated" }>,
          context,
        );
      case "message.part.updated":
        return mapMessagePartUpdated(
          event as Extract<OpencodeSseMessage, { type: "message.part.updated" }>,
          context,
        );
      case "mcp.tools.changed":
        return mapMcpToolsChanged(
          event as Extract<OpencodeSseMessage, { type: "mcp.tools.changed" }>,
          context,
        );
      case "mcp.browser.open.failed":
        return mapMcpBrowserOpenFailed(
          event as Extract<OpencodeSseMessage, { type: "mcp.browser.open.failed" }>,
          context,
        );
      case "command.executed":
        return mapCommandExecuted(
          event as Extract<OpencodeSseMessage, { type: "command.executed" }>,
          context,
        );
      case "workspace.status":
        return mapWorkspaceStatus(
          event as Extract<OpencodeSseMessage, { type: "workspace.status" }>,
          context,
        );
      case "workspace.ready":
        return mapWorkspaceReady(
          event as Extract<OpencodeSseMessage, { type: "workspace.ready" }>,
          context,
        );
      case "workspace.failed":
        return mapWorkspaceFailed(
          event as Extract<OpencodeSseMessage, { type: "workspace.failed" }>,
          context,
        );
      case "worktree.ready":
        return mapWorktreeReady(
          event as Extract<OpencodeSseMessage, { type: "worktree.ready" }>,
          context,
        );
      case "worktree.failed":
        return mapWorktreeFailed(
          event as Extract<OpencodeSseMessage, { type: "worktree.failed" }>,
          context,
        );
      case "permission.replied":
      case "question.replied":
      case "question.rejected":
      case "server.connected":
      case "server.heartbeat":
        return [];
      default:
        return [];
    }
  })();

  return mapped.map(enrichOpencodeEvent);
}

function enrichOpencodeEvent(sourceEvent: SourceEvent): SourceEvent {
  const metadata = opencodeEventMetadata(sourceEvent);
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

function opencodeEventMetadata(sourceEvent: SourceEvent): SourceEvent["metadata"] | undefined {
  const metadata: Record<string, unknown> = {
    execution: {
      runner: "opencode",
    },
  };

  if (sourceEvent.type === "human.input.requested" && sourceEvent.request.kind === "approval") {
    metadata.governance = { approvalState: "pending" };
  }

  return metadata;
}
