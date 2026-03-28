import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import {
  appendAutoresearchOptimizerResultsLog,
  assessAutoresearchEditSurface,
  AUTORESEARCH_OPTIMIZER_RUN_SCHEMA_VERSION,
  createAutoresearchOptimizationBrief,
  defaultAutoresearchBriefPath,
  defaultAutoresearchEvaluationPath,
  defaultAutoresearchOptimizerPatchPath,
  defaultAutoresearchOptimizerPromptPath,
  defaultAutoresearchOptimizerRawOutputPath,
  defaultAutoresearchOptimizerRunPath,
  DEFAULT_AUTORESEARCH_EVALUATIONS_DIR,
  DEFAULT_AUTORESEARCH_OPTIMIZER_RESULTS_LOG_PATH,
  evaluateAutoresearchCalibrationCases,
  loadAutoresearchCalibrationCases,
  renderAutoresearchCalibrationMarkdown,
  renderAutoresearchOptimizationMarkdown,
  renderAutoresearchOptimizationPrompt,
  renderAutoresearchOptimizerRunMarkdown,
  writeAutoresearchCalibrationReport,
  writeAutoresearchOptimizationBrief,
  writeAutoresearchOptimizerPatch,
  writeAutoresearchOptimizerPrompt,
  writeAutoresearchOptimizerRawOutput,
  writeAutoresearchOptimizerRun,
  type AutoresearchOptimizerRun,
} from "../packages/lab/src/index.js";

type Provider = "hermes" | "openclaw" | "generic";

