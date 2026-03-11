import { stderr } from "node:process";

import { createApertureRuntime } from "../packages/runtime/src/index.ts";

async function main(): Promise<void> {
  const controlHost = process.env.APERTURE_CONTROL_HOST ?? "127.0.0.1";
  const controlPort = readNumber(process.env.APERTURE_CONTROL_PORT) ?? 4546;
  const controlPathPrefix = process.env.APERTURE_CONTROL_PATH ?? "/runtime";

  const runtime = createApertureRuntime({
    kind: "aperture",
    controlHost,
    controlPort,
    controlPathPrefix,
  });
  const binding = await runtime.listen();

  stderr.write(`Aperture runtime listening at ${binding.controlUrl}\n`);
  stderr.write("Start adapters separately, for example: pnpm claude:start\n");
  stderr.write("Open the TUI separately with: pnpm tui\n");

  const close = async () => {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
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

void main();
