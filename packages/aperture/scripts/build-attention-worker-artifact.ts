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
const maximumOmpExtensionBytes = 1024 * 1024;
const maximumBundleBytes = 2 * 1024 * 1024;
const minimumNodeVersion = "22.0.0";
const schemaNames = [
  "notification-worker-input.schema.json",
  "notification-worker-output.schema.json",
  "surface-protocol.schema.json",
  "omp-attention-event.schema.json",
  "omp-direct-message.schema.json",
] as const;
const ompFixtureNames = [
  "approval-request.json",
  "input-request.json",
  "failure-event.json",
  "focus-registration.json",
  "focus-activation.json",
  "focus-result.json",
  "completion-event.json",
  "status-event.json",
  "snapshot-failure.json",
  "snapshot-completion.json",
  "snapshot-status.json",
  "snapshot-now-next.json",
  "snapshot-resolved.json",
  "notification-fallback-ambient.json",
] as const;

const options = parseOptions(process.argv.slice(2));
const outputRoot = path.resolve(
  options.outputDir ?? path.join(workspaceRoot, "dist", "aperture-attention-worker"),
);
assertSafeOutputDirectory(outputRoot);
const trustedCi =
  !options.allowUnsignedLocal &&
  process.env.CI === "true" &&
  process.env.APERTURE_TRUSTED_CI === "1" &&
  Boolean(process.env.APERTURE_SOURCE_TAG);
if (!options.allowUnsignedLocal && !trustedCi) {
  throw new Error(
    "release worker build requires APERTURE_SOURCE_TAG and APERTURE_TRUSTED_CI=1 in trusted CI",
  );
}

const bundle = await readFile(workerBundle);
if (bundle.byteLength > maximumBundleBytes) {
  throw new Error(`attention worker bundle exceeds the ${maximumBundleBytes}-byte artifact limit`);
}
const ompBundle = await readFile(ompExtension);
if (ompBundle.byteLength > maximumOmpExtensionBytes) {
  throw new Error(
    `OMP extension bundle exceeds the ${maximumOmpExtensionBytes}-byte artifact limit`,
  );
}

await rm(outputRoot, { recursive: true, force: true });
const libraryRoot = path.join(outputRoot, "lib");
const schemaRoot = path.join(outputRoot, "schemas");
const evidenceRoot = path.join(outputRoot, "evidence");
const ompIntegrationRoot = path.join(outputRoot, "integrations", "omp");
const ompFixtureRoot = path.join(outputRoot, "fixtures", "omp-direct");
await mkdir(libraryRoot, { recursive: true });
await mkdir(schemaRoot, { recursive: true });
await mkdir(evidenceRoot, { recursive: true });
await mkdir(ompIntegrationRoot, { recursive: true });
await mkdir(ompFixtureRoot, { recursive: true });
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
  type?: unknown;
  omp?: { extensions?: unknown };
};
if (
  ompManifestMetadata.name !== "@tomismeta/aperture-omp" ||
  ompManifestMetadata.version !== packageMetadata.version ||
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
const esbuildMetadata = JSON.parse(
  await readFile(requireFromScript.resolve("esbuild/package.json"), "utf8"),
) as { version?: unknown };
const files = await Promise.all([
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
const ompDirectSchema = requiredFile("schemas/omp-direct-message.schema.json");
const ompAttentionSchema = requiredFile("schemas/omp-attention-event.schema.json");
const workerImportEvidence = requiredFile("evidence/runtime-imports.json");
const ompExtensionFile = requiredFile(`integrations/omp/${ompExtensionName}`);
const ompManifestFile = requiredFile("integrations/omp/package.json");
const ompImportEvidence = requiredFile("evidence/omp-runtime-imports.json");
const buildInfo = {
  schemaVersion: 1,
  artifactType: "node-commonjs-bundle",
  worker: "aperture-attention-engine",
  minimumNodeVersion,
  minimumNodeMajor: 22,
  apertureCommit: commit,
  apertureSourceTag: process.env.APERTURE_SOURCE_TAG || null,
  sourceDirty,
  payloadProfile: options.allowUnsignedLocal ? "development" : "release",
  aperturePackageVersion: String(packageMetadata.version || ""),
  apertureCoreVersion: String(coreMetadata.version || ""),
  builder: {
    name: "esbuild",
    version: String(esbuildMetadata.version || ""),
    nodeVersion: process.versions.node,
  },
  workerContract: {
    notificationInputSchemaVersion: 2,
    notificationOutputSchemaVersion: 3,
    surfaceProtocolVersion: 3,
    ompAttentionEventSchemaVersion: 2,
    ompDirectProtocolVersion: 2,
  },
  focusBroker: {
    registrationTtlMs: 15_000,
    heartbeatIntervalMs: 5_000,
    herdrProtocol: "raw-ndjson-0.8.2",
    compositorExecutable: "/usr/bin/hyprctl",
    compositorDispatchTemplate: 'dispatch hl.dsp.focus({ window = "address:<validated>" })',
    activationResults: ["focused", "stale", "missing"],
    titleOwnership: "worker-central-epoch-fenced-lease",
    clientPolicy: "one-foot-client-per-herdr-socket-and-hypr-instance",
    persistence: "volatile-only",
  },
  schemas: {
    input: {
      version: 2,
      path: notificationInputSchema.path,
      sha256: notificationInputSchema.sha256,
    },
    output: {
      version: 3,
      path: notificationOutputSchema.path,
      sha256: notificationOutputSchema.sha256,
    },
    surface: {
      version: 3,
      path: surfaceSchema.path,
      sha256: surfaceSchema.sha256,
    },
    ompAttentionEvent: {
      version: 2,
      path: ompAttentionSchema.path,
      sha256: ompAttentionSchema.sha256,
    },
    ompDirectMessage: {
      version: 2,
      path: ompDirectSchema.path,
      sha256: ompDirectSchema.sha256,
    },
  },
  fixtures: {
    ompDirect: {
      version: 2,
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
    conformanceProofId: "aperture-attention-worker-conformance-v1",
    ambientCeilingProofId: "notification-worker-ambient-ceiling-v1",
    directTransportProofId: "aperture-omp-direct-transport-conformance-v1",
    directPrivacyProofId: "aperture-omp-direct-privacy-v1",
    navigationProofId: "aperture-opaque-focus-navigation-v2",
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
