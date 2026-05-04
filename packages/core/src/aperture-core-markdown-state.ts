import type { AttentionSignal } from "./interaction-signal.js";
import { loadPolicyConfig, type PolicyConfig } from "./policy-config.js";
import { MARKDOWN_SCHEMA_VERSION } from "./judgment-defaults.js";
import { distillMemoryProfile } from "./memory-aggregator.js";
import { ProfileStore, type MemoryProfile, type ApertureProfile } from "./profile-store.js";
import { formatTimestamp } from "./time.js";

export type LoadedMarkdownRuntimeState = {
  profileStore: ProfileStore;
  markdownRootDir: string;
  apertureProfile: ApertureProfile;
  memoryProfile: MemoryProfile;
  policyConfig: PolicyConfig;
};

export type ReloadMarkdownRuntimeOptions = {
  profileStore: ProfileStore;
  markdownRootDir: string;
  apertureProfile: ApertureProfile | undefined;
  memoryProfile: MemoryProfile;
  policyConfig: PolicyConfig | undefined;
};

export type ReloadedMarkdownRuntimeState = {
  apertureProfile: ApertureProfile;
  memoryProfile: MemoryProfile;
  policyConfig: PolicyConfig;
};

export async function loadMarkdownRuntimeState(
  rootDir: string,
): Promise<LoadedMarkdownRuntimeState> {
  const profileStore = new ProfileStore(rootDir);
  const [apertureProfile, memoryProfile, policyConfig] = await Promise.all([
    profileStore.loadApertureProfile(defaultApertureProfile()),
    profileStore.loadMemoryProfile(defaultMemoryProfile()),
    loadPolicyConfig(rootDir, defaultPolicyConfig()),
  ]);

  return {
    profileStore,
    markdownRootDir: rootDir,
    apertureProfile,
    memoryProfile,
    policyConfig,
  };
}

export async function reloadMarkdownRuntimeState(
  options: ReloadMarkdownRuntimeOptions,
): Promise<ReloadedMarkdownRuntimeState> {
  const [apertureProfile, memoryProfile, policyConfig] = await Promise.all([
    options.profileStore.loadApertureProfile(options.apertureProfile ?? defaultApertureProfile()),
    options.profileStore.loadMemoryProfile(options.memoryProfile),
    loadPolicyConfig(options.markdownRootDir, options.policyConfig ?? defaultPolicyConfig()),
  ]);

  return {
    apertureProfile,
    memoryProfile,
    policyConfig,
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

function defaultApertureProfile(): ApertureProfile {
  return {
    version: MARKDOWN_SCHEMA_VERSION,
    operatorId: "default",
    updatedAt: formatTimestamp(0),
  };
}

function defaultMemoryProfile(): MemoryProfile {
  return {
    version: MARKDOWN_SCHEMA_VERSION,
    operatorId: "default",
    updatedAt: formatTimestamp(0),
    sessionCount: 0,
  };
}

function defaultPolicyConfig(): PolicyConfig {
  return {
    version: MARKDOWN_SCHEMA_VERSION,
    updatedAt: formatTimestamp(0),
  };
}
