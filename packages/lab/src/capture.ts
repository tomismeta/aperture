import type { ApertureCoreOptions } from "@tomismeta/aperture-core";

import {
  defaultOfflineReviewArtifactPath,
  type OfflineReviewArtifact,
  type OfflineReviewFocusArea,
  prepareOfflineReviewArtifact,
  writeOfflineReviewArtifact,
} from "./offline-review.js";
import {
  createSessionBundleFromRuntimeCapture,
  createRuntimeSessionCaptureCursor,
  createTempSessionBundlePath,
  defaultSessionBundlePath,
  DEFAULT_SESSION_BUNDLES_DIR,
  loadSessionBundle,
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

export type WriteCaptureReviewArtifactsOptions = CreateCaptureReviewArtifactsOptions & {
  artifactPath?: string;
};

export type WrittenCaptureReviewArtifacts = CaptureReviewArtifacts & {
  bundlePath: string;
  artifactPath: string;
};

export type WriteSessionBundleReviewArtifactOptions = {
  artifactPath?: string;
  focusAreas?: readonly OfflineReviewFocusArea[];
  rubricVersion?: string;
  generatedAt?: string;
};

export type WrittenSessionBundleReviewArtifact = {
  bundle: ReplaySessionBundle;
  bundlePath: string;
  artifact: OfflineReviewArtifact;
  artifactPath: string;
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

export async function writeCaptureReviewArtifacts(
  capture: RuntimeSessionCaptureLike,
  options: WriteCaptureReviewArtifactsOptions = {},
): Promise<WrittenCaptureReviewArtifacts> {
  const result = createCaptureReviewArtifacts(capture, options);
  const bundlePath = options.bundlePath ?? defaultSessionBundlePath(result.bundle);
  const artifact = result.artifact.bundle.bundlePath === bundlePath
    ? result.artifact
    : prepareOfflineReviewArtifact(result.bundle, {
        bundlePath,
        ...(options.focusAreas !== undefined ? { focusAreas: options.focusAreas } : {}),
        ...(options.rubricVersion !== undefined ? { rubricVersion: options.rubricVersion } : {}),
        ...(options.generatedAt !== undefined ? { generatedAt: options.generatedAt } : {}),
      });
  const artifactPath = options.artifactPath ?? defaultOfflineReviewArtifactPath(artifact);

  await writeSessionBundle(bundlePath, result.bundle);
  await writeOfflineReviewArtifact(artifactPath, artifact);

  return {
    bundle: result.bundle,
    artifact,
    bundlePath,
    artifactPath,
  };
}

export async function writeSessionBundleReviewArtifact(
  bundlePath: string,
  options: WriteSessionBundleReviewArtifactOptions = {},
): Promise<WrittenSessionBundleReviewArtifact> {
  const bundle = await loadSessionBundle(bundlePath);
  const artifact = prepareOfflineReviewArtifact(bundle, {
    bundlePath,
    ...(options.focusAreas !== undefined ? { focusAreas: options.focusAreas } : {}),
    ...(options.rubricVersion !== undefined ? { rubricVersion: options.rubricVersion } : {}),
    ...(options.generatedAt !== undefined ? { generatedAt: options.generatedAt } : {}),
  });
  const artifactPath = options.artifactPath ?? defaultOfflineReviewArtifactPath(artifact);

  await writeOfflineReviewArtifact(artifactPath, artifact);

  return {
    bundle,
    bundlePath,
    artifact,
    artifactPath,
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
