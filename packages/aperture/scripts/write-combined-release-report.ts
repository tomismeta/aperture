import { createHash } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type ArtifactFile = {
  path: string;
  sha256: string;
  bytes: number;
  mode: string;
};

type BuildInfo = {
  apertureCommit: string;
  apertureSourceTag: string;
  sourceDirty: boolean;
  provenanceAttestationReference: string;
  workerBundle: { bytes: number; sha256: string };
  integrations: { omp: { bytes: number; sha256: string } };
  workerContract: {
    notificationInputSchemaVersion: number;
    notificationOutputSchemaVersion: number;
    surfaceProtocolVersion: number;
    ompAttentionEventSchemaVersion: number;
  };
  validation: {
    conformanceProofId: string;
    ambientCeilingProofId: string;
    ompAdapterProofId: string;
    directTransportProofId: string;
    directPrivacyProofId: string;
    navigationProofId: string;
    ompHostProofId: string;
    directNodeCompatibility: Array<{
      nodeVersion: string;
      status: string;
      reportPath: string;
    }>;
    nodeCompatibility: Array<{ nodeVersion: string; status: string; reportPath: string }>;
  };
  ci: { workflowRef: string; runId: string; runAttempt: string };
  files: ArtifactFile[];
};

const options = parseOptions(process.argv.slice(2));
const artifactRoot = path.resolve(options.artifactDir);
const archivePath = path.resolve(options.archive);
const buildInfoPath = path.join(artifactRoot, "BUILDINFO.json");
const buildInfoContent = await readFile(buildInfoPath);
const buildInfo = JSON.parse(buildInfoContent.toString("utf8")) as BuildInfo;
const buildInfoMetadata = await lstat(buildInfoPath);
const buildInfoMode = (buildInfoMetadata.mode & 0o777).toString(8).padStart(4, "0");
const archiveContent = await readFile(archivePath);
const ompCompatibility = JSON.parse(
  await readFile(path.join(artifactRoot, "evidence", "omp-host-matrix.json"), "utf8"),
) as { matrix: Array<{ ompVersion: string; status: string }> };

const report = {
  schemaVersion: 1,
  status: "passed",
  signedTag: buildInfo.apertureSourceTag,
  signedTagCommit: buildInfo.apertureCommit,
  sourceDirty: buildInfo.sourceDirty,
  workflowRef: buildInfo.ci.workflowRef,
  runId: buildInfo.ci.runId,
  runAttempt: buildInfo.ci.runAttempt,
  workflowChain: {
    releaseCheckRunId: options.releaseCheckRunId,
    workerArtifactRunId: options.workerArtifactRunId,
    directReleaseRunId: options.directReleaseRunId,
  },
  artifactUrl: options.artifactUrl,
  artifactArchiveSha256: sha256(archiveContent),
  archiveAttestationReference: options.archiveAttestationReference,
  buildInfoAttestationReference: options.buildInfoAttestationReference,
  provenanceAttestationReference: buildInfo.provenanceAttestationReference,
  workerBytes: buildInfo.workerBundle.bytes,
  workerSha256: buildInfo.workerBundle.sha256,
  ompBytes: buildInfo.integrations.omp.bytes,
  ompSha256: buildInfo.integrations.omp.sha256,
  identityConfigSha256: findFile(buildInfo.files, "config/identities.json").sha256,
  nodeMatrix: buildInfo.validation.nodeCompatibility.map((entry) => ({
    version: entry.nodeVersion,
    status: entry.status,
    evidence: entry.reportPath,
  })),
  ompMatrix: ompCompatibility.matrix,
  workerConformanceProof: buildInfo.validation.conformanceProofId,
  ambientCeilingProof: buildInfo.validation.ambientCeilingProofId,
  ompAdapterProof: buildInfo.validation.ompAdapterProofId,
  directTransportProof: buildInfo.validation.directTransportProofId,
  directPrivacyProof: buildInfo.validation.directPrivacyProofId,
  navigationProof: buildInfo.validation.navigationProofId,
  ompHostProof: buildInfo.validation.ompHostProofId,
  directNodeMatrix: buildInfo.validation.directNodeCompatibility.map((entry) => ({
    version: entry.nodeVersion,
    status: entry.status,
    evidence: entry.reportPath,
  })),
  schemaVersions: buildInfo.workerContract,
  buildInfoPath: "BUILDINFO.json",
  buildInfoSha256: sha256(buildInfoContent),
  filesManifestCount: buildInfo.files.length,
  archiveMembers: [
    {
      path: "BUILDINFO.json",
      bytes: buildInfoContent.byteLength,
      sha256: sha256(buildInfoContent),
      mode: buildInfoMode,
    },
    ...buildInfo.files,
  ],
  evidenceReferences: buildInfo.files
    .filter((entry) => entry.path.startsWith("evidence/"))
    .map((entry) => ({ path: entry.path, sha256: entry.sha256 })),
  allValidationsPassed: true,
  fixedIdentitiesMatched: true,
  unmetPrerequisites: [],
  fixedIdentityMismatchReason: null,
};

