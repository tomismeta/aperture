import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const requireFromScript = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, "..");
const workspaceRoot = path.resolve(packageRoot, "..", "..");
const workerBundleName = "aperture-attention-engine.cjs";
const workerBundle = path.join(packageRoot, "dist", workerBundleName);
const runtimeImportReport = path.join(
  packageRoot,
  "dist",
  "aperture-attention-engine.runtime-imports.json",
);
const ompExtensionName = "aperture-omp-extension.mjs";
const ompExtension = path.join(packageRoot, "dist", ompExtensionName);
const ompExtensionManifest = path.join(workspaceRoot, "packages", "omp", "omarchy-package.json");
const ompRuntimeImportReport = path.join(
  packageRoot,
  "dist",
  "aperture-omp-extension.runtime-imports.json",
);
const maximumMarketplaceArtifactBytes = 524_288;
const minimumNodeVersion = "22.0.0";
const schemaNames = [
  "notification-worker-input.schema.json",
  "notification-worker-output.schema.json",
  "surface-protocol.schema.json",
  "omp-attention-event.schema.json",
  "worker-direct-message.schema.json",
] as const;
const ompFixtureNames = [
  "approval-request.json",
  "input-request.json",
  "failure-event.json",
  "focus-registration.json",
  "focus-registration-direct-terminal.json",
  "focus-registration-tmux.json",
  "focus-activation.json",
  "focus-result.json",
  "completion-event.json",
  "completion-resolved-event.json",
  "status-event.json",
  "snapshot-failure.json",
  "snapshot-completion.json",
  "snapshot-completion-resolved.json",
  "snapshot-status.json",
  "snapshot-now-next.json",
  "snapshot-resolved.json",
] as const;
const identityConfig = {
  schemaVersion: 1,
  identities: [
    {
      id: "omp",
      kind: "omp",
      label: "OMP",
      applicationNames: ["aperture-omp"],
    },
  ],
} as const;

const options = parseOptions(process.argv.slice(2));
const outputRoot = path.resolve(
  options.outputDir ?? path.join(workspaceRoot, "dist", "aperture-attention-worker"),
);
assertSafeOutputDirectory(outputRoot);
const trustedSourceTag = process.env.APERTURE_SOURCE_TAG;
const trustedCi =
  !options.allowUnsignedLocal &&
  process.env.CI === "true" &&
  process.env.APERTURE_TRUSTED_CI === "1" &&
  typeof trustedSourceTag === "string" &&
  /^aperture-worker-v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(trustedSourceTag) &&
  process.env.GITHUB_REF_TYPE === "tag" &&
  process.env.GITHUB_REF_NAME === trustedSourceTag &&
  process.env.GITHUB_REF === `refs/tags/${trustedSourceTag}`;
if (!options.allowUnsignedLocal && !trustedCi) {
  throw new Error(
    "release worker build requires an exact Aperture worker SemVer tag and trusted tag-ref CI context",
  );
}

const bundle = await readFile(workerBundle);
if (bundle.byteLength > maximumMarketplaceArtifactBytes) {
  throw new Error(
    `attention worker bundle is ${bundle.byteLength} bytes; marketplace limit is ${maximumMarketplaceArtifactBytes} bytes`,
  );
}
const ompBundle = await readFile(ompExtension);
if (ompBundle.byteLength > maximumMarketplaceArtifactBytes) {
  throw new Error(
    `OMP extension bundle is ${ompBundle.byteLength} bytes; marketplace limit is ${maximumMarketplaceArtifactBytes} bytes`,
  );
}

