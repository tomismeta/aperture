import { spawn, type ChildProcess } from "node:child_process";
import { stderr } from "node:process";

async function main(): Promise<void> {
  const children: ChildProcess[] = [];
  let shuttingDown = false;

  const runtime = spawnPnpm(["serve"]);
  children.push(runtime);
  await waitForReady(runtime, "Aperture runtime listening");

  const claude = spawnPnpm(["claude:start"]);
  children.push(claude);
  await waitForReady(claude, "Aperture Claude adapter listening");

  const tui = spawn("pnpm", ["tui"], {
    stdio: "inherit",
    env: process.env,
  });

  const close = async () => {
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
    process.exit(0);
  };

  const onSignal = () => {
    void close();
  };

  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  tui.once("exit", () => {
    void close();
  });
}

function spawnPnpm(args: string[]): ChildProcess {
  return spawn("pnpm", args, {
    stdio: ["inherit", "inherit", "pipe"],
    env: process.env,
  });
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
