import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn, type ChildProcessByStdio } from "node:child_process";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, "..");
const runtimeRequestTimeoutMs = 5_000;

type PackagedRuntimeProcess = ChildProcessByStdio<null, Readable, Readable>;

function commandEnv(): NodeJS.ProcessEnv {
  const entries = Object.entries(process.env).filter(([key]) => {
    const normalized = key.toLowerCase();
    return (
      !normalized.startsWith("npm_") &&
      !normalized.startsWith("pnpm_") &&
      normalized !== "_jsr_registry"
    );
  });

  return Object.fromEntries(entries);
}

function run(
  command: string,
  args: string[],
  cwd: string,
  extraEnv: NodeJS.ProcessEnv = {},
): string {
  return execFileSync(command, args, {
    cwd,
    stdio: ["ignore", "pipe", "inherit"],
    encoding: "utf8",
    env: {
      ...commandEnv(),
      ...extraEnv,
    },
  });
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

type RuntimeLaunch = {
  child: PackagedRuntimeProcess;
  controlUrl: string;
  authToken: string;
};

async function startPackagedRuntime(
  binPath: string,
  cwd: string,
  extraEnv: NodeJS.ProcessEnv,
): Promise<RuntimeLaunch> {
  const child: PackagedRuntimeProcess = spawn(
    binPath,
    ["internal", "runtime", "--learning", "off"],
    {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...commandEnv(),
        ...extraEnv,
        APERTURE_CONTROL_HOST: "127.0.0.1",
        APERTURE_CONTROL_PORT: "0",
        APERTURE_CONTROL_PATH: "/runtime",
      },
    },
  );
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  let stdoutText = "";
  let stderrText = "";

  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      fail(
        new Error(
          `Timed out waiting for packaged runtime to start.\nstdout:\n${stdoutText}\nstderr:\n${stderrText}`,
        ),
      );
    }, 10_000);

    function cleanup(): void {
      clearTimeout(timeout);
      child.stdout.off("data", onStdout);
      child.stderr.off("data", onStderr);
      child.off("exit", onExit);
      child.off("error", fail);
    }

    function fail(error: Error): void {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      void stopPackagedRuntime(child).finally(() => {
        reject(error);
      });
    }

    async function tryResolve(): Promise<void> {
      if (settled) {
        return;
      }
      const controlUrl = stderrText.match(/Aperture runtime listening at (http:\/\/[^\s]+)/)?.[1];
      const tokenPath = stderrText.match(/Runtime auth token path: ([^\n]+)/)?.[1]?.trim();
      if (!controlUrl || !tokenPath) {
        return;
      }

      try {
        const authToken = (await readFile(tokenPath, "utf8")).trim();
        settled = true;
        cleanup();
        resolve({ child, controlUrl, authToken });
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    }

    function onStdout(chunk: string): void {
      stdoutText += chunk;
    }

    function onStderr(chunk: string): void {
      stderrText += chunk;
      void tryResolve();
    }

    function onExit(code: number | null, signal: NodeJS.Signals | null): void {
      fail(
        new Error(
          `Packaged runtime exited before it was ready (code=${code ?? "null"}, signal=${
            signal ?? "null"
          }).\nstdout:\n${stdoutText}\nstderr:\n${stderrText}`,
        ),
      );
    }

    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.once("exit", onExit);
    child.once("error", fail);
  });
}

async function stopPackagedRuntime(child: PackagedRuntimeProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  child.kill("SIGTERM");
  if (await waitForRuntimeExit(child, 5_000)) {
    return;
  }

  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
  }
  await waitForRuntimeExit(child, 5_000);
}

async function waitForRuntimeExit(
  child: PackagedRuntimeProcess,
  timeoutMs: number,
): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return true;
  }

  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);

    function cleanup(): void {
      clearTimeout(timeout);
      child.off("exit", onExit);
    }

    function onExit(): void {
      cleanup();
      resolve(true);
    }

    child.once("exit", onExit);
  });
}

async function runtimeFetchJson(
  runtime: RuntimeLaunch,
  routePath: string,
  init: RequestInit = {},
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error(`Timed out waiting for packaged runtime route ${routePath}`));
  }, runtimeRequestTimeoutMs);

  try {
    const response = await fetch(`${runtime.controlUrl}${routePath}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${runtime.authToken}`,
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
    const body = await response.text();
    assert.equal(response.status, 200, body);
    return body ? (JSON.parse(body) as unknown) : {};
  } finally {
    clearTimeout(timeout);
  }
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  assert.equal(typeof value, "object", `${label} should be an object`);
  assert.notEqual(value, null, `${label} should not be null`);
  return value as Record<string, unknown>;
}

function asStringArray(value: unknown, label: string): string[] {
  assert.ok(Array.isArray(value), `${label} should be an array`);
  return value as string[];
}

