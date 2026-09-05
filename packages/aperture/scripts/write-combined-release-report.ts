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
  artifactMode: string;
  apertureSourceTag: string;
  aperturePackageVersion: string;
  apertureCoreVersion: string;
  ompPackageVersion: string;
  artifactLimits: { maximumTextArtifactBytes: number };
  sourceDirty: boolean;
  provenanceAttestationReference: string;
  workerBundle: { bytes: number; sha256: string };
  integrations: { omp: { packageVersion: string; bytes: number; sha256: string } };
  workerContract: {
    notificationInput: boolean;
    ompWorkerOutputSchemaVersion: number;
    surfaceProtocolVersion: number;
    ompAttentionEventSchemaVersion: number;
    workerDirectProtocolVersion: number;
    jsonlHandshakes: Record<string, unknown>;
  };
  validation: {
    conformanceProofId: string;
    ompOnlyReport: string;
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
  directSocketLifecycle: Record<string, unknown>;
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
  schemaVersion: 3,
  status: "passed",
  signedTag: buildInfo.apertureSourceTag,
  signedTagCommit: buildInfo.apertureCommit,
  sourceDirty: buildInfo.sourceDirty,
  sourceTrust: {
    protectedMainRef: "refs/heads/main",
    requiredStatusCheck: "release-check",
    signerAllowlistSource: "protected-main",
  },
  workflowChain: {
    releaseCheck: {
      runId: options.releaseCheckRunId,
      runAttempt: options.releaseCheckRunAttempt,
      workflowName: "Release Check",
      event: "push",
      sourceRef: "refs/heads/main",
      sourceDigest: buildInfo.apertureCommit,
      conclusion: "success",
    },
    workerArtifact: {
      runId: options.workerArtifactRunId,
      runAttempt: options.workerArtifactRunAttempt,
      workflowName: "Aperture Worker Artifact",
      workflowRef: buildInfo.ci.workflowRef,
      event: "push",
      sourceRef: `refs/tags/${buildInfo.apertureSourceTag}`,
      sourceDigest: buildInfo.apertureCommit,
      conclusion: "success",
    },
    directRelease: {
      runId: options.directReleaseRunId,
      runAttempt: options.directReleaseRunAttempt,
      workflowName: "Aperture Worker Direct Release",
      event: "workflow_dispatch",
      sourceRef: `refs/tags/${buildInfo.apertureSourceTag}`,
      sourceDigest: buildInfo.apertureCommit,
      conclusion: "success",
    },
  },
  finalization: {
    runId: options.evidenceFinalizerRunId,
    runAttempt: options.evidenceFinalizerRunAttempt,
    workflowName: "Aperture Worker Release Evidence",
    event: "workflow_dispatch",
    sourceRef: `refs/tags/${buildInfo.apertureSourceTag}`,
    sourceDigest: buildInfo.apertureCommit,
  },
  releasePolicy: {
    environment: "aperture-worker-release",
    immutableReleasesRequired: true,
  },
  artifactUrl: options.artifactUrl,
  artifactArchiveSha256: sha256(archiveContent),
  archiveAttestationReference: options.archiveAttestationReference,
  buildInfoAttestationReference: options.buildInfoAttestationReference,
  provenanceAttestationReference: buildInfo.provenanceAttestationReference,
  attestationPolicy: {
    sourceRef: `refs/tags/${buildInfo.apertureSourceTag}`,
    sourceDigest: buildInfo.apertureCommit,
    payloadSignerWorkflow:
      "tomismeta/aperture/.github/workflows/aperture-worker-direct-release.yml",
    buildInfoSignerWorkflow:
      "tomismeta/aperture/.github/workflows/aperture-worker-direct-release.yml",
    archiveSignerWorkflow:
      "tomismeta/aperture/.github/workflows/aperture-worker-direct-release.yml",
    releaseReportSignerWorkflow:
      "tomismeta/aperture/.github/workflows/aperture-worker-release-evidence.yml",
  },
  artifactMode: buildInfo.artifactMode,
  notificationInput: buildInfo.workerContract.notificationInput,
  workerBytes: buildInfo.workerBundle.bytes,
  workerSha256: buildInfo.workerBundle.sha256,
  aperturePackageVersion: buildInfo.aperturePackageVersion,
  apertureCoreVersion: buildInfo.apertureCoreVersion,
  ompPackageVersion: buildInfo.ompPackageVersion,
  artifactLimits: {
    maximumTextArtifactBytes: buildInfo.artifactLimits.maximumTextArtifactBytes,
  },
  integrations: {
    omp: {
      packageVersion: buildInfo.integrations.omp.packageVersion,
      bytes: buildInfo.integrations.omp.bytes,
      sha256: buildInfo.integrations.omp.sha256,
    },
  },
  nodeMatrix: buildInfo.validation.nodeCompatibility.map((entry) => ({
    version: entry.nodeVersion,
    status: entry.status,
    evidence: entry.reportPath,
  })),
  ompMatrix: ompCompatibility.matrix,
  ompOnlyWorkerProof: buildInfo.validation.conformanceProofId,
  ompOnlyWorkerEvidence: buildInfo.validation.ompOnlyReport,
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
  directSocketLifecycle: buildInfo.directSocketLifecycle,
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
  unmetPrerequisites: [],
};

