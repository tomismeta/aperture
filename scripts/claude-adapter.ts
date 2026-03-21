import { stderr } from "node:process";

import type {
  ClaudeCodeElicitationEvent,
  ClaudeCodePreToolUseEvent,
} from "../packages/claude-code/src/index.ts";
import { createClaudeCodeHookServer } from "../packages/claude-code/src/server.ts";
import {
  ApertureRuntimeAdapterClient,
  discoverLocalRuntimes,
} from "../packages/runtime/src/index.ts";

async function main(): Promise<void> {
  const host = process.env.APERTURE_CLAUDE_HOST ?? "127.0.0.1";
  const port = readNumber(process.env.APERTURE_CLAUDE_PORT) ?? 4545;
  const path = process.env.APERTURE_CLAUDE_PATH ?? "/hook";
  const runtimeBaseUrl = await resolveRuntimeUrl();
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
    path,
    includePostToolUse: true,
    tools: undefined,
    preToolUsePolicy: () => (adapterClient.getSurfaceCount() > 0 ? "hold" : "ask"),
    elicitationPolicy: () => (adapterClient.getSurfaceCount() > 0 ? "hold" : "native"),
    onPreToolUseFallback: (event, reason) => {
      if (reason === "timed_out" || reason === "not_held") {
        void adapterClient.publishSourceEvent(claudeApprovalFallbackEvent(event, reason));
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
  stderr.write("Run the TUI separately with: pnpm tui\n");

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

async function resolveRuntimeUrl(): Promise<string> {
  const explicit = process.env.APERTURE_RUNTIME_URL ?? process.env.APERTURE_CLAUDE_RUNTIME_URL;
  if (explicit) {
    return explicit.replace(/\/+$/, "");
  }

  const runtimes = await discoverLocalRuntimes({ kind: "aperture" });
  if (runtimes.length === 0) {
    throw new Error("No live Aperture runtime found. Start one with `pnpm serve`.");
  }

  if (runtimes.length > 1) {
    stderr.write("Multiple live Aperture runtimes detected:\n");
    for (const runtime of runtimes) {
      stderr.write(`- ${runtime.controlUrl} (pid ${runtime.pid}, updated ${runtime.updatedAt})\n`);
    }
    stderr.write(`Connecting Claude adapter to the most recent runtime: ${runtimes[0]?.controlUrl}\n`);
  }

  return runtimes[0]?.controlUrl ?? "http://127.0.0.1:4546/runtime";
}

function readNumber(raw: string | undefined): number | null {
  if (!raw) {
    return null;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function claudeApprovalFallbackEvent(
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

function claudeElicitationFallbackEvent(
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

function claudeSource(event: Pick<ClaudeCodePreToolUseEvent | ClaudeCodeElicitationEvent, "session_id" | "cwd">) {
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

void main();
