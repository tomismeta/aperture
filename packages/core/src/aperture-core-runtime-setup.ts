import type { AttentionOperatorPresence } from "./attention-evidence.js";
import { JudgmentCoordinator } from "./judgment-coordinator.js";
import { MARKDOWN_SCHEMA_VERSION } from "./judgment-defaults.js";
import type { PolicyConfig } from "./policy-config.js";
import { AttentionPolicy } from "./attention-policy.js";
import { AttentionPlanner } from "./attention-planner.js";
import { AttentionValue } from "./attention-value.js";
import type { MemoryProfile, ApertureProfile } from "./profile-store.js";
import {
  baseAttentionSurfaceCapabilities,
  type AttentionSurfaceCapabilities,
} from "./surface-capabilities.js";
import { formatTimestamp, type TimeSource } from "./time.js";

export type ApertureCoreRuntimeSetupOptions = {
  apertureProfile?: ApertureProfile;
  memoryProfile?: MemoryProfile;
  policyConfig?: PolicyConfig;
  surfaceCapabilities?: AttentionSurfaceCapabilities;
  operatorPresence?: AttentionOperatorPresence;
  responseExpiryMs?: number;
  timeSource?: TimeSource;
};

export type ApertureCoreRuntimeSetupState = {
  apertureProfile: ApertureProfile | undefined;
  baseMemoryProfile: MemoryProfile;
  policyConfig: PolicyConfig | undefined;
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
    apertureProfile: options.apertureProfile,
    baseMemoryProfile: options.memoryProfile ?? defaultMemoryProfile(),
    policyConfig: options.policyConfig,
    surfaceCapabilities: cloneSurfaceCapabilities(options.surfaceCapabilities),
    operatorPresence: options.operatorPresence ?? "present",
    responseExpiryMs: options.responseExpiryMs,
    timeSource: options.timeSource ?? Date.now,
  };
}

export function buildApertureCoordinator(
  state: Pick<
    ApertureCoreRuntimeSetupState,
    "apertureProfile" | "baseMemoryProfile" | "policyConfig"
  >,
): JudgmentCoordinator {
  return new JudgmentCoordinator(
    new AttentionPolicy({
      ...(state.apertureProfile !== undefined ? { apertureProfile: state.apertureProfile } : {}),
      ...(state.policyConfig !== undefined ? { policyConfig: state.policyConfig } : {}),
      memoryProfile: state.baseMemoryProfile,
    }),
    new AttentionValue({
      memoryProfile: state.baseMemoryProfile,
    }),
    new AttentionPlanner({
      ...(state.policyConfig?.plannerDefaults !== undefined
        ? { plannerDefaults: state.policyConfig.plannerDefaults }
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
