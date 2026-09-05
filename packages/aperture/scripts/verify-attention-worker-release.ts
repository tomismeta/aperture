import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { OMP_ATTENTION_EVENT_SCHEMA_VERSION } from "../src/omp-attention-event.js";
import { OMP_WORKER_OUTPUT_PROTOCOL_VERSION } from "../src/notification-worker/omp-worker-protocol.js";
import { APERTURE_SURFACE_PROTOCOL_VERSION } from "../src/surface/protocol.js";
import { WORKER_DIRECT_PROTOCOL_VERSION } from "../src/worker-direct-message.js";
import { MAXIMUM_CONCURRENT_NATIVE_FALLBACKS } from "../../omp/src/omarchy-attention-state.js";

const WORKER_PROOF = "aperture-omp-only-worker-conformance-v1";
const OMP_PROOF = "aperture-omp-adapter-conformance-v1";
const DIRECT_PROOF = "aperture-omp-direct-transport-conformance-v1";
const PRIVACY_PROOF = "aperture-omp-direct-privacy-v1";
const NAVIGATION_PROOF = "aperture-opaque-focus-navigation-v4";
const MAXIMUM_MARKETPLACE_ARTIFACT_BYTES = 524_288;
const ROOT_ENTRIES = [
  "BUILDINFO.json",
  "evidence",
  "integrations",
  "fixtures",
  "lib",
  "schemas",
] as const;
const FIXED_FILES = [
  "evidence/direct-privacy.json",
  "evidence/direct-transport.json",
  "evidence/omp-adapter.json",
  "evidence/omp-only-worker.json",
  "evidence/omp-runtime-imports.json",
  "evidence/runtime-imports.json",
  "fixtures/omp-direct/approval-request.json",
  "fixtures/omp-direct/completion-event.json",
  "fixtures/omp-direct/failure-event.json",
  "fixtures/omp-direct/focus-activation.json",
  "fixtures/omp-direct/focus-registration.json",
  "fixtures/omp-direct/focus-result.json",
  "fixtures/omp-direct/input-request.json",
  "fixtures/omp-direct/completion-resolved-event.json",
  "fixtures/omp-direct/session-heartbeat.json",
  "fixtures/omp-direct/snapshot-completion.json",
  "fixtures/omp-direct/snapshot-completion-resolved.json",
  "fixtures/omp-direct/focus-registration-direct-terminal.json",
  "fixtures/omp-direct/focus-registration-tmux.json",
  "fixtures/omp-direct/snapshot-failure.json",
  "fixtures/omp-direct/snapshot-now-next.json",
  "fixtures/omp-direct/snapshot-resolved.json",
  "integrations/omp/aperture-omp-extension.mjs",
  "integrations/omp/package.json",
  "lib/aperture-attention-engine.cjs",
  "schemas/omp-worker-output.schema.json",
  "schemas/omp-attention-event.schema.json",
  "schemas/worker-direct-message.schema.json",
  "schemas/surface-protocol.schema.json",
];

type ArtifactFile = {
  path: string;
  sha256: string;
  bytes: number;
  mode: string;
};

type BuildInfo = Record<string, unknown> & {
  files?: unknown;
};

const options = parseOptions(process.argv.slice(2));
const artifactRoot = path.resolve(options.artifactDir);
const buildInfoPath = path.join(artifactRoot, "BUILDINFO.json");

const buildInfo = JSON.parse(await readFile(buildInfoPath, "utf8")) as BuildInfo;
await validateMetadata(buildInfo, artifactRoot, options.sourceCommit, options.sourceTag);
const artifactFiles = await collectArtifactFiles(artifactRoot);
validateAllowedFiles(artifactFiles);
assertManifest(buildInfo.files, artifactFiles);
process.stdout.write(`${buildInfoPath}\n`);

