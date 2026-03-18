import { stderr } from "node:process";

import { createCodexBridge } from "../packages/codex/src/index.ts";
import {
  createStderrLogger,
  parseCodexTransportArgs,
  resolveCodexAppServerOptions,
  resolveCodexRuntimeUrl,
} from "./codex-shared.ts";

async function main(): Promise<void> {
  const { options: transportArgs } = parseCodexTransportArgs(process.argv.slice(2));
  const runtimeBaseUrl = await resolveCodexRuntimeUrl();
  const appServer = resolveCodexAppServerOptions(transportArgs);
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

  stderr.write(`Aperture Codex adapter ready via runtime ${runtimeBaseUrl}\n`);
  stderr.write(`Using Codex App Server ${appServer.transportLabel} transport\n`);
  stderr.write("Run the TUI separately with: pnpm tui\n");

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
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  stderr.write(`${message}\n`);
  process.exit(1);
});
