import { readFile } from "node:fs/promises";
import path from "node:path";

import { PUBLIC_CORPUS_RUN_SCHEMA_VERSION } from "./artifact-versions.js";
import {
  MAX_PUBLIC_CORPUS_RESPONSE_BYTES,
  type PublicCorpusDataset,
  type PublicCorpusRunManifest,
  type PublicCorpusRunPlan,
  type PublicCorpusRunStatus,
} from "./public-corpus-manifest.js";
import { isPublicCorpusSource } from "./public-corpus-manifest-source-validation.js";

export async function readPublicCorpusRunManifest(
  filePath: string,
): Promise<PublicCorpusRunManifest> {
  const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  if (
    !isPublicCorpusRunManifest(parsed) ||
    path.resolve(parsed.artifacts.manifestPath) !== path.resolve(filePath)
  ) {
    throw new Error(`Invalid public corpus run manifest at ${filePath}`);
  }
  return parsed;
}

export function isPublicCorpusRunManifest(value: unknown): value is PublicCorpusRunManifest {
  if (typeof value !== "object" || value === null) return false;
  const manifest = value as PublicCorpusRunManifest;
  if (!isPublicCorpusRunPlan(manifest.plan)) return false;
  const upperBound = manifest.plan.startOffset + manifest.plan.maxRows;
  return (
    manifest.schemaVersion === PUBLIC_CORPUS_RUN_SCHEMA_VERSION &&
    isRunStatus(manifest.status) &&
    typeof manifest.runId === "string" &&
    typeof manifest.createdAt === "string" &&
    typeof manifest.updatedAt === "string" &&
    isPublicCorpusSource(manifest.source, manifest.plan.dataset) &&
    isPublicCorpusProgress(manifest.progress, manifest.plan.startOffset, upperBound) &&
    typeof manifest.runtime?.runtimeRoot === "string" &&
    typeof manifest.runtime.cwd === "string" &&
    typeof manifest.runtime.nodeVersion === "string" &&
    manifest.runtime.importerSchemaVersion === PUBLIC_CORPUS_RUN_SCHEMA_VERSION &&
    isPrivacyClassification(manifest.privacy?.classification) &&
    manifest.privacy.redactionPosture === "review_required_before_promotion" &&
    isLicenseScope(manifest.privacy.licenseScope) &&
    manifest.privacy.rawRetention === "not_mirrored" &&
    isPublicCorpusArtifacts(manifest.artifacts) &&
    isPublicCorpusIntegrity(manifest.integrity)
  );
}

function isPublicCorpusRunPlan(value: unknown): value is PublicCorpusRunPlan {
  if (typeof value !== "object" || value === null) return false;
  const plan = value as PublicCorpusRunPlan;
  return (
    isCorpusDataset(plan.dataset) &&
    plan.split === "train" &&
    isNonNegativeInteger(plan.startOffset) &&
    isPositiveInteger(plan.maxRows) &&
    Number.isSafeInteger(plan.startOffset + plan.maxRows) &&
    isPositiveInteger(plan.pageSize) &&
    plan.pageSize <= 100 &&
    isPositiveInteger(plan.requestTimeoutSeconds) &&
    isPositiveInteger(plan.maxResponseBytes) &&
    plan.maxResponseBytes <= MAX_PUBLIC_CORPUS_RESPONSE_BYTES &&
    isNonNegativeInteger(plan.maxRetries) &&
    (plan.existing === "verify" || plan.existing === "error" || plan.existing === "skip") &&
    plan.mirrorRaw === false &&
    typeof plan.dryRun === "boolean" &&
    typeof plan.planOnly === "boolean"
  );
}

function isCorpusDataset(value: unknown): value is PublicCorpusDataset {
  return value === "dataclaw" || value === "trace-commons";
}

function isLicenseScope(value: unknown): boolean {
  return (
    value === "dataset_compilation_cc_by_4.0_embedded_content_may_differ" ||
    value === "dataset_license_review_required_embedded_content_may_differ"
  );
}

function isPrivacyClassification(value: unknown): boolean {
  return value === "public_anonymized_best_effort" || value === "public_unredacted_review_required";
}

function isPublicCorpusProgress(
  value: unknown,
  startOffset: number,
  upperBound: number,
): value is PublicCorpusRunManifest["progress"] {
  if (typeof value !== "object" || value === null) return false;
  const progress = value as PublicCorpusRunManifest["progress"];
  return (
    isNonNegativeInteger(progress.nextOffset) &&
    progress.nextOffset >= startOffset &&
    progress.nextOffset <= upperBound &&
    isNonNegativeInteger(progress.pagesAttempted) &&
    isNonNegativeInteger(progress.pagesCompleted) &&
    isNonNegativeInteger(progress.rowsFetched) &&
    isNonNegativeInteger(progress.rowsImported) &&
    isNonNegativeInteger(progress.rowsSkipped) &&
    isNonNegativeInteger(progress.rowsFailed) &&
    isNonNegativeInteger(progress.rowsDuplicated) &&
    progress.pagesCompleted <= progress.pagesAttempted &&
    progress.rowsFetched <= upperBound - startOffset &&
    progress.nextOffset - startOffset <= progress.rowsFetched &&
    progress.rowsImported + progress.rowsSkipped + progress.rowsFailed <= progress.rowsFetched
  );
}

function isPublicCorpusArtifacts(value: unknown): value is PublicCorpusRunManifest["artifacts"] {
  if (typeof value !== "object" || value === null) return false;
  const artifacts = value as PublicCorpusRunManifest["artifacts"];
  return (
    typeof artifacts.runRoot === "string" &&
    typeof artifacts.manifestPath === "string" &&
    typeof artifacts.recordsPath === "string" &&
    typeof artifacts.errorsPath === "string" &&
    typeof artifacts.bundleRoot === "string" &&
    isPathWithin(artifacts.runRoot, artifacts.manifestPath) &&
    isPathWithin(artifacts.runRoot, artifacts.recordsPath) &&
    isPathWithin(artifacts.runRoot, artifacts.errorsPath)
  );
}

function isRunStatus(value: unknown): value is PublicCorpusRunStatus {
  return (
    value === "planned" ||
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "cancelled"
  );
}

function isPublicCorpusIntegrity(value: unknown): value is PublicCorpusRunManifest["integrity"] {
  if (typeof value !== "object" || value === null) return false;
  const integrity = value as PublicCorpusRunManifest["integrity"];
  return (
    (integrity.recordsDigest === undefined || isSha256Digest(integrity.recordsDigest)) &&
    (integrity.errorsDigest === undefined || isSha256Digest(integrity.errorsDigest)) &&
    (integrity.bundleSetDigest === undefined || isSha256Digest(integrity.bundleSetDigest))
  );
}

function isSha256Digest(value: unknown): value is `sha256:${string}` {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isPathWithin(parent: string, child: string): boolean {
  const relativePath = path.relative(path.resolve(parent), path.resolve(child));
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}