async function validateMetadata(
  buildInfo: BuildInfo,
  root: string,
  sourceCommit: string,
  sourceTag: string,
): Promise<void> {
  assert(buildInfo.schemaVersion === 2, "BUILDINFO schemaVersion must be 2");
  assert(
    !("ompPackageVersion" in buildInfo) && !("releaseSeries" in buildInfo),
    "BUILDINFO must not contain redundant component or release versions",
  );
  assert(buildInfo.artifactType === "node-commonjs-bundle", "invalid artifact type");
  assert(buildInfo.worker === "aperture-attention-engine", "invalid worker identity");
  assert(buildInfo.minimumNodeVersion === "22.0.0", "invalid minimum Node version");
  assert(buildInfo.minimumNodeMajor === 22, "invalid minimum Node major");
  assert(buildInfo.artifactMode === "omp-only", "invalid artifact mode");
  assert(buildInfo.trustedCi === true, "release requires trusted CI");
  assert(buildInfo.sourceDirty === false, "release source must be clean");
  assert(buildInfo.apertureCommit === sourceCommit, "BUILDINFO source commit mismatch");
  assert(buildInfo.apertureSourceTag === sourceTag, "BUILDINFO source tag mismatch");
  assert(buildInfo.aperturePackageVersion === "0.10.0", "invalid Aperture package version");
  const artifactLimits = record(buildInfo.artifactLimits, "missing artifact limits");
  assert(
    artifactLimits.maximumTextArtifactBytes === MAXIMUM_MARKETPLACE_ARTIFACT_BYTES,
    "invalid marketplace text artifact limit",
  );
  assert(buildInfo.apertureCoreVersion === "0.9.0", "invalid ApertureCore version");
  assertUtcTimestamp(buildInfo.builtAt);
  assert(
    !("provenanceAttestationReference" in buildInfo) &&
      !("provenanceAttestationRequired" in buildInfo),
    "BUILDINFO must not contain attestation or provenance fields",
  );
  const builder = record(buildInfo.builder, "missing builder metadata");
  assert(builder.name === "esbuild", "invalid builder");
  assertNonempty(builder.version, "missing esbuild version");
  assertNonempty(builder.nodeVersion, "missing build Node version");
  const workerContract = record(buildInfo.workerContract, "missing worker contract");
  assert(workerContract.notificationInput === false, "notification input must be disabled");
  assert(
    JSON.stringify(Object.keys(workerContract).sort()) ===
      JSON.stringify(["jsonlHandshakes", "notificationInput"]),
    "worker contract must contain only notification input and JSONL handshakes",
  );
  assert(
    JSON.stringify(workerContract.jsonlHandshakes) ===
      JSON.stringify({
        privateWorker: {
          protocolVersion: OMP_WORKER_OUTPUT_PROTOCOL_VERSION,
          peer: "aperture-attention-engine",
          framing: "jsonl",
          outputEncoding: "ascii-json-escapes",
          maximumLineBytes: 262_144,
          navigation: "validated-opaque-focus-only",
        },
        publicSurface: {
          protocolVersion: APERTURE_SURFACE_PROTOCOL_VERSION,
          peer: "aperture-stdio",
          framing: "jsonl",
          outputEncoding: "ascii-json-escapes",
          maximumLineBytes: 262_144,
          navigation: "absent",
        },
      }),
    "invalid JSONL handshake contract",
  );
  assert(
    JSON.stringify(buildInfo.directSocketLifecycle) ===
      JSON.stringify({
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
        startupErrorCode: "direct_transport_unavailable",
        startupExitCodes: { unsafe: 74, transient: 75 },
        startupFailureReadiness: "no-ready-or-snapshot",
      }),
    "invalid direct socket lifecycle contract",
  );
  const focusCoordinator = record(buildInfo.focusCoordinator, "missing focus coordinator policy");
  assert(focusCoordinator.registrationTtlMs === 15_000, "invalid registration TTL");
  assert(focusCoordinator.heartbeatIntervalMs === 5_000, "invalid focus heartbeat interval");
  assert(focusCoordinator.retryInitialMs === 250, "invalid focus retry floor");
  assert(focusCoordinator.retryMaximumMs === 5_000, "invalid focus retry ceiling");
  assert(focusCoordinator.shutdownTimeoutMs === 3_000, "invalid focus shutdown bound");
  assert(focusCoordinator.maximumDirectClients === 32, "invalid direct client cap");
  assert(
    focusCoordinator.attentionAcknowledgementTimeoutMs === 1_000,
    "invalid attention acknowledgement bound",
  );
  assert(
    focusCoordinator.focusAcknowledgementTimeoutMs === 2_750,
    "invalid focus acknowledgement bound",
  );
  assert(
    focusCoordinator.focusServerProcessingTimeoutMs === 2_250,
    "invalid focus server processing bound",
  );
  assert(
    focusCoordinator.activeWindowConfirmationIntervalMs === 25,
    "invalid focus confirmation interval",
  );
  assert(
    focusCoordinator.activeWindowConfirmationTimeoutMs === 1_000,
    "invalid focus confirmation bound",
  );
  assert(focusCoordinator.maximumDirectReceipts === 1_024, "invalid direct receipt cap");
  assert(
    focusCoordinator.maximumAmbiguousDeliveryAttempts === 3,
    "invalid ambiguous delivery retry cap",
  );
  assert(
    focusCoordinator.directClosureAuthority === "retry-until-accepted-or-session-lease-expiry",
    "invalid direct closure authority",
  );
  assert(focusCoordinator.focusReplayTransientAttempts === 3, "invalid focus replay retry bound");
  assert(
    focusCoordinator.focusReplayReceiptEpisodes ===
      "fresh-random-token-per-registration-stable-across-retries",
    "invalid focus replay receipt episode policy",
  );
  assert(
    focusCoordinator.nativeFallbackPolicy === "definite-pre-write-only",
    "invalid native fallback policy",
  );
  assert(
    focusCoordinator.maximumConcurrentNativeFallbacks === MAXIMUM_CONCURRENT_NATIVE_FALLBACKS,
    "invalid concurrent native fallback cap",
  );
  assert(
    focusCoordinator.sessionHeartbeatIntervalMs === 5_000,
    "invalid session heartbeat interval",
  );
  assert(focusCoordinator.sessionLeaseMs === 20_000, "invalid session lease");
  assert(focusCoordinator.sessionReconnectGraceMs === 10_000, "invalid reconnect grace");
  assert(focusCoordinator.maximumSessionLeaseRecords === 128, "invalid session lease cap");
  assert(focusCoordinator.maximumQueuedFocusOperations === 64, "invalid focus operation cap");
  assert(focusCoordinator.maximumActiveRegistrations === 128, "invalid focus registration cap");
  assert(focusCoordinator.maximumLeaseMembers === 32, "invalid lease-member cap");
  assert(
    focusCoordinator.maximumPendingQmlFocusRequests === 16,
    "invalid downstream focus-request cap",
  );
  assert(focusCoordinator.maximumFocusReplayEvents === 64, "invalid focus replay cap");
  assert(
    focusCoordinator.focusReplayAcknowledgementTimeoutMs === 750,
    "invalid focus replay acknowledgement bound",
  );
  assert(
    focusCoordinator.maximumConcurrentFocusReplays === 1,
    "invalid focus replay concurrency cap",
  );
  assert(
    focusCoordinator.titleOwnership === "tmux-cas-herdr-retain-no-conditional-clear",
    "invalid focus ownership policy",
  );
  assert(
    focusCoordinator.herdrTitleRelease === "retained-no-conditional-clear",
    "invalid Herdr title release policy",
  );
  assert(
    focusCoordinator.workerGeneration === "volatile-per-worker",
    "invalid worker generation policy",
  );
  assert(
    focusCoordinator.clientPolicy === "backend-scoped-single-client-admission",
    "invalid focus client admission policy",
  );
  assert(
    focusCoordinator.markerAdmission === "exact-marker-and-live-address-only",
    "invalid direct marker admission policy",
  );
  assert(focusCoordinator.persistence === "volatile-only", "focus targets must remain volatile");

  const ci = record(buildInfo.ci, "missing CI metadata");
  assertNonempty(ci.workflowRef, "missing CI workflowRef");
  assert(
    ci.workflowRef ===
      `tomismeta/aperture/.github/workflows/aperture-worker-release.yml@refs/tags/${sourceTag}`,
    "invalid CI workflowRef",
  );
  assert(typeof ci.runId === "string" && /^[1-9]\d*$/.test(ci.runId), "invalid CI runId");
  assert(
    typeof ci.runAttempt === "string" && /^[1-9]\d*$/.test(ci.runAttempt),
    "invalid CI runAttempt",
  );

  const worker = record(buildInfo.workerBundle, "missing worker identity");
  assert(worker.path === "lib/aperture-attention-engine.cjs", "invalid worker path");
  assert(typeof worker.bytes === "number" && worker.bytes > 0, "invalid worker byte size");
  assert(
    worker.bytes <= MAXIMUM_MARKETPLACE_ARTIFACT_BYTES,
    `worker exceeds ${MAXIMUM_MARKETPLACE_ARTIFACT_BYTES}-byte marketplace limit`,
  );
  assert(
    typeof worker.sha256 === "string" && /^[0-9a-f]{64}$/.test(worker.sha256),
    "invalid worker SHA-256",
  );

  const integrations = record(buildInfo.integrations, "missing integrations");
  const omp = record(integrations.omp, "missing OMP integration");
  assert(omp.artifactType === "omp-extension-module", "invalid OMP artifact type");
  assert(omp.path === "integrations/omp/aperture-omp-extension.mjs", "invalid OMP path");
  assert(omp.manifestPath === "integrations/omp/package.json", "invalid OMP manifest path");
  assert(
    typeof omp.packageVersion === "string" &&
      /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(omp.packageVersion),
    "invalid OMP integration version",
  );
  assert(typeof omp.bytes === "number" && omp.bytes > 0, "invalid OMP byte size");
  assert(
    omp.bytes <= MAXIMUM_MARKETPLACE_ARTIFACT_BYTES,
    `OMP extension exceeds ${MAXIMUM_MARKETPLACE_ARTIFACT_BYTES}-byte marketplace limit`,
  );
  assert(
    typeof omp.sha256 === "string" && /^[0-9a-f]{64}$/.test(omp.sha256),
    "invalid OMP SHA-256",
  );
  assert(omp.minimumOmpVersion === "18.0.0", "invalid minimum OMP version");
  assert(omp.proofId === OMP_PROOF, "invalid OMP proof identity");

  assertRuntimeImports(buildInfo.runtimeDependencies, "worker");
  assertRuntimeImports(omp.runtimeDependencies, "OMP");

  const validation = record(buildInfo.validation, "missing validation metadata");
  assert(validation.status === "passed", "worker validation did not pass");
  assert(validation.conformanceProofId === WORKER_PROOF, "invalid worker proof identity");
  assert(validation.ompOnlyReport === "evidence/omp-only-worker.json", "invalid OMP-only report");
  assert(validation.ompAdapterProofId === OMP_PROOF, "invalid OMP adapter proof identity");
  assert(validation.directTransportProofId === DIRECT_PROOF, "invalid direct transport proof");
  assert(validation.directPrivacyProofId === PRIVACY_PROOF, "invalid direct privacy proof");
  assert(validation.navigationProofId === NAVIGATION_PROOF, "invalid navigation proof");
  assert(
    !("focusBackendReport" in validation) &&
      !("ompHostProofId" in validation) &&
      !("ompHostReport" in validation),
    "BUILDINFO retains non-release validation evidence",
  );
  const compatibility = array(validation.nodeCompatibility, "missing Node compatibility reports");
  assert(compatibility.length === 1, "release must contain exactly one Node report");
  const nodeCompatibility = record(compatibility[0], "invalid Node compatibility entry");
  assert(nodeCompatibility.status === "passed", "Node compatibility entry did not pass");
  assertNonempty(nodeCompatibility.nodeVersion, "missing Node compatibility version");
  assert(
    Number(nodeCompatibility.nodeVersion.split(".")[0]) === 22,
    "release Node compatibility must be Node 22",
  );
  const directCompatibility = array(
    validation.directNodeCompatibility,
    "missing direct Node compatibility reports",
  );
  assert(directCompatibility.length === 1, "release must contain exactly one direct Node report");
  const directNodeCompatibility = record(
    directCompatibility[0],
    "invalid direct Node compatibility entry",
  );
  assert(directNodeCompatibility.status === "passed", "direct Node compatibility did not pass");
  assertNonempty(directNodeCompatibility.nodeVersion, "missing direct Node compatibility version");
  assert(
    Number(directNodeCompatibility.nodeVersion.split(".")[0]) === 22,
    "release direct compatibility must be Node 22",
  );

  const ompValidation = record(omp.validation, "missing OMP validation");
  assert(ompValidation.status === "passed", "OMP validation did not pass");
  assert(ompValidation.proofId === OMP_PROOF, "invalid OMP validation proof identity");
  assert(!("hostCompatibility" in omp), "BUILDINFO retains OMP host compatibility evidence");

  const schemas = record(buildInfo.schemas, "missing schemas");
  assertSchema(
    schemas.output,
    "schemas/omp-worker-output.schema.json",
    OMP_WORKER_OUTPUT_PROTOCOL_VERSION,
  );
  assertSchema(
    schemas.surface,
    "schemas/surface-protocol.schema.json",
    APERTURE_SURFACE_PROTOCOL_VERSION,
  );
  assertSchema(
    schemas.ompAttentionEvent,
    "schemas/omp-attention-event.schema.json",
    OMP_ATTENTION_EVENT_SCHEMA_VERSION,
  );
  assertSchema(
    schemas.workerDirectMessage,
    "schemas/worker-direct-message.schema.json",
    WORKER_DIRECT_PROTOCOL_VERSION,
  );
  const fixtureMetadata = record(buildInfo.fixtures, "missing fixture metadata");
  const ompFixtures = record(fixtureMetadata.ompDirect, "missing OMP direct fixtures");
  assert(
    JSON.stringify(Object.keys(ompFixtures)) === JSON.stringify(["paths"]),
    "OMP fixture metadata must contain only paths",
  );
  const declaredFixturePaths = array(ompFixtures.paths, "missing OMP fixture paths");
  const requiredFixturePaths = [...FIXED_FILES]
    .filter((entry) => entry.startsWith("fixtures/"))
    .sort();
  assert(
    JSON.stringify([...declaredFixturePaths].sort()) === JSON.stringify(requiredFixturePaths),
    "OMP fixture manifest is incomplete",
  );
  const nowNextFixture = JSON.parse(
    await readFile(path.join(root, "fixtures", "omp-direct", "snapshot-now-next.json"), "utf8"),
  ) as Record<string, unknown>;
  const nowNextView = record(nowNextFixture.view, "invalid NOW/NEXT fixture");
  const nowFrame = record(nowNextView.now, "missing NOW fixture frame");
  const nextFrames = array(nowNextView.next, "missing NEXT fixture frames");
  assert(nextFrames.length === 1, "NEXT fixture must contain one queued frame");
  assertNavigation(nowFrame.navigation, "NOW fixture");
  assertNavigation(record(nextFrames[0], "invalid NEXT fixture frame").navigation, "NEXT fixture");
  const ompOnlyEvidence = JSON.parse(
    await readFile(path.join(root, "evidence", "omp-only-worker.json"), "utf8"),
  ) as Record<string, unknown>;
  assert(ompOnlyEvidence.schemaVersion === 1, "invalid OMP-only evidence schema");
  assert(ompOnlyEvidence.proofId === WORKER_PROOF, "invalid OMP-only evidence proof");
  assert(ompOnlyEvidence.status === "passed", "OMP-only evidence did not pass");
  assert(ompOnlyEvidence.artifactMode === "omp-only", "invalid OMP-only evidence mode");
  assert(ompOnlyEvidence.notificationInput === false, "OMP-only evidence enables notifications");
  assert(
    !array(ompOnlyEvidence.checks, "missing OMP-only checks").includes(
      "ambient-notification-ceiling",
    ),
    "OMP-only evidence retained notification projection",
  );
  const ompOnlyChecks = array(ompOnlyEvidence.checks, "missing OMP-only checks");
  for (const requiredCheck of [
    "cleanup-mode-no-config-or-engine",
    "omp-only-handshake",
    "omp-control-input-only",
    "calm-snapshot-only",
    "bounded-ascii-output",
    "no-generic-state-access",
    "generic-notification-modules-absent",
    "live-socket-overlap-exit75-open-stdin-no-ready-or-snapshot",
    "live-socket-identity-and-responsiveness-preserved",
    "fresh-process-retry-private-owned-socket-accepted-v4-heartbeat",
    "unsafe-startup-exit74-open-stdin-no-ready-or-snapshot-no-deletion",
    "lifecycle-lock-contention-exit75-and-unsafe-lock-exit74",
  ]) {
    assert(ompOnlyChecks.includes(requiredCheck), `missing OMP-only check: ${requiredCheck}`);
  }

  const manifest = JSON.parse(
    await readFile(path.join(root, "integrations", "omp", "package.json"), "utf8"),
  ) as Record<string, unknown>;
  const sourceManifest = JSON.parse(
    await readFile(new URL("../../omp/omarchy-package.json", import.meta.url), "utf8"),
  ) as Record<string, unknown>;
  assert(manifest.name === "@tomismeta/aperture-omp", "invalid OMP package name");
  assert(manifest.version === omp.packageVersion, "OMP package version mismatch");
  assert(manifest.version === sourceManifest.version, "OMP source package version mismatch");
  assert(manifest.private === true, "OMP package must be private");
  assert(manifest.type === "module", "OMP package must be an ES module");
  const ompManifest = record(manifest.omp, "missing OMP package manifest");
  assert(
    JSON.stringify(ompManifest.extensions) === JSON.stringify(["./aperture-omp-extension.mjs"]),
    "invalid OMP extension declaration",
  );
}

