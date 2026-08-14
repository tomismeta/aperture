import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
  buildObservationKernelReleaseHoldoutReport,
  OBSERVATION_KERNEL_RELEASE_HOLDOUT_CUSTODY_PATH,
  OBSERVATION_KERNEL_RELEASE_HOLDOUT_FIRST_RUN_PATH,
  OBSERVATION_KERNEL_RELEASE_HOLDOUT_PATH,
  OBSERVATION_KERNEL_RELEASE_HOLDOUT_REPORT_PATH,
  OBSERVATION_KERNEL_RELEASE_HOLDOUT_EVIDENCE_CUSTODY_PATH,
  parseObservationKernelReleaseHoldout,
  runObservationKernelReleaseHoldout,
  serializeObservationKernelReleaseHoldout,
  type ObservationKernelReleaseHoldoutReport,
  type ObservationKernelReleaseHoldoutRun,
} from "../packages/lab/src/observation-kernel-release-holdout.js";
import { isDirectExecution } from "./direct-execution.js";

const execFile = promisify(execFileCallback);
const REPO_ROOT = process.cwd();
const IMPLEMENTATION_FILES = [
  "scripts/observation-kernel-release-holdout.ts",
  "packages/lab/src/observation-kernel-release-holdout.ts",
  "packages/lab/src/observation-kernel-holdout.ts",
  "packages/lab/src/observation-kernel-evaluator.ts",
  "packages/lab/src/kernel-canonical-json.ts",
  "packages/lab/src/observation-kernel-scorecard-model.ts",
  "packages/core/package.json",
] as const;
const CONTRACT_FILES = {
  observation: "docs/engine/observation-judgment-contract-v1.md",
  sourceEvidence: "docs/engine/source-evidence-contract-v1.md",
  output: "packages/lab/conformance/observation-kernel-holdout-v5-output-contract.json",
} as const;

export async function runObservationKernelReleaseHoldoutCommand(
  args: readonly string[] = process.argv.slice(2),
): Promise<void> {
  const mode = args.find((arg) => arg.startsWith("--"));
  if (mode === "--seal") {
    await sealHoldout();
    return;
  }
  if (mode === "--first-run") {
    await writeFirstRun();
    return;
  }
  if (mode === "--check") {
    await checkHoldout();
    return;
  }
  if (mode === "--refresh") {
    await refreshEvidence();
    return;
  }
  throw new Error("Usage: --seal, --first-run, --check, or --refresh");
}

async function refreshEvidence(): Promise<void> {
  if (process.env.APERTURE_RELEASE_HOLDOUT_REFRESH !== "1") {
    throw new Error(
      "Refusing to refresh release holdout evidence without APERTURE_RELEASE_HOLDOUT_REFRESH=1.",
    );
  }
  await Promise.all(
    [
      OBSERVATION_KERNEL_RELEASE_HOLDOUT_CUSTODY_PATH,
      OBSERVATION_KERNEL_RELEASE_HOLDOUT_FIRST_RUN_PATH,
      OBSERVATION_KERNEL_RELEASE_HOLDOUT_REPORT_PATH,
      OBSERVATION_KERNEL_RELEASE_HOLDOUT_EVIDENCE_CUSTODY_PATH,
    ].map((filePath) => rm(filePath, { force: true })),
  );
}

async function sealHoldout(): Promise<void> {
  const artifact = parseObservationKernelReleaseHoldout();
  await assertCoreMatchesFreeze(artifact.methodology.implementationFreeze);
  const freezeCoreTree = await git(
    "rev-parse",
    `${artifact.methodology.implementationFreeze}:packages/core`,
  );
  const custody = {
    artifact: {
      path: "packages/lab/conformance/observation-kernel-release-holdout.json",
      sha256: await sha256File(OBSERVATION_KERNEL_RELEASE_HOLDOUT_PATH),
    },
    frozenCore: {
      commit: artifact.methodology.implementationFreeze,
      tree: freezeCoreTree,
    },
    runner: {
      path: "scripts/observation-kernel-release-holdout.ts",
      sha256: await sha256File("scripts/observation-kernel-release-holdout.ts"),
    },
    implementation: { files: await buildDigestMap(IMPLEMENTATION_FILES) },
    contracts: {
      observation: {
        path: CONTRACT_FILES.observation,
        sha256: `sha256:${await sha256File(CONTRACT_FILES.observation)}`,
      },
      sourceEvidence: {
        path: CONTRACT_FILES.sourceEvidence,
        sha256: `sha256:${await sha256File(CONTRACT_FILES.sourceEvidence)}`,
      },
      output: {
        path: CONTRACT_FILES.output,
        sha256: `sha256:${await sha256File(CONTRACT_FILES.output)}`,
      },
    },
    holdoutId: artifact.methodology.holdoutId,
    lifecycle: "sealed",
  };
  await writeExclusive(
    OBSERVATION_KERNEL_RELEASE_HOLDOUT_CUSTODY_PATH,
    serializeObservationKernelReleaseHoldout(custody),
  );
}

