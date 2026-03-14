import { cwd } from "node:process";
import { stderr } from "node:process";

import {
  bootstrapLearningPersistence,
  createApertureRuntime,
  type LearningMode,
} from "../packages/runtime/src/index.ts";

async function main(): Promise<void> {
  const learning = readLearningMode(process.argv.slice(2));
  const controlHost = process.env.APERTURE_CONTROL_HOST ?? "127.0.0.1";
  const controlPort = readNumber(process.env.APERTURE_CONTROL_PORT) ?? 4546;
  const controlPathPrefix = process.env.APERTURE_CONTROL_PATH ?? "/runtime";
  const learningBootstrap =
    learning === "on" ? await bootstrapLearningPersistence(cwd()) : null;

  const runtime = createApertureRuntime({
    kind: "aperture",
    controlHost,
    controlPort,
    controlPathPrefix,
    ...(learningBootstrap
      ? {
          core: learningBootstrap.core,
          learningPersistence: learningBootstrap.state,
        }
      : {}),
  });
  const binding = await runtime.listen();

  stderr.write(`Aperture runtime listening at ${binding.controlUrl}\n`);
  stderr.write(`Learning persistence ${learning === "on" ? "enabled" : "disabled"}\n`);
  stderr.write("Start adapters separately, for example: pnpm claude:start or pnpm opencode:start\n");
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

function readLearningMode(args: string[]): LearningMode {
  const flagIndex = args.findIndex((arg) => arg === "--learning");
  if (flagIndex === -1) {
    return "on";
  }

  const value = args[flagIndex + 1];
  if (value === "off") {
    return "off";
  }
  return "on";
}

void main();
