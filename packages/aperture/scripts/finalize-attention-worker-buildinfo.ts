import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

type ArtifactFile = {
  path: string;
  sha256: string;
  bytes: number;
  mode: "0644";
};

type BuildInfoShape = {
  artifactType?: unknown;
  minimumNodeMajor?: unknown;
  workerBundle?: { sha256?: unknown; bytes?: unknown };
  files?: ArtifactFile[];
  validation?: unknown;
  provenanceAttestationReference?: string | null;
  trustedCi?: unknown;
};

type CompatibilityReport = {
  schemaVersion?: unknown;
  proofId?: unknown;
  ambientCeilingProofId?: unknown;
  passed?: unknown;
  nodeVersion?: unknown;
  bundle?: { sha256?: unknown; bytes?: unknown };
  cleanDirectoryWithoutNodeModules?: unknown;
  ambientCases?: unknown;
  checks?: unknown;
};

const options = parseOptions(process.argv.slice(2));
const artifactRoot = path.resolve(options.artifactDir);
const buildInfoPath = path.join(artifactRoot, "BUILDINFO.json");
const buildInfo = JSON.parse(await readFile(buildInfoPath, "utf8")) as BuildInfoShape;
const workerBundle = buildInfo.workerBundle;
if (
  buildInfo.artifactType !== "node-commonjs-bundle" ||
  buildInfo.minimumNodeMajor !== 22 ||
  !workerBundle ||
  typeof workerBundle.sha256 !== "string" ||
  typeof workerBundle.bytes !== "number"
) {
  throw new Error("attention worker BUILDINFO is not finalizable");
}
if (options.nodeReports.length < 3) {
  throw new Error("attention worker finalization requires Node 22, Node 24, and current reports");
}

const reports = await Promise.all(
  options.nodeReports.map(async (reportPath) => {
    const absolutePath = path.resolve(reportPath);
    const content = await readFile(absolutePath);
    const report = JSON.parse(content.toString("utf8")) as CompatibilityReport;
    if (
      report.schemaVersion !== 1 ||
      report.proofId !== "aperture-attention-worker-conformance-v1" ||
      report.ambientCeilingProofId !== "notification-worker-ambient-ceiling-v1" ||
      report.passed !== true ||
      typeof report.nodeVersion !== "string" ||
      !report.bundle ||
      report.bundle.sha256 !== workerBundle.sha256 ||
      report.bundle.bytes !== workerBundle.bytes ||
      report.cleanDirectoryWithoutNodeModules !== true ||
      !Array.isArray(report.ambientCases) ||
      !Array.isArray(report.checks)
    ) {
      throw new Error(`invalid attention worker compatibility report: ${absolutePath}`);
    }
    return { absolutePath, content, report };
  }),
);
const nodeMajors = new Set(
  reports.map(({ report }) => Number(String(report.nodeVersion).split(".")[0])),
);
if (!nodeMajors.has(22) || !nodeMajors.has(24) || ![...nodeMajors].some((major) => major > 24)) {
  throw new Error(
    "attention worker compatibility reports do not cover Node 22, Node 24, and current",
  );
}

const evidenceRoot = path.join(artifactRoot, "evidence");
await mkdir(evidenceRoot, { recursive: true });
const compatibility = [];
for (const { content, report } of reports) {
  const nodeVersion = String(report.nodeVersion);
  const name = `node-${nodeVersion}.json`;
  const destination = path.join(evidenceRoot, name);
  await writeFile(destination, content);
  compatibility.push({
    nodeVersion,
    status: "passed",
    reportPath: `evidence/${name}`,
    reportSha256: createHash("sha256").update(content).digest("hex"),
  });
}
compatibility.sort((left, right) => left.nodeVersion.localeCompare(right.nodeVersion));
const ambientCases = reports[0]!.report.ambientCases as unknown[];
for (const { report } of reports) {
  if (JSON.stringify(report.ambientCases) !== JSON.stringify(ambientCases)) {
    throw new Error("attention worker compatibility reports used different Ambient cases");
  }
}
const ambientEvidence = {
  schemaVersion: 1,
  proofId: "notification-worker-ambient-ceiling-v1",
  status: "passed",
  expected: {
    now: null,
    next: [],
    lane: "ambient",
    tone: "ambient",
    consequence: "low",
    provenance: "omitted",
  },
  cases: ambientCases,
  sourceTest: "packages/aperture/test/notification-worker.test.ts",
  compatibilityReports: compatibility.map((entry) => entry.reportPath),
};
const ambientEvidencePath = path.join(evidenceRoot, "ambient-ceiling.json");
await writeFile(ambientEvidencePath, `${JSON.stringify(ambientEvidence, null, 2)}\n`, "utf8");
const existingFiles = Array.isArray(buildInfo.files)
  ? buildInfo.files.filter(
      (entry) =>
        typeof entry.path === "string" &&
        !/^evidence\/(?:node-|ambient-ceiling\.json$)/.test(entry.path),
    )
  : [];
const evidenceFiles = await Promise.all([
  ...compatibility.map((entry) =>
    artifactFile(artifactRoot, path.join(artifactRoot, entry.reportPath)),
  ),
  artifactFile(artifactRoot, ambientEvidencePath),
]);
buildInfo.files = [...existingFiles, ...evidenceFiles];
buildInfo.validation = {
  status: "passed",
  conformanceProofId: "aperture-attention-worker-conformance-v1",
  ambientCeilingProofId: "notification-worker-ambient-ceiling-v1",
  ambientCeilingReport: "evidence/ambient-ceiling.json",
  nodeCompatibility: compatibility,
};
buildInfo.provenanceAttestationReference = options.attestationReference ?? null;
if (buildInfo.trustedCi === true && !options.attestationReference) {
  throw new Error("trusted attention worker BUILDINFO requires an attestation reference");
}
await writeFile(buildInfoPath, `${JSON.stringify(buildInfo, null, 2)}\n`, "utf8");
process.stdout.write(`${buildInfoPath}\n`);

type FinalizeOptions = {
  artifactDir: string;
  nodeReports: string[];
  attestationReference?: string;
};

function parseOptions(args: string[]): FinalizeOptions {
  let artifactDir = "";
  const nodeReports: string[] = [];
  let attestationReference: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") continue;
    if (
      argument === "--artifact-dir" ||
      argument === "--node-report" ||
      argument === "--attestation-reference"
    ) {
      const value = args[index + 1];
      if (!value) throw new Error(`${argument} requires a value`);
      if (argument === "--artifact-dir") artifactDir = value;
      else if (argument === "--node-report") nodeReports.push(value);
      else attestationReference = value;
      index += 1;
      continue;
    }
    throw new Error(`unknown BUILDINFO finalization option: ${argument ?? "(missing)"}`);
  }
  if (!artifactDir) throw new Error("--artifact-dir is required");
  return {
    artifactDir,
    nodeReports,
    ...(attestationReference ? { attestationReference } : {}),
  };
}

async function artifactFile(root: string, filePath: string): Promise<ArtifactFile> {
  const content = await readFile(filePath);
  return {
    path: path.relative(root, filePath).split(path.sep).join("/"),
    sha256: createHash("sha256").update(content).digest("hex"),
    bytes: (await stat(filePath)).size,
    mode: "0644",
  };
}
