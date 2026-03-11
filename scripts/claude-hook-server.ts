import { stderr } from "node:process";

import type { ClaudeCodePreToolUseEvent } from "../packages/claude-code/src/index.ts";
import { createClaudeCodeHookServer } from "../packages/claude-code/src/server.ts";
import { ApertureRuntimeAdapterClient, createApertureRuntime } from "../packages/runtime/src/index.ts";

async function main(): Promise<void> {
  const host = process.env.APERTURE_CLAUDE_HOST ?? "127.0.0.1";
  const port = readNumber(process.env.APERTURE_CLAUDE_PORT) ?? 4545;
  const path = process.env.APERTURE_CLAUDE_PATH ?? "/hook";
  const controlHost = process.env.APERTURE_CLAUDE_CONTROL_HOST ?? "127.0.0.1";
  const controlPort = readNumber(process.env.APERTURE_CLAUDE_CONTROL_PORT) ?? 4546;
  const controlPathPrefix = process.env.APERTURE_CLAUDE_CONTROL_PATH ?? "/runtime";
  const includePostToolUse = process.env.APERTURE_INCLUDE_POST_TOOL_USE === "1";

  const runtime = createApertureRuntime({
    kind: "aperture",
    controlHost,
    controlPort,
    controlPathPrefix,
    metadata: {
      adapters: "claude-code",
    },
  });
  const runtimeBinding = await runtime.listen();
  const adapterClient = await ApertureRuntimeAdapterClient.connect({
    baseUrl: runtimeBinding.controlUrl,
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
    includePostToolUse,
    tools: undefined,
    preToolUsePolicy: () => (runtime.hasAttachedSurface() ? "hold" : "ask"),
    onPreToolUseFallback: (event, reason) => {
      if (reason === "timed_out" || reason === "not_held") {
        void adapterClient.publishConformed(claudeApprovalFallbackEvent(event, reason));
      }
    },
  });
  const hookBinding = await hookServer.listen();

  stderr.write(`Aperture Claude hook server listening at ${hookBinding.url}\n`);
  stderr.write(`Aperture runtime control listening at ${runtimeBinding.controlUrl}\n`);
  stderr.write("Run the TUI separately with: pnpm claude:tui\n");

  const close = async () => {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await hookServer.close();
    await adapterClient.close();
    await runtime.close();
    process.exit(0);
  };

  const onSignal = () => {
    void close();
  };

  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
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

function claudeSource(event: Pick<ClaudeCodePreToolUseEvent, "session_id" | "cwd">) {
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