type Options = {
  provider: Provider;
  optimizerCommand?: string;
  outputPath?: string;
  promptPath?: string;
  rawOutputPath?: string;
  patchOutputPath?: string;
  beforeOutputPath?: string;
  afterOutputPath?: string;
  briefOutputPath?: string;
  json: boolean;
  skipJudgmentBattle: boolean;
  skipReleaseCheck: boolean;
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  await ensureCleanWorktree();

  const generatedAt = new Date().toISOString();
  const optimizerCommand = options.optimizerCommand
    ?? `pnpm lab:autoresearch:optimizer --provider ${options.provider}`;

  const before = await createEvaluationSnapshot(generatedAt, "before", options.beforeOutputPath);
  const brief = createAutoresearchOptimizationBrief(before.report, {
    generatedAt,
    reportPath: before.outputPath,
  });
  const briefOutputPath = options.briefOutputPath ?? defaultAutoresearchBriefPath(brief);
  const briefMarkdownPath = briefOutputPath.replace(/\.json$/i, ".md");
  await writeAutoresearchOptimizationBrief(briefOutputPath, brief);
  await writeMarkdown(briefMarkdownPath, renderAutoresearchOptimizationMarkdown(brief));

  if (before.report.summary.mismatchCount === 0) {
    const runPath = options.outputPath ?? defaultAutoresearchOptimizerRunPath(generatedAt);
    const runMarkdownPath = runPath.replace(/\.json$/i, ".md");
    const run = createOptimizerRun({
      generatedAt,
      provider: options.provider,
      optimizerCommand,
      briefOutputPath,
      briefMarkdownPath,
      beforeOutputPath: before.outputPath,
      beforeMarkdownPath: before.markdownPath,
      afterOutputPath: before.outputPath,
      afterMarkdownPath: before.markdownPath,
      beforeMismatchCount: before.report.summary.mismatchCount,
      afterMismatchCount: before.report.summary.mismatchCount,
      beforeInvariantMismatchCount: before.report.summary.invariantMismatchCount,
      afterInvariantMismatchCount: before.report.summary.invariantMismatchCount,
      changedFiles: [],
      disallowedFiles: [],
      autoresearchEvaluate: true,
      status: "clean",
      notes: ["Frozen calibration corpus is already clean; optimization skipped."],
    });
    await writeAutoresearchOptimizerRun(runPath, run);
    await writeMarkdown(runMarkdownPath, renderAutoresearchOptimizerRunMarkdown(run));
    await appendAutoresearchOptimizerResultsLog(DEFAULT_AUTORESEARCH_OPTIMIZER_RESULTS_LOG_PATH, run, {
      runPath,
    });
    emitResult(
      options.json,
      {
        status: run.status,
        runPath,
        runMarkdownPath,
        briefOutputPath,
        beforeReportPath: before.outputPath,
        afterReportPath: before.outputPath,
        changedFiles: [],
        disallowedFiles: [],
        mismatchCount: before.report.summary.mismatchCount,
      },
      [
        "Autoresearch optimizer found no remaining mismatches.",
        `Run: ${runPath}`,
        `Brief: ${briefOutputPath}`,
      ],
    );
    return;
  }

  const promptPath = options.promptPath ?? defaultAutoresearchOptimizerPromptPath(generatedAt);
  const rawOutputPath = options.rawOutputPath ?? defaultAutoresearchOptimizerRawOutputPath(generatedAt);
  const patchOutputPath = options.patchOutputPath ?? defaultAutoresearchOptimizerPatchPath(generatedAt);
  const prompt = renderAutoresearchOptimizationPrompt(brief);
  await writeAutoresearchOptimizerPrompt(promptPath, prompt);

  let rawOutput = "";
  let executionError: string | undefined;
  try {
    rawOutput = await executePromptCommand(optimizerCommand, prompt);
  } catch (error) {
    executionError = error instanceof Error ? error.message : String(error);
    rawOutput = executionError;
  }
  await writeAutoresearchOptimizerRawOutput(rawOutputPath, rawOutput);

  const changedFiles = await listWorkingTreeFiles();
  const surface = assessAutoresearchEditSurface(changedFiles, brief.allowedEditPaths);
  const patch = surface.changedFiles.length > 0 ? await readGitDiff() : "";
  if (patch.trim()) {
    await writeAutoresearchOptimizerPatch(patchOutputPath, patch);
  }
  const after = await createEvaluationSnapshot(generatedAt, "after", options.afterOutputPath);

  let judgmentBattle: boolean | undefined;
  let releaseCheck: boolean | undefined;
  const notes: string[] = [];
  if (executionError) {
    notes.push(`Optimizer command failed: ${executionError}`);
  }
  if (surface.disallowedFiles.length > 0) {
    notes.push(`Disallowed files changed: ${surface.disallowedFiles.join(", ")}`);
  }

  if (!executionError && surface.disallowedFiles.length === 0 && surface.changedFiles.length > 0) {
    if (!options.skipJudgmentBattle) {
      const gate = await runShellCommand("pnpm judgment:battle");
      judgmentBattle = gate.ok;
      if (!gate.ok) {
        notes.push(`judgment:battle failed: ${gate.summary}`);
      }
    }

    if (!options.skipReleaseCheck) {
      const gate = await runShellCommand("pnpm release:check");
      releaseCheck = gate.ok;
      if (!gate.ok) {
        notes.push(`release:check failed: ${gate.summary}`);
      }
    }
  }

  const status = determineStatus({
    executionError,
    changedFiles: surface.changedFiles,
    disallowedFiles: surface.disallowedFiles,
    beforeMismatchCount: before.report.summary.mismatchCount,
    afterMismatchCount: after.report.summary.mismatchCount,
    beforeInvariantMismatchCount: before.report.summary.invariantMismatchCount,
    afterInvariantMismatchCount: after.report.summary.invariantMismatchCount,
    judgmentBattle,
    releaseCheck,
  });

  const runPath = options.outputPath ?? defaultAutoresearchOptimizerRunPath(generatedAt);
  const run = createOptimizerRun({
    generatedAt,
    provider: options.provider,
    optimizerCommand,
    briefOutputPath,
    briefMarkdownPath,
    promptPath,
    rawOutputPath,
    ...(patch.trim() ? { patchPath: patchOutputPath } : {}),
    beforeOutputPath: before.outputPath,
    beforeMarkdownPath: before.markdownPath,
    afterOutputPath: after.outputPath,
    afterMarkdownPath: after.markdownPath,
    beforeMismatchCount: before.report.summary.mismatchCount,
    afterMismatchCount: after.report.summary.mismatchCount,
    beforeInvariantMismatchCount: before.report.summary.invariantMismatchCount,
    afterInvariantMismatchCount: after.report.summary.invariantMismatchCount,
    changedFiles: surface.changedFiles,
    disallowedFiles: surface.disallowedFiles,
    autoresearchEvaluate: true,
    ...(judgmentBattle !== undefined ? { judgmentBattle } : {}),
    ...(releaseCheck !== undefined ? { releaseCheck } : {}),
    status,
    notes,
  });

  await writeAutoresearchOptimizerRun(runPath, run);
  const runMarkdownPath = runPath.replace(/\.json$/i, ".md");
  await writeMarkdown(runMarkdownPath, renderAutoresearchOptimizerRunMarkdown(run));
  await appendAutoresearchOptimizerResultsLog(DEFAULT_AUTORESEARCH_OPTIMIZER_RESULTS_LOG_PATH, run, {
    runPath,
  });

  emitResult(
    options.json,
    {
      status: run.status,
      provider: options.provider,
      optimizerCommand,
      runPath,
      runMarkdownPath,
      briefOutputPath,
      briefMarkdownPath,
      beforeReportPath: before.outputPath,
      afterReportPath: after.outputPath,
      changedFiles: surface.changedFiles,
      disallowedFiles: surface.disallowedFiles,
      beforeMismatchCount: before.report.summary.mismatchCount,
      afterMismatchCount: after.report.summary.mismatchCount,
      beforeInvariantMismatchCount: before.report.summary.invariantMismatchCount,
      afterInvariantMismatchCount: after.report.summary.invariantMismatchCount,
      gates: {
        autoresearchEvaluate: true,
        ...(judgmentBattle !== undefined ? { judgmentBattle } : {}),
        ...(releaseCheck !== undefined ? { releaseCheck } : {}),
      },
      notes,
    },
    [
      `Autoresearch optimizer status: ${run.status}.`,
      `Run: ${runPath}`,
      `Brief: ${briefOutputPath}`,
      `Mismatches: ${before.report.summary.mismatchCount} -> ${after.report.summary.mismatchCount}`,
      `Changed files: ${surface.changedFiles.length}`,
    ],
  );
}

