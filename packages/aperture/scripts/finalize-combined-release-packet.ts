import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const WORKER_BYTES = 909_269;
const WORKER_SHA256 = "a24ccd5f91c106a056ac48502e33cdfba85010efc7d2b54e085e915df2fbb294";
const OMP_BYTES = 12_712;
const OMP_SHA256 = "4ed0828ece31c1d82c521c304b2670b6b6224359472dd9d2090cd01818c70268";
const WORKER_PROOF = "aperture-attention-worker-conformance-v1";
const AMBIENT_PROOF = "notification-worker-ambient-ceiling-v1";
const OMP_PROOF = "aperture-omp-adapter-conformance-v1";
const OMP_VERSION = "18.0.11";
const ROOT_ENTRIES = new Set([
  "BUILDINFO.json",
  "config",
  "evidence",
  "integrations",
  "lib",
  "schemas",
]);
const FIXED_FILES = new Set([
  "config/identities.json",
  "evidence/ambient-ceiling.json",
  "evidence/omp-18.0.11.json",
  "evidence/omp-adapter.json",
  "evidence/omp-runtime-imports.json",
  "evidence/runtime-imports.json",
  "integrations/omp/aperture-omp-extension.mjs",
  "integrations/omp/package.json",
  "lib/aperture-attention-engine.cjs",
  "schemas/notification-worker-input.schema.json",
  "schemas/notification-worker-output.schema.json",
  "schemas/surface-protocol.schema.json",
]);
const IDENTITY_CONFIG = {
  schemaVersion: 1,
  identities: [
    {
      id: "omp",
      kind: "omp",
      label: "OMP",
      applicationNames: ["aperture-omp"],
    },
  ],
};

type ArtifactFile = {
  path: string;
  sha256: string;
  bytes: number;
  mode: string;
};

type BuildInfo = Record<string, unknown> & {
  files?: unknown;
  provenanceAttestationReference?: unknown;
};

const options = parseOptions(process.argv.slice(2));
const artifactRoot = path.resolve(options.artifactDir);
const buildInfoPath = path.join(artifactRoot, "BUILDINFO.json");

if (!options.verifyOnly) {
  const configRoot = path.join(artifactRoot, "config");
  await mkdir(configRoot, { recursive: true });
  const identityPath = path.join(configRoot, "identities.json");
  await writeFile(identityPath, `${JSON.stringify(IDENTITY_CONFIG, null, 2)}\n`, "utf8");
  await chmod(identityPath, 0o644);
}

const draftBuildInfo = JSON.parse(await readFile(buildInfoPath, "utf8")) as BuildInfo;
await validateMetadata(draftBuildInfo, artifactRoot, options.sourceCommit, options.sourceTag);
const artifactFiles = await collectArtifactFiles(artifactRoot);
validateAllowedFiles(artifactFiles);

if (options.verifyOnly) {
  assertManifest(draftBuildInfo.files, artifactFiles);
} else {
  draftBuildInfo.files = artifactFiles;
  draftBuildInfo.provenanceAttestationReference = options.attestationReference;
  await writeFile(buildInfoPath, `${JSON.stringify(draftBuildInfo, null, 2)}\n`, "utf8");
  await chmod(buildInfoPath, 0o644);
}

const finalized = JSON.parse(await readFile(buildInfoPath, "utf8")) as BuildInfo;
await validateMetadata(finalized, artifactRoot, options.sourceCommit, options.sourceTag);
assertManifest(finalized.files, artifactFiles);
process.stdout.write(`${buildInfoPath}\n`);

