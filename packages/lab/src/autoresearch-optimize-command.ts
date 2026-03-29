import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import {
  createAutoresearchOptimizationBrief,
  defaultAutoresearchBriefPath,
  defaultAutoresearchEvaluationPath,
  evaluateAutoresearchCalibrationCases,
  loadAutoresearchCalibrationCases,
  renderAutoresearchCalibrationMarkdown,
  renderAutoresearchOptimizationMarkdown,
  writeAutoresearchCalibrationReport,
  writeAutoresearchOptimizationBrief,
} from "./autoresearch-calibration.js";
import {
  assessAutoresearchEditSurface,
  AUTORESEARCH_OPTIMIZER_RUN_SCHEMA_VERSION,
  buildAutoresearchEvaluationCommands,
  defaultAutoresearchOptimizerPatchPath,
  defaultAutoresearchOptimizerPromptPath,
  defaultAutoresearchOptimizerRawOutputPath,
  defaultAutoresearchOptimizerRunPath,
  parseAutoresearchOptimizerFeedback,
  renderAutoresearchOptimizationPrompt,
  renderAutoresearchOptimizerRunMarkdown,
  writeAutoresearchOptimizerPatch,
  writeAutoresearchOptimizerPrompt,
  writeAutoresearchOptimizerRawOutput,
  writeAutoresearchOptimizerRun,
  type AutoresearchOptimizerRun,
} from "./autoresearch-optimizer.js";
import {
  executePromptCommand,
  runFStopRolePrompt,
  type FStopProvider,
} from "./fstop-role.js";
import {
  ensureCleanWorktree,
  listWorkingTreeFiles,
  runGit,
  spawnChecked,
} from "./autoresearch-workspace.js";

export type AutoresearchOptimizeCommandOptions = {
  provider: FStopProvider;
  optimizerCommand?: string;
  extraCalibrationDirs: string[];
  cwd?: string;
  outputPath?: string;
  promptPath?: string;
  rawOutputPath?: string;
  patchOutputPath?: string;
  beforeOutputPath?: string;
  afterOutputPath?: string;
  briefOutputPath?: string;
  skipJudgmentBattle: boolean;
  skipReleaseCheck: boolean;
};

export type AutoresearchOptimizeCommandResult = {
  status: AutoresearchOptimizerRun["status"];
  provider: FStopProvider;
  optimizerCommand: string;
  runPath: string;
  runMarkdownPath: string;
  briefOutputPath: string;
  briefMarkdownPath: string;
  beforeReportPath: string;
  afterReportPath: string;
  changedFiles: string[];
  disallowedFiles: string[];
  beforeMismatchCount: number;
  afterMismatchCount: number;
  beforeInvariantMismatchCount: number;
  afterInvariantMismatchCount: number;
  gates: {
    autoresearchEvaluate: true;
    judgmentBattle?: boolean;
    releaseCheck?: boolean;
  };
  notes: string[];
  feedback?: AutoresearchOptimizerRun["feedback"];
  run: AutoresearchOptimizerRun;
};