function parseArgs(argv: string[]): Options {
  let provider: Provider = "generic";
  let optimizerCommand: string | undefined;
  let outputPath: string | undefined;
  let promptPath: string | undefined;
  let rawOutputPath: string | undefined;
  let patchOutputPath: string | undefined;
  let beforeOutputPath: string | undefined;
  let afterOutputPath: string | undefined;
  let briefOutputPath: string | undefined;
  let json = false;
  let skipJudgmentBattle = false;
  let skipReleaseCheck = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--provider":
        provider = readProvider(argv[++index]);
        break;
      case "--optimizer-command":
        optimizerCommand = argv[++index];
        break;
      case "--output":
        outputPath = path.resolve(argv[++index] ?? "");
        break;
      case "--prompt-output":
        promptPath = path.resolve(argv[++index] ?? "");
        break;
      case "--raw-output":
        rawOutputPath = path.resolve(argv[++index] ?? "");
        break;
      case "--patch-output":
        patchOutputPath = path.resolve(argv[++index] ?? "");
        break;
      case "--before-output":
        beforeOutputPath = path.resolve(argv[++index] ?? "");
        break;
      case "--after-output":
        afterOutputPath = path.resolve(argv[++index] ?? "");
        break;
      case "--brief-output":
        briefOutputPath = path.resolve(argv[++index] ?? "");
        break;
      case "--skip-judgment-battle":
        skipJudgmentBattle = true;
        break;
      case "--skip-release-check":
        skipReleaseCheck = true;
        break;
      case "--json":
        json = true;
        break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return {
    provider,
    ...(optimizerCommand ? { optimizerCommand } : {}),
    ...(outputPath ? { outputPath } : {}),
    ...(promptPath ? { promptPath } : {}),
    ...(rawOutputPath ? { rawOutputPath } : {}),
    ...(patchOutputPath ? { patchOutputPath } : {}),
    ...(beforeOutputPath ? { beforeOutputPath } : {}),
    ...(afterOutputPath ? { afterOutputPath } : {}),
    ...(briefOutputPath ? { briefOutputPath } : {}),
    json,
    skipJudgmentBattle,
    skipReleaseCheck,
  };
}

function readProvider(value: string | undefined): Provider {
  if (value === "hermes" || value === "openclaw" || value === "generic") {
    return value;
  }

  throw new Error("--provider must be one of: hermes, openclaw, generic");
}