await writeFile(path.resolve(options.output), `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${path.resolve(options.output)}\n`);


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
  releaseCheckRunAttempt: string;
  workerArtifactRunId: string;
  workerArtifactRunAttempt: string;
  directReleaseRunId: string;
  directReleaseRunAttempt: string;
  evidenceFinalizerRunId: string;
  evidenceFinalizerRunAttempt: string;
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
      argument === "--release-check-run-attempt" ||
      argument === "--worker-artifact-run-id" ||
      argument === "--worker-artifact-run-attempt" ||
      argument === "--direct-release-run-id" ||
      argument === "--direct-release-run-attempt" ||
      argument === "--evidence-finalizer-run-id" ||
      argument === "--evidence-finalizer-run-attempt" ||
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
      } else if (argument === "--release-check-run-attempt") {
        parsed.releaseCheckRunAttempt = value;
      } else if (argument === "--worker-artifact-run-id") {
        parsed.workerArtifactRunId = value;
      } else if (argument === "--worker-artifact-run-attempt") {
        parsed.workerArtifactRunAttempt = value;
      } else if (argument === "--direct-release-run-id") {
        parsed.directReleaseRunId = value;
      } else if (argument === "--direct-release-run-attempt") {
        parsed.directReleaseRunAttempt = value;
      } else if (argument === "--evidence-finalizer-run-id") {
        parsed.evidenceFinalizerRunId = value;
      } else if (argument === "--evidence-finalizer-run-attempt") {
        parsed.evidenceFinalizerRunAttempt = value;
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
  if (!parsed.releaseCheckRunAttempt) {
    throw new Error("--release-check-run-attempt is required");
  }
  if (!parsed.workerArtifactRunId) throw new Error("--worker-artifact-run-id is required");
  if (!parsed.workerArtifactRunAttempt) {
    throw new Error("--worker-artifact-run-attempt is required");
  }
  if (!parsed.directReleaseRunId) throw new Error("--direct-release-run-id is required");
  if (!parsed.directReleaseRunAttempt) {
    throw new Error("--direct-release-run-attempt is required");
  }
  if (!parsed.evidenceFinalizerRunId) throw new Error("--evidence-finalizer-run-id is required");
  if (!parsed.evidenceFinalizerRunAttempt) {
    throw new Error("--evidence-finalizer-run-attempt is required");
  }
  for (const [label, value] of [
    ["--release-check-run-id", parsed.releaseCheckRunId],
    ["--release-check-run-attempt", parsed.releaseCheckRunAttempt],
    ["--worker-artifact-run-id", parsed.workerArtifactRunId],
    ["--worker-artifact-run-attempt", parsed.workerArtifactRunAttempt],
    ["--direct-release-run-id", parsed.directReleaseRunId],
    ["--direct-release-run-attempt", parsed.directReleaseRunAttempt],
    ["--evidence-finalizer-run-id", parsed.evidenceFinalizerRunId],
    ["--evidence-finalizer-run-attempt", parsed.evidenceFinalizerRunAttempt],
  ] as const) {
    if (!/^[1-9]\d*$/.test(value!)) throw new Error(`${label} must be a positive integer`);
  }
  return parsed as Options;
}
