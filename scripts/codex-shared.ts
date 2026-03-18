import { stderr } from "node:process";

import type { CodexAppServerClientOptions } from "../packages/codex/src/index.ts";
import { discoverLocalRuntimes } from "../packages/runtime/src/index.ts";

export type ResolvedCodexAppServerOptions = {
  clientOptions: CodexAppServerClientOptions;
  runtimeMetadata: Record<string, string>;
  transportLabel: "stdio" | "websocket";
};

export type CodexTransportCliOptions = {
  transport?: string;
  url?: string;
  command?: string;
};

export async function resolveCodexRuntimeUrl(
  envVar: "APERTURE_CODEX_RUNTIME_URL" | "APERTURE_RUNTIME_URL" = "APERTURE_CODEX_RUNTIME_URL",
): Promise<string> {
  const explicit = process.env[envVar] ?? process.env.APERTURE_RUNTIME_URL;
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
    stderr.write(`Connecting Codex adapter to the most recent runtime: ${runtimes[0]?.controlUrl}\n`);
  }

  return runtimes[0]?.controlUrl ?? "http://127.0.0.1:4546/runtime";
}

export function createStderrLogger(): Pick<Console, "info" | "warn" | "error"> {
  return {
    info(message: string) {
      stderr.write(`${message}\n`);
    },
    warn(message: string) {
      stderr.write(`${message}\n`);
    },
    error(message: string) {
      stderr.write(`${message}\n`);
    },
  };
}

export function resolveCodexAppServerOptions(options: {
  cwd?: string;
  transport?: string;
  url?: string;
  command?: string;
} = {}): ResolvedCodexAppServerOptions {
  const requestedTransport = (
    options.transport
    ?? process.env.APERTURE_CODEX_TRANSPORT
    ?? "stdio"
  ).toLowerCase();
  if (requestedTransport === "ws" || requestedTransport === "websocket") {
    const url = options.url
      ?? process.env.APERTURE_CODEX_WS_URL
      ?? process.env.APERTURE_CODEX_WEBSOCKET_URL;
    if (!url) {
      throw new Error(
        "Codex websocket transport requires a URL. Pass --url or set APERTURE_CODEX_WS_URL.",
      );
    }
    return {
      clientOptions: {
        transportKind: "websocket",
        websocket: { url },
      },
      runtimeMetadata: {
        transport: "app-server-websocket",
      },
      transportLabel: "websocket",
    };
  }

  if (requestedTransport !== "stdio") {
    throw new Error(
      `Unsupported Codex App Server transport "${requestedTransport}". Use "stdio" or "websocket".`,
    );
  }

  return {
    clientOptions: {
      transportKind: "stdio",
      stdio: {
        ...(options.command ?? process.env.APERTURE_CODEX_COMMAND
          ? { command: options.command ?? process.env.APERTURE_CODEX_COMMAND }
          : {}),
        ...(options.cwd ?? process.env.APERTURE_CODEX_CWD
          ? { cwd: options.cwd ?? process.env.APERTURE_CODEX_CWD }
          : {}),
      },
    },
    runtimeMetadata: {
      transport: "app-server-stdio",
    },
    transportLabel: "stdio",
  };
}

export function parseCodexTransportArgs(
  args: string[],
  flagPrefix = "",
): { options: CodexTransportCliOptions; remainingArgs: string[] } {
  const remainingArgs: string[] = [];
  const transportFlag = `--${flagPrefix}transport`;
  const urlFlag = `--${flagPrefix}url`;
  const commandFlag = `--${flagPrefix}command`;
  let transport: string | undefined;
  let url: string | undefined;
  let command: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (!arg) {
      continue;
    }

    if (arg === transportFlag) {
      if (next && !next.startsWith("-")) {
        transport = next;
        index += 1;
      }
      continue;
    }

    if (arg === urlFlag) {
      if (next && !next.startsWith("-")) {
        url = next;
        index += 1;
      }
      continue;
    }

    if (arg === commandFlag) {
      if (next && !next.startsWith("-")) {
        command = next;
        index += 1;
      }
      continue;
    }

    remainingArgs.push(arg);
  }

  return {
    options: {
      ...(transport ? { transport } : {}),
      ...(url ? { url } : {}),
      ...(command ? { command } : {}),
    },
    remainingArgs,
  };
}