await rm(outputRoot, { recursive: true, force: true });
const libraryRoot = path.join(outputRoot, "lib");
const schemaRoot = path.join(outputRoot, "schemas");
const evidenceRoot = path.join(outputRoot, "evidence");
const configRoot = path.join(outputRoot, "config");
const ompIntegrationRoot = path.join(outputRoot, "integrations", "omp");
const ompFixtureRoot = path.join(outputRoot, "fixtures", "omp-direct");
await mkdir(libraryRoot, { recursive: true });
await mkdir(schemaRoot, { recursive: true });
await mkdir(evidenceRoot, { recursive: true });
await mkdir(ompIntegrationRoot, { recursive: true });
await mkdir(configRoot, { recursive: true });
await mkdir(ompFixtureRoot, { recursive: true });
const stagedIdentityConfig = path.join(configRoot, "identities.json");
await writeFile(stagedIdentityConfig, `${JSON.stringify(identityConfig, null, 2)}\n`, "utf8");
await chmod(stagedIdentityConfig, 0o644);
const stagedBundle = path.join(libraryRoot, workerBundleName);
await copyFile(workerBundle, stagedBundle);
await chmod(stagedBundle, 0o644);
const stagedOmpExtension = path.join(ompIntegrationRoot, ompExtensionName);
const stagedOmpManifest = path.join(ompIntegrationRoot, "package.json");
await copyFile(ompExtension, stagedOmpExtension);
await copyFile(ompExtensionManifest, stagedOmpManifest);
await chmod(stagedOmpExtension, 0o644);
await chmod(stagedOmpManifest, 0o644);
for (const schemaName of schemaNames) {
  await copyFile(path.join(packageRoot, "dist", schemaName), path.join(schemaRoot, schemaName));
}
for (const fixtureName of ompFixtureNames) {
  await copyFile(
    path.join(packageRoot, "fixtures", "omp-direct", fixtureName),
    path.join(ompFixtureRoot, fixtureName),
  );
}
const stagedImportReport = path.join(evidenceRoot, "runtime-imports.json");
await copyFile(runtimeImportReport, stagedImportReport);
const importReport = JSON.parse(await readFile(stagedImportReport, "utf8")) as {
  schemaVersion?: unknown;
  status?: unknown;
  policy?: unknown;
  imports?: unknown;
};
if (
  importReport.schemaVersion !== 1 ||
  importReport.status !== "passed" ||
  importReport.policy !== "node-builtins-only" ||
  !Array.isArray(importReport.imports) ||
  !importReport.imports.every(
    (entry): entry is string => typeof entry === "string" && entry.startsWith("node:"),
  )
) {
  throw new Error("attention worker runtime import audit is invalid");
}
const stagedOmpImportReport = path.join(evidenceRoot, "omp-runtime-imports.json");
await copyFile(ompRuntimeImportReport, stagedOmpImportReport);
const ompImportReport = JSON.parse(await readFile(stagedOmpImportReport, "utf8")) as {
  schemaVersion?: unknown;
  status?: unknown;
  policy?: unknown;
  imports?: unknown;
};
if (
  ompImportReport.schemaVersion !== 1 ||
  ompImportReport.status !== "passed" ||
  ompImportReport.policy !== "node-builtins-only" ||
  !Array.isArray(ompImportReport.imports) ||
  !ompImportReport.imports.every(
    (entry): entry is string => typeof entry === "string" && entry.startsWith("node:"),
  )
) {
  throw new Error("OMP extension runtime import audit is invalid");
}

