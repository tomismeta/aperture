import { stderr } from "node:process";

import {
  buildCodexRunInput,
  createCodexBridge,
  parseCodexRunArgs,
} from "../packages/codex/src/index.ts";
import {
  createStderrLogger,
  parseCodexTransportArgs,
  resolveCodexAppServerOptions,
  resolveCodexRuntimeUrl,
} from "./codex-shared.ts";

async function main(): Promise<void> {
  const { options: transportArgs, remainingArgs } = parseCodexTransportArgs(process.argv.slice(2));
  const options = parseArgs(remainingArgs);
  const runtimeBaseUrl = await resolveCodexRuntimeUrl();
  const appServer = resolveCodexAppServerOptions({
    ...transportArgs,
    cwd: options.cwd,
  });
  const bridge = createCodexBridge({
    runtimeBaseUrl,
    runtimeLabel: process.env.APERTURE_CODEX_LABEL ?? "Codex adapter",
    ...(process.env.APERTURE_CODEX_SOURCE_LABEL
      ? { sourceLabel: process.env.APERTURE_CODEX_SOURCE_LABEL }
      : {}),
    runtimeMetadata: appServer.runtimeMetadata,
    appServer: appServer.clientOptions,
    debug: process.env.APERTURE_CODEX_DEBUG === "1",
    logger: createStderrLogger(),
  });

  await bridge.start();
  const client = bridge.getClient();

  try {
    const thread = options.resumeThreadId
      ? (await client.threadResume({ threadId: options.resumeThreadId })).thread
      : (await client.threadStart({
          ...(options.cwd ? { cwd: options.cwd } : {}),
          ...(options.model ? { model: options.model } : {}),
          ...(options.approvalPolicy ? { approvalPolicy: options.approvalPolicy } : {}),
          ...(options.sandbox ? { sandbox: options.sandbox } : {}),
        })).thread;

    const turn = await client.turnStart({
      threadId: thread.id,
      input: buildCodexRunInput(options.prompt),
      ...(options.cwd ? { cwd: options.cwd } : {}),
      ...(options.model ? { model: options.model } : {}),
      ...(options.approvalPolicy ? { approvalPolicy: options.approvalPolicy } : {}),
      ...(options.effort ? { effort: options.effort } : {}),
      ...(options.summary ? { summary: options.summary } : {}),
      ...(options.personality ? { personality: options.personality } : {}),
    });

    stderr.write(`Started Codex thread ${thread.id}\n`);
    stderr.write(`Started Codex turn ${turn.turn.id}\n`);
    stderr.write(`Codex App Server transport: ${appServer.transportLabel}\n`);
    if (options.approvalPolicy) {
      stderr.write(`Codex approval policy: ${options.approvalPolicy}\n`);
    }
    if (options.sandbox) {
      stderr.write(`Codex sandbox mode: ${options.sandbox}\n`);
    }
    stderr.write("Aperture will surface approvals and questions in the TUI when Codex requests them.\n");
    stderr.write("Press Ctrl+C to stop the Codex session runner.\n");

    const close = async () => {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      await bridge.close();
      process.exit(0);
    };

    const onSignal = () => {
      void close();
    };

    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
  } catch (error) {
    await bridge.close();
    throw error;
  }
}

function parseArgs(args: string[]) {
  return parseCodexRunArgs(args);
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  stderr.write(`${message}\n`);
  process.exit(1);
});
