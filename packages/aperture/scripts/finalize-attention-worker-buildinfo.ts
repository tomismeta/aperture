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
  integrations?: {
    omp?: {
      sha256?: unknown;
      bytes?: unknown;
      proofId?: unknown;
      validation?: unknown;
      hostCompatibility?: unknown;
    };
  };
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

type DirectCompatibilityReport = {
  schemaVersion?: unknown;
  proofId?: unknown;
  privacyProofId?: unknown;
  navigationProofId?: unknown;
  passed?: unknown;
  nodeVersion?: unknown;
  bundle?: { sha256?: unknown; bytes?: unknown };
  cleanDirectoryWithoutNodeModules?: unknown;
  socket?: {
    relativePath?: unknown;
    directoryMode?: unknown;
    socketMode?: unknown;
    removedOnShutdown?: unknown;
  };
  checks?: unknown;
};

type OmpCompatibilityReport = {
  schemaVersion?: unknown;
  proofId?: unknown;
  passed?: unknown;
  runtime?: unknown;
  bundle?: { sha256?: unknown; bytes?: unknown };
  cleanDirectoryWithoutNodeModules?: unknown;
  registeredEvents?: unknown;
  decisions?: {
    builtInNotifications?: unknown;
    identicalReplacement?: unknown;
    sessionShutdown?: unknown;
    credentialDisabled?: unknown;
    directTransport?: unknown;
    nativeFallback?: unknown;
    deliveryScheduling?: unknown;
  };
};

type OmpHostCompatibilityReport = {
  schemaVersion?: unknown;
  proofId?: unknown;
  passed?: unknown;
  worker?: { sha256?: unknown; bytes?: unknown };
  extension?: { sha256?: unknown; bytes?: unknown };
  socketRemovedOnShutdown?: unknown;
  matrix?: unknown;
};
type FocusBackendReport = {
  schemaVersion?: unknown;
  proofId?: unknown;
  status?: unknown;
  backends?: unknown;
  checks?: unknown;
};

