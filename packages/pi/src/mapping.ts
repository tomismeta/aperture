import type { SourceEvent } from "@tomismeta/aperture-core";

import {
  mapAgentEnd,
  mapAgentStart,
  mapBeforeAgentStart,
  mapInput,
  mapModelSelect,
  mapSessionShutdown,
  mapSessionStart,
  mapThinkingLevelSelect,
  mapTurnEnd,
  mapTurnStart,
} from "./mapping-lifecycle.js";
import {
  mapToolCall,
  mapToolExecutionEnd,
  mapToolExecutionStart,
  mapToolExecutionUpdate,
  mapToolResult,
  mapUserBash,
} from "./mapping-tools.js";
import { piEventMetadata, type PiMappingContext } from "./mapping-shared.js";
import type { PiEvent } from "./types.js";

export {
  createPiInstanceKey,
  piInteractionId,
  piSource,
  piTaskId,
  parsePiInteractionId,
  type ParsedPiInteractionId,
  type PiMappingContext,
  type PiResponseAction,
} from "./mapping-shared.js";
export { mapPiResponse } from "./mapping-response.js";

export function mapPiEvent(event: PiEvent, context: PiMappingContext = {}): SourceEvent[] {
  const mapped = (() => {
    switch (event.type) {
      case "session_start":
        return [mapSessionStart(event, context)];
      case "session_shutdown":
        return mapSessionShutdown(event, context);
      case "before_agent_start":
        return [mapBeforeAgentStart(event, context)];
      case "agent_start":
        return [mapAgentStart(event, context)];
      case "agent_end":
        return mapAgentEnd(event, context);
      case "turn_start":
        return [mapTurnStart(event, context)];
      case "turn_end":
        return [mapTurnEnd(event, context)];
      case "tool_call":
        return [mapToolCall(event, context)];
      case "tool_execution_start":
        return [mapToolExecutionStart(event, context)];
      case "tool_execution_update":
        return mapToolExecutionUpdate(event, context);
      case "tool_execution_end":
        return [mapToolExecutionEnd(event, context)];
      case "tool_result":
        return [mapToolResult(event, context)];
      case "model_select":
        return mapModelSelect(event, context);
      case "thinking_level_select":
        return mapThinkingLevelSelect(event, context);
      case "input":
        return mapInput(event, context);
      case "user_bash":
        return mapUserBash(event, context);
      default:
        return [];
    }
  })();

  return mapped.map(enrichPiEvent);
}

function enrichPiEvent(sourceEvent: SourceEvent): SourceEvent {
  const metadata = piEventMetadata(
    sourceEvent.type === "human.input.requested" && sourceEvent.request.kind === "approval"
      ? {
          governance: {
            approvalState: "pending",
          },
        }
      : undefined,
  );

  return {
    ...sourceEvent,
    metadata: {
      ...metadata,
      ...(sourceEvent.metadata ?? {}),
    },
  };
}
