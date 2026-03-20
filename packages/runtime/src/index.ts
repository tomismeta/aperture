export {
  createApertureRuntime,
  type ApertureRuntimeAdapter,
  type ApertureRuntime,
  type ApertureRuntimeEvent,
  type ApertureRuntimeOptions,
  type ApertureRuntimeSnapshot,
} from "./runtime.js";
export { ApertureRuntimeClient, type ApertureRuntimeClientOptions } from "./runtime-client.js";
export { ApertureRuntimeAdapterClient, type ApertureRuntimeAdapterClientOptions } from "./adapter-client.js";
export {
  baseAttentionSurfaceCapabilities,
  mergeAttentionSurfaceCapabilities,
  type AttentionResponseCapabilities,
  type AttentionSurfaceCapabilities,
  type AttentionTopologyCapabilities,
} from "../../core/src/surface-capabilities.js";
export {
  discoverLocalRuntimes,
  removeLocalRuntimeRegistration,
  writeLocalRuntimeRegistration,
  type ApertureLocalRuntimeRegistration,
} from "./runtime-discovery.js";
export {
  bootstrapLearningPersistence,
  type LearningMode,
  type LearningPersistenceState,
} from "./learning-persistence.js";
