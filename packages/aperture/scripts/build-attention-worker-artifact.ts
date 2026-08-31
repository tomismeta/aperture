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
const maximumBundleBytes = 2 * 1024 * 1024;
const minimumNodeVersion = "22.0.0";
const schemaNames = [
  "notification-worker-input.schema.json",
  "notification-worker-output.schema.json",
  "surface-protocol.schema.json",
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

await rm(outputRoot, { recursive: true, force: true });
const libraryRoot = path.join(outputRoot, "lib");
const schemaRoot = path.join(outputRoot, "schemas");
const evidenceRoot = path.join(outputRoot, "evidence");
await mkdir(libraryRoot, { recursive: true });
await mkdir(schemaRoot, { recursive: true });
await mkdir(evidenceRoot, { recursive: true });
const stagedBundle = path.join(libraryRoot, workerBundleName);
await copyFile(workerBundle, stagedBundle);
await chmod(stagedBundle, 0o644);
for (const schemaName of schemaNames) {
  await copyFile(path.join(packageRoot, "dist", schemaName), path.join(schemaRoot, schemaName));
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
  artifactFile(outputRoot, stagedImportReport, "0644"),
]);
const workerFile = files[0]!;
const buildInfo = {
  schemaVersion: 1,
  artifactType: "node-commonjs-bundle",
  worker: "aperture-attention-engine",
  minimumNodeVersion,
  minimumNodeMajor: 22,
  apertureCommit: commit,
  apertureSourceTag: process.env.APERTURE_SOURCE_TAG || null,
  sourceDirty,
  aperturePackageVersion: String(packageMetadata.version || ""),
  apertureCoreVersion: String(coreMetadata.version || ""),
  builder: {
    name: "esbuild",
    version: String(esbuildMetadata.version || ""),
    nodeVersion: process.versions.node,
  },
  workerContract: {
    notificationInputSchemaVersion: 1,
    notificationOutputSchemaVersion: 1,
    surfaceProtocolVersion: 1,
  },
  schemas: {
    input: {
      version: 1,
      path: files[1]!.path,
      sha256: files[1]!.sha256,
    },
    output: {
      version: 1,
      path: files[2]!.path,
      sha256: files[2]!.sha256,
    },
    surface: {
      version: 1,
      path: files[3]!.path,
      sha256: files[3]!.sha256,
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
    evidencePath: files[4]!.path,
    evidenceSha256: files[4]!.sha256,
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
