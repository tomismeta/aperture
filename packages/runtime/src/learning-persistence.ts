import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  ApertureCore,
  MARKDOWN_SCHEMA_VERSION,
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
    version: MARKDOWN_SCHEMA_VERSION,
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
    `- version: ${MARKDOWN_SCHEMA_VERSION}`,
    `- updated at: ${updatedAt}`,
    "",
    "## Policy",
    "",
    "Policy rules map named interaction categories to deterministic handling.",
    "",
    "Accepted rule names today:",
    "- lowRiskRead",
    "- envWrite",
    "- destructiveBash",
    "",
    "Accepted fields:",
    "- may interrupt: true | false",
    "- minimum presentation: ambient | queue | active",
    "- require context expansion: true | false",
    "",
    "Operator-response work should stay active until Aperture supports explicit",
    "auto-approval for that category.",
    "",
    "### lowRiskRead",
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
