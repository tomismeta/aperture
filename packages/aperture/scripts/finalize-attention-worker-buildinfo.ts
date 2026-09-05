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
  artifactMode?: unknown;
  aperturePackageVersion?: unknown;
  apertureCoreVersion?: unknown;
  ompPackageVersion?: unknown;
  artifactLimits?: { maximumTextArtifactBytes?: unknown };
  minimumNodeMajor?: unknown;
  workerContract?: unknown;
  directSocketLifecycle?: unknown;
  workerBundle?: { sha256?: unknown; bytes?: unknown };
  integrations?: {
    omp?: {
      sha256?: unknown;
      packageVersion?: unknown;
      bytes?: unknown;
      proofId?: unknown;
      validation?: unknown;
    };
  };
  files?: ArtifactFile[];
  validation?: unknown;
};

type CompatibilityReport = {
  schemaVersion?: unknown;
  proofId?: unknown;
  passed?: unknown;
  nodeVersion?: unknown;
  bundle?: { sha256?: unknown; bytes?: unknown };
  cleanDirectoryWithoutNodeModules?: unknown;
  artifactMode?: unknown;
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

const maximumMarketplaceArtifactBytes = 524_288;
const expectedJsonlHandshakes = {
  privateWorker: {
    protocolVersion: 4,
    peer: "aperture-attention-engine",
    framing: "jsonl",
    outputEncoding: "ascii-json-escapes",
    maximumLineBytes: 262_144,
    navigation: "validated-opaque-focus-only",
  },
  publicSurface: {
    protocolVersion: 4,
    peer: "aperture-stdio",
    framing: "jsonl",
    outputEncoding: "ascii-json-escapes",
    maximumLineBytes: 262_144,
    navigation: "absent",
  },
};
const expectedDirectSocketLifecycle = {
  directoryMode: "0700",
  socketMode: "0600",
  lifecycleLockMode: "0600",
  lifecycleSerialization: "hard-link-owner-lock",
  cleanupDeadlineMs: 1_500,
  cleanupExitCodes: {
    removedOrAbsent: 0,
    unsafe: 74,
    transient: 75,
  },
};
const options = parseOptions(process.argv.slice(2));
const artifactRoot = path.resolve(options.artifactDir);
const buildInfoPath = path.join(artifactRoot, "BUILDINFO.json");
const buildInfo = JSON.parse(await readFile(buildInfoPath, "utf8")) as BuildInfoShape;
const workerBundle = buildInfo.workerBundle;
const ompIntegration = buildInfo.integrations?.omp;
const workerContract = optionalRecord(buildInfo.workerContract);
if (
  workerBundle &&
  typeof workerBundle.bytes === "number" &&
  workerBundle.bytes > maximumMarketplaceArtifactBytes
) {
  throw new Error(
    `attention worker is ${workerBundle.bytes} bytes; marketplace limit is ${maximumMarketplaceArtifactBytes} bytes`,
  );
}
if (
  ompIntegration &&
  typeof ompIntegration.bytes === "number" &&
  ompIntegration.bytes > maximumMarketplaceArtifactBytes
) {
  throw new Error(
    `OMP extension is ${ompIntegration.bytes} bytes; marketplace limit is ${maximumMarketplaceArtifactBytes} bytes`,
  );
}
if (
  buildInfo.artifactType !== "node-commonjs-bundle" ||
  buildInfo.artifactMode !== "omp-only" ||
  buildInfo.minimumNodeMajor !== 22 ||
  buildInfo.aperturePackageVersion !== "0.10.0" ||
  buildInfo.apertureCoreVersion !== "0.9.0" ||
  buildInfo.ompPackageVersion !== "0.1.0" ||
  !workerBundle ||
  buildInfo.artifactLimits?.maximumTextArtifactBytes !== maximumMarketplaceArtifactBytes ||
  workerContract?.notificationInput !== false ||
  JSON.stringify(workerContract?.jsonlHandshakes) !== JSON.stringify(expectedJsonlHandshakes) ||
  JSON.stringify(buildInfo.directSocketLifecycle) !==
    JSON.stringify(expectedDirectSocketLifecycle) ||
  typeof workerBundle.sha256 !== "string" ||
  typeof workerBundle.bytes !== "number" ||
  workerBundle.bytes < 1 ||
  workerBundle.bytes > maximumMarketplaceArtifactBytes ||
  !ompIntegration ||
  ompIntegration.proofId !== "aperture-omp-adapter-conformance-v1" ||
  typeof ompIntegration.sha256 !== "string" ||
  ompIntegration.packageVersion !== "0.1.0" ||
  typeof ompIntegration.bytes !== "number" ||
  ompIntegration.bytes < 1 ||
  ompIntegration.bytes > maximumMarketplaceArtifactBytes
) {
  throw new Error(
    `attention worker BUILDINFO is not finalizable; worker and OMP extension must each be at most ${maximumMarketplaceArtifactBytes} bytes`,
  );
}
const ompManifest = JSON.parse(
  await readFile(path.join(artifactRoot, "integrations", "omp", "package.json"), "utf8"),
) as {
  name?: unknown;
  version?: unknown;
  private?: unknown;
  type?: unknown;
  omp?: { extensions?: unknown };
};
if (
  ompManifest.name !== "@tomismeta/aperture-omp" ||
  ompManifest.version !== buildInfo.ompPackageVersion ||
  ompManifest.private !== true ||
  ompManifest.type !== "module" ||
  JSON.stringify(ompManifest.omp?.extensions) !== JSON.stringify(["./aperture-omp-extension.mjs"])
) {
  throw new Error("attention worker OMP manifest does not match BUILDINFO");
}
if (options.nodeReports.length !== 1) {
  throw new Error("attention worker finalization requires exactly one Node 22 report");
}
if (options.directReports.length !== 1) {
  throw new Error("direct OMP finalization requires exactly one Node 22 report");
}
if (!options.ompReport) {
  throw new Error("attention worker finalization requires an OMP adapter report");
}

const reports = await Promise.all(
  options.nodeReports.map(async (reportPath) => {
    const absolutePath = path.resolve(reportPath);
    const content = await readFile(absolutePath);
    const report = JSON.parse(content.toString("utf8")) as CompatibilityReport;
    if (
      report.schemaVersion !== 1 ||
      report.proofId !== "aperture-omp-only-worker-conformance-v1" ||
      report.passed !== true ||
      typeof report.nodeVersion !== "string" ||
      !report.bundle ||
      report.bundle.sha256 !== workerBundle.sha256 ||
      report.bundle.bytes !== workerBundle.bytes ||
      report.cleanDirectoryWithoutNodeModules !== true ||
      report.artifactMode !== "omp-only" ||
      !Array.isArray(report.checks) ||
      !report.checks.includes("cleanup-mode-no-config-or-engine") ||
      !report.checks.includes("omp-only-handshake") ||
      !report.checks.includes("omp-control-input-only") ||
      !report.checks.includes("no-generic-state-access") ||
      !report.checks.includes("generic-notification-modules-absent") ||
      !report.checks.includes("bounded-ascii-output")
    ) {
      throw new Error(`invalid attention worker compatibility report: ${absolutePath}`);
    }
    return { absolutePath, content, report };
  }),
);
const nodeMajors = new Set(
  reports.map(({ report }) => Number(String(report.nodeVersion).split(".")[0])),
);
if (nodeMajors.size !== 1 || !nodeMajors.has(22)) {
  throw new Error("attention worker compatibility report must cover exactly Node 22");
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
      !Array.isArray(report.checks) ||
      !report.checks.includes("private-output-v4-omp-only-handshake")
    ) {
      throw new Error(`invalid direct OMP compatibility report: ${absolutePath}`);
    }
    return { absolutePath, content, report };
  }),
);
const directNodeMajors = new Set(
  directReports.map(({ report }) => Number(String(report.nodeVersion).split(".")[0])),
);
if (directNodeMajors.size !== 1 || !directNodeMajors.has(22)) {
  throw new Error("direct OMP compatibility report must cover exactly Node 22");
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
const ompOnlyChecks = reports[0]!.report.checks as unknown[];
for (const { report } of reports) {
  if (JSON.stringify(report.checks) !== JSON.stringify(ompOnlyChecks)) {
    throw new Error("OMP-only worker compatibility reports used different checks");
  }
}
const ompOnlyEvidence = {
  schemaVersion: 1,
  proofId: "aperture-omp-only-worker-conformance-v1",
  status: "passed",
  artifactMode: "omp-only",
  notificationInput: false,
  checks: ompOnlyChecks,
  sourceTest: "packages/aperture/scripts/smoke-attention-worker.ts",
  compatibilityReports: compatibility.map((entry) => entry.reportPath),
};
const ompOnlyEvidencePath = path.join(evidenceRoot, "omp-only-worker.json");
await writeFile(ompOnlyEvidencePath, `${JSON.stringify(ompOnlyEvidence, null, 2)}\n`, "utf8");
const stagedOmpReportPath = path.join(evidenceRoot, "omp-adapter.json");
await writeFile(stagedOmpReportPath, ompReportContent);
const existingFiles = Array.isArray(buildInfo.files)
  ? buildInfo.files.filter(
      (entry) =>
        typeof entry.path === "string" &&
        !/^evidence\/(?:node-|direct-node-|omp-only-worker\.json$|direct-transport\.json$|direct-privacy\.json$|omp-adapter\.json$)/.test(
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
  artifactFile(artifactRoot, ompOnlyEvidencePath),
  artifactFile(artifactRoot, directEvidencePath),
  artifactFile(artifactRoot, privacyEvidencePath),
  artifactFile(artifactRoot, stagedOmpReportPath),
]);
buildInfo.files = [...existingFiles, ...evidenceFiles].sort((left, right) =>
  left.path.localeCompare(right.path),
);
buildInfo.validation = {
  status: "passed",
  conformanceProofId: "aperture-omp-only-worker-conformance-v1",
  ompOnlyReport: "evidence/omp-only-worker.json",
  nodeCompatibility: compatibility,
  ompAdapterProofId: "aperture-omp-adapter-conformance-v1",
  directTransportProofId: "aperture-omp-direct-transport-conformance-v1",
  directTransportReport: "evidence/direct-transport.json",
  directPrivacyProofId: "aperture-omp-direct-privacy-v1",
  directPrivacyReport: "evidence/direct-privacy.json",
  navigationProofId: "aperture-opaque-focus-navigation-v4",
  directNodeCompatibility: directCompatibility,
};
ompIntegration.validation = {
  status: "passed",
  proofId: "aperture-omp-adapter-conformance-v1",
  reportPath: "evidence/omp-adapter.json",
  reportSha256: createHash("sha256").update(ompReportContent).digest("hex"),
};
await writeFile(buildInfoPath, `${JSON.stringify(buildInfo, null, 2)}\n`, "utf8");
process.stdout.write(`${buildInfoPath}\n`);

type FinalizeOptions = {
  artifactDir: string;
  nodeReports: string[];
  directReports: string[];
  ompReport: string;
};

function parseOptions(args: string[]): FinalizeOptions {
  let artifactDir = "";
  const nodeReports: string[] = [];
  const parsedDirectReports: string[] = [];
  let parsedOmpReport = "";
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") continue;
    if (
      argument === "--artifact-dir" ||
      argument === "--node-report" ||
      argument === "--direct-report" ||
      argument === "--omp-report"
    ) {
      const value = args[index + 1];
      if (!value) throw new Error(`${argument} requires a value`);
      if (argument === "--artifact-dir") artifactDir = value;
      else if (argument === "--node-report") nodeReports.push(value);
      else if (argument === "--direct-report") parsedDirectReports.push(value);
      else parsedOmpReport = value;
      index += 1;
      continue;
    }
    throw new Error(`unknown BUILDINFO finalization option: ${argument ?? "(missing)"}`);
  }
  if (!artifactDir) throw new Error("--artifact-dir is required");
  if (!parsedOmpReport) throw new Error("--omp-report is required");
  return {
    artifactDir,
    nodeReports,
    directReports: parsedDirectReports,
    ompReport: parsedOmpReport,
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

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
