import { randomUUID } from "node:crypto";
import type { TerminalTitleCapability } from "@tomismeta/aperture/focus-host";
import { contextFromOmpExtension } from "./mapping.js";
import type { OmpEvent, OmpExtensionApi, OmpExtensionContext, OmpMappingContext } from "./types.js";

const OMP_EXTENSION_EVENTS = [
  "session_start",
  "session_stop",
  "session_shutdown",
  "before_agent_start",
  "agent_start",
  "agent_end",
  "turn_start",
  "turn_end",
  "tool_call",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
  "tool_result",
  "tool_approval_requested",
  "tool_approval_resolved",
  "input",
  "credential_disabled",
] as const;

export type OmpEventCapabilities = {
  terminalTitle?: TerminalTitleCapability;
};

export type OmpEventSink = {
  handle(
    event: OmpEvent,
    context: OmpMappingContext,
    capabilities: OmpEventCapabilities,
  ): Promise<void>;
  close(): Promise<void>;
};

export function bindOmpExtension(
  pi: OmpExtensionApi,
  sink: OmpEventSink,
  baseContext: OmpMappingContext = {},
): void {
  let agentRunId: string | undefined;
  for (const eventName of OMP_EXTENSION_EVENTS) {
    pi.on(eventName, async (event, extensionContext) => {
      if (event.type === "agent_start") agentRunId = randomUUID();
      const context = contextFromOmpExtension(extensionContext, baseContext);
      if (event.type === "session_stop") context.agentRunId = agentRunId ??= randomUUID();
      const sessionLabel = sessionLabelFromOmp(pi);
      if (sessionLabel) {
        context.session = { ...context.session, label: sessionLabel };
      }
      const capabilities = capabilitiesFromOmpExtension(extensionContext);
      try {
        await sink.handle(event, context, capabilities);
        if (event.type === "session_shutdown") await sink.close();
      } catch (error) {
        reportAdapterError(pi, extensionContext.ui, error);
      }
    });
  }
}

function capabilitiesFromOmpExtension(extensionContext: OmpExtensionContext): OmpEventCapabilities {
  const setTitle = extensionContext.ui?.setTitle;
  if (!setTitle) return {};
  return {
    terminalTitle: {
      claim(title) {
        setTitle.call(extensionContext.ui, title);
        let released = false;
        return {
          release() {
            if (released) return;
            released = true;
            setTitle.call(extensionContext.ui, "π");
          },
        };
      },
    },
  };
}

function sessionLabelFromOmp(pi: OmpExtensionApi): string | undefined {
  try {
    return pi.getSessionName?.();
  } catch {
    return undefined;
  }
}

function reportAdapterError(
  pi: OmpExtensionApi,
  ui: { notify?: (message: string, type?: "info" | "warning" | "error") => void } | undefined,
  error: unknown,
): void {
  const message = error instanceof Error ? error.message : String(error);
  pi.logger?.warn?.("Aperture OMP adapter delivery failed", { error: message });
  ui?.notify?.(`Aperture OMP adapter is unavailable: ${message}`, "warning");
}
