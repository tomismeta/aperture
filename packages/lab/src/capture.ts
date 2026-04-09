import type { ApertureCoreOptions } from "@tomismeta/aperture-core";

import {
  type OfflineReviewArtifact,
  type OfflineReviewFocusArea,
  prepareOfflineReviewArtifact,
} from "./offline-review.js";
import {
  createSessionBundleFromRuntimeCapture,
  createRuntimeSessionCaptureCursor,
  createTempSessionBundlePath,
  defaultSessionBundlePath,
  DEFAULT_SESSION_BUNDLES_DIR,
  SESSION_BUNDLE_SCHEMA_VERSION,
  sliceRuntimeSessionCapture,
  validateSessionBundle,
  writeSessionBundle,
  type ReplaySessionBundle,
  type ReplaySessionBundleSource,
  type RuntimeSessionCaptureCursor,
  type RuntimeSessionCaptureLike,
} from "./session-bundle.js";

export type CreateCaptureReviewArtifactsOptions = {
  sessionId?: string;
  title?: string;
  description?: string;
  doctrineTags?: string[];
  source?: ReplaySessionBundleSource;
  exportedAt?: string;
  core?: ApertureCoreOptions;
  bundlePath?: string;
  focusAreas?: readonly OfflineReviewFocusArea[];
  rubricVersion?: string;
  generatedAt?: string;
};

export type CaptureReviewArtifacts = {
  bundle: ReplaySessionBundle;
  artifact: OfflineReviewArtifact;
};

export function createCaptureReviewArtifacts(
  capture: RuntimeSessionCaptureLike,
  options: CreateCaptureReviewArtifactsOptions = {},
): CaptureReviewArtifacts {
  const bundle = createSessionBundleFromRuntimeCapture(capture, {
    ...(options.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
    ...(options.title !== undefined ? { title: options.title } : {}),
    ...(options.description !== undefined ? { description: options.description } : {}),
    ...(options.doctrineTags !== undefined ? { doctrineTags: [...options.doctrineTags] } : {}),
    ...(options.source !== undefined ? { source: options.source } : {}),
    ...(options.exportedAt !== undefined ? { exportedAt: options.exportedAt } : {}),
    ...(options.core !== undefined ? { core: options.core } : {}),
  });
  const artifact = prepareOfflineReviewArtifact(bundle, {
    ...(options.bundlePath !== undefined ? { bundlePath: options.bundlePath } : {}),
    ...(options.focusAreas !== undefined ? { focusAreas: options.focusAreas } : {}),
    ...(options.rubricVersion !== undefined ? { rubricVersion: options.rubricVersion } : {}),
    ...(options.generatedAt !== undefined ? { generatedAt: options.generatedAt } : {}),
  });

  return {
    bundle,
    artifact,
  };
}

export {
  createRuntimeSessionCaptureCursor,
  createSessionBundleFromRuntimeCapture,
  createTempSessionBundlePath,
  defaultSessionBundlePath,
  DEFAULT_SESSION_BUNDLES_DIR,
  SESSION_BUNDLE_SCHEMA_VERSION,
  sliceRuntimeSessionCapture,
  validateSessionBundle,
  writeSessionBundle,
};

export type {
  OfflineReviewArtifact,
  OfflineReviewFocusArea,
  ReplaySessionBundle,
  ReplaySessionBundleSource,
  RuntimeSessionCaptureCursor,
  RuntimeSessionCaptureLike,
};
