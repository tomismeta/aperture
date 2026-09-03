import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, "..");
const workspaceRoot = path.resolve(packageRoot, "..", "..");
const options = parseOptions(process.argv.slice(2));
const sourceExtension = path.resolve(
  options.extension ?? path.join(packageRoot, "dist", "aperture-omp-extension.mjs"),
);
const sourceManifest = path.resolve(
  options.manifest ?? path.join(workspaceRoot, "packages", "omp", "omarchy-package.json"),
);
const expectedEvents = [
  "session_start",
  "session_stop",
  "session_shutdown",
  "before_agent_start",
  "agent_start",
  "agent_end",
  "turn_start",
  "turn_end",
  "tool_call",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
  "tool_result",
  "tool_approval_requested",
  "tool_approval_resolved",
  "input",
  "credential_disabled",
].sort();
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "aperture-omp-extension-smoke-"));
try {
  const integrationRoot = path.join(temporaryRoot, "integrations", "omp");
  await mkdir(integrationRoot, { recursive: true });
  const extensionPath = path.join(integrationRoot, "aperture-omp-extension.mjs");
  const manifestPath = path.join(integrationRoot, "package.json");
  await copyFile(sourceExtension, extensionPath);
  await copyFile(sourceManifest, manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    name?: unknown;
    version?: unknown;
    private?: unknown;
    type?: unknown;
    omp?: { extensions?: unknown[] };
  };
  assert.equal(manifest.name, "@tomismeta/aperture-omp");
  assert.equal(manifest.version, "0.1.0");
  assert.equal(manifest.private, true);
  assert.equal(manifest.type, "module");
  assert.deepEqual(manifest.omp?.extensions, ["./aperture-omp-extension.mjs"]);
  // This intentionally loads the runtime-selected staged plugin artifact; a static import would
  // exercise repository source instead of the bundle Omarchy will vendor.

  const loaded = (await import(`${pathToFileURL(extensionPath).href}?smoke=${Date.now()}`)) as {
    default?: unknown;
    createApertureOmarchyOmpExtension?: (
      options: Record<string, unknown>,
    ) => (api: {
      on(
        event: string,
        handler: (
          event: { type: string },
          context: Record<string, unknown>,
        ) => Promise<void> | void,
      ): void;
    }) => Promise<void>;
  };
  assert.equal(typeof loaded.default, "function");
  assert.equal(typeof loaded.createApertureOmarchyOmpExtension, "function");
  const registered: string[] = [];
  const handlers = new Map<
    string,
    (event: { type: string }, context: Record<string, unknown>) => Promise<void> | void
  >();
  const factory = loaded.default as (api: {
    on(
      event: string,
      handler: (event: { type: string }, context: Record<string, unknown>) => Promise<void> | void,
    ): void;
  }) => Promise<void>;
  const senderDirectory = path.join(temporaryRoot, "bin");
  const senderPath = path.join(senderDirectory, "omarchy-notification-send");
  await mkdir(senderDirectory, { recursive: true });
  await writeFile(senderPath, "#!/bin/sh\nexit 0\n", "utf8");
  await chmod(senderPath, 0o755);
  const previousNotifications = process.env.PI_NOTIFICATIONS;
  const previousPath = process.env.PATH;
  process.env.PATH = [senderDirectory, previousPath].filter(Boolean).join(path.delimiter);
  process.env.PI_NOTIFICATIONS = "on";
  try {
    await factory({
      on(event, handler) {
        assert.equal(typeof handler, "function");
        registered.push(event);
        handlers.set(event, handler);
      },
    });
    assert.equal(process.env.PI_NOTIFICATIONS, "off");
    assert.deepEqual(registered.sort(), expectedEvents);
    await handlers.get("session_shutdown")?.({ type: "session_shutdown" }, {});
    assert.equal(process.env.PI_NOTIFICATIONS, "on");
  } finally {
    if (previousNotifications === undefined) delete process.env.PI_NOTIFICATIONS;
    else process.env.PI_NOTIFICATIONS = previousNotifications;
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
  }
  const directEvents: unknown[] = [];
  const directCommands: string[] = [];
  const directHandlers = new Map<
    string,
    (event: { type: string }, context: Record<string, unknown>) => Promise<void> | void
  >();
  process.env.PI_NOTIFICATIONS = "on";
  try {
    const directFactory = loaded.createApertureOmarchyOmpExtension!({
      directTransport: {
        isAvailable: async () => true,
        send: async (event: unknown) => {
          directEvents.push(event);
        },
        close: async () => undefined,
      },
      availabilityCheck: async () => true,
      commandRunner: async (command: string) => {
        directCommands.push(command);
        return { stdout: command === "omarchy-notification-send" ? "99\n" : "", stderr: "" };
      },
    });
    await directFactory({ on: (event, handler) => directHandlers.set(event, handler) });
    await directHandlers.get("tool_approval_requested")?.(
      {
        type: "tool_approval_requested",
        sessionId: "session-smoke",
        toolCallId: "tool-smoke",
        toolName: "bash",
        approvalMode: "write",
      },
      { sessionManager: { sessionId: "session-smoke" } },
    );
    await directHandlers.get("session_shutdown")?.(
      { type: "session_shutdown" },
      { sessionManager: { sessionId: "session-smoke" } },
    );
    assert.equal(directEvents.length, 2);
    assert.equal(directCommands.includes("omarchy-notification-send"), false);
    assert.equal(process.env.PI_NOTIFICATIONS, "on");
  } finally {
    if (previousNotifications === undefined) delete process.env.PI_NOTIFICATIONS;
    else process.env.PI_NOTIFICATIONS = previousNotifications;
  }
  const fallbackCommands: string[] = [];
  const fallbackHandlers = new Map<
    string,
    (event: { type: string }, context: Record<string, unknown>) => Promise<void> | void
  >();
  process.env.PI_NOTIFICATIONS = "on";
  try {
    const fallbackFactory = loaded.createApertureOmarchyOmpExtension!({
      directTransport: {
        isAvailable: async () => true,
        send: async () => {
          throw new Error("direct transport unavailable");
        },
        close: async () => undefined,
      },
      availabilityCheck: async () => true,
      commandRunner: async (command: string) => {
        fallbackCommands.push(command);
        return { stdout: command === "omarchy-notification-send" ? "100\n" : "", stderr: "" };
      },
    });
    await fallbackFactory({ on: (event, handler) => fallbackHandlers.set(event, handler) });
    await fallbackHandlers.get("tool_approval_requested")?.(
      {
        type: "tool_approval_requested",
        sessionId: "session-fallback",
        toolCallId: "tool-fallback",
        toolName: "bash",
        approvalMode: "write",
      },
      { sessionManager: { sessionId: "session-fallback" } },
    );
    await fallbackHandlers.get("session_shutdown")?.(
      { type: "session_shutdown" },
      { sessionManager: { sessionId: "session-fallback" } },
    );
    assert.equal(fallbackCommands.includes("omarchy-notification-send"), true);
    assert.equal(process.env.PI_NOTIFICATIONS, "on");
  } finally {
    if (previousNotifications === undefined) delete process.env.PI_NOTIFICATIONS;
    else process.env.PI_NOTIFICATIONS = previousNotifications;
  }
  const content = await readFile(extensionPath);
  const report = {
    schemaVersion: 1,
    proofId: "aperture-omp-adapter-conformance-v1",
    passed: true,
    runtime: "omp-extension-module",
    nodeVersion: process.versions.node,
    bundle: {
      sha256: createHash("sha256").update(content).digest("hex"),
      bytes: (await stat(extensionPath)).size,
    },
    cleanDirectoryWithoutNodeModules: true,
    manifest: {
      name: manifest.name,
      extension: manifest.omp?.extensions?.[0],
    },
    registeredEvents: registered,
    sourceTest: "packages/omp/test/omp-adapter.test.ts",
    decisions: {
      builtInNotifications: "suppressed-process-locally-when-transport-available",
      identicalReplacement: "native-id-reuse-without-artificial-update",
      sessionShutdown: "close-persistent-approval-and-input-only",
      credentialDisabled: "deterministic-typed-event-proof",
      directTransport: "acknowledged-direct-suppresses-native",
      nativeFallback: "direct-failure-restores-native",
      deliveryScheduling: "non-blocking-bounded-queue",
    },
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
  extension?: string;
  manifest?: string;
  report?: string;
};

function parseOptions(args: string[]): SmokeOptions {
  const parsed: SmokeOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") continue;
    if (argument === "--extension" || argument === "--manifest" || argument === "--report") {
      const value = args[index + 1];
      if (!value) throw new Error(`${argument} requires a path`);
      if (argument === "--extension") parsed.extension = value;
      else if (argument === "--manifest") parsed.manifest = value;
      else parsed.report = value;
      index += 1;
      continue;
    }
    throw new Error(`unknown OMP extension smoke option: ${argument ?? "(missing)"}`);
  }
  return parsed;
}