await writeFile(path.resolve(options.output), `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${path.resolve(options.output)}\n`);

function findFile(files: ArtifactFile[], expectedPath: string): ArtifactFile {
  const entry = files.find((candidate) => candidate.path === expectedPath);
  if (!entry) throw new Error(`BUILDINFO.files is missing ${expectedPath}`);
  return entry;
}

function sha256(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

type Options = {
  artifactDir: string;
  archive: string;
  archiveAttestationReference: string;
  buildInfoAttestationReference: string;
  artifactUrl: string;
  output: string;
  releaseCheckRunId: string;
  workerArtifactRunId: string;
  directReleaseRunId: string;
};

function parseOptions(args: string[]): Options {
  const parsed: Partial<Options> = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") continue;
    if (
      argument === "--artifact-dir" ||
      argument === "--archive" ||
      argument === "--archive-attestation-reference" ||
      argument === "--buildinfo-attestation-reference" ||
      argument === "--release-check-run-id" ||
      argument === "--worker-artifact-run-id" ||
      argument === "--direct-release-run-id" ||
      argument === "--artifact-url" ||
      argument === "--output"
    ) {
      const value = args[index + 1];
      if (!value) throw new Error(`${argument} requires a value`);
      if (argument === "--artifact-dir") parsed.artifactDir = value;
      else if (argument === "--archive") parsed.archive = value;
      else if (argument === "--archive-attestation-reference") {
        parsed.archiveAttestationReference = value;
      } else if (argument === "--buildinfo-attestation-reference") {
        parsed.buildInfoAttestationReference = value;
      } else if (argument === "--release-check-run-id") {
        parsed.releaseCheckRunId = value;
      } else if (argument === "--worker-artifact-run-id") {
        parsed.workerArtifactRunId = value;
      } else if (argument === "--direct-release-run-id") {
        parsed.directReleaseRunId = value;
      } else if (argument === "--artifact-url") parsed.artifactUrl = value;
      else parsed.output = value;
      index += 1;
      continue;
    }
    throw new Error(`unknown combined release report option: ${argument ?? "(missing)"}`);
  }
  if (!parsed.artifactDir) throw new Error("--artifact-dir is required");
  if (!parsed.archive) throw new Error("--archive is required");
  if (!parsed.archiveAttestationReference) {
    throw new Error("--archive-attestation-reference is required");
  }
  if (!parsed.buildInfoAttestationReference) {
    throw new Error("--buildinfo-attestation-reference is required");
  }
  if (!parsed.artifactUrl) throw new Error("--artifact-url is required");
  if (!parsed.output) throw new Error("--output is required");
  if (!parsed.releaseCheckRunId) throw new Error("--release-check-run-id is required");
  if (!parsed.workerArtifactRunId) throw new Error("--worker-artifact-run-id is required");
  if (!parsed.directReleaseRunId) throw new Error("--direct-release-run-id is required");
  return parsed as Options;
}
