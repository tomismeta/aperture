import { mkdir, stat } from "node:fs/promises";
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
  const memoryProfile = await profileStore.loadMemoryProfile(fallback);
  if (!exists) {
    await profileStore.saveMemoryProfile(memoryProfile);
  }

  return {
    core: new ApertureCore({
      memoryProfile,
      profileStore,
      markdownRootDir: rootDir,
    }),
    state: {
      enabled: true,
      rootDir,
      memoryPath,
      lastLoadedAt: now,
      lastCheckpointAt: null,
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
