import { ApertureRuntimeAdapterClient, discoverLocalRuntimes } from "@aperture/runtime";
import type { AttentionResponse, SourceEvent } from "@tomismeta/aperture-core";

import {
  contextFromPiExtension,
  createPiInstanceKey,
  type PiMappingContext,
} from "./mapping-shared.js";
import { mapPiEvent } from "./mapping.js";
import { mapPiResponse } from "./mapping-response.js";
import type {
  PiEvent,
  PiExtensionApi,
  PiExtensionContext,
  PiExtensionHandlerResult,
  PiToolCallEvent,
} from "./types.js";

export type PiToolCallPolicy = "observe" | "hold-if-surface" | "hold";

export type AperturePiExtensionOptions = {
  runtimeBaseUrl?: string;
  runtimeLabel?: string;
  runtimeMetadata?: Record<string, string>;
  sourceLabel?: string;
  toolCallPolicy?: PiToolCallPolicy;
  responseTimeoutMs?: number;
  runtimeClientFactory?: (context: PiMappingContext) => Promise<PiRuntimeClient>;
};

export type PiRuntimeClient = Pick<
  ApertureRuntimeAdapterClient,
  "publishSourceEventBatch" | "getResponseSurfaceCount" | "onResponse" | "onError" | "close"
>;

const PI_EXTENSION_EVENTS = [
  "session_start",
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
  "model_select",
  "thinking_level_select",
  "input",
  "user_bash",
] as const;

const DEFAULT_RESPONSE_TIMEOUT_MS = 60_000;

export function createAperturePiExtension(options: AperturePiExtensionOptions = {}) {
  return function aperturePiExtension(pi: PiExtensionApi): void {
    bindAperturePiExtension(pi, options);
  };
}

export function bindAperturePiExtension(
  pi: PiExtensionApi,
  options: AperturePiExtensionOptions = {},
): void {
  let runtimeClientPromise: Promise<PiRuntimeClient> | null = null;
  let runtimeClient: PiRuntimeClient | null = null;
  const baseContext: PiMappingContext = {
    ...(options.sourceLabel ? { sourceLabel: options.sourceLabel } : {}),
  };

  for (const eventName of PI_EXTENSION_EVENTS) {
    pi.on(eventName, async (event, extensionContext) => {
      const mappingContext = contextFromPiExtension(extensionContext, baseContext);
      if (event.type === "tool_call") {
        return handleToolCall(event, extensionContext, mappingContext);
      }
      await publishMappedEvent(event, extensionContext, mappingContext);
      if (event.type === "session_shutdown") {
        await closeRuntimeClient();
      }
      return undefined;
    });
  }

  async function handleToolCall(
    event: PiToolCallEvent,
    extensionContext: PiExtensionContext,
    mappingContext: PiMappingContext,
  ): Promise<PiExtensionHandlerResult> {
    const policy = options.toolCallPolicy ?? "observe";
    if (policy === "observe") {
      return undefined;
    }

    const client = await ensureRuntimeClient(mappingContext, extensionContext).catch(() => null);
    if (!client) {
      return undefined;
    }

    if (policy === "hold-if-surface" && client.getResponseSurfaceCount() === 0) {
      return undefined;
    }

    const approval = mapPiEvent(event, mappingContext).find(
      (sourceEvent) => sourceEvent.type === "human.input.requested",
    );
    if (!approval || approval.type !== "human.input.requested") {
      return undefined;
    }
    await client.publishSourceEventBatch([approval]);

    const response = await waitForResponse(
      client,
      approval.interactionId,
      options.responseTimeoutMs ?? DEFAULT_RESPONSE_TIMEOUT_MS,
    );
    if (!response) {
      return {
        block: true,
        reason: "Aperture did not receive an operator response before the Pi tool timeout.",
      };
    }

    const action = mapPiResponse(response);
    if (action?.kind === "tool.block") {
      return {
        block: true,
        reason: action.reason,
      };
    }
    return undefined;
  }

  async function publishMappedEvent(
    event: PiEvent,
    extensionContext: PiExtensionContext,
    mappingContext: PiMappingContext,
  ): Promise<SourceEvent[]> {
    const mapped = mapPiEvent(event, mappingContext);
    if (mapped.length === 0) {
      return mapped;
    }

    const client = await ensureRuntimeClient(mappingContext, extensionContext).catch((error) => {
      notify(
        extensionContext,
        `Aperture Pi adapter is not connected: ${formatError(error)}`,
        "warning",
      );
      return null;
    });
    if (!client) {
      return mapped;
    }

    await client.publishSourceEventBatch(mapped).catch((error) => {
      notify(
        extensionContext,
        `Aperture Pi adapter failed to publish: ${formatError(error)}`,
        "warning",
      );
    });
    return mapped;
  }

  async function ensureRuntimeClient(
    mappingContext: PiMappingContext,
    extensionContext: PiExtensionContext,
  ): Promise<PiRuntimeClient> {
    if (runtimeClient) {
      return runtimeClient;
    }
    runtimeClientPromise ??= connectRuntimeClient(mappingContext);
    runtimeClient = await runtimeClientPromise;
    runtimeClient.onError((error) => {
      notify(extensionContext, `Aperture runtime error: ${error.message}`, "warning");
    });
    return runtimeClient;
  }

  async function connectRuntimeClient(mappingContext: PiMappingContext): Promise<PiRuntimeClient> {
    if (options.runtimeClientFactory) {
      return options.runtimeClientFactory(mappingContext);
    }

    const runtimeBaseUrl = await resolveRuntimeUrl(options.runtimeBaseUrl);
    const instanceKey = createPiInstanceKey(mappingContext);
    return ApertureRuntimeAdapterClient.connect({
      baseUrl: runtimeBaseUrl,
      kind: "pi",
      id: `pi-${instanceKey}`,
      label: options.runtimeLabel ?? "Pi adapter",
      metadata: {
        transport: "pi-extension",
        ...(mappingContext.cwd ? { cwd: mappingContext.cwd } : {}),
        ...(mappingContext.sessionFile ? { sessionFile: mappingContext.sessionFile } : {}),
        ...(options.runtimeMetadata ?? {}),
      },
    });
  }

  async function closeRuntimeClient(): Promise<void> {
    if (!runtimeClient) {
      return;
    }
    const client = runtimeClient;
    runtimeClient = null;
    runtimeClientPromise = null;
    await client.close().catch(() => {});
  }
}

export default createAperturePiExtension();

async function resolveRuntimeUrl(explicit: string | undefined): Promise<string> {
  const requested =
    explicit ?? process.env.APERTURE_PI_RUNTIME_URL ?? process.env.APERTURE_RUNTIME_URL;
  if (requested) {
    return requested.replace(/\/+$/, "");
  }

  const runtimes = await discoverLocalRuntimes({ kind: "aperture" });
  const runtime = runtimes[0];
  if (!runtime) {
    throw new Error("No live Aperture runtime found. Start one with `pnpm serve`.");
  }
  return runtime.controlUrl;
}

function waitForResponse(
  client: PiRuntimeClient,
  interactionId: string,
  timeoutMs: number,
): Promise<AttentionResponse | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(null);
    }, timeoutMs);
    const unsubscribe = client.onResponse((response) => {
      if (response.interactionId !== interactionId) {
        return;
      }
      clearTimeout(timer);
      unsubscribe();
      resolve(response);
    });
  });
}

function notify(
  context: PiExtensionContext,
  message: string,
  type: "info" | "warning" | "error",
): void {
  context.ui?.notify?.(message, type);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