function findRuntimeCandidateTrace(traces: unknown[], eventId: string): Record<string, unknown> {
  const trace = traces.find((entry) => {
    const candidate = asRecord(entry, "runtime trace");
    return (
      asRecord(candidate.event, "runtime trace event").id === eventId &&
      asRecord(candidate.evaluation, "runtime trace evaluation").kind === "candidate"
    );
  });
  assert.ok(trace, `expected packaged runtime to emit candidate trace for ${eventId}`);
  return asRecord(trace, "runtime trace");
}

async function assertPackagedRuntimeUsesCurrentCore(
  binPath: string,
  installDir: string,
  homeDir: string,
): Promise<void> {
  const runtime = await startPackagedRuntime(binPath, installDir, { HOME: homeDir });
  try {
    await runtimeFetchJson(runtime, "/events/source", {
      method: "POST",
      body: JSON.stringify({
        event: {
          id: "evt:product-smoke:read-start-line-window-limit",
          type: "task.updated",
          taskId: "task:product-smoke:read-start-line-window-limit",
          timestamp: "2026-05-09T13:24:30.000Z",
          source: { id: "product-smoke" },
          title: "read failure",
          summary:
            "File content (812KB) exceeds maximum allowed size (512KB). Use start_line and end_line parameters to read specific portions of the file.",
          status: "failed",
          toolFamily: "read",
        },
      }),
    });
    await runtimeFetchJson(runtime, "/events/source", {
      method: "POST",
      body: JSON.stringify({
        event: {
          id: "evt:product-smoke:edit-applied-readback",
          type: "task.updated",
          taskId: "task:product-smoke:edit-applied-readback",
          timestamp: "2026-05-09T13:25:30.000Z",
          source: { id: "product-smoke" },
          title: "edit failure",
          summary:
            "Successfully modified file: /repo/src/app.ts (1 replacements). Here is the updated code:\nexport const value = 1;",
          status: "failed",
          toolFamily: "edit",
        },
      }),
    });

    const capture = asRecord(await runtimeFetchJson(runtime, "/session"), "runtime session");
    const traces = capture.traces;
    assert.ok(Array.isArray(traces), "runtime session should expose traces");
    const traceRecord = findRuntimeCandidateTrace(
      traces,
      "evt:product-smoke:read-start-line-window-limit",
    );
    const evaluation = asRecord(traceRecord.evaluation, "runtime trace evaluation");
    const adjusted = asRecord(evaluation.adjusted, "runtime trace adjusted candidate");
    assert.equal(adjusted.priority, "normal");
    assert.equal(adjusted.tone, "focused");
    assert.equal(adjusted.consequence, "medium");
    assert.equal(
      asRecord(adjusted.responseSpec, "runtime trace response spec").kind,
      "acknowledge",
    );

    const judgmentInput = asRecord(adjusted.judgmentInput, "runtime trace adjusted judgment input");
    assert.equal(Object.hasOwn(judgmentInput, "failureEvidence"), false);
    const observation = asRecord(judgmentInput.observation, "runtime trace observation");
    assert.equal(observation.kind, "diagnostic");
    assert.equal(observation.polarity, "failure");
    assert.equal(observation.diagnosticClass, "source_limit");
    assert.equal(observation.evidenceLoss, "partial");
    assert.equal(observation.recoveryHint, "narrow_evidence_scope");
    assert.equal(observation.consequenceBaseline, "medium");
    assert.equal(observation.semanticAgreement, "stable");
    const semanticEvidence = asRecord(
      judgmentInput.semanticEvidence,
      "runtime trace semantic evidence",
    );
    assert.equal(semanticEvidence.confidence, "high");
    assert.equal(semanticEvidence.source, "explicit");
    assert.equal(semanticEvidence.strength, "strong");
    assert.equal(semanticEvidence.abstained, false);

    const policy = asRecord(traceRecord.policy, "runtime trace policy");
    assert.equal(policy.mayInterrupt, false);
    assert.equal(policy.minimumLane, "next");
    const coordination = asRecord(traceRecord.coordination, "runtime trace coordination");
    assert.equal(coordination.kind, "queue");
    const planning = asRecord(
      asRecord(traceRecord.decisionRecord, "runtime trace decision record").planning,
      "runtime trace planning",
    );
    assert.equal(planning.route, "queue");
    assert.equal(planning.plannedLane, "next");
    assert.equal(planning.ambiguity, null);
    assert.ok(
      asStringArray(planning.reasonCodes, "runtime trace planning reason codes").includes(
        "criterion:peripheral_resolution:queue",
      ),
    );

    const semantic = asRecord(traceRecord.semantic, "runtime trace semantic");
    assert.equal(semantic.intentFrame, "failure");
    assert.equal(semantic.activityClass, "tool_failure");
    assert.equal(semantic.toolFamily, "read");
    assert.equal(semantic.consequence, "medium");
    assert.equal(semantic.confidence, "high");
    const ontology = asRecord(semantic.ontology, "runtime trace semantic ontology");
    assert.equal(ontology.activity, "failure");
    assert.equal(ontology.consequence, "medium");
    assert.equal(ontology.source, "explicit");

    const readbackTraceRecord = findRuntimeCandidateTrace(
      traces,
      "evt:product-smoke:edit-applied-readback",
    );
    const readbackEvaluation = asRecord(
      readbackTraceRecord.evaluation,
      "runtime readback trace evaluation",
    );
    const readbackAdjusted = asRecord(
      readbackEvaluation.adjusted,
      "runtime readback trace adjusted candidate",
    );
    assert.equal(readbackAdjusted.priority, "high");
    assert.equal(readbackAdjusted.tone, "critical");
    assert.equal(readbackAdjusted.consequence, "high");
    assert.equal(
      asRecord(readbackAdjusted.responseSpec, "runtime readback response spec").kind,
      "acknowledge",
    );

    const readbackJudgmentInput = asRecord(
      readbackAdjusted.judgmentInput,
      "runtime readback judgment input",
    );
    assert.equal(Object.hasOwn(readbackJudgmentInput, "failureEvidence"), false);
    assert.equal(readbackJudgmentInput.routineObservationalStatusConflict, true);
    const readbackObservation = asRecord(
      readbackJudgmentInput.observation,
      "runtime readback observation",
    );
    assert.equal(readbackObservation.kind, "payload");
    assert.equal(readbackObservation.polarity, "neutral");
    assert.equal(readbackObservation.semanticAgreement, "stable");
    assert.equal(readbackObservation.evidenceLoss, "none");
    assert.equal(readbackObservation.consequenceBaseline, "high");
    const readbackOwnership = asRecord(readbackObservation.ownership, "runtime readback owner");
    assert.equal(readbackOwnership.owner, "tool");
    assert.equal(readbackOwnership.toolFamily, "edit");
    const readbackConflict = asRecord(
      readbackJudgmentInput.observationalStatusConflict,
      "runtime readback observational status conflict",
    );
    assert.equal(readbackConflict.kind, "payload_observation");
    assert.equal(readbackConflict.toolFamily, "edit");
    assert.equal(readbackConflict.baselineConsequence, "high");
  } finally {
    await stopPackagedRuntime(runtime.child);
  }
}