const options = parseOptions(process.argv.slice(2));
const artifactRoot = path.resolve(options.artifactDir);
const buildInfoPath = path.join(artifactRoot, "BUILDINFO.json");
const buildInfo = JSON.parse(await readFile(buildInfoPath, "utf8")) as BuildInfoShape;
const workerBundle = buildInfo.workerBundle;
const ompIntegration = buildInfo.integrations?.omp;
if (
  buildInfo.artifactType !== "node-commonjs-bundle" ||
  buildInfo.minimumNodeMajor !== 22 ||
  !workerBundle ||
  typeof workerBundle.sha256 !== "string" ||
  typeof workerBundle.bytes !== "number" ||
  !ompIntegration ||
  ompIntegration.proofId !== "aperture-omp-adapter-conformance-v1" ||
  typeof ompIntegration.sha256 !== "string" ||
  typeof ompIntegration.bytes !== "number"
) {
  throw new Error("attention worker BUILDINFO is not finalizable");
}
if (options.nodeReports.length < 3) {
  throw new Error("attention worker finalization requires Node 22, Node 24, and current reports");
}
if (options.directReports.length < 3) {
  throw new Error("direct OMP finalization requires Node 22, Node 24, and current reports");
}
if (!options.ompReport) {
  throw new Error("attention worker finalization requires an OMP adapter report");
}
if (!options.ompHostReport) {
  throw new Error("attention worker finalization requires an OMP host matrix report");
}
if (!options.focusReport) {
  throw new Error("attention worker finalization requires a focus backend report");
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
const directReports = await Promise.all(
  options.directReports.map(async (reportPath) => {
    const absolutePath = path.resolve(reportPath);
    const content = await readFile(absolutePath);
    const report = JSON.parse(content.toString("utf8")) as DirectCompatibilityReport;
    if (
      report.schemaVersion !== 1 ||
      report.proofId !== "aperture-omp-direct-transport-conformance-v1" ||
      report.privacyProofId !== "aperture-omp-direct-privacy-v1" ||
      report.navigationProofId !== "aperture-opaque-focus-navigation-v4" ||
      report.passed !== true ||
      typeof report.nodeVersion !== "string" ||
      !report.bundle ||
      report.bundle.sha256 !== workerBundle.sha256 ||
      report.bundle.bytes !== workerBundle.bytes ||
      report.cleanDirectoryWithoutNodeModules !== true ||
      report.socket?.relativePath !== "omarchy/aperture/attention.sock" ||
      report.socket.directoryMode !== "0700" ||
      report.socket.socketMode !== "0600" ||
      report.socket.removedOnShutdown !== true ||
      !Array.isArray(report.checks)
    ) {
      throw new Error(`invalid direct OMP compatibility report: ${absolutePath}`);
    }
    return { absolutePath, content, report };
  }),
);
const directNodeMajors = new Set(
  directReports.map(({ report }) => Number(String(report.nodeVersion).split(".")[0])),
);
if (
  !directNodeMajors.has(22) ||
  !directNodeMajors.has(24) ||
  ![...directNodeMajors].some((major) => major > 24)
) {
  throw new Error("direct OMP reports do not cover Node 22, Node 24, and current");
}
const ompReportPath = path.resolve(options.ompReport);
const ompReportContent = await readFile(ompReportPath);
const ompReport = JSON.parse(ompReportContent.toString("utf8")) as OmpCompatibilityReport;
if (
  ompReport.schemaVersion !== 1 ||
  ompReport.proofId !== "aperture-omp-adapter-conformance-v1" ||
  ompReport.passed !== true ||
  ompReport.runtime !== "omp-extension-module" ||
  !ompReport.bundle ||
  ompReport.bundle.sha256 !== ompIntegration.sha256 ||
  ompReport.bundle.bytes !== ompIntegration.bytes ||
  ompReport.cleanDirectoryWithoutNodeModules !== true ||
  !Array.isArray(ompReport.registeredEvents) ||
  ompReport.decisions?.builtInNotifications !==
    "suppressed-process-locally-when-transport-available" ||
  ompReport.decisions.identicalReplacement !== "native-id-reuse-without-artificial-update" ||
  ompReport.decisions.sessionShutdown !== "close-persistent-approval-and-input-only" ||
  ompReport.decisions.credentialDisabled !== "deterministic-typed-event-proof" ||
  ompReport.decisions.directTransport !== "acknowledged-direct-suppresses-native" ||
  ompReport.decisions.nativeFallback !== "direct-failure-restores-native" ||
  ompReport.decisions.deliveryScheduling !== "non-blocking-bounded-queue"
) {
  throw new Error("invalid OMP adapter compatibility report");
}
const ompHostReportPath = path.resolve(options.ompHostReport);
const ompHostReportContent = await readFile(ompHostReportPath);
const ompHostReport = JSON.parse(
  ompHostReportContent.toString("utf8"),
) as OmpHostCompatibilityReport;
if (
  ompHostReport.schemaVersion !== 1 ||
  ompHostReport.proofId !== "aperture-omp-host-direct-compatibility-v1" ||
  ompHostReport.passed !== true ||
  ompHostReport.worker?.sha256 !== workerBundle.sha256 ||
  ompHostReport.worker.bytes !== workerBundle.bytes ||
  ompHostReport.extension?.sha256 !== ompIntegration.sha256 ||
  ompHostReport.extension.bytes !== ompIntegration.bytes ||
  ompHostReport.socketRemovedOnShutdown !== true ||
  !Array.isArray(ompHostReport.matrix) ||
  !ompHostReport.matrix.every(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      "status" in entry &&
      entry.status === "passed" &&
      "actualExtensionLoader" in entry &&
      entry.actualExtensionLoader === true &&
      "rpcReady" in entry &&
      entry.rpcReady === true &&
      "directSocketDelivered" in entry &&
      entry.directSocketDelivered === true &&
      "modelRequestSent" in entry &&
      entry.modelRequestSent === false,
  ) ||
  !ompHostReport.matrix.some(
    (entry) => (entry as { ompVersion?: unknown }).ompVersion === "18.0.11",
  )
) {
  throw new Error("invalid OMP host compatibility report");
}
const focusReportPath = path.resolve(options.focusReport);
const focusReportContent = await readFile(focusReportPath);
const focusReport = JSON.parse(focusReportContent.toString("utf8")) as FocusBackendReport;
if (
  focusReport.schemaVersion !== 1 ||
  focusReport.proofId !== "aperture-opaque-focus-navigation-v4" ||
  focusReport.status !== "passed" ||
  !Array.isArray(focusReport.backends) ||
  !["herdr", "direct-terminal", "tmux"].every((backend) =>
    focusReport.backends!.some(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        "backend" in entry &&
        entry.backend === backend &&
        "result" in entry &&
        entry.result === "focused",
    ),
  ) ||
  !Array.isArray(focusReport.checks)
) {
  throw new Error("invalid positive focus backend report");
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
const directCompatibility = [];
for (const { content, report } of directReports) {
  const nodeVersion = String(report.nodeVersion);
  const name = `direct-node-${nodeVersion}.json`;
  const destination = path.join(evidenceRoot, name);
  await writeFile(destination, content);
  directCompatibility.push({
    nodeVersion,
    status: "passed",
    reportPath: `evidence/${name}`,
    reportSha256: createHash("sha256").update(content).digest("hex"),
  });
}
directCompatibility.sort((left, right) => left.nodeVersion.localeCompare(right.nodeVersion));
const directChecks = directReports[0]!.report.checks as unknown[];
for (const { report } of directReports) {
  if (JSON.stringify(report.checks) !== JSON.stringify(directChecks)) {
    throw new Error("direct OMP compatibility reports used different checks");
  }
}
const directEvidence = {
  schemaVersion: 1,
  proofId: "aperture-omp-direct-transport-conformance-v1",
  navigationProofId: "aperture-opaque-focus-navigation-v4",
  status: "passed",
  socket: {
    relativePath: "omarchy/aperture/attention.sock",
    directoryMode: "0700",
    socketMode: "0600",
    removedOnShutdown: true,
  },
  checks: directChecks,
  fixtureRoot: "fixtures/omp-direct",
  compatibilityReports: directCompatibility.map((entry) => entry.reportPath),
};
const directEvidencePath = path.join(evidenceRoot, "direct-transport.json");
await writeFile(directEvidencePath, `${JSON.stringify(directEvidence, null, 2)}\n`, "utf8");
const privacyEvidence = {
  schemaVersion: 1,
  proofId: "aperture-omp-direct-privacy-v1",
  status: "passed",
  forbiddenInput: [
    "prompt text",
    "raw tool input",
    "raw tool output",
    "approval reason",
    "credential material",
    "private filesystem path",
    "executable command",
  ],
  persistedStateMode: "0600",
  sourceTest: "packages/aperture/test/omp-direct-worker.test.ts",
  compatibilityReports: directCompatibility.map((entry) => entry.reportPath),
};
const privacyEvidencePath = path.join(evidenceRoot, "direct-privacy.json");
await writeFile(privacyEvidencePath, `${JSON.stringify(privacyEvidence, null, 2)}\n`, "utf8");
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
const stagedOmpReportPath = path.join(evidenceRoot, "omp-adapter.json");
await writeFile(stagedOmpReportPath, ompReportContent);
const stagedOmpHostReportPath = path.join(evidenceRoot, "omp-host-matrix.json");
await writeFile(stagedOmpHostReportPath, ompHostReportContent);
const stagedFocusReportPath = path.join(evidenceRoot, "focus-backends.json");
await writeFile(stagedFocusReportPath, focusReportContent);
const existingFiles = Array.isArray(buildInfo.files)
  ? buildInfo.files.filter(
      (entry) =>
        typeof entry.path === "string" &&
        !/^evidence\/(?:node-|direct-node-|ambient-ceiling\.json$|direct-transport\.json$|direct-privacy\.json$|omp-adapter\.json$|omp-host-matrix\.json$|focus-backends\.json$)/.test(
          entry.path,
        ),
    )
  : [];
const evidenceFiles = await Promise.all([
  ...compatibility.map((entry) =>
    artifactFile(artifactRoot, path.join(artifactRoot, entry.reportPath)),
  ),
  ...directCompatibility.map((entry) =>
    artifactFile(artifactRoot, path.join(artifactRoot, entry.reportPath)),
  ),
  artifactFile(artifactRoot, ambientEvidencePath),
  artifactFile(artifactRoot, directEvidencePath),
  artifactFile(artifactRoot, privacyEvidencePath),
  artifactFile(artifactRoot, stagedOmpReportPath),
  artifactFile(artifactRoot, stagedOmpHostReportPath),
  artifactFile(artifactRoot, stagedFocusReportPath),
]);
buildInfo.files = [...existingFiles, ...evidenceFiles].sort((left, right) =>
  left.path.localeCompare(right.path),
);
buildInfo.validation = {
  status: "passed",
  conformanceProofId: "aperture-attention-worker-conformance-v1",
  ambientCeilingProofId: "notification-worker-ambient-ceiling-v1",
  ambientCeilingReport: "evidence/ambient-ceiling.json",
  nodeCompatibility: compatibility,
  ompAdapterProofId: "aperture-omp-adapter-conformance-v1",
  directTransportProofId: "aperture-omp-direct-transport-conformance-v1",
  directTransportReport: "evidence/direct-transport.json",
  directPrivacyProofId: "aperture-omp-direct-privacy-v1",
  directPrivacyReport: "evidence/direct-privacy.json",
  navigationProofId: "aperture-opaque-focus-navigation-v4",
  focusBackendReport: "evidence/focus-backends.json",
  directNodeCompatibility: directCompatibility,
  ompHostProofId: "aperture-omp-host-direct-compatibility-v1",
  ompHostReport: "evidence/omp-host-matrix.json",
};
ompIntegration.validation = {
  status: "passed",
  proofId: "aperture-omp-adapter-conformance-v1",
  reportPath: "evidence/omp-adapter.json",
  reportSha256: createHash("sha256").update(ompReportContent).digest("hex"),
};
ompIntegration.hostCompatibility = {
  status: "passed",
  proofId: "aperture-omp-host-direct-compatibility-v1",
  reportPath: "evidence/omp-host-matrix.json",
  reportSha256: createHash("sha256").update(ompHostReportContent).digest("hex"),
  versions: (ompHostReport.matrix as Array<{ ompVersion: string }>).map(
    (entry) => entry.ompVersion,
  ),
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
  directReports: string[];
  ompReport: string;
  ompHostReport: string;
  focusReport: string;
  attestationReference?: string;
};

function parseOptions(args: string[]): FinalizeOptions {
  let artifactDir = "";
  const nodeReports: string[] = [];
  const parsedDirectReports: string[] = [];
  let parsedOmpReport = "";
  let parsedOmpHostReport = "";
  let parsedFocusReport = "";
  let attestationReference: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") continue;
    if (
      argument === "--artifact-dir" ||
      argument === "--node-report" ||
      argument === "--direct-report" ||
      argument === "--omp-report" ||
      argument === "--omp-host-report" ||
      argument === "--focus-report" ||
      argument === "--attestation-reference"
    ) {
      const value = args[index + 1];
      if (!value) throw new Error(`${argument} requires a value`);
      if (argument === "--artifact-dir") artifactDir = value;
      else if (argument === "--node-report") nodeReports.push(value);
      else if (argument === "--direct-report") parsedDirectReports.push(value);
      else if (argument === "--omp-report") parsedOmpReport = value;
      else if (argument === "--omp-host-report") parsedOmpHostReport = value;
      else if (argument === "--focus-report") parsedFocusReport = value;
      else attestationReference = value;
      index += 1;
      continue;
    }
    throw new Error(`unknown BUILDINFO finalization option: ${argument ?? "(missing)"}`);
  }
  if (!artifactDir) throw new Error("--artifact-dir is required");
  if (!parsedOmpReport) throw new Error("--omp-report is required");
  if (!parsedOmpHostReport) throw new Error("--omp-host-report is required");
  if (!parsedFocusReport) throw new Error("--focus-report is required");
  return {
    artifactDir,
    nodeReports,
    directReports: parsedDirectReports,
    ompReport: parsedOmpReport,
    ompHostReport: parsedOmpHostReport,
    focusReport: parsedFocusReport,
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