async function ensureCleanWorktree(): Promise<void> {
  const files = await listWorkingTreeFiles();
  if (files.length > 0) {
    throw new Error(
      `Autoresearch optimizer requires a clean worktree before it starts. Found changes in: ${files.join(", ")}`,
    );
  }
}

async function createEvaluationSnapshot(
  generatedAt: string,
  label: "before" | "after",
  explicitOutputPath?: string,
): Promise<{
  report: Awaited<ReturnType<typeof evaluateAutoresearchCalibrationCases>>;
  outputPath: string;
  markdownPath: string;
}> {
  const cases = await loadAutoresearchCalibrationCases();
  const report = await evaluateAutoresearchCalibrationCases(cases, {
    generatedAt,
  });
  const outputPath = explicitOutputPath ?? defaultPhaseEvaluationPath(generatedAt, label);
  const markdownPath = outputPath.replace(/\.json$/i, ".md");
  await writeAutoresearchCalibrationReport(outputPath, report);
  await writeMarkdown(markdownPath, renderAutoresearchCalibrationMarkdown(report));

  return {
    report,
    outputPath,
    markdownPath,
  };
}

function defaultPhaseEvaluationPath(generatedAt: string, label: "before" | "after"): string {
  const base = defaultAutoresearchEvaluationPath(generatedAt, DEFAULT_AUTORESEARCH_EVALUATIONS_DIR);
  return base.replace("autoresearch-evaluation-", `autoresearch-evaluation-${label}-`);
}

async function executePromptCommand(command: string, prompt: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      cwd: process.cwd(),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    child.stderr.on("data", (chunk) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf8").trim();
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      const combined = [stdout, stderr].filter(Boolean).join("\n");
      if (code !== 0) {
        reject(new Error(`Optimizer command failed with exit code ${code}${combined ? `: ${combined}` : ""}`));
        return;
      }
      resolve(combined || "(optimizer produced no textual summary)");
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

async function listWorkingTreeFiles(): Promise<string[]> {
  const status = await runGitStatus();
  return parseGitStatusFiles(status.stdout);
}

async function runGitStatus(): Promise<{ stdout: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn("git", ["status", "--short"], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on("data", (chunk) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    child.stderr.on("data", (chunk) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      if (code !== 0) {
        reject(new Error(`git status failed with exit code ${code}${stderr ? `: ${stderr}` : ""}`));
        return;
      }
      resolve({ stdout });
    });
  });
}

function parseGitStatusFiles(statusOutput: string): string[] {
  const files = new Set<string>();
  for (const line of statusOutput.split("\n")) {
    if (!line.trim()) {
      continue;
    }

    const candidate = line.slice(3).trim();
    if (!candidate) {
      continue;
    }

    const renamed = candidate.includes(" -> ") ? candidate.split(" -> ").at(-1) : candidate;
    if (renamed) {
      files.add(renamed);
    }
  }

  return [...files].sort();
}

async function runShellCommand(command: string): Promise<{ ok: boolean; summary: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on("data", (chunk) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    child.stderr.on("data", (chunk) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf8").trim();
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      const combined = [stdout, stderr].filter(Boolean).join("\n");
      resolve({
        ok: code === 0,
        summary: combined || `exit code ${code ?? 1}`,
      });
    });
  });
}

async function readGitDiff(): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn("git", ["diff", "--binary"], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on("data", (chunk) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    child.stderr.on("data", (chunk) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      if (code !== 0) {
        reject(new Error(`git diff failed with exit code ${code}${stderr ? `: ${stderr}` : ""}`));
        return;
      }
      resolve(stdout);
    });
  });
}

function determineStatus(input: {
  executionError?: string;
  changedFiles: string[];
  disallowedFiles: string[];
  beforeMismatchCount: number;
  afterMismatchCount: number;
  beforeInvariantMismatchCount: number;
  afterInvariantMismatchCount: number;
  judgmentBattle?: boolean;
  releaseCheck?: boolean;
}): AutoresearchOptimizerRun["status"] {
  if (input.executionError || input.disallowedFiles.length > 0) {
    return "invalid";
  }
  if (input.changedFiles.length === 0) {
    return "no_change";
  }
  if (input.afterInvariantMismatchCount > input.beforeInvariantMismatchCount) {
    return "regressed";
  }
  if (input.judgmentBattle === false || input.releaseCheck === false) {
    return "regressed";
  }
  if (input.afterMismatchCount < input.beforeMismatchCount) {
    return "improved";
  }
  if (input.afterMismatchCount > input.beforeMismatchCount) {
    return "regressed";
  }
  return "no_change";
}

