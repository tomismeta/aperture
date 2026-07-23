export type AttentionEvaluationControlMode = "hands-on" | "standard" | "focus";

export type AttentionEvaluationApertureProfile = {
  version: number;
  operatorId: string;
  updatedAt: string;
  preferences?: {
    controlMode?: AttentionEvaluationControlMode;
    quietHours?: string[];
    preferBatchingFor?: string[];
    alwaysExpandContextFor?: string[];
    neverAutoApprove?: string[];
  };
  overrides?: {
    tools?: Record<string, Record<string, string | boolean | number>>;
  };
};

export type AttentionEvaluationMemoryProfile = {
  version: number;
  operatorId: string;
  updatedAt: string;
  sessionCount: number;
  toolFamilies?: Record<string, AttentionEvaluationToolFamilyMemory>;
  sourceTrust?: Record<string, Record<string, AttentionEvaluationSourceTrustMemory>>;
  consequenceProfiles?: Record<string, AttentionEvaluationConsequenceMemory>;
  lessons?: string[];
};

export type AttentionEvaluationToolFamilyMemory = {
  presentations: number;
  responses: number;
  dismissals: number;
  avgResponseLatencyMs?: number;
  avgDismissalLatencyMs?: number;
  contextExpansionRate?: number;
  returnAfterDeferralRate?: number;
};

export type AttentionEvaluationSourceTrustMemory = {
  confirmations: number;
  disagreements: number;
  trustAdjustment: number;
};

export type AttentionEvaluationConsequenceMemory = {
  rejectionRate: number;
  reviewedCount?: number;
};

export type AttentionEvaluationPolicyConfig = {
  version?: number;
  updatedAt?: string;
  policy?: Record<string, AttentionEvaluationPolicyRule>;
  ambiguityDefaults?: AttentionEvaluationAmbiguityDefaults;
  plannerDefaults?: AttentionEvaluationPlannerDefaults;
};

export type AttentionEvaluationPolicyRule = {
  autoApprove?: boolean;
  mayInterrupt?: boolean;
  minimumLane?: "ambient" | "next" | "now";
  requireContextExpansion?: boolean;
};

export type AttentionEvaluationAmbiguityDefaults = {
  nonBlockingActivationThreshold?: number;
  promotionMargin?: number;
};

export type AttentionEvaluationPlannerDefaults = {
  batchStatusBursts?: boolean;
  deferLowValueDuringPressure?: boolean;
  minimumDwellMs?: number;
  streamContinuityMargin?: number;
  conflictingInterruptMargin?: number;
  disabledContinuityRules?: AttentionEvaluationContinuityRuleName[];
};

export type AttentionEvaluationContinuityRuleName =
  | "same_interaction"
  | "visible_episode"
  | "same_episode"
  | "minimum_dwell"
  | "burst_dampening"
  | "deferral_escalation"
  | "conflicting_interrupt"
  | "decision_stream_continuity"
  | "context_patience";

export type AttentionEvaluationConfig = {
  apertureProfile?: AttentionEvaluationApertureProfile;
  memoryProfile?: AttentionEvaluationMemoryProfile;
  policyConfig?: AttentionEvaluationPolicyConfig;
  ambiguityDefaults?: AttentionEvaluationAmbiguityDefaults;
  plannerDefaults?: AttentionEvaluationPlannerDefaults;
};