export async function runAutoresearchOptimizeCommand(
  options: AutoresearchOptimizeCommandOptions,
): Promise<AutoresearchOptimizeCommandResult> {
  const repoDir = options.cwd ?? process.cwd();
  await ensureCleanWorktree(repoDir);

  const generatedAt = new Date().toISOString();
  const optimizerCommand = options.optimizerCommand ?? `provider:${options.provider}`;
  const evaluationCommands = buildAutoresearchEvaluationCommands(options.extraCalibrationDirs);

  const before = await createOptimizerEvaluationSnapshot(
    generatedAt,
    "before",
    options.beforeOutputPath,
    options.extraCalibrationDirs,
    repoDir,
  );
  const brief = createAutoresearchOptimizationBrief(before.report, {
    generatedAt,
    reportPath: before.outputPath,
    evaluationCommands,
  });
  const briefOutputPath = options.briefOutputPath ?? defaultAutoresearchBriefPath(brief);
  const briefMarkdownPath = briefOutputPath.replace(/\.json$/i, ".md");
  await writeAutoresearchOptimizationBrief(briefOutputPath, brief);
  await writeDirectoryFile(briefMarkdownPath, renderAutoresearchOptimizationMarkdown(brief));

  if (before.report.summary.mismatchCount === 0) {
    const runPath = options.outputPath ?? defaultAutoresearchOptimizerRunPath(generatedAt);
    const run = buildOptimizerRun({
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
    const runMarkdownPath = runPath.replace(/\.json$/i, ".md");
    await writeAutoresearchOptimizerRun(runPath, run);
    await writeDirectoryFile(runMarkdownPath, renderAutoresearchOptimizerRunMarkdown(run));
    return {
      status: run.status,
      provider: options.provider,
      optimizerCommand,
      runPath,
      runMarkdownPath,
      briefOutputPath,
      briefMarkdownPath,
      beforeReportPath: before.outputPath,
      afterReportPath: before.outputPath,
      changedFiles: [],
      disallowedFiles: [],
      beforeMismatchCount: before.report.summary.mismatchCount,
      afterMismatchCount: before.report.summary.mismatchCount,
      beforeInvariantMismatchCount: before.report.summary.invariantMismatchCount,
      afterInvariantMismatchCount: before.report.summary.invariantMismatchCount,
      gates: {
        autoresearchEvaluate: true,
      },
      notes: run.notes,
      run,
    };
  }

  const promptPath = options.promptPath ?? defaultAutoresearchOptimizerPromptPath(generatedAt);
  const rawOutputPath = options.rawOutputPath ?? defaultAutoresearchOptimizerRawOutputPath(generatedAt);
  const patchOutputPath = options.patchOutputPath ?? defaultAutoresearchOptimizerPatchPath(generatedAt);
  const prompt = renderAutoresearchOptimizationPrompt(brief);
  await writeAutoresearchOptimizerPrompt(promptPath, prompt);

  const beforeHead = await readGitHead(repoDir);
  let rawOutput = "";
  let executionError: string | undefined;
  try {
    rawOutput = options.optimizerCommand
      ? await executePromptCommand(
        options.optimizerCommand,
        prompt,
        "Optimizer command",
        "Optimizer command produced no stdout.",
        repoDir,
      )
      : await runFStopRolePrompt("optimizer", prompt, {
        provider: options.provider,
        cwd: repoDir,
      });
  } catch (error) {
    executionError = error instanceof Error ? error.message : String(error);
    rawOutput = executionError;
  }
  await writeAutoresearchOptimizerRawOutput(rawOutputPath, rawOutput);
  const feedback = parseAutoresearchOptimizerFeedback(rawOutput);

  const afterHead = await readGitHead(repoDir);
  const changedFiles = await listCombinedChangedFiles(repoDir, beforeHead, afterHead);
  const surface = assessAutoresearchEditSurface(changedFiles, brief.allowedEditPaths);
  const patch = surface.changedFiles.length > 0 ? await readGitDiff(repoDir, beforeHead, afterHead) : "";
  if (patch.trim()) {
    await writeAutoresearchOptimizerPatch(patchOutputPath, patch);
  }

  const after = await createOptimizerEvaluationSnapshot(
    generatedAt,
    "after",
    options.afterOutputPath,
    options.extraCalibrationDirs,
    repoDir,
  );

  let judgmentBattle: boolean | undefined;
  let releaseCheck: boolean | undefined;
  const notes: string[] = [];
  if (executionError) {
    notes.push(`Optimizer command failed: ${executionError}`);
  }
  if (!executionError && !feedback) {
    notes.push("Optimizer output did not match the structured feedback schema.");
  }
  if (feedback?.action === "no_patch") {
    notes.push(...feedback.reasons.map((entry) => `No-patch reason: ${entry}`));
  }
  if (beforeHead !== afterHead) {
    notes.push(`Optimizer changed HEAD from ${beforeHead} to ${afterHead}.`);
  }
  if (surface.disallowedFiles.length > 0) {
    notes.push(`Disallowed files changed: ${surface.disallowedFiles.join(", ")}`);
  }

  if (!executionError && surface.disallowedFiles.length === 0 && surface.changedFiles.length > 0) {
    if (!options.skipJudgmentBattle) {
      const gate = await runShellCommand("pnpm judgment:battle", repoDir);
      judgmentBattle = gate.ok;
      if (!gate.ok) {
        notes.push(`judgment:battle failed: ${gate.summary}`);
      }
    }

    if (!options.skipReleaseCheck) {
      const gate = await runShellCommand("pnpm release:check", repoDir);
      releaseCheck = gate.ok;
      if (!gate.ok) {
        notes.push(`release:check failed: ${gate.summary}`);
      }
    }
  }

  const status = determineOptimizerStatus({
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
  const run = buildOptimizerRun({
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
    ...(feedback ? { feedback } : {}),
    notes,
  });
  const runMarkdownPath = runPath.replace(/\.json$/i, ".md");
  await writeAutoresearchOptimizerRun(runPath, run);
  await writeDirectoryFile(runMarkdownPath, renderAutoresearchOptimizerRunMarkdown(run));

  return {
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
    ...(feedback ? { feedback } : {}),
    gates: {
      autoresearchEvaluate: true,
      ...(judgmentBattle !== undefined ? { judgmentBattle } : {}),
      ...(releaseCheck !== undefined ? { releaseCheck } : {}),
    },
    notes,
    run,
  };
}

async function createOptimizerEvaluationSnapshot(
  generatedAt: string,
  label: "before" | "after",
  explicitOutputPath?: string,
  extraCalibrationDirs: readonly string[] = [],
  repoRoot: string = process.cwd(),
): Promise<{
  report: Awaited<ReturnType<typeof evaluateAutoresearchCalibrationCases>>;
  outputPath: string;
  markdownPath: string;
}> {
  const cases = await loadAutoresearchCalibrationCases({
    repoRoot,
    ...(extraCalibrationDirs.length > 0 ? { extraDirectories: extraCalibrationDirs } : {}),
  });
  const report = await evaluateAutoresearchCalibrationCases(cases, { generatedAt });
  const outputPath = explicitOutputPath ?? defaultOptimizerEvaluationPath(generatedAt, label);
  const markdownPath = outputPath.replace(/\.json$/i, ".md");
  await writeAutoresearchCalibrationReport(outputPath, report);
  await writeDirectoryFile(markdownPath, renderAutoresearchCalibrationMarkdown(report));
  return { report, outputPath, markdownPath };
}

function defaultOptimizerEvaluationPath(generatedAt: string, label: "before" | "after"): string {
  const base = defaultAutoresearchEvaluationPath(generatedAt);
  return base.replace("autoresearch-evaluation-", `autoresearch-evaluation-${label}-`);
}

async function readGitHead(repoDir: string): Promise<string> {
  return await runGit(repoDir, ["rev-parse", "HEAD"]);
}

async function listCombinedChangedFiles(repoDir: string, beforeHead: string, afterHead: string): Promise<string[]> {
  const workingTreeFiles = await listWorkingTreeFiles(repoDir);
  if (beforeHead === afterHead) {
    return workingTreeFiles;
  }

  const committedFiles = await readGitDiffNameOnly(repoDir, beforeHead, afterHead);
  return [...new Set([...workingTreeFiles, ...committedFiles])].sort();
}

async function readGitDiff(repoDir: string, beforeHead?: string, afterHead?: string): Promise<string> {
  const args = beforeHead && afterHead && beforeHead !== afterHead
    ? ["diff", "--binary", `${beforeHead}..${afterHead}`]
    : ["diff", "--binary"];
  const result = await spawnChecked("git", args, {
    cwd: repoDir,
  });
  return result.stdout;
}

async function readGitDiffNameOnly(repoDir: string, beforeHead: string, afterHead: string): Promise<string[]> {
  const stdout = await runGit(repoDir, ["diff", "--name-only", `${beforeHead}..${afterHead}`]);
  return stdout.split("\n").map((entry) => entry.trim()).filter(Boolean);
}

async function runShellCommand(command: string, repoDir: string): Promise<{ ok: boolean; summary: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      cwd: repoDir,
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

function determineOptimizerStatus(input: {
  executionError?: string | undefined;
  changedFiles: string[];
  disallowedFiles: string[];
  beforeMismatchCount: number;
  afterMismatchCount: number;
  beforeInvariantMismatchCount: number;
  afterInvariantMismatchCount: number;
  judgmentBattle?: boolean | undefined;
  releaseCheck?: boolean | undefined;
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

function buildOptimizerRun(input: {
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
  feedback?: AutoresearchOptimizerRun["feedback"];
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
      improved:
        input.afterMismatchCount < input.beforeMismatchCount
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
    ...(input.feedback ? { feedback: input.feedback } : {}),
    notes: input.notes,
  };
}

async function writeDirectoryFile(filePath: string, contents: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, "utf8");
}
