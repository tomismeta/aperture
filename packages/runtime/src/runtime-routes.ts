import { type ApertureCore, type SourceEvent } from "@tomismeta/aperture-core";
import type { InternalHealthEmitter } from "@tomismeta/aperture-core/internal";

import type { LearningPersistenceState } from "./learning-persistence.js";
import { createRuntimeControlRoutes } from "./runtime-control-routes.js";
import { createRuntimeRegistryRoutes } from "./runtime-registry-routes.js";
import type { RuntimeRoute } from "./runtime-router.js";
import { RuntimeState } from "./runtime-state.js";
import { createWorkRoutes } from "./runtime-work-routes.js";

export type RuntimeRouteBodyLimits = {
  general: number;
  work: number;
  sourceEvents: number;
};

export type RuntimeRouteCore = Pick<
  ApertureCore,
  | "checkpointMemory"
  | "reloadMarkdown"
  | "submit"
  | "engage"
  | "getAttentionView"
  | "getSignalSummary"
  | "getAttentionState"
> &
  InternalHealthEmitter;

export type BuildRuntimeRoutesOptions = {
  runtimeId: string;
  kind: string;
  metadata?: Record<string, string>;
  controlHost: string;
  controlPort: number;
  controlPathPrefix: string;
  bodyLimits: RuntimeRouteBodyLimits;
  core: RuntimeRouteCore;
  state: RuntimeState;
  getListeningPort: () => number | null;
  publishSourceEvents: (events: SourceEvent[]) => void;
  syncSurfaceCapabilities: () => void;
  exportSessionCapture: () => ReturnType<RuntimeState["exportSessionCapture"]>;
  setLearningPersistence: (state: LearningPersistenceState | undefined) => void;
  readLearningPersistence: () => LearningPersistenceState | undefined;
};

export function buildRuntimeRoutes(options: BuildRuntimeRoutesOptions): RuntimeRoute[] {
  return [
    ...createRuntimeControlRoutes(options),
    ...createWorkRoutes(options),
    ...createRuntimeRegistryRoutes(options),
  ];
}
