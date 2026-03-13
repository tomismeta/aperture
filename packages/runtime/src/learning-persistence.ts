import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  ApertureCore,
  serializeJudgmentConfig,
  MARKDOWN_SCHEMA_VERSION,
  ProfileStore,
  type JudgmentConfig,
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
    await writeFile(judgmentPath, serializeJudgmentConfig(defaultJudgmentConfig(now)), "utf8");
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

function defaultJudgmentConfig(updatedAt: string): JudgmentConfig {
  return {
    version: MARKDOWN_SCHEMA_VERSION,
    updatedAt,
    policy: {
      lowRiskRead: {
        mayInterrupt: false,
        minimumPresentation: "ambient",
      },
      envWrite: {
        mayInterrupt: true,
        minimumPresentation: "active",
        requireContextExpansion: true,
      },
      destructiveBash: {
        mayInterrupt: true,
        minimumPresentation: "active",
        requireContextExpansion: true,
      },
    },
    plannerDefaults: {
      batchStatusBursts: true,
      deferLowValueDuringPressure: true,
    },
  };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const result = await stat(path);
    return result.isFile();
  } catch {
    return false;
  }
}
