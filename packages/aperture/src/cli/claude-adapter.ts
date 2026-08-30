import { stderr, stdin, stdout } from "node:process";

import {
  type ClaudeCodeElicitationEvent,
  type ClaudeCodePermissionRequestEvent,
  type ClaudeCodePreToolUseEvent,
  createClaudeCodeHookServer,
} from "@aperture/claude-code";
import { ApertureRuntimeAdapterClient, type ApertureRuntimeSnapshot } from "@aperture/runtime";

import { readNumber } from "./shared.js";

export async function runClaudeForward(): Promise<void> {
  const chunks: Buffer[] = [];

  stdin.on("data", (chunk: Buffer | string) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });

  stdin.on("end", async () => {
    const body = Buffer.concat(chunks).toString("utf8");
    const target = process.env.APERTURE_CLAUDE_HOOK_URL ?? "http://127.0.0.1:4545/hook";

    try {
      const response = await fetch(target, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body,
      });

      const text = await response.text();
      if (!response.ok) {
        stderr.write(`Aperture hook forward failed: ${response.status} ${response.statusText}\n`);
        if (text) {
          stderr.write(`${text}\n`);
        }
        process.exit(0);
        return;
      }

      if (text) {
        stdout.write(text);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stderr.write(`Aperture hook forward failed: ${message}\n`);
      process.exit(0);
    }
  });
}

export async function runClaudeAdapter(runtimeBaseUrl: string): Promise<void> {
  const host = process.env.APERTURE_CLAUDE_HOST ?? "127.0.0.1";
  const port = readNumber(process.env.APERTURE_CLAUDE_PORT) ?? 4545;
  const requestPath = process.env.APERTURE_CLAUDE_PATH ?? "/hook";
  const adapterClient = await ApertureRuntimeAdapterClient.connect({
    baseUrl: runtimeBaseUrl,
    kind: "claude-code",
    label: "Claude Code hook server",
    metadata: {
      transport: "hook-server",
    },
  });

  const hookServer = createClaudeCodeHookServer(adapterClient, {
    host,
    port,
    path: requestPath,
    includePostToolUse: true,
    preToolUsePolicy: () => (adapterClient.getResponseSurfaceCount() > 0 ? "hold" : "ask"),
    permissionRequestPolicy: () =>
      adapterClient.getResponseSurfaceCount() > 0 ? "hold" : "native",
    elicitationPolicy: () => (adapterClient.getResponseSurfaceCount() > 0 ? "hold" : "native"),
    onPreToolUseFallback: (event, reason) => {
      if (reason === "timed_out" || reason === "not_held") {
        void adapterClient.publishSourceEvent(claudeApprovalFallbackEvent(event, reason));
      }
    },
    onPermissionRequestFallback: (event, reason) => {
      if (reason === "timed_out" || reason === "not_held") {
        void adapterClient.publishSourceEvent(claudePermissionFallbackEvent(event, reason));
      }
    },
    onElicitationFallback: (event, reason) => {
      if (reason === "timed_out" || reason === "not_held") {
        void adapterClient.publishSourceEvent(claudeElicitationFallbackEvent(event, reason));
      }
    },
  });
  const hookBinding = await hookServer.listen();

  stderr.write(`Aperture Claude adapter listening at ${hookBinding.url}\n`);
  stderr.write(`Connected Claude adapter to runtime ${runtimeBaseUrl}\n`);
  stderr.write("Run the TUI separately with: aperture internal tui\n");

  const close = async () => {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await hookServer.close();
    await adapterClient.close();
    process.exit(0);
  };

  const onSignal = () => {
    void close();
  };

  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
}

export function runtimeHasLiveClaudeActivity(snapshot: ApertureRuntimeSnapshot): boolean {
  const frames = [
    ...(snapshot.attentionView.now ? [snapshot.attentionView.now] : []),
    ...snapshot.attentionView.next,
    ...snapshot.attentionView.ambient,
  ];

  return frames.some((frame) => frame.source?.kind === "claude-code");
}

export function readyClaudeState(
  changedHooks: boolean,
  attachedExisting: boolean,
): {
  state: "ready" | "action";
  detail: string;
  hint?: string;
} {
  const endpoint = claudeBridgeUrl();
  if (changedHooks) {
    return {
      state: "action",
      detail: attachedExisting
        ? `Using an existing Claude bridge at ${endpoint}, but Claude Code still needs to reload the updated hooks.`
        : `Claude bridge is ready at ${endpoint}. Claude Code still needs to reload the updated hooks.`,
      hint: "Restart Claude Code and run /hooks once to finish setup.",
    };
  }

  return {
    state: "ready",
    detail: attachedExisting
      ? `Using an existing Claude bridge at ${endpoint}.`
      : `Listening for Claude Code hooks at ${endpoint}.`,
  };
}

export function isClaudeBridgePortInUse(message: string): boolean {
  return message.includes("EADDRINUSE");
}

export function claudeBridgeUrl(): string {
  const host = process.env.APERTURE_CLAUDE_HOST ?? "127.0.0.1";
  const port = readNumber(process.env.APERTURE_CLAUDE_PORT) ?? 4545;
  const hookPath = process.env.APERTURE_CLAUDE_PATH ?? "/hook";
  return `http://${host}:${port}${hookPath}`;
}