async function validateMetadata(
  buildInfo: BuildInfo,
  root: string,
  sourceCommit: string,
  sourceTag: string,
): Promise<void> {
  assert(buildInfo.schemaVersion === 1, "BUILDINFO schemaVersion must be 1");
  assert(buildInfo.artifactType === "node-commonjs-bundle", "invalid artifact type");
  assert(buildInfo.worker === "aperture-attention-engine", "invalid worker identity");
  assert(buildInfo.minimumNodeVersion === "22.0.0", "invalid minimum Node version");
  assert(buildInfo.minimumNodeMajor === 22, "invalid minimum Node major");
  assert(buildInfo.trustedCi === true, "combined release requires trusted CI");
  assert(buildInfo.sourceDirty === false, "combined release source must be clean");
  assert(buildInfo.apertureCommit === sourceCommit, "BUILDINFO source commit mismatch");
  assert(buildInfo.apertureSourceTag === sourceTag, "BUILDINFO source tag mismatch");
  assert(typeof buildInfo.aperturePackageVersion === "string", "missing Aperture version");
  assert(typeof buildInfo.apertureCoreVersion === "string", "missing ApertureCore version");
  assertUtcTimestamp(buildInfo.builtAt);
  assertNonempty(buildInfo.provenanceAttestationReference, "missing provenance reference");

  const builder = record(buildInfo.builder, "missing builder metadata");
  assert(builder.name === "esbuild", "invalid builder");
  assertNonempty(builder.version, "missing esbuild version");
  assertNonempty(builder.nodeVersion, "missing build Node version");

  const ci = record(buildInfo.ci, "missing CI metadata");
  assertNonempty(ci.workflowRef, "missing CI workflowRef");
  assert(ci.runId !== null && ci.runId !== undefined && ci.runId !== "", "missing CI runId");
  assert(
    ci.runAttempt !== null && ci.runAttempt !== undefined && ci.runAttempt !== "",
    "missing CI runAttempt",
  );

  const worker = record(buildInfo.workerBundle, "missing worker identity");
  assert(worker.path === "lib/aperture-attention-engine.cjs", "invalid worker path");
  assert(worker.bytes === WORKER_BYTES, "worker byte identity mismatch");
  assert(worker.sha256 === WORKER_SHA256, "worker SHA-256 identity mismatch");

  const integrations = record(buildInfo.integrations, "missing integrations");
  const omp = record(integrations.omp, "missing OMP integration");
  assert(omp.artifactType === "omp-extension-module", "invalid OMP artifact type");
  assert(omp.path === "integrations/omp/aperture-omp-extension.mjs", "invalid OMP path");
  assert(omp.manifestPath === "integrations/omp/package.json", "invalid OMP manifest path");
  assert(omp.bytes === OMP_BYTES, "OMP byte identity mismatch");
  assert(omp.sha256 === OMP_SHA256, "OMP SHA-256 identity mismatch");
  assert(omp.minimumOmpVersion === "18.0.0", "invalid minimum OMP version");
  assert(omp.proofId === OMP_PROOF, "invalid OMP proof identity");

  assertRuntimeImports(buildInfo.runtimeDependencies, "worker");
  assertRuntimeImports(omp.runtimeDependencies, "OMP");

  const validation = record(buildInfo.validation, "missing validation metadata");
  assert(validation.status === "passed", "worker validation did not pass");
  assert(validation.conformanceProofId === WORKER_PROOF, "invalid worker proof identity");
  assert(validation.ambientCeilingProofId === AMBIENT_PROOF, "invalid Ambient proof identity");
  assert(validation.ompAdapterProofId === OMP_PROOF, "invalid OMP adapter proof identity");
  const compatibility = array(validation.nodeCompatibility, "missing Node compatibility reports");
  assert(compatibility.length > 0, "Node compatibility reports are empty");
  const nodeMajors = new Set<number>();
  for (const rawEntry of compatibility) {
    const entry = record(rawEntry, "invalid Node compatibility entry");
    assert(entry.status === "passed", "Node compatibility entry did not pass");
    assertNonempty(entry.nodeVersion, "missing Node compatibility version");
    nodeMajors.add(Number(String(entry.nodeVersion).split(".")[0]));
  }
  assert(nodeMajors.has(22), "Node 22 compatibility is missing");
  assert(nodeMajors.has(24), "Node 24 compatibility is missing");
  assert(
    [...nodeMajors].some((major) => major > 24),
    "current Node compatibility is missing",
  );

  const ompValidation = record(omp.validation, "missing OMP validation");
  assert(ompValidation.status === "passed", "OMP validation did not pass");
  assert(ompValidation.proofId === OMP_PROOF, "invalid OMP validation proof identity");

  const schemas = record(buildInfo.schemas, "missing schemas");
  assertSchema(schemas.input, "schemas/notification-worker-input.schema.json");
  assertSchema(schemas.output, "schemas/notification-worker-output.schema.json");
  assertSchema(schemas.surface, "schemas/surface-protocol.schema.json");

  const identityConfig = JSON.parse(
    await readFile(path.join(root, "config", "identities.json"), "utf8"),
  ) as unknown;
  assert(
    JSON.stringify(identityConfig) === JSON.stringify(IDENTITY_CONFIG),
    "identity configuration is not the reviewed OMP-only contract",
  );

  const manifest = JSON.parse(
    await readFile(path.join(root, "integrations", "omp", "package.json"), "utf8"),
  ) as Record<string, unknown>;
  assert(manifest.name === "@tomismeta/aperture-omp", "invalid OMP package name");
  assert(manifest.version === buildInfo.aperturePackageVersion, "OMP package version mismatch");
  assert(manifest.type === "module", "OMP package must be an ES module");
  const ompManifest = record(manifest.omp, "missing OMP package manifest");
  assert(
    JSON.stringify(ompManifest.extensions) === JSON.stringify(["./aperture-omp-extension.mjs"]),
    "invalid OMP extension declaration",
  );

  const ompCompatibility = JSON.parse(
    await readFile(path.join(root, "evidence", "omp-18.0.11.json"), "utf8"),
  ) as Record<string, unknown>;
  assert(ompCompatibility.schemaVersion === 1, "invalid OMP host evidence schema");
  assert(ompCompatibility.status === "passed", "OMP host compatibility did not pass");
  assert(ompCompatibility.ompVersion === OMP_VERSION, "wrong OMP host version");
  assert(ompCompatibility.actualExtensionLoader === true, "actual OMP loader was not exercised");
  assert(ompCompatibility.extensionSha256 === OMP_SHA256, "OMP host evidence SHA mismatch");
  assert(ompCompatibility.extensionBytes === OMP_BYTES, "OMP host evidence byte mismatch");
}

