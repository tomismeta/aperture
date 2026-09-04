import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, "..");
const options = parseOptions(process.argv.slice(2));
const sourceBundle = path.resolve(
  options.worker ?? path.join(packageRoot, "dist", "aperture-attention-engine.cjs"),
);
const checks: string[] = [];
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "aperture-omp-only-worker-smoke-"));
const cleanupRuntime = await mkdtemp("/tmp/aperture-worker-cleanup-smoke-");
try {
  const worker = path.join(temporaryRoot, "aperture-attention-engine.cjs");
  const config = path.join(temporaryRoot, "identities.json");
  const stateDir = path.join(temporaryRoot, "state");
  const runtimeDir = path.join(temporaryRoot, "runtime");
  await copyFile(sourceBundle, worker);
  await mkdir(runtimeDir, { recursive: true, mode: 0o700 });
  await chmod(runtimeDir, 0o700);

  const cleanup = spawnSync(
    process.execPath,
    [
      worker,
      "--config",
      path.join(temporaryRoot, "missing-identities.json"),
      "--cleanup-owned-socket",
    ],
    {
      env: { ...process.env, XDG_RUNTIME_DIR: cleanupRuntime },
      encoding: "utf8",
      timeout: 5_000,
    },
  );
  assert.equal(cleanup.status, 0, cleanup.stderr);
  assert.equal(cleanup.signal, null);
  assert.equal(cleanup.stdout, "");
  await assert.rejects(
    () => stat(path.join(cleanupRuntime, "omarchy")),
    (error: unknown) =>
      Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT"),
  );
  checks.push("cleanup-mode-no-config-or-engine");

  await writeFile(
    config,
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
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  await writeFile(path.join(stateDir, "state.json"), "legacy-generic-state\n", { mode: 0o600 });

  const result = await runWorker(worker, config, stateDir, runtimeDir, [
    JSON.stringify({
      type: "notification.observed",
      key: "generic-input-must-be-rejected",
      occurredAt: new Date().toISOString(),
      application: { name: "aperture-omp" },
      summary: "Generic notification input must not enter the OMP worker",
      urgency: "critical",
    }),
    "{malformed",
    "x".repeat(64 * 1024),
    JSON.stringify({ type: "shutdown" }),
  ]);
  assert.equal(result.messages[0]?.type, "hello");
  assert.equal(result.messages[0]?.worker, "aperture-attention-engine");
  assert.equal(result.messages[0]?.protocolVersion, 4);
  assert.deepEqual(result.messages[0]?.capabilities, {
    notificationInput: false,
    ompDirectInput: true,
    snapshots: true,
    responses: false,
    focusActivation: true,
  });
  assert.equal(
    result.messages.some((message) => message.type === "engine" && message.state === "restoring"),
    true,
  );
  assert.equal(
    result.messages.some((message) => message.type === "engine" && message.state === "ready"),
    true,
  );
  checks.push("omp-only-handshake");

  const snapshots = result.messages.filter((message) => message.type === "snapshot");
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0]?.totals?.now, 0);
  assert.equal(snapshots[0]?.totals?.next, 0);
  assert.equal(snapshots[0]?.totals?.ambient, 0);
  assert.equal(snapshots[0]?.view?.now, null);
  assert.deepEqual(snapshots[0]?.view?.next, []);
  assert.deepEqual(snapshots[0]?.view?.ambient, []);
  checks.push("generic-notification-input-disabled", "calm-snapshot-only");

  const invalidErrors = result.messages.filter(
    (message) => message.type === "error" && message.code === "invalid_input",
  );
  assert.equal(invalidErrors.length, 3);
  assert.equal(invalidErrors.every((message) => message.recoverable === true), true);
  assert.equal(
    invalidErrors.some((message) => message.message?.includes("disabled in OMP-only mode")),
    true,
  );
  assert.equal(
    result.lines.every((line) => Buffer.byteLength(`${line}\n`, "utf8") <= 256 * 1024),
    true,
  );
  assert.equal(result.lines.every((line) => /^[\x00-\x7f]*$/.test(line)), true);
  checks.push("malformed-input", "oversized-input", "bounded-ascii-output");

  await assert.rejects(
    () => stat(path.join(stateDir, "state.json")),
    (error: unknown) =>
      Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT"),
  );
  if (process.platform !== "win32") {
    assert.equal((await stat(stateDir)).mode & 0o777, 0o700);
  }
  checks.push("legacy-notification-state-removed", "no-generic-state-persistence");

  const bundleContent = await readFile(worker);
  const report = {
    schemaVersion: 1,
    proofId: "aperture-omp-only-worker-conformance-v1",
    passed: true,
    nodeVersion: process.versions.node,
    bundle: {
      sha256: createHash("sha256").update(bundleContent).digest("hex"),
      bytes: bundleContent.byteLength,
    },
    cleanDirectoryWithoutNodeModules: true,
    artifactMode: "omp-only",
    checks,
  };
  if (options.report) {
    const reportPath = path.resolve(options.report);
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  process.stdout.write(`${JSON.stringify(report)}\n`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
  await rm(cleanupRuntime, { recursive: true, force: true });
}

type SmokeOptions = {
  worker?: string;
  report?: string;
};

type SmokeWorkerMessage = {
  type?: string;
  protocolVersion?: number;
  worker?: string;
  state?: string;
  code?: string;
  message?: string;
  recoverable?: boolean;
  capabilities?: {
    notificationInput?: boolean;
    ompDirectInput?: boolean;
    snapshots?: boolean;
    responses?: boolean;
    focusActivation?: boolean;
  };
  totals?: { ambient?: number; now?: number; next?: number };
  view?: { now?: unknown; next?: unknown[]; ambient?: unknown[] };
};

type WorkerRun = {
  messages: SmokeWorkerMessage[];
  lines: string[];
};

function parseOptions(args: string[]): SmokeOptions {
  const parsed: SmokeOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") continue;
    if (argument === "--worker" || argument === "--report") {
      const value = args[index + 1];
      if (!value) throw new Error(`${argument} requires a path`);
      if (argument === "--worker") parsed.worker = value;
      else parsed.report = value;
      index += 1;
      continue;
    }
    throw new Error(`unknown attention worker smoke option: ${argument ?? "(missing)"}`);
  }
  return parsed;
}

async function runWorker(
  worker: string,
  config: string,
  stateDir: string,
  runtimeDir: string,
  lines: string[],
): Promise<WorkerRun> {
  const child = spawn(process.execPath, [worker, "--config", config, "--state-dir", stateDir], {
    cwd: path.dirname(worker),
    env: { ...process.env, XDG_RUNTIME_DIR: runtimeDir },
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
  child.stdin.end(`${lines.join("\n")}\n`);
  const outcome = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    },
  );
  assert.equal(outcome.signal, null, stderr);
  assert.equal(outcome.code, 0, stderr);
  const outputLines = stdout.split("\n").filter((line) => line.length > 0);
  return {
    lines: outputLines,
    messages: outputLines.map((line) => JSON.parse(line) as SmokeWorkerMessage),
  };
}
