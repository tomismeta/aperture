import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter, once } from "node:events";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

const options = parseOptions(process.argv.slice(2));
const worker = path.resolve(options.worker);
const extension = path.resolve(options.extension);
const temporaryRoot = await mkdtemp("/tmp/ap-omp-host-");

try {
  const runtimeDir = path.join(temporaryRoot, "runtime");
  const configHome = path.join(temporaryRoot, "config");
  const stateDir = path.join(temporaryRoot, "state");
  const configDir = path.join(configHome, "omarchy", "aperture");
  const configPath = path.join(configDir, "config.json");
  const socketPath = path.join(runtimeDir, "omarchy", "aperture", "attention.sock");
  await mkdir(runtimeDir, { recursive: true, mode: 0o700 });
  await chmod(runtimeDir, 0o700);
  await mkdir(configDir, { recursive: true });
  await writeFile(
    configPath,
    `${JSON.stringify({
      schemaVersion: 1,
      identities: [
        {
          id: "omp",
          kind: "omp",
          label: "OMP",
          applicationNames: ["aperture-omp"],
        },
      ],
    })}\n`,
    "utf8",
  );

  const workerHarness = startWorker(worker, configPath, stateDir, runtimeDir);
  await workerHarness.waitFor((message) => message.type === "engine" && message.state === "ready");
  const matrix = [];
  for (const version of options.ompVersions) {
    const help = await runProcess("bunx", [`@oh-my-pi/pi-coding-agent@${version}`, "--help"], {
      PI_CODING_AGENT_DIR: path.join(temporaryRoot, `agent-help-${version}`),
    });
    assert.equal(help.code, 0, help.stderr);

    const marker = path.join(temporaryRoot, `loaded-${version}`);
    const sessionId = `01a0-omp-${version.replaceAll(".", "-")}`;
    const wrapper = path.join(temporaryRoot, `wrapper-${version}.mjs`);
    await writeFile(
      wrapper,
      `import { writeFileSync } from "node:fs";\nimport extension from ${JSON.stringify(pathToFileURL(extension).href)};\nexport default async function proof(pi) {\n  const handlers = new Map();\n  await extension({ logger: pi.logger, on(event, handler) { handlers.set(event, handler); pi.on(event, handler); } });\n  const context = { sessionManager: { getSessionId() { return ${JSON.stringify(sessionId)}; }, getSessionFile() { return ${JSON.stringify(path.join(temporaryRoot, `session-${version}.jsonl`))}; } } };\n  await handlers.get("tool_call")?.({ type: "tool_call", toolCallId: "ask-host", toolName: "ask", input: {} }, context);\n  await handlers.get("session_shutdown")?.({ type: "session_shutdown" }, context);\n  writeFileSync(${JSON.stringify(marker)}, "loaded\\n", "utf8");\n}\n`,
      "utf8",
    );
    const before = workerHarness.messageCount();
    const rpc = await runProcess(
      "bunx",
      [
        `@oh-my-pi/pi-coding-agent@${version}`,
        "--no-extensions",
        "--extension",
        wrapper,
        "--mode",
        "rpc",
        "--no-session",
        "--model",
        "openai/gpt-4o",
      ],
      {
        XDG_RUNTIME_DIR: runtimeDir,
        PI_CODING_AGENT_DIR: path.join(temporaryRoot, `agent-${version}`),
        OPENAI_API_KEY: "compatibility-probe-not-used",
        PI_NOTIFICATIONS: "on",
      },
    );
    assert.equal(rpc.code, 0, rpc.stderr);
    assert.match(rpc.stdout, /"type":"ready"/);
    assert.equal(await readFile(marker, "utf8"), "loaded\n");
    const projected = await workerHarness.waitForFrom(
      before,
      (message) =>
        message.type === "snapshot" && message.view?.now?.title === "OMP needs your input",
    );
    assert.equal(projected.view?.now?.navigation, undefined);
    matrix.push({
      ompVersion: version,
      status: "passed",
      actualExtensionLoader: true,
      stockSessionMethods: true,
      attentionClassification: "input_requested",
      rpcReady: true,
      directSocketDelivered: true,
      navigation: "absent-rpc-headless",
      modelRequestSent: false,
    });
  }

  await workerHarness.shutdown();
  await assert.rejects(() => stat(socketPath), /ENOENT/);
  const workerContent = await readFile(worker);
  const extensionContent = await readFile(extension);
  const report = {
    schemaVersion: 1,
    proofId: "aperture-omp-host-direct-compatibility-v1",
    passed: true,
    worker: {
      bytes: workerContent.byteLength,
      sha256: createHash("sha256").update(workerContent).digest("hex"),
    },
    extension: {
      bytes: extensionContent.byteLength,
      sha256: createHash("sha256").update(extensionContent).digest("hex"),
    },
    socketRemovedOnShutdown: true,
    matrix,
  };
  if (options.report) {
    const reportPath = path.resolve(options.report);
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  process.stdout.write(`${JSON.stringify(report)}\n`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

type WorkerMessage = {
  type?: string;
  state?: string;
  view?: {
    now?: {
      title?: string;
      navigation?: { kind?: string; sessionId?: string };
    } | null;
  };
};

type ProcessResult = { code: number | null; stdout: string; stderr: string };

type Options = {
  worker: string;
  extension: string;
  ompVersions: string[];
  report?: string;
};

function startWorker(workerFile: string, config: string, stateDir: string, runtimeDir: string) {
  const child = spawn(process.execPath, [workerFile, "--config", config, "--state-dir", stateDir], {
    cwd: path.dirname(workerFile),
    env: { ...process.env, XDG_RUNTIME_DIR: runtimeDir },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const messages: WorkerMessage[] = [];
  const events = new EventEmitter();
  let buffered = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  child.stdout.on("data", (chunk: string) => {
    buffered += chunk;
    for (;;) {
      const newline = buffered.indexOf("\n");
      if (newline === -1) break;
      const line = buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line) as WorkerMessage;
      messages.push(message);
      events.emit("message", message);
    }
  });

  const waitForFrom = async (
    start: number,
    predicate: (message: WorkerMessage) => boolean,
  ): Promise<WorkerMessage> => {
    for (;;) {
      const existing = messages.slice(start).find(predicate);
      if (existing) return existing;
      const [message] = await once(events, "message", { signal: AbortSignal.timeout(10_000) });
      if (predicate(message as WorkerMessage)) return message as WorkerMessage;
    }
  };

  return {
    messageCount: () => messages.length,
    waitFor: (predicate: (message: WorkerMessage) => boolean) => waitForFrom(0, predicate),
    waitForFrom,
    async shutdown(): Promise<void> {
      child.stdin.end(`${JSON.stringify({ type: "shutdown" })}\n`);
      const [code, signal] = await once(child, "close", { signal: AbortSignal.timeout(5_000) });
      assert.equal(code, 0, `worker failed (${String(signal)}): ${stderr}`);
    },
  };
}

async function runProcess(
  command: string,
  args: string[],
  environment: Record<string, string>,
): Promise<ProcessResult> {
  const child = spawn(command, args, {
    env: { ...process.env, ...environment },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  child.stdin.end();
  const [code] = await once(child, "close", { signal: AbortSignal.timeout(30_000) });
  return { code: code as number | null, stdout, stderr };
}

function parseOptions(args: string[]): Options {
  let parsedWorker = "";
  let parsedExtension = "";
  let report: string | undefined;
  const ompVersions: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") continue;
    if (
      argument === "--worker" ||
      argument === "--extension" ||
      argument === "--omp-version" ||
      argument === "--report"
    ) {
      const value = args[index + 1];
      if (!value) throw new Error(`${argument} requires a value`);
      if (argument === "--worker") parsedWorker = value;
      else if (argument === "--extension") parsedExtension = value;
      else if (argument === "--omp-version") ompVersions.push(value);
      else report = value;
      index += 1;
      continue;
    }
    throw new Error(`unknown OMP host smoke option: ${argument ?? "(missing)"}`);
  }
  if (!parsedWorker) throw new Error("--worker is required");
  if (!parsedExtension) throw new Error("--extension is required");
  if (ompVersions.length === 0) throw new Error("at least one --omp-version is required");
  return {
    worker: parsedWorker,
    extension: parsedExtension,
    ompVersions,
    ...(report ? { report } : {}),
  };
}
