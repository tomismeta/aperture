import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { ApertureCore } from "@tomismeta/aperture-core";
import {
  APERTURE_STATE_SCHEMA_VERSION,
  ProfileStore,
  type MemoryProfile,
} from "@tomismeta/aperture-core/internal";

export type LearningMode = "on" | "off";

export type LearningPersistenceState = {
  enabled: boolean;
  rootDir?: string;
  memoryPath?: string;
  aperturePath?: string;
  lastLoadedAt?: string;
  lastCheckpointAt?: string | null;
};

export async function bootstrapLearningPersistence(cwd: string): Promise<{
  core: ApertureCore;
  state: LearningPersistenceState;
}> {
  const rootDir = join(cwd, ".aperture");
  const memoryPath = join(rootDir, "MEMORY.md");
  const aperturePath = join(rootDir, "APERTURE.md");
  const profileStore = new ProfileStore(rootDir);
  const now = new Date().toISOString();

  await mkdir(rootDir, { recursive: true });

  const fallback: MemoryProfile = {
    version: APERTURE_STATE_SCHEMA_VERSION,
    operatorId: "default",
    updatedAt: now,
    sessionCount: 0,
  };

  const exists = await fileExists(memoryPath);
  if (!exists) {
    await profileStore.saveMemoryProfile(fallback);
  }

  const apertureExists = await fileExists(aperturePath);
  if (!apertureExists) {
    await writeFile(aperturePath, buildApertureTemplate(now), "utf8");
  }

  return {
    core: await ApertureCore.fromMarkdown(rootDir),
    state: {
      enabled: true,
      rootDir,
      memoryPath,
      aperturePath,
      lastLoadedAt: now,
      lastCheckpointAt: null,
    },
  };
}

function buildApertureTemplate(now: string): string {
  return [
    "# Aperture",
    "",
    "Human-owned configuration for Aperture.",
    "",
    "Aperture reads this file at startup and can reload it later, but it will",
    "not rewrite your choices. Keep learned behavior in MEMORY.md.",
    "",
    "## Meta",
    `- version: ${APERTURE_STATE_SCHEMA_VERSION}`,
    "- profile id: default",
    `- updated at: ${now}`,
    "",
    ...defaultPreferenceSections(),
    "",
    ...defaultPolicySections(),
    "",
  ].join("\n");
}

function defaultPreferenceSections(): string[] {
  return [
    "## Preferences",
    "",
    "Friendly controls should stay scarce. Prefer Control Mode before adding",
    "one-off toggles.",
    "",
    "Accepted fields:",
    "- control mode: hands-on | standard | focus",
    "",
    "Control mode changes Aperture's default posture:",
    "- hands-on: ask sooner and keep configured auto-approval visible",
    "- standard: balanced deterministic routing",
    "- focus: ask later for non-blocking work so the current task stays quiet",
    "",
    "- control mode: standard",
  ];
}

function defaultPolicySections(): string[] {
  return [
    "## Policy",
    "",
    "Policy rules map named interaction categories to deterministic handling.",
    "",
    "Accepted rule names today:",
    "- lowRiskRead",
    "- lowRiskWeb",
    "- fileWrite",
    "- envWrite",
    "- destructiveBash",
    "",
    "Accepted fields:",
    "- auto approve: true | false",
    "- may interrupt: true | false",
    "- minimum lane: ambient | next | now",
    "- require context expansion: true | false",
    "",
    "If a category uses auto approve, Aperture resolves that approval immediately",
    "instead of surfacing it. Otherwise operator-response work should stay in the now lane.",
    "The default scaffold is conservative: ratchet categories down to auto approve",
    "only after you trust that behavior.",
    "",
    "### lowRiskRead",
    "- may interrupt: true",
    "- minimum lane: now",
    "",
    "### lowRiskWeb",
    "- may interrupt: true",
    "- minimum lane: now",
    "",
    "### fileWrite",
    "- may interrupt: true",
    "- minimum lane: now",
    "",
    "### envWrite",
    "- may interrupt: true",
    "- minimum lane: now",
    "- require context expansion: true",
    "",
    "### destructiveBash",
    "- may interrupt: true",
    "- minimum lane: now",
    "- require context expansion: true",
    "",
    "## Planner Defaults",
    "",
    "Planner defaults are coarse switches for queue behavior.",
    "",
    "Accepted fields:",
    "- batch status bursts: true | false",
    "- defer low value during pressure: true | false",
    "",
    "- batch status bursts: true",
    "- defer low value during pressure: true",
  ];
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const result = await stat(path);
    return result.isFile();
  } catch {
    return false;
  }
}