const repositoryCommit = await gitValue(["rev-parse", "HEAD"]);
const sourceDirty = (await gitValue(["status", "--porcelain"])).length > 0;
const commit = process.env.APERTURE_SOURCE_COMMIT || repositoryCommit;
if (trustedCi && commit !== repositoryCommit) {
  throw new Error("APERTURE_SOURCE_COMMIT does not match the checked-out Aperture commit");
}
if (trustedCi && sourceDirty) {
  throw new Error("trusted attention worker artifact requires a clean source checkout");
}
const packageMetadata = JSON.parse(
  await readFile(path.join(packageRoot, "package.json"), "utf8"),
) as { version?: unknown };
const ompManifestMetadata = JSON.parse(await readFile(stagedOmpManifest, "utf8")) as {
  name?: unknown;
  version?: unknown;
  private?: unknown;
  type?: unknown;
  omp?: { extensions?: unknown };
};
if (
  ompManifestMetadata.name !== "@tomismeta/aperture-omp" ||
  ompManifestMetadata.version !== "0.1.0" ||
  ompManifestMetadata.private !== true ||
  ompManifestMetadata.type !== "module" ||
  !Array.isArray(ompManifestMetadata.omp?.extensions) ||
  ompManifestMetadata.omp.extensions.length !== 1 ||
  ompManifestMetadata.omp.extensions[0] !== `./${ompExtensionName}`
) {
  throw new Error("vendored OMP extension manifest is invalid");
}
const coreMetadata = JSON.parse(
  await readFile(path.join(workspaceRoot, "packages", "core", "package.json"), "utf8"),
) as { version?: unknown };
if (packageMetadata.version !== "0.10.0") {
  throw new Error("Aperture worker payload requires @tomismeta/aperture 0.10.0");
}
if (coreMetadata.version !== "0.9.0") {
  throw new Error("Aperture worker payload requires @tomismeta/aperture-core 0.9.0");
}
const esbuildMetadata = JSON.parse(
  await readFile(requireFromScript.resolve("esbuild/package.json"), "utf8"),
) as { version?: unknown };
const files = await Promise.all([
  artifactFile(outputRoot, stagedIdentityConfig, "0644"),
  artifactFile(outputRoot, stagedBundle, "0644"),
  ...schemaNames.map((schemaName) =>
    artifactFile(outputRoot, path.join(schemaRoot, schemaName), "0644"),
  ),
  ...ompFixtureNames.map((fixtureName) =>
    artifactFile(outputRoot, path.join(ompFixtureRoot, fixtureName), "0644"),
  ),
  artifactFile(outputRoot, stagedImportReport, "0644"),
  artifactFile(outputRoot, stagedOmpExtension, "0644"),
  artifactFile(outputRoot, stagedOmpManifest, "0644"),
  artifactFile(outputRoot, stagedOmpImportReport, "0644"),
]);
const fileByPath = new Map(files.map((entry) => [entry.path, entry]));
const requiredFile = (relativePath: string) => {
  const entry = fileByPath.get(relativePath);
  if (!entry) throw new Error(`staged artifact is missing ${relativePath}`);
  return entry;
};
const workerFile = requiredFile(`lib/${workerBundleName}`);
const notificationInputSchema = requiredFile("schemas/notification-worker-input.schema.json");
const notificationOutputSchema = requiredFile("schemas/notification-worker-output.schema.json");
const surfaceSchema = requiredFile("schemas/surface-protocol.schema.json");
const workerDirectSchema = requiredFile("schemas/worker-direct-message.schema.json");
const ompAttentionSchema = requiredFile("schemas/omp-attention-event.schema.json");
const workerImportEvidence = requiredFile("evidence/runtime-imports.json");
const ompExtensionFile = requiredFile(`integrations/omp/${ompExtensionName}`);
if (workerFile.bytes > maximumMarketplaceArtifactBytes) {
  throw new Error(
    `staged attention worker is ${workerFile.bytes} bytes; marketplace limit is ${maximumMarketplaceArtifactBytes} bytes`,
  );
}
if (ompExtensionFile.bytes > maximumMarketplaceArtifactBytes) {
  throw new Error(
    `staged OMP extension is ${ompExtensionFile.bytes} bytes; marketplace limit is ${maximumMarketplaceArtifactBytes} bytes`,
  );
}
const ompManifestFile = requiredFile("integrations/omp/package.json");
const ompImportEvidence = requiredFile("evidence/omp-runtime-imports.json");
const apertureSourceTag = process.env.APERTURE_SOURCE_TAG || null;
const releaseSeries = apertureSourceTag ? apertureSourceTag.replace(/\.\d+$/, "") : "development";

