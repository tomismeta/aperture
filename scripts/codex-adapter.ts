import { stderr } from "node:process";

import { createCodexBridge } from "../packages/codex/src/index.ts";
import { createStderrLogger, resolveCodexRuntimeUrl } from "./codex-shared.ts";

async function main(): Promise<void> {
  const runtimeBaseUrl = await resolveCodexRuntimeUrl();
  const bridge = createCodexBridge({
    runtimeBaseUrl,
    runtimeLabel: process.env.APERTURE_CODEX_LABEL ?? "Codex adapter",
    ...(process.env.APERTURE_CODEX_SOURCE_LABEL
      ? { sourceLabel: process.env.APERTURE_CODEX_SOURCE_LABEL }
      : {}),
    appServer: {
      stdio: {
        ...(process.env.APERTURE_CODEX_COMMAND
          ? { command: process.env.APERTURE_CODEX_COMMAND }
          : {}),
        ...(process.env.APERTURE_CODEX_CWD ? { cwd: process.env.APERTURE_CODEX_CWD } : {}),
      },
    },
    debug: process.env.APERTURE_CODEX_DEBUG === "1",
    logger: createStderrLogger(),
  });

  await bridge.start();

  stderr.write(`Aperture Codex adapter ready via runtime ${runtimeBaseUrl}\n`);
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