function createOptimizerRun(input: {
  generatedAt: string;
  provider: string;
  optimizerCommand: string;
  briefOutputPath: string;
  briefMarkdownPath?: string;
  promptPath?: string;
  rawOutputPath?: string;
  patchPath?: string;
  beforeOutputPath: string;
  beforeMarkdownPath?: string;
  afterOutputPath: string;
  afterMarkdownPath?: string;
  beforeMismatchCount: number;
  afterMismatchCount: number;
  beforeInvariantMismatchCount: number;
  afterInvariantMismatchCount: number;
  changedFiles: string[];
  disallowedFiles: string[];
  autoresearchEvaluate: boolean;
  judgmentBattle?: boolean;
  releaseCheck?: boolean;
  status: AutoresearchOptimizerRun["status"];
  notes: string[];
}): AutoresearchOptimizerRun {
  return {
    schemaVersion: AUTORESEARCH_OPTIMIZER_RUN_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    provider: input.provider,
    optimizerCommand: input.optimizerCommand,
    summary: {
      beforeMismatchCount: input.beforeMismatchCount,
      afterMismatchCount: input.afterMismatchCount,
      beforeInvariantMismatchCount: input.beforeInvariantMismatchCount,
      afterInvariantMismatchCount: input.afterInvariantMismatchCount,
      improved: input.afterMismatchCount < input.beforeMismatchCount
        && input.afterInvariantMismatchCount <= input.beforeInvariantMismatchCount,
    },
    artifacts: {
      briefPath: input.briefOutputPath,
      beforeReportPath: input.beforeOutputPath,
      afterReportPath: input.afterOutputPath,
      ...(input.briefMarkdownPath ? { briefMarkdownPath: input.briefMarkdownPath } : {}),
      ...(input.promptPath ? { promptPath: input.promptPath } : {}),
      ...(input.rawOutputPath ? { rawOutputPath: input.rawOutputPath } : {}),
      ...(input.patchPath ? { patchPath: input.patchPath } : {}),
      ...(input.beforeMarkdownPath ? { beforeMarkdownPath: input.beforeMarkdownPath } : {}),
      ...(input.afterMarkdownPath ? { afterMarkdownPath: input.afterMarkdownPath } : {}),
    },
    changes: {
      changedFiles: input.changedFiles,
      disallowedFiles: input.disallowedFiles,
    },
    gates: {
      autoresearchEvaluate: input.autoresearchEvaluate,
      ...(input.judgmentBattle !== undefined ? { judgmentBattle: input.judgmentBattle } : {}),
      ...(input.releaseCheck !== undefined ? { releaseCheck: input.releaseCheck } : {}),
    },
    status: input.status,
    notes: input.notes,
  };
}

async function writeMarkdown(filePath: string, contents: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, "utf8");
}

function emitResult(json: boolean, machine: unknown, text: string[]): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(machine, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${text.join("\n")}\n`);
}

function printUsage(): void {
  console.log([
    "Usage: pnpm lab:autoresearch:optimize [options]",
    "",
    "Runs the frozen calibration loop, asks an optimizer provider to make bounded semantic-layer edits, then reruns the gates.",
    "",
    "Options:",
    "  --provider <hermes|openclaw|generic>  Optimizer provider shortcut (default: generic)",
    "  --optimizer-command <cmd>             Explicit optimizer command; overrides provider adapter",
    "  --output <path>                       Write optimizer run JSON to this path",
    "  --prompt-output <path>                Write optimizer prompt to this path",
    "  --raw-output <path>                   Write raw optimizer stdout/stderr summary to this path",
    "  --patch-output <path>                 Write the surviving git diff patch to this path",
    "  --before-output <path>                Write the pre-optimization evaluation report to this path",
    "  --after-output <path>                 Write the post-optimization evaluation report to this path",
    "  --brief-output <path>                 Write the optimization brief to this path",
    "  --skip-judgment-battle                Skip pnpm judgment:battle",
    "  --skip-release-check                  Skip pnpm release:check",
    "  --json                                Emit machine-readable JSON",
  ].join("\n"));
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
