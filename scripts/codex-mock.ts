import { stderr, stdin } from "node:process";

import type { CodexServerRequest } from "../packages/codex/src/index.ts";
import { createCodexRuntimeBridge } from "../packages/codex/src/index.ts";
import {
  ApertureRuntimeAdapterClient,
  discoverLocalRuntimes,
} from "../packages/runtime/src/index.ts";

async function main(): Promise<void> {
  const runtimeBaseUrl = await resolveRuntimeUrl();
  const adapterClient = await ApertureRuntimeAdapterClient.connect({
    baseUrl: runtimeBaseUrl,
    kind: "codex",
    label: "Codex mock adapter",
    metadata: {
      transport: "mock",
    },
  });
  const bridge = createCodexRuntimeBridge(adapterClient, {
    sendCodexResponse(response) {
      stderr.write(`Codex mock response: ${JSON.stringify(response)}\n`);
    },
  });

  stderr.write(`Connected Codex mock adapter to runtime ${runtimeBaseUrl}\n`);

  if (stdin.isTTY) {
    stderr.write("No Codex transport exists yet, so this mock publishes a sample request.\n");
    stderr.write("Use the TUI to respond. Responses will print here.\n");
    await bridge.handleCodexRequest(sampleApprovalRequest());
  } else {
    const raw = await readAllStdin();
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      await bridge.handleCodexRequest(JSON.parse(trimmed) as CodexServerRequest);
    }
  }

  const close = async () => {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    bridge.close();
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
  const explicit = process.env.APERTURE_RUNTIME_URL ?? process.env.APERTURE_CODEX_RUNTIME_URL;
  if (explicit) {
    return explicit.replace(/\/+$/, "");
  }

  const runtimes = await discoverLocalRuntimes({ kind: "aperture" });
  if (runtimes.length === 0) {
    throw new Error("No live Aperture runtime found. Start one with `pnpm serve`.");
  }

  return runtimes[0]?.controlUrl ?? "http://127.0.0.1:4546/runtime";
}

function sampleApprovalRequest(): CodexServerRequest {
  return {
    id: "mock-approval-1",
    method: "item/commandExecution/requestApproval",
    params: {
      itemId: "item:mock:1",
      threadId: "thread:mock",
      turnId: "turn:mock:1",
      command: "git status --short",
      cwd: "/Users/tom/dev/aperture",
      reason: "Inspect the current working tree before continuing.",
    },
  };
}

function readAllStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    stdin.setEncoding("utf8");
    stdin.on("data", (chunk) => {
      data += chunk;
    });
    stdin.on("end", () => resolve(data));
    stdin.on("error", reject);
  });
}

void main();
