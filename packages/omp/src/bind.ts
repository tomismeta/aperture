import { contextFromOmpExtension } from "./mapping.js";
import type { OmpEvent, OmpExtensionApi, OmpMappingContext } from "./types.js";

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

export type OmpEventSink = {
  handle(event: OmpEvent, context: OmpMappingContext): Promise<void>;
  close(): Promise<void>;
};

export function bindOmpExtension(
  pi: OmpExtensionApi,
  sink: OmpEventSink,
  baseContext: OmpMappingContext = {},
): void {
  for (const eventName of OMP_EXTENSION_EVENTS) {
    pi.on(eventName, async (event, extensionContext) => {
      const context = contextFromOmpExtension(extensionContext, baseContext);
      try {
        await sink.handle(event, context);
        if (event.type === "session_shutdown") await sink.close();
      } catch (error) {
        reportAdapterError(pi, extensionContext.ui, error);
      }
    });
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
