export { ApertureCore } from "./aperture-core.js";
export type {
  ApertureCoreOptions,
  PublishOptions,
  AttentionFrameListener,
  AttentionTaskViewListener,
  AttentionViewListener,
  AttentionResponseListener,
  AttentionSignalListener,
  AttentionTraceListener,
} from "./aperture-core.js";

export type * from "./events.js";
export type {
  SourceEvent,
  SourceTaskStartedEvent,
  SourceTaskUpdatedEvent,
  SourceHumanInputRequestedEvent,
  SourceTaskCompletedEvent,
  SourceTaskCancelledEvent,
} from "./source-event.js";
export type {
  AttentionFrame,
  AttentionTaskView,
  AttentionView,
  AttentionConsequenceLevel,
} from "./frame.js";
export type { AttentionResponse } from "./frame-response.js";
export type { AttentionSignal } from "./interaction-signal.js";
export type {
  AttentionTopologyCapabilities,
  AttentionResponseCapabilities,
  AttentionSurfaceCapabilities,
} from "./surface-capabilities.js";
export {
  baseAttentionSurfaceCapabilities,
  mergeAttentionSurfaceCapabilities,
} from "./surface-capabilities.js";
