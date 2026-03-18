import { spawn, type ChildProcess } from "node:child_process";
import { stderr } from "node:process";

import { discoverLocalRuntimes } from "../packages/runtime/src/index.ts";
import { listEnabledGlobalOpencodeProfiles } from "./opencode-config.ts";

async function main(): Promise<void> {
  const children: ChildProcess[] = [];
  let shuttingDown = false;
  const cliArgs = process.argv.slice(2);
  const learningArgs = readLearningArgs(cliArgs);
  const codexArgs = readCodexArgs(cliArgs);
  const hasOpencodeProfiles = (await listEnabledGlobalOpencodeProfiles()).length > 0;
  const enableCodex = shouldEnableCodex(cliArgs);

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
    const runtimeBaseUrl = await resolveRuntimeUrl();
    const childEnv = {
      ...process.env,
      APERTURE_RUNTIME_URL: runtimeBaseUrl,
    };

    const claude = spawnPnpm(["claude:start"], childEnv);
    children.push(claude);
    const adapterReadiness: Promise<void>[] = [
      waitForReady(claude, "Aperture Claude adapter listening"),
    ];

    if (hasOpencodeProfiles) {
      const opencode = spawnPnpm(["opencode:start"], childEnv);
      children.push(opencode);
      adapterReadiness.push(waitForReady(opencode, "Aperture OpenCode adapter ready"));
    }

    if (enableCodex) {
      const codex = spawnPnpm(["codex:start", ...(codexArgs.length > 0 ? ["--", ...codexArgs] : [])], childEnv);
      children.push(codex);
      adapterReadiness.push(waitForReady(codex, "Aperture Codex adapter ready"));
    }

    await Promise.all(adapterReadiness);

    const tui = spawn("pnpm", ["tui"], {
      stdio: "inherit",
      env: childEnv,
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

function spawnPnpm(args: string[], env: NodeJS.ProcessEnv = process.env): ChildProcess {
  return spawn("pnpm", args, {
    // The background runtime and adapter should never compete with the TUI for stdin.
    stdio: ["ignore", "inherit", "pipe"],
    env,
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

function shouldEnableCodex(args: string[]): boolean {
  return process.env.APERTURE_ENABLE_CODEX === "1" || args.includes("--codex");
}

function readCodexArgs(args: string[]): string[] {
  const codexArgs: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (!arg) {
      continue;
    }

    switch (arg) {
      case "--codex-transport":
        if (next && !next.startsWith("-")) {
          codexArgs.push("--transport", next);
          index += 1;
        }
        continue;
      case "--codex-url":
        if (next && !next.startsWith("-")) {
          codexArgs.push("--url", next);
          index += 1;
        }
        continue;
      case "--codex-command":
        if (next && !next.startsWith("-")) {
          codexArgs.push("--command", next);
          index += 1;
        }
        continue;
      default:
        continue;
    }
  }

  return codexArgs;
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

async function resolveRuntimeUrl(): Promise<string> {
  const explicit = process.env.APERTURE_RUNTIME_URL;
  if (explicit) {
    return explicit.replace(/\/+$/, "");
  }

  const runtimes = await discoverLocalRuntimes({ kind: "aperture" });
  if (runtimes.length === 0) {
    throw new Error("Aperture runtime became ready but could not be discovered.");
  }

  return runtimes[0]?.controlUrl ?? "http://127.0.0.1:4546/runtime";
}

void main();