function readCodexHookCommands(rawHooksJson: string): string[] {
  const config = JSON.parse(rawHooksJson) as {
    hooks?: Record<string, Array<{ hooks?: Array<{ command?: unknown }> }>>;
  };

  return Object.values(config.hooks ?? {}).flatMap((entries) =>
    entries.flatMap((entry) =>
      (entry.hooks ?? [])
        .map((hook) => hook.command)
        .filter((command): command is string => typeof command === "string"),
    ),
  );
}

async function main(): Promise<void> {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aperture-product-smoke-"));
  const packDir = path.join(tempRoot, "pack");
  const installDir = path.join(tempRoot, "install");
  const homeDir = path.join(tempRoot, "home");
  const projectDir = path.join(tempRoot, "project");

  await mkdir(packDir, { recursive: true });
  await mkdir(installDir, { recursive: true });
  await mkdir(homeDir, { recursive: true });
  await mkdir(projectDir, { recursive: true });

  try {
    run("pnpm", ["run", "build"], packageRoot);

    const packJson = run(
      "npm",
      ["pack", "--json", "--ignore-scripts", "--pack-destination", packDir],
      packageRoot,
    );
    const jsonStart = packJson.indexOf("[");
    assert.notEqual(jsonStart, -1, "expected npm pack to emit JSON output");
    const packed = JSON.parse(packJson.slice(jsonStart)) as Array<{ filename: string }>;
    const tarballFilename = packed[0]?.filename;
    assert.ok(tarballFilename, "expected npm pack to produce a tarball");

    const tarballPath = path.join(packDir, tarballFilename);
    const isolatedEnv = { HOME: homeDir };
    const globalSettingsPath = path.join(homeDir, ".claude", "settings.json");
    const localSettingsPath = path.join(projectDir, ".claude", "settings.local.json");
    const globalCodexHooksPath = path.join(homeDir, ".codex", "hooks.json");
    const localCodexHooksPath = path.join(projectDir, ".codex", "hooks.json");
    const captureDir = path.join(homeDir, ".aperture", "captures");
    const productStateDir = path.join(homeDir, ".aperture");
    const projectStateDir = path.join(projectDir, ".aperture");

    await writeFile(
      path.join(installDir, "package.json"),
      `${JSON.stringify({ name: "aperture-smoke", private: true }, null, 2)}\n`,
      "utf8",
    );

    run("npm", ["install", tarballPath], installDir);

    const binPath = path.join(installDir, "node_modules", ".bin", "aperture");
    const help = run(binPath, ["help"], installDir, isolatedEnv);
    assert.match(help, /Aperture/);
    assert.match(help, /debug \[topic\]/);
    assert.match(help, /completion <shell>/);
    assert.match(help, /codex/);

    run(binPath, ["claude", "connect", "--global"], installDir, isolatedEnv);
    run(binPath, ["claude", "connect", projectDir], installDir, isolatedEnv);
    run(binPath, ["codex", "connect", "--global"], installDir, isolatedEnv);
    run(binPath, ["codex", "connect", projectDir], installDir, isolatedEnv);
    await mkdir(captureDir, { recursive: true });
    await writeFile(path.join(captureDir, "smoke-bundle.json"), '{\n  "ok": true\n}\n', "utf8");
    await mkdir(projectStateDir, { recursive: true });
    await writeFile(path.join(projectStateDir, "local-state.txt"), "local\n", "utf8");

    const globalSettings = await readFile(globalSettingsPath, "utf8");
    assert.match(globalSettings, /internal hook claude-forward/);
    const localSettings = await readFile(localSettingsPath, "utf8");
    assert.match(localSettings, /internal hook claude-forward/);
    const globalCodexHooks = await readFile(globalCodexHooksPath, "utf8");
    const globalCodexCommands = readCodexHookCommands(globalCodexHooks);
    assert.ok(
      globalCodexCommands.some((command) => command.includes("internal hook codex-forward")),
    );
    assert.ok(
      globalCodexCommands.every((command) =>
        command.includes('--url "http://127.0.0.1:4547/hook"'),
      ),
    );
    const localCodexHooks = await readFile(localCodexHooksPath, "utf8");
    const localCodexCommands = readCodexHookCommands(localCodexHooks);
    assert.ok(
      localCodexCommands.some((command) => command.includes("internal hook codex-forward")),
    );
    assert.ok(
      localCodexCommands.every((command) => command.includes('--url "http://127.0.0.1:4547/hook"')),
    );

    const doctor = run(binPath, ["doctor"], installDir, isolatedEnv);
    assert.match(doctor, /Aperture Doctor/);
    assert.match(doctor, new RegExp(homeDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(doctor, /node_modules\/@tomismeta\/aperture\/dist\/cli\.js/);
    assert.match(doctor, /hooks: installed/);

    const debug = run(binPath, ["debug", "state"], installDir, isolatedEnv);
    assert.match(debug, /Product state/);
    assert.match(debug, /captures:/);
    assert.match(debug, /capture files: 1/);

    const completion = run(binPath, ["completion", "zsh"], installDir, isolatedEnv);
    assert.match(completion, /#compdef aperture/);

    await assertPackagedRuntimeUsesCurrentCore(binPath, installDir, homeDir);

    const uninstallPlan = run(
      binPath,
      ["uninstall", "--project", projectDir],
      installDir,
      isolatedEnv,
    );
    assert.match(uninstallPlan, /Aperture uninstall will remove:/);
    assert.match(uninstallPlan, /settings\.local\.json/);

    const uninstall = run(
      binPath,
      ["uninstall", "--yes", "--project", projectDir],
      installDir,
      isolatedEnv,
    );
    assert.match(uninstall, /Aperture cleanup complete\./);
    assert.equal(
      await pathExists(productStateDir),
      false,
      "expected uninstall to remove ~/.aperture",
    );
    assert.equal(
      await pathExists(projectStateDir),
      false,
      "expected uninstall to remove project .aperture",
    );
    assert.equal(
      await pathExists(globalSettingsPath),
      false,
      "expected uninstall to remove global Claude hook file",
    );
    assert.equal(
      await pathExists(localSettingsPath),
      false,
      "expected uninstall to remove local Claude hook file",
    );
    assert.equal(
      await pathExists(globalCodexHooksPath),
      false,
      "expected uninstall to remove global Codex hook file",
    );
    assert.equal(
      await pathExists(localCodexHooksPath),
      false,
      "expected uninstall to remove local Codex hook file",
    );

    const installedPackage = JSON.parse(
      await readFile(
        path.join(installDir, "node_modules", "@tomismeta", "aperture", "package.json"),
        "utf8",
      ),
    ) as { bin?: Record<string, string>; dependencies?: Record<string, string>; main?: string };
    assert.ok(
      installedPackage.bin?.aperture,
      "expected installed package to expose the aperture bin",
    );
    assert.deepEqual(
      installedPackage.dependencies ?? {},
      {},
      "product package should not declare runtime dependencies",
    );
    assert.equal(
      installedPackage.main,
      undefined,
      "product package should not expose a library main",
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  assert.fail(error instanceof Error ? (error.stack ?? error.message) : String(error));
});
