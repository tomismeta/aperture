import type { AttentionOperatorPresence } from "./attention-evidence.js";
import { JudgmentCoordinator } from "./judgment-coordinator.js";
import { MARKDOWN_SCHEMA_VERSION } from "./judgment-defaults.js";
import type { JudgmentConfig } from "./judgment-config.js";
import { AttentionPolicy } from "./attention-policy.js";
import { AttentionPlanner } from "./attention-planner.js";
import { AttentionValue } from "./attention-value.js";
import type { MemoryProfile, UserProfile } from "./profile-store.js";
import {
  baseAttentionSurfaceCapabilities,
  type AttentionSurfaceCapabilities,
} from "./surface-capabilities.js";
import { formatTimestamp, type TimeSource } from "./time.js";

export type ApertureCoreRuntimeSetupOptions = {
  userProfile?: UserProfile;
  memoryProfile?: MemoryProfile;
  judgmentConfig?: JudgmentConfig;
  surfaceCapabilities?: AttentionSurfaceCapabilities;
  operatorPresence?: AttentionOperatorPresence;
  responseExpiryMs?: number;
  timeSource?: TimeSource;
};

export type ApertureCoreRuntimeSetupState = {
  userProfile: UserProfile | undefined;
  baseMemoryProfile: MemoryProfile;
  judgmentConfig: JudgmentConfig | undefined;
  surfaceCapabilities: AttentionSurfaceCapabilities;
  operatorPresence: AttentionOperatorPresence;
  responseExpiryMs: number | undefined;
  timeSource: TimeSource;
};

/**
 * Constructor/setup helpers stay separate from the live publish path so
 * ApertureCore can keep reading as the runtime conductor.
 */
export function normalizeApertureCoreRuntimeSetup(
  options: ApertureCoreRuntimeSetupOptions = {},
): ApertureCoreRuntimeSetupState {
  return {
    userProfile: options.userProfile,
    baseMemoryProfile: options.memoryProfile ?? defaultMemoryProfile(),
    judgmentConfig: options.judgmentConfig,
    surfaceCapabilities: cloneSurfaceCapabilities(options.surfaceCapabilities),
    operatorPresence: options.operatorPresence ?? "present",
    responseExpiryMs: options.responseExpiryMs,
    timeSource: options.timeSource ?? Date.now,
  };
}

export function buildApertureCoordinator(
  state: Pick<
    ApertureCoreRuntimeSetupState,
    "userProfile" | "baseMemoryProfile" | "judgmentConfig"
  >,
): JudgmentCoordinator {
  return new JudgmentCoordinator(
    new AttentionPolicy({
      ...(state.userProfile !== undefined ? { userProfile: state.userProfile } : {}),
      ...(state.judgmentConfig !== undefined ? { judgmentConfig: state.judgmentConfig } : {}),
      memoryProfile: state.baseMemoryProfile,
    }),
    new AttentionValue({
      memoryProfile: state.baseMemoryProfile,
    }),
    new AttentionPlanner({
      ...(state.judgmentConfig?.plannerDefaults !== undefined
        ? { plannerDefaults: state.judgmentConfig.plannerDefaults }
        : {}),
    }),
  );
}

export function cloneSurfaceCapabilities(
  capabilities?: AttentionSurfaceCapabilities,
): AttentionSurfaceCapabilities {
  const source = capabilities ?? baseAttentionSurfaceCapabilities;
  return {
    topology: { ...source.topology },
    responses: { ...source.responses },
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
