import { readdir, stat } from "node:fs/promises";
import path, { resolve } from "node:path";
import { stdout } from "node:process";
import packageMetadata from "../../package.json" with { type: "json" };

import { discoverLocalRuntimes, type ApertureRuntimeSnapshot } from "@aperture/runtime";

import {
  apertureCaptureDir,
  apertureHomeDir,
  apertureLearningWorkspaceRoot,
  globalOpencodeConfigPath,
  listGlobalOpencodeProfiles,
  type OpencodeConnectionProfile,
} from "../opencode-config.js";
import {
  buildClaudeHookCommand,
  countApertureHookEntries,
  readSettings,
  resolveClaudeSettingsPath,
} from "./claude-hooks.js";
import { type OpencodeProfileProbeResult, probeOpencodeProfiles } from "./opencode-support.js";
import { formatBytes, pathExists } from "./shared.js";
import { fetchRuntimeSnapshot } from "./runtime-support.js";

export type DebugTopic = "all" | "runtime" | "claude" | "opencode" | "state" | "capture";

type DebugCaptureArtifact = {
  name: string;
  sizeBytes: number;
  modifiedAt: string;
};

type DebugSnapshot = {
  dataDir: string;
  captureDir: string;
  learningRoot: string;
  globalClaudeSettingsPath: string;
  globalClaudeHookCount: number;
  localClaudeSettingsPath: string;
  localClaudeHookCount: number;
  allProfiles: OpencodeConnectionProfile[];
  enabledProfiles: OpencodeConnectionProfile[];
  opencodeStatus: OpencodeProfileProbeResult;
  runtimes: Awaited<ReturnType<typeof discoverLocalRuntimes>>;
  primaryRuntimeUrl: string | null;
  runtimeSnapshot: ApertureRuntimeSnapshot | null;
  runtimeSnapshotError: string | null;
  recentCaptureArtifacts: DebugCaptureArtifact[];
};

export async function runDoctor(command: string): Promise<void> {
  const dataDir = apertureHomeDir();
  const captureDir = apertureCaptureDir();
  const learningRoot = resolve(apertureLearningWorkspaceRoot(), ".aperture");
  const settingsPath = resolveClaudeSettingsPath(true);
  const claudeSettings = await readSettings(settingsPath);
  const claudeHookCount = countApertureHookEntries(claudeSettings);
  const allProfiles = await listGlobalOpencodeProfiles();
  const enabledProfiles = allProfiles.filter((profile) => profile.enabled);
  const runtimes = await discoverLocalRuntimes({ kind: "aperture" });
  const opencodeStatus = await probeOpencodeProfiles(enabledProfiles);

  const lines = [
    "Aperture Doctor",
    "The live attention surface for humans working with agents.",
    "",
    "Product state",
    `  data dir: ${dataDir}`,
    `  captures: ${captureDir}`,
    `  learning state: ${learningRoot}`,
    `  OpenCode config: ${globalOpencodeConfigPath()}`,
    "",
    "Claude Code",
    `  hooks: ${claudeHookCount > 0 ? `installed (${claudeHookCount})` : "not installed"}`,
    `  settings: ${settingsPath}`,
    `  command: ${command}`,
    "",
    "OpenCode",
    `  profiles: ${enabledProfiles.length}/${allProfiles.length} enabled`,
    `  status: ${opencodeStatus.detail}`,
    ...(opencodeStatus.hint ? [`  hint: ${opencodeStatus.hint}`] : []),
    "",
    "Runtime",
    `  live runtimes: ${runtimes.length}`,
    ...runtimes.map((runtime) => `  - ${runtime.controlUrl} (pid ${runtime.pid})`),
  ];

  if (claudeHookCount === 0) {
    lines.push(
      "",
      "Suggested next steps",
      "  1. Run `aperture` to install Claude hooks and boot the product.",
    );
  } else if (enabledProfiles.length === 0) {
    lines.push(
      "",
      "Suggested next steps",
      "  1. Start Aperture with `aperture`.",
      "  2. Start OpenCode with `opencode serve --port 4096`, then `opencode attach http://127.0.0.1:4096`.",
    );
  }

  stdout.write(`${lines.join("\n")}\n`);
}

