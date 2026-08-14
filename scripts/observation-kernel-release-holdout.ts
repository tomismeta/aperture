import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
  buildObservationKernelReleaseHoldoutReport,
  OBSERVATION_KERNEL_RELEASE_HOLDOUT_CUSTODY_PATH,
  OBSERVATION_KERNEL_RELEASE_HOLDOUT_FIRST_RUN_PATH,
  OBSERVATION_KERNEL_RELEASE_HOLDOUT_REPORT_PATH,
  parseObservationKernelReleaseHoldout,
  runObservationKernelReleaseHoldout,
  serializeObservationKernelReleaseHoldout,
  type ObservationKernelReleaseHoldoutReport,
  type ObservationKernelReleaseHoldoutRun,
} from "../packages/lab/src/observation-kernel-release-holdout.js";
import { isDirectExecution } from "./direct-execution.js";

const execFile = promisify(execFileCallback);
const REPO_ROOT = process.cwd();

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
  throw new Error("Usage: --seal, --first-run, or --check");
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
    contracts: {
      observation: artifact.methodology.observationContractDigest,
      sourceEvidence: artifact.methodology.sourceEvidenceContractDigest,
      output: artifact.methodology.outputContractDigest,
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
  if (!isRecord(artifactRecord) || !isRecord(frozenCore) || !isRecord(runner)) {
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
  if (custody.holdoutId !== artifact.methodology.holdoutId || custody.lifecycle !== "sealed") {
    throw new Error("Observation Kernel release holdout custody identity is invalid.");
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
