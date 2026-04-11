// Workspace-private seam for internal packages that need richer core contracts
// without widening the public npm SDK surface.
export type { AttentionField, AttentionResponseSpec } from "./frame.js";
export type { AttentionSignalSummary } from "./signal-summary.js";
export type { AttentionState } from "./attention-state.js";
export { evaluateTraceSession, type TraceEvaluationReport } from "./trace-evaluator.js";
export { isCandidateTrace } from "./trace-types.js";
export type { ApertureTrace, CandidateApertureTrace } from "./trace-types.js";
export { assertValidFrameResponse, assertValidSourceEvent } from "./aperture-core-validation.js";
export {
  subscribeInternalTrace,
  type InternalTraceEmitter,
  type InternalTraceListener,
} from "./internal-trace.js";
export { forecastAttentionPressure } from "./attention-pressure.js";
export { scoreAttentionFrame } from "./frame-score.js";
export { ProfileStore } from "./profile-store.js";
export type { MemoryProfile } from "./profile-store.js";