export async function collectDebugSnapshot(): Promise<DebugSnapshot> {
  const dataDir = apertureHomeDir();
  const captureDir = apertureCaptureDir();
  const learningRoot = resolve(apertureLearningWorkspaceRoot(), ".aperture");
  const globalClaudeSettingsPath = resolveClaudeSettingsPath(true);
  const localClaudeSettingsPath = resolveClaudeSettingsPath(false, process.cwd());
  const [globalClaudeSettings, localClaudeSettings, allProfiles, runtimes, recentCaptureArtifacts] =
    await Promise.all([
      readSettings(globalClaudeSettingsPath),
      readSettings(localClaudeSettingsPath),
      listGlobalOpencodeProfiles(),
      discoverLocalRuntimes({ kind: "aperture" }),
      listRecentCaptureArtifacts(captureDir),
    ]);
  const enabledProfiles = allProfiles.filter((profile) => profile.enabled);
  const opencodeStatus = await probeOpencodeProfiles(enabledProfiles);
  const primaryRuntimeUrl = runtimes[0]?.controlUrl?.replace(/\/+$/, "") ?? null;

  let runtimeSnapshot: ApertureRuntimeSnapshot | null = null;
  let runtimeSnapshotError: string | null = null;
  if (primaryRuntimeUrl) {
    try {
      runtimeSnapshot = await fetchRuntimeSnapshot(primaryRuntimeUrl);
    } catch (error) {
      runtimeSnapshotError = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    dataDir,
    captureDir,
    learningRoot,
    globalClaudeSettingsPath,
    globalClaudeHookCount: countApertureHookEntries(globalClaudeSettings),
    localClaudeSettingsPath,
    localClaudeHookCount: countApertureHookEntries(localClaudeSettings),
    allProfiles,
    enabledProfiles,
    opencodeStatus,
    runtimes,
    primaryRuntimeUrl,
    runtimeSnapshot,
    runtimeSnapshotError,
    recentCaptureArtifacts,
  };
}

export function printDebugSnapshot(
  snapshot: DebugSnapshot,
  topic: DebugTopic,
  command: string,
): void {
  const sections: string[] = [
    "Aperture Debug",
    "Support details for runtime, integrations, and local product state.",
    "",
    "Version",
    `  aperture: ${packageMetadata.version}`,
    `  node: ${process.version}`,
    `  cwd: ${process.cwd()}`,
    "",
  ];

  const include = (name: Exclude<DebugTopic, "all">) => topic === "all" || topic === name;

  if (include("state")) {
    sections.push(
      "Product state",
      `  data dir: ${snapshot.dataDir}`,
      `  captures: ${snapshot.captureDir}`,
      `  learning state: ${snapshot.learningRoot}`,
      `  capture files: ${snapshot.recentCaptureArtifacts.length}`,
      "",
    );
  }

  if (include("claude")) {
    sections.push(
      "Claude Code",
      `  global hooks: ${snapshot.globalClaudeHookCount > 0 ? `installed (${snapshot.globalClaudeHookCount})` : "not installed"}`,
      `  global settings: ${snapshot.globalClaudeSettingsPath}`,
      `  local hooks in cwd: ${snapshot.localClaudeHookCount > 0 ? `installed (${snapshot.localClaudeHookCount})` : "not installed"}`,
      `  local settings: ${snapshot.localClaudeSettingsPath}`,
      `  command: ${command}`,
      "",
    );
  }

  if (include("opencode")) {
    sections.push(
      "OpenCode",
      `  profiles: ${snapshot.enabledProfiles.length}/${snapshot.allProfiles.length} enabled`,
      `  status: ${snapshot.opencodeStatus.detail}`,
      ...(snapshot.opencodeStatus.hint ? [`  hint: ${snapshot.opencodeStatus.hint}`] : []),
      ...snapshot.allProfiles.map(
        (profile) =>
          `  - ${profile.id}${profile.enabled ? " [enabled]" : " [disabled]"} -> ${profile.baseUrl}${profile.label ? ` (${profile.label})` : ""}`,
      ),
      "",
    );
  }

  if (include("runtime")) {
    sections.push(
      "Runtime",
      `  live runtimes: ${snapshot.runtimes.length}`,
      ...(snapshot.primaryRuntimeUrl ? [`  primary: ${snapshot.primaryRuntimeUrl}`] : []),
      ...snapshot.runtimes.map((runtime) => `  - ${runtime.controlUrl} (pid ${runtime.pid})`),
    );

    if (snapshot.runtimeSnapshot) {
      const topRoute = snapshot.runtimeSnapshot.health.telemetry.routes[0];
      sections.push(
        `  surfaces: ${snapshot.runtimeSnapshot.surfaceCount}`,
        `  adapters: ${snapshot.runtimeSnapshot.adapters.length}`,
        `  attention: now ${snapshot.runtimeSnapshot.attentionView.now ? 1 : 0} · next ${snapshot.runtimeSnapshot.attentionView.next.length} · ambient ${snapshot.runtimeSnapshot.attentionView.ambient.length}`,
        `  recent signals: ${snapshot.runtimeSnapshot.signalSummary.recentSignals}`,
        `  lifetime signals: ${snapshot.runtimeSnapshot.signalSummary.lifetimeSignals}`,
        `  requests: ${snapshot.runtimeSnapshot.health.telemetry.totalRequests} total · ${snapshot.runtimeSnapshot.health.telemetry.failedRequests} failed · ${snapshot.runtimeSnapshot.health.telemetry.activeRequests} active`,
        ...(topRoute
          ? [
              `  top route: ${topRoute.name} ${topRoute.method} · ${topRoute.requests} req · avg ${topRoute.averageDurationMs ?? 0} ms`,
            ]
          : []),
        ...(snapshot.runtimeSnapshot.health.telemetry.lastErrorCode
          ? [
              `  last route error: ${snapshot.runtimeSnapshot.health.telemetry.lastErrorCode} at ${snapshot.runtimeSnapshot.health.telemetry.lastErrorAt}`,
            ]
          : []),
        ...snapshot.runtimeSnapshot.adapters.map(
          (adapter) =>
            `  - ${adapter.kind}${adapter.label ? ` (${adapter.label})` : ""} · last seen ${adapter.lastSeenAt}`,
        ),
      );
    } else if (snapshot.runtimeSnapshotError) {
      sections.push(`  snapshot error: ${snapshot.runtimeSnapshotError}`);
    }

    sections.push("");
  }

  if (include("capture")) {
    sections.push(
      "Capture",
      `  directory: ${snapshot.captureDir}`,
      ...(snapshot.recentCaptureArtifacts.length === 0
        ? ["  recent files: none"]
        : [
            "  recent files:",
            ...snapshot.recentCaptureArtifacts.map(
              (artifact) =>
                `  - ${artifact.name} · ${formatBytes(artifact.sizeBytes)} · ${artifact.modifiedAt}`,
            ),
          ]),
      "",
    );
  }

  stdout.write(`${sections.join("\n").replace(/\n+$/, "\n")}`);
}

async function listRecentCaptureArtifacts(directory: string): Promise<DebugCaptureArtifact[]> {
  if (!(await pathExists(directory))) {
    return [];
  }

  const entries = await readdir(directory, { withFileTypes: true });
  const captures = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        const absolutePath = path.join(directory, entry.name);
        const metadata = await stat(absolutePath);
        return {
          name: entry.name,
          sizeBytes: metadata.size,
          modifiedAt: metadata.mtime.toISOString(),
        } satisfies DebugCaptureArtifact;
      }),
  );

  return captures
    .sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt))
    .slice(0, 5);
}

export function buildDoctorDebugCommand(cliEntryPath: string, cliRepoRoot: string): string {
  return buildClaudeHookCommand(cliEntryPath, cliRepoRoot);
}
