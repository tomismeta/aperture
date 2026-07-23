import type {
  AttentionEvaluationApertureProfile,
  AttentionEvaluationConsequenceMemory,
  AttentionEvaluationMemoryProfile,
  AttentionEvaluationSourceTrustMemory,
  AttentionEvaluationToolFamilyMemory,
} from "./attention-evaluator-config.js";
import type { ApertureProfile, MemoryProfile } from "./profile-store.js";

export function normalizeMemoryProfile(
  profile?: AttentionEvaluationMemoryProfile,
): MemoryProfile | undefined {
  if (profile === undefined) {
    return undefined;
  }

  return {
    version: profile.version,
    operatorId: profile.operatorId,
    updatedAt: profile.updatedAt,
    sessionCount: profile.sessionCount,
    ...(profile.toolFamilies !== undefined
      ? { toolFamilies: mapRecord(profile.toolFamilies, normalizeToolFamilyMemory) }
      : {}),
    ...(profile.sourceTrust !== undefined
      ? {
          sourceTrust: mapRecord(profile.sourceTrust, (sources) =>
            mapRecord(sources, normalizeSourceTrustMemory),
          ),
        }
      : {}),
    ...(profile.consequenceProfiles !== undefined
      ? {
          consequenceProfiles: mapRecord(profile.consequenceProfiles, normalizeConsequenceMemory),
        }
      : {}),
    ...(profile.lessons !== undefined ? { lessons: [...profile.lessons] } : {}),
  };
}

export function normalizeApertureProfile(
  profile?: AttentionEvaluationApertureProfile,
): ApertureProfile | undefined {
  if (profile === undefined) {
    return undefined;
  }

  return {
    version: profile.version,
    operatorId: profile.operatorId,
    updatedAt: profile.updatedAt,
    ...(profile.preferences !== undefined
      ? {
          preferences: {
            ...(profile.preferences.controlMode !== undefined
              ? { controlMode: profile.preferences.controlMode }
              : {}),
            ...(profile.preferences.quietHours !== undefined
              ? { quietHours: [...profile.preferences.quietHours] }
              : {}),
            ...(profile.preferences.preferBatchingFor !== undefined
              ? { preferBatchingFor: [...profile.preferences.preferBatchingFor] }
              : {}),
            ...(profile.preferences.alwaysExpandContextFor !== undefined
              ? { alwaysExpandContextFor: [...profile.preferences.alwaysExpandContextFor] }
              : {}),
            ...(profile.preferences.neverAutoApprove !== undefined
              ? { neverAutoApprove: [...profile.preferences.neverAutoApprove] }
              : {}),
          },
        }
      : {}),
    ...(profile.overrides !== undefined
      ? {
          overrides: {
            ...(profile.overrides.tools !== undefined
              ? { tools: mapRecord(profile.overrides.tools, (rules) => ({ ...rules })) }
              : {}),
          },
        }
      : {}),
  };
}

function normalizeToolFamilyMemory(
  memory: AttentionEvaluationToolFamilyMemory,
): NonNullable<MemoryProfile["toolFamilies"]>[string] {
  return {
    presentations: memory.presentations,
    responses: memory.responses,
    dismissals: memory.dismissals,
    ...(memory.avgResponseLatencyMs !== undefined
      ? { avgResponseLatencyMs: memory.avgResponseLatencyMs }
      : {}),
    ...(memory.avgDismissalLatencyMs !== undefined
      ? { avgDismissalLatencyMs: memory.avgDismissalLatencyMs }
      : {}),
    ...(memory.contextExpansionRate !== undefined
      ? { contextExpansionRate: memory.contextExpansionRate }
      : {}),
    ...(memory.returnAfterDeferralRate !== undefined
      ? { returnAfterDeferralRate: memory.returnAfterDeferralRate }
      : {}),
  };
}

function normalizeSourceTrustMemory(
  memory: AttentionEvaluationSourceTrustMemory,
): NonNullable<NonNullable<MemoryProfile["sourceTrust"]>[string]>[string] {
  return {
    confirmations: memory.confirmations,
    disagreements: memory.disagreements,
    trustAdjustment: memory.trustAdjustment,
  };
}

function normalizeConsequenceMemory(
  memory: AttentionEvaluationConsequenceMemory,
): NonNullable<MemoryProfile["consequenceProfiles"]>[string] {
  return {
    rejectionRate: memory.rejectionRate,
    ...(memory.reviewedCount !== undefined ? { reviewedCount: memory.reviewedCount } : {}),
  };
}

function mapRecord<TValue, TResult>(
  record: Record<string, TValue>,
  mapValue: (value: TValue) => TResult,
): Record<string, TResult> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, mapValue(value)]));
}
