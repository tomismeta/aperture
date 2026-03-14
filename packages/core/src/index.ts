export { ApertureCore } from "./aperture-core.js";
export type {
  ApertureCoreOptions,
  AttentionFrameListener,
  AttentionTaskViewListener,
  AttentionViewListener,
  AttentionResponseListener,
  AttentionSignalListener,
  AttentionTraceListener,
} from "./aperture-core.js";

export { AttentionPolicy } from "./attention-policy.js";
export type { AttentionPolicyVerdict, MinimumPresentation } from "./attention-policy.js";

export { AttentionValue } from "./attention-value.js";
export type {
  AttentionFrameValueBreakdown,
  AttentionValueBreakdown,
} from "./attention-value.js";

export { scoreAttentionFrame } from "./frame-score.js";

export { AttentionPlanner } from "./attention-planner.js";
export type {
  AttentionPlanningContext,
  AttentionPlanningExplanation,
  AttentionPlanDecision,
} from "./attention-planner.js";

export { JudgmentCoordinator } from "./judgment-coordinator.js";
export type {
  JudgmentContext,
  JudgmentDecision,
  JudgmentExplanation,
} from "./judgment-coordinator.js";

export {
  forecastAttentionPressure,
  idleAttentionPressure,
} from "./attention-pressure.js";
export type { AttentionPressure } from "./attention-pressure.js";

export { distillMemoryProfile } from "./memory-aggregator.js";
export { ProfileStore } from "./profile-store.js";
export { evaluateTraceSession } from "./trace-evaluator.js";
export type { TraceEvaluationReport } from "./trace-evaluator.js";

export type * from "./events.js";
export type * from "./adapter-event.js";
export type {
  AttentionAction,
  AttentionAcknowledgeResponseSpec,
  AttentionApprovalResponseSpec,
  AttentionChoiceResponseSpec,
  AttentionConsequenceLevel,
  AttentionContext,
  AttentionField,
  AttentionFormResponseSpec,
  AttentionFrame,
  AttentionFrameMode,
  AttentionNoResponseSpec,
  AttentionOption,
  AttentionProvenance,
  AttentionResponseSpec,
  AttentionTaskView,
  AttentionTiming,
  AttentionTone,
  AttentionView,
} from "./frame.js";
export type { AttentionResponse } from "./frame-response.js";
export type { AttentionSignal } from "./interaction-signal.js";
export type { AttentionCandidate, AttentionPriority } from "./interaction-candidate.js";
export type {
  AttentionSignalCounts,
  AttentionSignalSummary,
  AttentionDeferredSignalCounts,
} from "./signal-summary.js";
export type { AttentionState } from "./attention-state.js";
export type {
  ConsequenceMemory,
  MemoryProfile,
  SourceTrustMemory,
  ToolFamilyMemory,
  UserProfile,
} from "./profile-store.js";
export type {
  JudgmentConfig,
  JudgmentRule,
  PlannerDefaults,
} from "./judgment-config.js";
export type { ApertureTrace } from "./trace.js";