async function collectArtifactFiles(root: string): Promise<ArtifactFile[]> {
  const rootEntries = await readdir(root, { withFileTypes: true });
  for (const entry of rootEntries) {
    assert(ROOT_ENTRIES.has(entry.name), `undeclared artifact root entry: ${entry.name}`);
    assert(!entry.isSymbolicLink(), `artifact root symlink is forbidden: ${entry.name}`);
  }

  const files: ArtifactFile[] = [];
  for (const directory of ["config", "evidence", "integrations/omp", "lib", "schemas"]) {
    await collectDirectory(root, path.join(root, directory), files);
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  return files;
}

async function collectDirectory(
  root: string,
  directory: string,
  files: ArtifactFile[],
): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");
    assertSafeRelativePath(relativePath);
    assert(!entry.isSymbolicLink(), `artifact symlink is forbidden: ${relativePath}`);
    if (entry.isDirectory()) {
      await collectDirectory(root, absolutePath, files);
      continue;
    }
    assert(entry.isFile(), `unsupported artifact entry: ${relativePath}`);
    const metadata = await lstat(absolutePath);
    const mode = (metadata.mode & 0o777).toString(8).padStart(4, "0");
    assert(mode === "0644", `artifact file mode must be 0644: ${relativePath}`);
    const content = await readFile(absolutePath);
    files.push({
      path: relativePath,
      sha256: createHash("sha256").update(content).digest("hex"),
      bytes: content.byteLength,
      mode,
    });
  }
}

function validateAllowedFiles(files: ArtifactFile[]): void {
  const paths = files.map((entry) => entry.path);
  assert(new Set(paths).size === paths.length, "artifact manifest contains duplicate paths");
  for (const fixedPath of FIXED_FILES) {
    assert(paths.includes(fixedPath), `required artifact file is missing: ${fixedPath}`);
  }
  const nodeReports = paths.filter((entry) => /^evidence\/node-\d+\.\d+\.\d+\.json$/.test(entry));
  assert(nodeReports.length === 3, "artifact must contain exactly three Node reports");
  const allowed = new Set([...FIXED_FILES, ...nodeReports]);
  for (const artifactPath of paths) {
    assert(allowed.has(artifactPath), `undeclared artifact file: ${artifactPath}`);
    assert(!artifactPath.includes("node_modules"), `node_modules is forbidden: ${artifactPath}`);
    assert(!artifactPath.endsWith(".map"), `source maps are forbidden: ${artifactPath}`);
    assert(
      !/(^|\/)(?:cache|\.cache|__pycache__)(\/|$)/i.test(artifactPath),
      `cache is forbidden: ${artifactPath}`,
    );
    assert(
      !/(?:install|download)(?:er)?/i.test(path.basename(artifactPath)),
      `installer or downloader is forbidden: ${artifactPath}`,
    );
  }
}