async function writeFirstRun(): Promise<void> {
  const artifact = parseObservationKernelReleaseHoldout();
  const custody = await readJson(OBSERVATION_KERNEL_RELEASE_HOLDOUT_CUSTODY_PATH);
  await assertCustody(artifact, custody);
  await assertCoreMatchesFreeze(artifact.methodology.implementationFreeze);
  const firstRun = runObservationKernelReleaseHoldout();
  const repeatRun = runObservationKernelReleaseHoldout();
  const report = buildObservationKernelReleaseHoldoutReport(firstRun, repeatRun);
  await writeExclusive(
    OBSERVATION_KERNEL_RELEASE_HOLDOUT_FIRST_RUN_PATH,
    serializeObservationKernelReleaseHoldout(firstRun),
  );
  await writeExclusive(
    OBSERVATION_KERNEL_RELEASE_HOLDOUT_REPORT_PATH,
    serializeObservationKernelReleaseHoldout(report),
  );
  await writeExclusive(
    OBSERVATION_KERNEL_RELEASE_HOLDOUT_EVIDENCE_CUSTODY_PATH,
    serializeObservationKernelReleaseHoldout({
      holdoutId: artifact.methodology.holdoutId,
      lifecycle: "first_run_sealed",
      firstRun: {
        path: OBSERVATION_KERNEL_RELEASE_HOLDOUT_FIRST_RUN_PATH,
        sha256: await sha256File(OBSERVATION_KERNEL_RELEASE_HOLDOUT_FIRST_RUN_PATH),
      },
      report: {
        path: OBSERVATION_KERNEL_RELEASE_HOLDOUT_REPORT_PATH,
        sha256: await sha256File(OBSERVATION_KERNEL_RELEASE_HOLDOUT_REPORT_PATH),
      },
    }),
  );
  if (!report.passed) {
    throw new Error(
      `Observation Kernel release holdout failed: ${report.failures.join(", ") || "unknown failure"}`,
    );
  }
}

async function checkHoldout(): Promise<void> {
  const artifact = parseObservationKernelReleaseHoldout();
  const custody = await readJson(OBSERVATION_KERNEL_RELEASE_HOLDOUT_CUSTODY_PATH);
  await assertCustody(artifact, custody);
  await assertCoreMatchesFreeze(artifact.methodology.implementationFreeze);
  const storedFirst = (await readJson(
    OBSERVATION_KERNEL_RELEASE_HOLDOUT_FIRST_RUN_PATH,
  )) as ObservationKernelReleaseHoldoutRun;
  const storedReport = (await readJson(
    OBSERVATION_KERNEL_RELEASE_HOLDOUT_REPORT_PATH,
  )) as ObservationKernelReleaseHoldoutReport;
  const evidenceCustody = await readJson(OBSERVATION_KERNEL_RELEASE_HOLDOUT_EVIDENCE_CUSTODY_PATH);
  await assertEvidenceCustody(artifact, evidenceCustody);
  const currentFirst = runObservationKernelReleaseHoldout();
  const currentRepeat = runObservationKernelReleaseHoldout();
  const currentReport = buildObservationKernelReleaseHoldoutReport(currentFirst, currentRepeat);
  if (
    serializeObservationKernelReleaseHoldout(storedFirst) !==
    serializeObservationKernelReleaseHoldout(currentFirst)
  ) {
    throw new Error("Observation Kernel release holdout first-run evidence changed.");
  }
  if (
    serializeObservationKernelReleaseHoldout(storedReport) !==
    serializeObservationKernelReleaseHoldout(currentReport)
  ) {
    throw new Error("Observation Kernel release holdout report changed.");
  }
  if (!currentReport.passed) {
    throw new Error(
      `Observation Kernel release holdout failed: ${currentReport.failures.join(", ") || "unknown failure"}`,
    );
  }
}

