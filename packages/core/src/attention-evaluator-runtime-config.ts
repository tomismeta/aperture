import type {
  AttentionEvaluationConfig,
  AttentionEvaluationPlannerDefaults,
  AttentionEvaluationPolicyConfig,
} from "./attention-evaluator-config.js";
import {
  normalizeApertureProfile,
  normalizeMemoryProfile,
} from "./attention-evaluator-profile-config.js";
import type { AmbiguityDefaults, PlannerDefaults, PolicyConfig } from "./policy-config.js";
import type { ApertureProfile, MemoryProfile } from "./profile-store.js";

export type RuntimeAttentionEvaluationConfig = {
  apertureProfile?: ApertureProfile;
  memoryProfile?: MemoryProfile;
  policyConfig?: PolicyConfig;
  ambiguityDefaults?: AmbiguityDefaults;
  plannerDefaults?: PlannerDefaults;
};

export function normalizeAttentionEvaluationConfig(
  config: AttentionEvaluationConfig = {},
): RuntimeAttentionEvaluationConfig {
  const normalized: RuntimeAttentionEvaluationConfig = {};
  const apertureProfile = normalizeApertureProfile(config.apertureProfile);
  const memoryProfile = normalizeMemoryProfile(config.memoryProfile);
  const policyConfig = normalizePolicyConfig(config.policyConfig);
  const plannerDefaults = normalizePlannerDefaults(config.plannerDefaults);

  if (apertureProfile !== undefined) {
    normalized.apertureProfile = apertureProfile;
  }
  if (memoryProfile !== undefined) {
    normalized.memoryProfile = memoryProfile;
  }
  if (policyConfig !== undefined) {
    normalized.policyConfig = policyConfig;
  }
  if (config.ambiguityDefaults !== undefined) {
    normalized.ambiguityDefaults = config.ambiguityDefaults;
  }
  if (plannerDefaults !== undefined) {
    normalized.plannerDefaults = plannerDefaults;
  }

  return normalized;
}

function normalizePolicyConfig(config?: AttentionEvaluationPolicyConfig): PolicyConfig | undefined {
  if (config === undefined) {
    return undefined;
  }

  const plannerDefaults = normalizePlannerDefaults(config.plannerDefaults);
  return {
    version: config.version ?? 1,
    updatedAt: config.updatedAt ?? "1970-01-01T00:00:00.000Z",
    ...(config.policy !== undefined
      ? {
          policy: Object.fromEntries(
            Object.entries(config.policy).map(([name, rule]) => [
              name,
              {
                ...(rule.autoApprove !== undefined ? { autoApprove: rule.autoApprove } : {}),
                ...(rule.mayInterrupt !== undefined ? { mayInterrupt: rule.mayInterrupt } : {}),
                ...(rule.minimumLane !== undefined ? { minimumLane: rule.minimumLane } : {}),
                ...(rule.requireContextExpansion !== undefined
                  ? { requireContextExpansion: rule.requireContextExpansion }
                  : {}),
              },
            ]),
          ),
        }
      : {}),
    ...(config.ambiguityDefaults !== undefined
      ? {
          ambiguityDefaults: {
            ...(config.ambiguityDefaults.nonBlockingActivationThreshold !== undefined
              ? {
                  nonBlockingActivationThreshold:
                    config.ambiguityDefaults.nonBlockingActivationThreshold,
                }
              : {}),
            ...(config.ambiguityDefaults.promotionMargin !== undefined
              ? { promotionMargin: config.ambiguityDefaults.promotionMargin }
              : {}),
          },
        }
      : {}),
    ...(plannerDefaults !== undefined ? { plannerDefaults } : {}),
  };
}

function normalizePlannerDefaults(
  defaults?: AttentionEvaluationPlannerDefaults,
): PlannerDefaults | undefined {
  if (defaults === undefined) {
    return undefined;
  }

  const normalized: PlannerDefaults = {};
  if (defaults.batchStatusBursts !== undefined) {
    normalized.batchStatusBursts = defaults.batchStatusBursts;
  }
  if (defaults.deferLowValueDuringPressure !== undefined) {
    normalized.deferLowValueDuringPressure = defaults.deferLowValueDuringPressure;
  }
  if (defaults.minimumDwellMs !== undefined) {
    normalized.minimumDwellMs = defaults.minimumDwellMs;
  }
  if (defaults.streamContinuityMargin !== undefined) {
    normalized.streamContinuityMargin = defaults.streamContinuityMargin;
  }
  if (defaults.conflictingInterruptMargin !== undefined) {
    normalized.conflictingInterruptMargin = defaults.conflictingInterruptMargin;
  }
  if (defaults.disabledContinuityRules !== undefined) {
    normalized.disabledContinuityRules = [...defaults.disabledContinuityRules];
  }

  return normalized;
}