const buildInfo = {
  schemaVersion: 1,
  artifactType: "node-commonjs-bundle",
  worker: "aperture-attention-engine",
  artifactMode: "omp-only",
  minimumNodeVersion,
  minimumNodeMajor: 22,
  apertureCommit: commit,
  releaseSeries,
  apertureSourceTag,
  sourceDirty,
  payloadProfile: options.allowUnsignedLocal ? "development" : "release",
  aperturePackageVersion: String(packageMetadata.version || ""),
  artifactLimits: {
    maximumTextArtifactBytes: maximumMarketplaceArtifactBytes,
  },
  apertureCoreVersion: String(coreMetadata.version || ""),
  ompPackageVersion: String(ompManifestMetadata.version),
  builder: {
    name: "esbuild",
    version: String(esbuildMetadata.version || ""),
    nodeVersion: process.versions.node,
  },
  workerContract: {
    notificationInput: false,
    notificationInputSchemaVersion: 2,
    notificationOutputSchemaVersion: 4,
    surfaceProtocolVersion: 4,
    ompAttentionEventSchemaVersion: 3,
    workerDirectProtocolVersion: 4,
    jsonlHandshakes: {
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
    },
  },
  stateMigration: {
    ompDirect: {
      fromSchemaVersions: [1, 2],
      toSchemaVersion: 3,
      navigationAfterMigration: "absent-until-live-registration",
      causalTombstones: ["interaction-resolution", "session-shutdown"],
    },
    legacyNotificationState: "removed-without-restore",
  },
  focusCoordinator: {
    registrationTtlMs: 15_000,
    heartbeatIntervalMs: 5_000,
    retryInitialMs: 250,
    retryMaximumMs: 5_000,
    attentionAcknowledgementTimeoutMs: 1_000,
    focusAcknowledgementTimeoutMs: 2_750,
    focusServerProcessingTimeoutMs: 2_250,
    activeWindowConfirmationIntervalMs: 25,
    activeWindowConfirmationTimeoutMs: 1_000,
    shutdownTimeoutMs: 3_000,
    maximumDirectClients: 32,
    maximumDirectReceipts: 1_024,
    maximumAmbiguousDeliveryAttempts: 3,
    nativeFallbackPolicy: "definite-pre-write-only",
    sessionHeartbeatIntervalMs: 5_000,
    sessionLeaseMs: 20_000,
    sessionReconnectGraceMs: 10_000,
    maximumSessionLeaseRecords: 128,
    maximumQueuedFocusOperations: 64,
    maximumActiveRegistrations: 128,
    maximumLeaseMembers: 32,
    maximumPendingQmlFocusRequests: 16,
    maximumFocusReplayEvents: 64,
    focusReplayAcknowledgementTimeoutMs: 750,
    maximumConcurrentFocusReplays: 1,
    herdrProtocol: "raw-ndjson-0.8.2",
    compositorExecutable: "/usr/bin/hyprctl",
    compositorDispatchTemplate: 'dispatch hl.dsp.focus({ window = "address:<validated>" })',
    activationResults: ["focused", "stale", "missing"],
    titleOwnership: "tmux-cas-herdr-retain-no-conditional-clear",
    herdrTitleRelease: "retained-no-conditional-clear",
    workerGeneration: "volatile-per-worker",
    clientPolicy: "backend-scoped-single-client-admission",
    markerAdmission: "exact-marker-and-live-address-only",
    persistence: "volatile-only",
  },
  directSocketLifecycle: {
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
  },
  focusBackends: ["herdr-0.8.2", "foot-1.27", "tmux-3.7c"],
  schemas: {
    input: {
      version: 2,
      path: notificationInputSchema.path,
      sha256: notificationInputSchema.sha256,
    },
    output: {
      version: 4,
      path: notificationOutputSchema.path,
      sha256: notificationOutputSchema.sha256,
    },
    surface: {
      version: 4,
      path: surfaceSchema.path,
      sha256: surfaceSchema.sha256,
    },
    ompAttentionEvent: {
      version: 3,
      path: ompAttentionSchema.path,
      sha256: ompAttentionSchema.sha256,
    },
    workerDirectMessage: {
      version: 4,
      path: workerDirectSchema.path,
      sha256: workerDirectSchema.sha256,
    },
  },
  fixtures: {
    ompDirect: {
      version: 4,
      paths: ompFixtureNames.map((fixtureName) => `fixtures/omp-direct/${fixtureName}`),
    },
  },
  workerBundle: {
    path: workerFile.path,
    sha256: workerFile.sha256,
    bytes: workerFile.bytes,
  },
  files,
  runtimeDependencies: {
    policy: "node-builtins-only",
    status: "passed",
    imports: importReport.imports,
    evidencePath: workerImportEvidence.path,
    evidenceSha256: workerImportEvidence.sha256,
  },
  integrations: {
    omp: {
      packageVersion: String(ompManifestMetadata.version),
      artifactType: "omp-extension-module",
      path: ompExtensionFile.path,
      manifestPath: ompManifestFile.path,
      sha256: ompExtensionFile.sha256,
      bytes: ompExtensionFile.bytes,
      minimumOmpVersion: "18.0.0",
      proofId: "aperture-omp-adapter-conformance-v1",
      runtimeDependencies: {
        policy: "node-builtins-only",
        status: "passed",
        imports: ompImportReport.imports,
        evidencePath: ompImportEvidence.path,
        evidenceSha256: ompImportEvidence.sha256,
      },
    },
  },
  builtAt: new Date().toISOString(),
  ci: {
    workflowRef: process.env.GITHUB_WORKFLOW_REF || null,
    runId: process.env.GITHUB_RUN_ID || null,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
  },
  validation: {
    status: "pending",
    conformanceProofId: "aperture-omp-only-worker-conformance-v1",
    directTransportProofId: "aperture-omp-direct-transport-conformance-v1",
    directPrivacyProofId: "aperture-omp-direct-privacy-v1",
    navigationProofId: "aperture-opaque-focus-navigation-v4",
    requiredNodeMajors: [22, 24, "current"],
    nodeCompatibility: [],
  },
  provenanceAttestationReference: null,
  provenanceAttestationRequired: true,
  trustedCi,
};
await writeFile(
  path.join(outputRoot, "BUILDINFO.json"),
  `${JSON.stringify(buildInfo, null, 2)}\n`,
  "utf8",
);
process.stdout.write(`${outputRoot}\n`);

