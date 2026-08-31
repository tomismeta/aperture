import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, "..");
const options = parseOptions(process.argv.slice(2));
const sourceBundle = path.resolve(
  options.worker ?? path.join(packageRoot, "dist", "aperture-attention-engine.cjs"),
);
const ambientCases = [
  "Build failed and cannot continue",
  "Approval required: allow command?",
  "Blocked waiting for your input",
  "Permission needed immediately",
  "Critical urgent action required",
  "Same issue as before; this supersedes the previous request",
  "Review this error and approve the fix",
  "Done and complete; needs input",
];
const checks: string[] = [];
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "aperture-attention-worker-smoke-"));
try {
  const worker = path.join(temporaryRoot, "aperture-attention-engine.cjs");
  const config = path.join(temporaryRoot, "identities.json");
  const stateDir = path.join(temporaryRoot, "state");
  await copyFile(sourceBundle, worker);
  await writeFile(
    config,
    `${JSON.stringify({
      schemaVersion: 1,
      identities: [
        {
          id: "smoke-agent",
          kind: "smoke-agent",
          label: "Smoke Agent",
          applicationNames: ["Smoke Agent"],
        },
      ],
    })}\n`,
    "utf8",
  );

  const eventKey = "generation:smoke-1";
  const occurredAt = Date.parse("2026-08-31T16:00:00.000Z");
  const eventLines = ambientCases.map((summary, index) =>
    JSON.stringify({
      type: index === 0 ? "notification.observed" : "notification.updated",
      key: eventKey,
      occurredAt: new Date(occurredAt + index * 1000).toISOString(),
      application: { name: "Smoke Agent", category: "device.error.urgent" },
      summary,
      body:
        index === 0
          ? "raw-body-canary Bearer abc.def /Users/alice/private-project"
          : `adversarial body ${index}: urgent approval failed blocked`,
      urgency: "critical",
    }),
  );
  const first = await runWorker(worker, config, stateDir, [
    ...eventLines,
    JSON.stringify({
      type: "notification.observed",
      key: "generation:unknown",
      occurredAt: new Date(occurredAt + 20_000).toISOString(),
      application: { name: "Unknown Agent" },
      summary: "Unknown critical failure",
      body: "unknown-body-canary",
      urgency: "critical",
    }),
    "{malformed",
    "x".repeat(64 * 1024),
    JSON.stringify({ type: "shutdown" }),
  ]);
  assert.equal(first.messages[0]?.type, "hello");
  assert.equal(first.messages[0]?.worker, "aperture-attention-engine");
  assert.deepEqual(first.messages[0]?.capabilities, {
    notificationInput: true,
    snapshots: true,
    responses: false,
  });
  assert.equal(
    first.messages.some((message) => message.type === "engine" && message.state === "restoring"),
    true,
  );
  assert.equal(
    first.messages.some((message) => message.type === "engine" && message.state === "ready"),
    true,
  );
  checks.push("canonical-handshake");

  const firstSnapshots = first.messages.filter((message) => message.type === "snapshot");
  assert.equal(firstSnapshots.length, ambientCases.length + 1);
  for (let index = 1; index < firstSnapshots.length; index += 1) {
    const snapshot = firstSnapshots[index]!;
    assert.equal(snapshot.totals?.now, 0, ambientCases[index - 1]);
    assert.equal(snapshot.totals?.next, 0, ambientCases[index - 1]);
    assert.equal(snapshot.totals?.ambient, 1, ambientCases[index - 1]);
    assert.equal(snapshot.view?.now, null, ambientCases[index - 1]);
    assert.deepEqual(snapshot.view?.next, [], ambientCases[index - 1]);
    assert.equal(snapshot.view?.ambient?.[0]?.title, ambientCases[index - 1]);
    assert.equal(snapshot.view?.ambient?.[0]?.tone, "ambient");
    assert.equal(snapshot.view?.ambient?.[0]?.consequence, "low");
    assert.equal(snapshot.view?.ambient?.[0]?.provenance, undefined);
  }
  const snapshotSequences = firstSnapshots.map((snapshot) => snapshot.sequence);
  for (let index = 1; index < snapshotSequences.length; index += 1) {
    assert.ok(Number(snapshotSequences[index]) > Number(snapshotSequences[index - 1]));
  }
  checks.push("ambient-ceiling", "observed-updated", "monotonic-complete-snapshots");

  const invalidErrors = first.messages.filter(
    (message) => message.type === "error" && message.code === "invalid_input",
  );
  assert.equal(invalidErrors.length, 2);
  assert.equal(
    invalidErrors.every((message) => message.recoverable === true),
    true,
  );
  assert.equal(
    first.lines.every((line) => Buffer.byteLength(`${line}\n`, "utf8") <= 256 * 1024),
    true,
  );
  checks.push("malformed-input", "oversized-input", "bounded-output");

  const rawState = await readFile(path.join(stateDir, "state.json"), "utf8");
  for (const canary of [
    "raw-body-canary",
    "abc.def",
    "/Users/alice",
    "private-project",
    "unknown-body-canary",
  ]) {
    assert.equal(rawState.includes(canary), false, `state persisted canary: ${canary}`);
  }
  const activeState = JSON.parse(rawState) as {
    active?: Array<{
      key?: unknown;
      revisions?: Array<{ displayTitle?: unknown; sourceEvent?: unknown }>;
    }>;
  };
  assert.equal(activeState.active?.length, 1);
  assert.equal(activeState.active?.[0]?.key, eventKey);
  const latestRevision = activeState.active?.[0]?.revisions?.at(-1);
  assert.equal(latestRevision?.displayTitle, ambientCases.at(-1));
  assert.equal(JSON.stringify(latestRevision?.sourceEvent).includes(ambientCases.at(-1)!), false);
  checks.push("unknown-application-ignored", "raw-body-not-persisted");

  const activeView = firstSnapshots.at(-1)?.view;
  const second = await runWorker(worker, config, stateDir, [
    JSON.stringify({
      type: "notification.closed",
      key: eventKey,
      occurredAt: new Date(occurredAt + 60_000).toISOString(),
      reason: "actioned",
    }),
    JSON.stringify({ type: "shutdown" }),
  ]);
  const secondSnapshots = second.messages.filter((message) => message.type === "snapshot");
  assert.deepEqual(secondSnapshots[0]?.view, activeView);
  assert.equal(secondSnapshots.at(-1)?.totals?.ambient, 0);
  const finalState = JSON.parse(await readFile(path.join(stateDir, "state.json"), "utf8")) as {
    active?: unknown[];
    signals?: Array<{ kind?: unknown; responseKind?: unknown }>;
  };
  assert.deepEqual(finalState.active, []);
  assert.equal(finalState.signals?.at(-1)?.kind, "responded");
  assert.equal(finalState.signals?.at(-1)?.responseKind, "acknowledged");
  if (process.platform !== "win32") {
    assert.equal((await stat(stateDir)).mode & 0o777, 0o700);
    assert.equal((await stat(path.join(stateDir, "state.json"))).mode & 0o777, 0o600);
  }
  checks.push("deterministic-replay", "closed-feedback", "clean-shutdown", "private-permissions");

  const bundleContent = await readFile(worker);
  const report = {
    schemaVersion: 1,
    proofId: "aperture-attention-worker-conformance-v1",
    ambientCeilingProofId: "notification-worker-ambient-ceiling-v1",
    passed: true,
    nodeVersion: process.versions.node,
    bundle: {
      sha256: createHash("sha256").update(bundleContent).digest("hex"),
      bytes: bundleContent.byteLength,
    },
    cleanDirectoryWithoutNodeModules: true,
    ambientCases,
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
}

type SmokeOptions = {
  worker?: string;
  report?: string;
};

type SmokeWorkerMessage = {
  type?: string;
  worker?: string;
  state?: string;
  code?: string;
  recoverable?: boolean;
  sequence?: number;
  capabilities?: {
    notificationInput?: boolean;
    snapshots?: boolean;
    responses?: boolean;
  };
  totals?: { ambient?: number; now?: number; next?: number };
  view?: {
    now?: unknown;
    next?: unknown[];
    ambient?: Array<{
      title?: string;
      tone?: string;
      consequence?: string;
      provenance?: unknown;
    }>;
  };
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
  lines: string[],
): Promise<WorkerRun> {
  const child = spawn(process.execPath, [worker, "--config", config, "--state-dir", stateDir], {
    cwd: path.dirname(worker),
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let outputBytes = 0;
  child.stdout.on("data", (chunk: Buffer) => {
    outputBytes += chunk.byteLength;
    if (outputBytes > 4 * 1024 * 1024) child.kill("SIGKILL");
    else stdout.push(chunk);
  });
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  child.stdin.end(`${lines.join("\n")}\n`);
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    },
  );
  assert.equal(
    result.code,
    0,
    `worker failed (${result.signal ?? "no signal"}): ${Buffer.concat(stderr).toString("utf8")}`,
  );
  const outputLines = Buffer.concat(stdout).toString("utf8").split("\n").filter(Boolean);
  return {
    lines: outputLines,
    messages: outputLines.map((line) => JSON.parse(line) as SmokeWorkerMessage),
  };
}
