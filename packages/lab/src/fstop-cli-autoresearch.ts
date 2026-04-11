import {
  resolveAutoresearchInputFile,
  runAutoresearchCampaignCommand,
  runAutoresearchOptimizeCommand,
  runAutoresearchRunnerCommand,
  runAutoresearchServiceCommand,
  runAutoresearchSweepCommand,
  runFStopRolePrompt,
} from "./index.js";
import {
  parseCampaignArgs,
  parseOptimizeArgs,
  parseRoleArgs,
  parseRunArgs,
  parseServiceArgs,
  parseSweepArgs,
  type Role,
} from "./fstop-cli-args.js";
import {
  emitResult,
  readStdin,
} from "./fstop-cli-shared.js";

export async function runRunCli(argv: string[]): Promise<void> {
  const options = parseRunArgs(argv);
  const resolvedInput = options.inputFile
    ? await resolveAutoresearchInputFile(options.inputFile, {
      ...(options.inputDatasetHint ? { dataset: options.inputDatasetHint } : {}),
      ...(options.inputSplitHint ? { split: options.inputSplitHint } : {}),
    })
    : undefined;
  const result = await runAutoresearchRunnerCommand({
    ...options,
    ...(resolvedInput ? { resolvedInput } : {}),
  });
  emitResult(options.json, result, [
    `Autoresearch agent run status: ${result.status}.`,
    `Run: ${result.runPath}`,
    `Retained backlog: ${result.backlogPath}`,
    ...(result.selectedProposalPath ? [`Proposal: ${result.selectedProposalPath}`] : []),
    ...(result.selectedPatchPath ? [`Patch: ${result.selectedPatchPath}`] : []),
  ]);
}

export async function runCampaignCli(argv: string[]): Promise<void> {
  const options = parseCampaignArgs(argv);
  const result = await runAutoresearchCampaignCommand(options);
  emitResult(options.json, result, [
    `F-Stop campaign status: ${result.status}.`,
    `Campaign: ${result.campaignRoot}`,
    `Status: ${result.statusPath}`,
    `Summary: ${result.summaryPath}`,
    ...(result.currentReportPath ? [`Current report: ${result.currentReportPath}`] : []),
    ...(result.selectedPatchPath ? [`Patch: ${result.selectedPatchPath}`] : []),
  ]);
}

export async function runServiceCli(argv: string[]): Promise<void> {
  const options = parseServiceArgs(argv);
  const result = await runAutoresearchServiceCommand(options);
  emitResult(options.json, result, [
    `F-Stop service status: ${result.status}.`,
    `Service: ${result.serviceRoot}`,
    `Status: ${result.statusPath}`,
    `Log: ${result.logPath}`,
    ...(result.currentReportPath ? [`Current report: ${result.currentReportPath}`] : []),
    ...(result.selectedPatchPath ? [`Patch: ${result.selectedPatchPath}`] : []),
  ]);
}

export async function runSweepCli(argv: string[]): Promise<void> {
  const options = parseSweepArgs(argv);
  const result = await runAutoresearchSweepCommand(options);
  emitResult(options.json, result, [
    `F-Stop sweep status: ${result.status}.`,
    `Sweep: ${result.sweepRoot}`,
    `Status: ${result.statusPath}`,
    `Log: ${result.logPath}`,
    `Lanes completed: ${result.completedLanes}/${result.laneCount}`,
  ]);
  if (result.status === "error") {
    process.exitCode = 1;
  }
}

export async function runOptimizeCli(argv: string[]): Promise<void> {
  const options = parseOptimizeArgs(argv);
  const result = await runAutoresearchOptimizeCommand({
    provider: options.provider,
    ...(options.optimizerCommand ? { optimizerCommand: options.optimizerCommand } : {}),
    extraCalibrationDirs: options.extraCalibrationDirs,
    ...(options.outputPath ? { outputPath: options.outputPath } : {}),
    ...(options.promptPath ? { promptPath: options.promptPath } : {}),
    ...(options.rawOutputPath ? { rawOutputPath: options.rawOutputPath } : {}),
    ...(options.patchOutputPath ? { patchOutputPath: options.patchOutputPath } : {}),
    ...(options.beforeOutputPath ? { beforeOutputPath: options.beforeOutputPath } : {}),
    ...(options.afterOutputPath ? { afterOutputPath: options.afterOutputPath } : {}),
    ...(options.briefOutputPath ? { briefOutputPath: options.briefOutputPath } : {}),
    skipJudgmentBattle: options.skipJudgmentBattle,
    skipReleaseCheck: options.skipReleaseCheck,
  });
  emitResult(options.json, {
    status: result.status,
    provider: result.provider,
    optimizerCommand: result.optimizerCommand,
    runPath: result.runPath,
    runMarkdownPath: result.runMarkdownPath,
    briefOutputPath: result.briefOutputPath,
    briefMarkdownPath: result.briefMarkdownPath,
    beforeReportPath: result.beforeReportPath,
    afterReportPath: result.afterReportPath,
    changedFiles: result.changedFiles,
    disallowedFiles: result.disallowedFiles,
    beforeMismatchCount: result.beforeMismatchCount,
    afterMismatchCount: result.afterMismatchCount,
    beforeInvariantMismatchCount: result.beforeInvariantMismatchCount,
    afterInvariantMismatchCount: result.afterInvariantMismatchCount,
    ...(result.feedback ? { feedback: result.feedback } : {}),
    gates: result.gates,
    notes: result.notes,
  }, [
    `Autoresearch optimizer status: ${result.status}.`,
    `Run: ${result.runPath}`,
    `Brief: ${result.briefOutputPath}`,
    `Mismatches: ${result.beforeMismatchCount} -> ${result.afterMismatchCount}`,
    `Changed files: ${result.changedFiles.length}`,
  ]);
}

export async function runRoleCli(role: Role, argv: string[]): Promise<void> {
  const options = parseRoleArgs(argv);
  const prompt = await readStdin();
  if (!prompt.trim()) {
    throw new Error(`${role === "optimizer" ? "Optimizer" : "Reviewer"} adapter expected a prompt on stdin.`);
  }

  const output = await runFStopRolePrompt(role, prompt, {
    provider: options.provider,
    ...(options.command ? { command: options.command } : {}),
  });
  process.stdout.write(output);
}
