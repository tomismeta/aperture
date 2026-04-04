// Workspace-private seam for internal packages that need richer core contracts
// without widening the public npm SDK surface.
export type {
  AttentionField,
  AttentionResponseSpec,
} from "./frame.js";
export type { AttentionSignalSummary } from "./signal-summary.js";
export type { AttentionState } from "./attention-state.js";
export type { ApertureTrace } from "./trace-types.js";
export { forecastAttentionPressure } from "./attention-pressure.js";
export { scoreAttentionFrame } from "./frame-score.js";
export { ProfileStore } from "./profile-store.js";
export type { MemoryProfile } from "./profile-store.js";