async function assertCustody(
  artifact: ReturnType<typeof parseObservationKernelReleaseHoldout>,
  custody: Record<string, unknown>,
): Promise<void> {
  const artifactRecord = custody.artifact;
  const frozenCore = custody.frozenCore;
  const runner = custody.runner;
  const implementation = custody.implementation;
  const contracts = custody.contracts;
  if (
    !isRecord(artifactRecord) ||
    !isRecord(frozenCore) ||
    !isRecord(runner) ||
    !isRecord(implementation) ||
    !isRecord(contracts)
  ) {
    throw new Error("Observation Kernel release holdout custody is invalid.");
  }
  const artifactDigest = await sha256File(OBSERVATION_KERNEL_RELEASE_HOLDOUT_PATH);
  if (artifactRecord.sha256 !== artifactDigest) {
    throw new Error("Observation Kernel release holdout artifact digest changed.");
  }
  if (frozenCore.commit !== artifact.methodology.implementationFreeze) {
    throw new Error("Observation Kernel release holdout freeze does not match custody.");
  }
  const coreTree = await git(
    "rev-parse",
    `${artifact.methodology.implementationFreeze}:packages/core`,
  );
  if (frozenCore.tree !== coreTree) {
    throw new Error("Observation Kernel release holdout core tree changed.");
  }
  if (runner.sha256 !== (await sha256File("scripts/observation-kernel-release-holdout.ts"))) {
    throw new Error("Observation Kernel release holdout runner changed.");
  }
  await assertDigestMap(implementation.files, IMPLEMENTATION_FILES);
  await assertContractDigest(
    contracts.observation,
    CONTRACT_FILES.observation,
    artifact.methodology.observationContractDigest,
  );
  await assertContractDigest(
    contracts.sourceEvidence,
    CONTRACT_FILES.sourceEvidence,
    artifact.methodology.sourceEvidenceContractDigest,
  );
  await assertContractDigest(
    contracts.output,
    CONTRACT_FILES.output,
    artifact.methodology.outputContractDigest,
  );
  if (custody.holdoutId !== artifact.methodology.holdoutId || custody.lifecycle !== "sealed") {
    throw new Error("Observation Kernel release holdout custody identity is invalid.");
  }
}

async function assertEvidenceCustody(
  artifact: ReturnType<typeof parseObservationKernelReleaseHoldout>,
  custody: Record<string, unknown>,
): Promise<void> {
  const firstRun = custody.firstRun;
  const report = custody.report;
  if (
    custody.holdoutId !== artifact.methodology.holdoutId ||
    custody.lifecycle !== "first_run_sealed" ||
    !isRecord(firstRun) ||
    !isRecord(report)
  ) {
    throw new Error("Observation Kernel release holdout evidence custody is invalid.");
  }
  await assertSingleDigest(firstRun, OBSERVATION_KERNEL_RELEASE_HOLDOUT_FIRST_RUN_PATH);
  await assertSingleDigest(report, OBSERVATION_KERNEL_RELEASE_HOLDOUT_REPORT_PATH);
}

async function buildDigestMap(paths: readonly string[]): Promise<Record<string, string>> {
  const entries = await Promise.all(
    paths.map(async (filePath) => [filePath, await sha256File(filePath)] as const),
  );
  return Object.fromEntries(entries);
}

async function assertDigestMap(value: unknown, paths: readonly string[]): Promise<void> {
  if (!isRecord(value)) throw new Error("Observation Kernel implementation custody is invalid.");
  for (const filePath of paths) {
    if (value[filePath] !== (await sha256File(filePath))) {
      throw new Error(`Observation Kernel release holdout implementation changed: ${filePath}`);
    }
  }
}

async function assertContractDigest(
  value: unknown,
  filePath: string,
  expectedDigest: string,
): Promise<void> {
  if (!isRecord(value) || value.path !== filePath) {
    throw new Error(`Observation Kernel contract custody is invalid: ${filePath}`);
  }
  const digest = `sha256:${await sha256File(filePath)}`;
  if (value.sha256 !== digest || expectedDigest !== digest) {
    throw new Error(`Observation Kernel contract changed: ${filePath}`);
  }
}

async function assertSingleDigest(value: Record<string, unknown>, filePath: string): Promise<void> {
  if (value.path !== filePath || value.sha256 !== (await sha256File(filePath))) {
    throw new Error(`Observation Kernel release holdout evidence changed: ${filePath}`);
  }
}

async function assertCoreMatchesFreeze(commit: string): Promise<void> {
  const result = await execFile("git", ["diff", "--quiet", commit, "--", "packages/core"], {
    cwd: REPO_ROOT,
  });
  if (result.stderr.length > 0) {
    throw new Error(`Unable to verify core freeze: ${result.stderr.trim()}`);
  }
}

async function readJson(filePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
}

async function sha256File(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

async function git(...args: string[]): Promise<string> {
  const result = await execFile("git", args, { cwd: REPO_ROOT });
  return result.stdout.trim();
}

async function writeExclusive(filePath: string, value: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const handle = await open(filePath, "wx");
  try {
    await handle.writeFile(value, "utf8");
  } finally {
    await handle.close();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

if (isDirectExecution(import.meta.url)) {
  void runObservationKernelReleaseHoldoutCommand().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
