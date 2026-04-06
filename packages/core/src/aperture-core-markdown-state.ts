import type { AttentionSignal } from "./interaction-signal.js";
import { loadJudgmentConfig, type JudgmentConfig } from "./judgment-config.js";
import { MARKDOWN_SCHEMA_VERSION } from "./judgment-defaults.js";
import { distillMemoryProfile } from "./memory-aggregator.js";
import { ProfileStore, type MemoryProfile, type UserProfile } from "./profile-store.js";

export type LoadedMarkdownRuntimeState = {
  profileStore: ProfileStore;
  markdownRootDir: string;
  userProfile: UserProfile;
  memoryProfile: MemoryProfile;
  judgmentConfig: JudgmentConfig;
};

export type ReloadMarkdownRuntimeOptions = {
  profileStore: ProfileStore;
  markdownRootDir: string;
  userProfile: UserProfile | undefined;
  memoryProfile: MemoryProfile;
  judgmentConfig: JudgmentConfig | undefined;
};

export type ReloadedMarkdownRuntimeState = {
  userProfile: UserProfile;
  memoryProfile: MemoryProfile;
  judgmentConfig: JudgmentConfig;
};

export async function loadMarkdownRuntimeState(
  rootDir: string,
): Promise<LoadedMarkdownRuntimeState> {
  const profileStore = new ProfileStore(rootDir);
  const [userProfile, memoryProfile, judgmentConfig] = await Promise.all([
    profileStore.loadUserProfile(defaultUserProfile()),
    profileStore.loadMemoryProfile(defaultMemoryProfile()),
    loadJudgmentConfig(rootDir, defaultJudgmentConfig()),
  ]);

  return {
    profileStore,
    markdownRootDir: rootDir,
    userProfile,
    memoryProfile,
    judgmentConfig,
  };
}

export async function reloadMarkdownRuntimeState(
  options: ReloadMarkdownRuntimeOptions,
): Promise<ReloadedMarkdownRuntimeState> {
  const [userProfile, memoryProfile, judgmentConfig] = await Promise.all([
    options.profileStore.loadUserProfile(options.userProfile ?? defaultUserProfile()),
    options.profileStore.loadMemoryProfile(options.memoryProfile),
    loadJudgmentConfig(
      options.markdownRootDir,
      options.judgmentConfig ?? defaultJudgmentConfig(),
    ),
  ]);

  return {
    userProfile,
    memoryProfile,
    judgmentConfig,
  };
}

export async function checkpointMarkdownMemoryProfile(options: {
  profileStore: ProfileStore | undefined;
  memoryProfile: MemoryProfile;
  signals: AttentionSignal[];
  now: string;
}): Promise<MemoryProfile | null> {
  if (!options.profileStore) {
    return null;
  }

  const snapshot = distillMemoryProfile(options.memoryProfile, options.signals, options.now);
  await options.profileStore.saveMemoryProfile(snapshot);
  return snapshot;
}

function defaultUserProfile(): UserProfile {
  return {
    version: MARKDOWN_SCHEMA_VERSION,
    operatorId: "default",
    updatedAt: new Date(0).toISOString(),
  };
}

function defaultMemoryProfile(): MemoryProfile {
  return {
    version: MARKDOWN_SCHEMA_VERSION,
    operatorId: "default",
    updatedAt: new Date(0).toISOString(),
    sessionCount: 0,
  };
}

function defaultJudgmentConfig(): JudgmentConfig {
  return {
    version: MARKDOWN_SCHEMA_VERSION,
    updatedAt: new Date(0).toISOString(),
  };
}