function assertManifest(rawManifest: unknown, expected: ArtifactFile[]): void {
  const manifest = array(rawManifest, "BUILDINFO.files must be an array") as ArtifactFile[];
  assert(manifest.length > 0, "BUILDINFO.files must not be empty");
  assert(JSON.stringify(manifest) === JSON.stringify(expected), "BUILDINFO.files is not exact");
}

function assertRuntimeImports(value: unknown, label: string): void {
  const runtime = record(value, `missing ${label} runtime import evidence`);
  assert(runtime.policy === "node-builtins-only", `${label} runtime import policy is invalid`);
  assert(runtime.status === "passed", `${label} runtime import validation did not pass`);
  const imports = array(runtime.imports, `missing ${label} runtime imports`);
  assert(
    imports.every((entry) => typeof entry === "string" && entry.startsWith("node:")),
    `${label} retained a non-builtin runtime import`,
  );
}

function assertSchema(value: unknown, expectedPath: string): void {
  const schema = record(value, `missing schema metadata for ${expectedPath}`);
  assert(schema.version === 1, `invalid schema version for ${expectedPath}`);
  assert(schema.path === expectedPath, `invalid schema path for ${expectedPath}`);
  assert(
    typeof schema.sha256 === "string" && /^[0-9a-f]{64}$/.test(schema.sha256),
    `invalid schema SHA-256 for ${expectedPath}`,
  );
}

function assertSafeRelativePath(value: string): void {
  assert(value.length > 0 && !path.isAbsolute(value), `unsafe artifact path: ${value}`);
  const components = value.split("/");
  assert(!components.includes(".") && !components.includes(".."), `unsafe artifact path: ${value}`);
}

function assertUtcTimestamp(value: unknown): void {
  assertNonempty(value, "missing build timestamp");
  assert(
    String(value).endsWith("Z") && !Number.isNaN(Date.parse(String(value))),
    "invalid UTC build timestamp",
  );
}

function record(value: unknown, message: string): Record<string, unknown> {
  assert(typeof value === "object" && value !== null && !Array.isArray(value), message);
  return value as Record<string, unknown>;
}

function array(value: unknown, message: string): unknown[] {
  assert(Array.isArray(value), message);
  return value;
}

function assertNonempty(value: unknown, message: string): asserts value is string {
  assert(typeof value === "string" && value.length > 0, message);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

type Options = {
  artifactDir: string;
  sourceCommit: string;
  sourceTag: string;
  attestationReference: string;
  verifyOnly: boolean;
};

function parseOptions(args: string[]): Options {
  const parsed: Partial<Options> = { verifyOnly: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") continue;
    if (argument === "--verify-only") {
      parsed.verifyOnly = true;
      continue;
    }
    if (
      argument === "--artifact-dir" ||
      argument === "--source-commit" ||
      argument === "--source-tag" ||
      argument === "--attestation-reference"
    ) {
      const value = args[index + 1];
      if (!value) throw new Error(`${argument} requires a value`);
      if (argument === "--artifact-dir") parsed.artifactDir = value;
      else if (argument === "--source-commit") parsed.sourceCommit = value;
      else if (argument === "--source-tag") parsed.sourceTag = value;
      else parsed.attestationReference = value;
      index += 1;
      continue;
    }
    throw new Error(`unknown combined release option: ${argument ?? "(missing)"}`);
  }
  if (!parsed.artifactDir) throw new Error("--artifact-dir is required");
  if (!parsed.sourceCommit) throw new Error("--source-commit is required");
  if (!parsed.sourceTag) throw new Error("--source-tag is required");
  if (!parsed.attestationReference && !parsed.verifyOnly) {
    throw new Error("--attestation-reference is required");
  }
  return {
    artifactDir: parsed.artifactDir,
    sourceCommit: parsed.sourceCommit,
    sourceTag: parsed.sourceTag,
    attestationReference: parsed.attestationReference ?? "",
    verifyOnly: parsed.verifyOnly ?? false,
  };
}