type BuildOptions = {
  outputDir?: string;
  allowUnsignedLocal: boolean;
};

function parseOptions(args: string[]): BuildOptions {
  const parsed: BuildOptions = { allowUnsignedLocal: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") continue;
    if (argument === "--output-dir") {
      const value = args[index + 1];
      if (!value) throw new Error("--output-dir requires a path");
      parsed.outputDir = value;
      index += 1;
      continue;
    }
    if (argument === "--allow-unsigned-local") {
      parsed.allowUnsignedLocal = true;
      continue;
    }
    throw new Error(`unknown attention worker artifact option: ${argument ?? "(missing)"}`);
  }
  return parsed;
}

function assertSafeOutputDirectory(value: string): void {
  const root = path.parse(value).root;
  if (value === root || value === workspaceRoot || value === packageRoot) {
    throw new Error(`refusing unsafe attention worker output directory: ${value}`);
  }
}

async function artifactFile(
  root: string,
  filePath: string,
  mode: "0644",
): Promise<{ path: string; sha256: string; bytes: number; mode: "0644" }> {
  const content = await readFile(filePath);
  return {
    path: path.relative(root, filePath).split(path.sep).join("/"),
    sha256: createHash("sha256").update(content).digest("hex"),
    bytes: (await stat(filePath)).size,
    mode,
  };
}

async function gitValue(args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, { cwd: workspaceRoot, encoding: "utf8" });
  return result.stdout.trim();
}
