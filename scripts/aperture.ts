import { spawn, type ChildProcess } from "node:child_process";
import { stderr } from "node:process";

import { listEnabledGlobalOpencodeProfiles } from "./opencode-config.ts";

async function main(): Promise<void> {
  const children: ChildProcess[] = [];
  let shuttingDown = false;
  const learningArgs = readLearningArgs(process.argv.slice(2));
  const hasOpencodeProfiles = (await listEnabledGlobalOpencodeProfiles()).length > 0;

  process.title = "aperture";

  const close = async (exitCode = 0) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);

    for (const child of children.reverse()) {
      child.kill("SIGTERM");
    }

    await Promise.all(children.map(waitForExit));
    process.exit(exitCode);
  };

  const onSignal = () => {
    void close();
  };

  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    const runtime = spawnPnpm(["serve", "--", ...learningArgs]);
    children.push(runtime);
    await waitForReady(runtime, "Aperture runtime listening");

    const claude = spawnPnpm(["claude:start"]);
    children.push(claude);
    await waitForReady(claude, "Aperture Claude adapter listening");

    if (hasOpencodeProfiles) {
      const opencode = spawnPnpm(["opencode:start"]);
      children.push(opencode);
      await waitForReady(opencode, "Aperture OpenCode adapter ready");
    }

    const tui = spawn("pnpm", ["tui"], {
      stdio: "inherit",
      env: process.env,
    });

    tui.once("exit", (code) => {
      void close(code ?? 0);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`${message}\n`);
    await close(1);
  }
}

function spawnPnpm(args: string[]): ChildProcess {
  return spawn("pnpm", args, {
    // The background runtime and adapter should never compete with the TUI for stdin.
    stdio: ["ignore", "inherit", "pipe"],
    env: process.env,
  });
}

function readLearningArgs(args: string[]): string[] {
  const flagIndex = args.findIndex((arg) => arg === "--learning");
  if (flagIndex === -1) {
    return ["--learning", "on"];
  }

  const value = args[flagIndex + 1];
  return ["--learning", value === "off" ? "off" : "on"];
}

async function waitForReady(child: ChildProcess, marker: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let stderrBuffer = "";

    const onData = (chunk: Buffer | string) => {
      const text = chunk.toString();
      stderr.write(text);
      stderrBuffer += text;
      if (stderrBuffer.includes(marker)) {
        cleanup();
        resolve();
      }
    };

    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`Process exited before becoming ready (code ${code ?? "unknown"})`));
    };

    const cleanup = () => {
      child.stderr?.off("data", onData);
      child.off("exit", onExit);
    };

    child.stderr?.on("data", onData);
    child.on("exit", onExit);
  });
}

async function waitForExit(child: ChildProcess): Promise<void> {
  await new Promise<void>((resolve) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }

    child.once("exit", () => resolve());
  });
}

void main();
