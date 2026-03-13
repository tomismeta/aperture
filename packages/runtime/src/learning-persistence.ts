import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  ApertureCore,
  ProfileStore,
  type MemoryProfile,
} from "@aperture/core";

export type LearningMode = "on" | "off";

export type LearningPersistenceState = {
  enabled: boolean;
  rootDir?: string;
  memoryPath?: string;
  judgmentPath?: string;
  lastLoadedAt?: string;
  lastCheckpointAt?: string | null;
};

// Keep this in sync with the persisted profile schema expected by core.
const PERSISTED_PROFILE_SCHEMA_VERSION = 1;

export async function bootstrapLearningPersistence(
  cwd: string,
): Promise<{
  core: ApertureCore;
  state: LearningPersistenceState;
}> {
  const rootDir = join(cwd, ".aperture");
  const memoryPath = join(rootDir, "MEMORY.md");
  const judgmentPath = join(rootDir, "JUDGMENT.md");
  const profileStore = new ProfileStore(rootDir);
  const now = new Date().toISOString();

  await mkdir(rootDir, { recursive: true });

  const fallback: MemoryProfile = {
    version: PERSISTED_PROFILE_SCHEMA_VERSION,
    operatorId: "default",
    updatedAt: now,
    sessionCount: 0,
  };

  const exists = await fileExists(memoryPath);
  if (!exists) {
    await profileStore.saveMemoryProfile(fallback);
  }

  const judgmentExists = await fileExists(judgmentPath);
  if (!judgmentExists) {
    await writeFile(judgmentPath, defaultJudgmentTemplate(now), "utf8");
  }

  return {
    core: await ApertureCore.fromMarkdown(rootDir),
    state: {
      enabled: true,
      rootDir,
      memoryPath,
      judgmentPath,
      lastLoadedAt: now,
      lastCheckpointAt: null,
    },
  };
}

function defaultJudgmentTemplate(updatedAt: string): string {
  return [
    "# Judgment",
    "",
    "Human-owned attention policy for Aperture.",
    "",
    "Only use the accepted values described below. Aperture reads this file at startup",
    "and can reload it later, but it will not rewrite your policy choices.",
    "",
    "## Meta",
    `- version: ${PERSISTED_PROFILE_SCHEMA_VERSION}`,
    `- updated at: ${updatedAt}`,
    "",
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
    "- minimum presentation: ambient | queue | active",
    "- require context expansion: true | false",
    "",
    "If a category uses auto approve, Aperture resolves that approval immediately",
    "instead of surfacing it. Otherwise operator-response work should stay active.",
    "The default scaffold is conservative: ratchet categories down to auto approve",
    "only after you trust that behavior.",
    "",
    "### lowRiskRead",
    "- may interrupt: true",
    "- minimum presentation: active",
    "",
    "### lowRiskWeb",
    "- may interrupt: true",
    "- minimum presentation: active",
    "",
    "### fileWrite",
    "- may interrupt: true",
    "- minimum presentation: active",
    "",
    "### envWrite",
    "- may interrupt: true",
    "- minimum presentation: active",
    "- require context expansion: true",
    "",
    "### destructiveBash",
    "- may interrupt: true",
    "- minimum presentation: active",
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
    "",
  ].join("\n");
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const result = await stat(path);
    return result.isFile();
  } catch {
    return false;
  }
}