async function collectArtifactFiles(root: string): Promise<ArtifactFile[]> {
  const rootEntries = await readdir(root, { withFileTypes: true });
  for (const entry of rootEntries) {
    assert(
      ROOT_ENTRIES.includes(entry.name as (typeof ROOT_ENTRIES)[number]),
      `undeclared artifact root entry: ${entry.name}`,
    );
    assert(!entry.isSymbolicLink(), `artifact root symlink is forbidden: ${entry.name}`);
  }

  const files: ArtifactFile[] = [];
  for (const directory of [
    "evidence",
    "fixtures/omp-direct",
    "integrations/omp",
    "lib",
    "schemas",
  ]) {
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
  assert(nodeReports.length === 1, "artifact must contain exactly one Node report");
  const directNodeReports = paths.filter((entry) =>
    /^evidence\/direct-node-\d+\.\d+\.\d+\.json$/.test(entry),
  );
  assert(directNodeReports.length === 1, "artifact must contain exactly one direct Node report");
  assert(files.length === 31, "artifact must contain exactly 31 payload files");
  const allowed = new Set([...FIXED_FILES, ...nodeReports, ...directNodeReports]);
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

function assertNavigation(value: unknown, label: string): void {
  const navigation = record(value, `${label} navigation is missing`);
  assert(
    JSON.stringify(Object.keys(navigation).sort()) === JSON.stringify(["handle", "kind"]),
    `${label} navigation fields are invalid`,
  );
  assert(navigation.kind === "opaque-focus", `${label} navigation kind is invalid`);
  assert(
    typeof navigation.handle === "string" && /^[A-Za-z0-9_-]{32}$/.test(navigation.handle),
    `${label} focus handle is invalid`,
  );
}

function assertSchema(value: unknown, expectedPath: string, expectedVersion: number): void {
  const schema = record(value, `missing schema metadata for ${expectedPath}`);
  assert(schema.version === expectedVersion, `invalid schema version for ${expectedPath}`);
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
};

function parseOptions(args: string[]): Options {
  const parsed: Partial<Options> = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") continue;
    if (
      argument === "--artifact-dir" ||
      argument === "--source-commit" ||
      argument === "--source-tag"
    ) {
      const value = args[index + 1];
      if (!value) throw new Error(`${argument} requires a value`);
      if (argument === "--artifact-dir") parsed.artifactDir = value;
      else if (argument === "--source-commit") parsed.sourceCommit = value;
      else parsed.sourceTag = value;
      index += 1;
      continue;
    }
    throw new Error(`unknown release verification option: ${argument ?? "(missing)"}`);
  }
  if (!parsed.artifactDir) throw new Error("--artifact-dir is required");
  if (!parsed.sourceCommit) throw new Error("--source-commit is required");
  if (!parsed.sourceTag) throw new Error("--source-tag is required");
  if (!/^[0-9a-f]{40}$/.test(parsed.sourceCommit)) {
    throw new Error("--source-commit must be an exact lowercase Git SHA-1");
  }
  if (!/^aperture-worker-v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(parsed.sourceTag)) {
    throw new Error("--source-tag must be an exact Aperture worker SemVer tag");
  }
  return {
    artifactDir: parsed.artifactDir,
    sourceCommit: parsed.sourceCommit,
    sourceTag: parsed.sourceTag,
  };
}