export async function startLauncherClaudeAdapter(runtimeBaseUrl: string) {
  const adapterClient = await ApertureRuntimeAdapterClient.connect({
    baseUrl: runtimeBaseUrl,
    kind: "claude-code",
    label: "Claude Code hook server",
    metadata: {
      transport: "hook-server",
    },
  });
  const hookServer = createClaudeCodeHookServer(adapterClient, {
    host: process.env.APERTURE_CLAUDE_HOST ?? "127.0.0.1",
    port: readNumber(process.env.APERTURE_CLAUDE_PORT) ?? 4545,
    path: process.env.APERTURE_CLAUDE_PATH ?? "/hook",
    includePostToolUse: true,
    preToolUsePolicy: () => (adapterClient.getResponseSurfaceCount() > 0 ? "hold" : "ask"),
    permissionRequestPolicy: () =>
      adapterClient.getResponseSurfaceCount() > 0 ? "hold" : "native",
    elicitationPolicy: () => (adapterClient.getResponseSurfaceCount() > 0 ? "hold" : "native"),
    onPreToolUseFallback: (event, reason) => {
      if (reason === "timed_out" || reason === "not_held") {
        void adapterClient.publishSourceEvent(claudeApprovalFallbackEvent(event, reason));
      }
    },
    onPermissionRequestFallback: (event, reason) => {
      if (reason === "timed_out" || reason === "not_held") {
        void adapterClient.publishSourceEvent(claudePermissionFallbackEvent(event, reason));
      }
    },
    onElicitationFallback: (event, reason) => {
      if (reason === "timed_out" || reason === "not_held") {
        void adapterClient.publishSourceEvent(claudeElicitationFallbackEvent(event, reason));
      }
    },
  });
  await hookServer.listen();

  return {
    async close() {
      await hookServer.close();
      await adapterClient.close();
    },
  };
}

export function claudeApprovalFallbackEvent(
  event: ClaudeCodePreToolUseEvent,
  reason: "timed_out" | "not_held",
) {
  return {
    id: `claude-code:${encodeURIComponent(event.session_id)}:PreToolUse:${encodeURIComponent(
      event.tool_use_id,
    )}:fallback:${reason}`,
    type: "task.updated" as const,
    taskId: `claude-code:session:${encodeURIComponent(event.session_id)}`,
    timestamp: new Date().toISOString(),
    source: claudeSource(event),
    title:
      reason === "timed_out"
        ? `${event.tool_name} approval timed out`
        : `${event.tool_name} approval returned to Claude`,
    summary:
      reason === "timed_out"
        ? "Aperture did not receive a response in time and returned this approval to Claude Code."
        : "Aperture did not retain this approval frame, so Claude Code handled it natively.",
    status: "running" as const,
  };
}

export function claudeElicitationFallbackEvent(
  event: ClaudeCodeElicitationEvent,
  reason: "timed_out" | "not_held",
) {
  return {
    id: `claude-code:${encodeURIComponent(event.session_id)}:Elicitation:${encodeURIComponent(
      event.elicitation_id ?? event.message,
    )}:fallback:${reason}`,
    type: "task.updated" as const,
    taskId: `claude-code:session:${encodeURIComponent(event.session_id)}`,
    timestamp: new Date().toISOString(),
    source: claudeSource(event),
    title:
      reason === "timed_out"
        ? "Claude input request timed out"
        : "Claude input request returned to Claude",
    summary:
      reason === "timed_out"
        ? "Aperture did not receive an input response in time and returned this request to Claude Code."
        : "Aperture did not retain this input request, so Claude Code handled it natively.",
    status: "running" as const,
  };
}

export function claudePermissionFallbackEvent(
  event: ClaudeCodePermissionRequestEvent,
  reason: "timed_out" | "not_held",
) {
  return {
    id: `claude-code:${encodeURIComponent(event.session_id)}:PermissionRequest:${encodeURIComponent(
      event.tool_name,
    )}:fallback:${reason}`,
    type: "task.updated" as const,
    taskId: `claude-code:session:${encodeURIComponent(event.session_id)}`,
    timestamp: new Date().toISOString(),
    source: claudeSource(event),
    title:
      reason === "timed_out"
        ? `${event.tool_name} permission timed out`
        : `${event.tool_name} permission returned to Claude`,
    summary:
      reason === "timed_out"
        ? "Aperture did not receive a permission response in time and returned this request to Claude Code."
        : "Aperture did not retain this permission request, so Claude Code handled it natively.",
    status: "running" as const,
  };
}

function claudeSource(
  event: Pick<
    ClaudeCodePreToolUseEvent | ClaudeCodePermissionRequestEvent | ClaudeCodeElicitationEvent,
    "session_id" | "cwd"
  >,
) {
  const workspace = event.cwd.split("/").filter(Boolean).at(-1) ?? "";
  const session = shortSessionLabel(event.session_id);
  return {
    id: `claude-code:${event.session_id}`,
    kind: "claude-code" as const,
    label: workspace ? `Claude Code ${workspace} #${session}` : `Claude Code #${session}`,
  };
}

function shortSessionLabel(sessionId: string): string {
  const compact = sessionId.replace(/[^a-zA-Z0-9]/g, "");
  return compact.slice(0, 6) || "session";
}
