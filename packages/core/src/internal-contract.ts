// Workspace-private seam for internal packages that need richer core contracts
// without widening the published npm SDK surface. The repo resolves this file
// through tsconfig path aliases; it is intentionally not exported by the
// published @tomismeta/aperture-core package.
export type { AttentionField, AttentionResponseSpec } from "./frame.js";
export type { AttentionSignalSummary } from "./signal-summary.js";
export type { AttentionState } from "./attention-state.js";
export type { ApertureCoreHealthSnapshot } from "./aperture-core.js";
export type {
  AttentionDecisionPlannedLane,
  AttentionDecisionRecord,
} from "./attention-decision-record.js";
export { evaluateTraceSession, type TraceEvaluationReport } from "./trace-evaluator.js";
export { isCandidateTrace } from "./trace-types.js";
export type { ApertureTrace, CandidateApertureTrace } from "./trace-types.js";
export { assertValidFrameResponse, assertValidSourceEvent } from "./aperture-core-validation.js";
export {
  ApertureCoreError,
  ApertureCoreResponseExpiredError,
  ApertureCoreValidationError,
  isApertureCoreError,
  isApertureCoreResponseExpiredError,
  isApertureCoreValidationError,
} from "./aperture-core-error.js";
export {
  APERTURE_INTERNAL_READ_HEALTH,
  readInternalCoreHealthSnapshot,
  type InternalHealthEmitter,
} from "./internal-health.js";
export {
  subscribeInternalTrace,
  type InternalTraceEmitter,
  type InternalTraceListener,
} from "./internal-trace.js";
export { forecastAttentionPressure } from "./attention-pressure.js";
export { scoreAttentionFrame } from "./frame-score.js";
export { ProfileStore } from "./profile-store.js";
export { loadPolicyConfig } from "./policy-config.js";
export type { ApertureProfile, MemoryProfile } from "./profile-store.js";
export type { PolicyConfig } from "./policy-config.js";
export {
  projectObservationJudgmentContract,
  resolveObservationStatusConflictKind,
  type ObservationJudgmentContract,
  type ObservationJudgmentDocument,
} from "./judgment-observation-contract.js";
export {
  readTaskFailureSemanticEvidence,
  type TaskFailureDetail,
  type TaskFailureEvidenceKind,
  type TaskFailureSemanticEvidence,
  type TaskFailureTerminalShape,
} from "./semantic-evidence.js";
export { isSemanticCommandExecutionToolFamily } from "./semantic-tool-family.js";
