import { spawn } from "node:child_process";
import {
  lstat,
  readdir,
  readFile,
  readlink,
  realpath,
  rm,
} from "node:fs/promises";
import path from "node:path";

import {
  compareOfflineReviewArtifact,
  createAutoresearchOptimizationBrief,
  defaultAutoresearchBriefPath,
  defaultAutoresearchCalibrationCasePath,
  defaultAutoresearchEvaluationPath,
  defaultOfflineReviewArtifactPath,
  defaultOfflineReviewPromptPath,
  defaultOfflineReviewReportPath,
  DEFAULT_AUTORESEARCH_GATE_TIMEOUT_SECONDS,
  DEFAULT_AUTORESEARCH_RUN_REVIEW_CONCURRENCY,
  DEFAULT_DATACLAW_SPLIT,
  DEFAULT_FSTOP_SESSION_BUNDLES_DIR,
  DEFAULT_OPEN_AGENT_SESSIONS_SPLIT,
  DEFAULT_OFFLINE_REVIEW_FOCUS_AREAS,
  DEFAULT_PUBLIC_TRAJECTORY_BUNDLES_DIR,
  DEFAULT_RAW_TRAJECTORY_BUNDLES_DIR,
  DEFAULT_SWE_SMITH_SPLIT,
  defaultLabRuntimeRoot,
  defaultPublicTrajectorySplit,
  evaluateAutoresearchCalibrationCases,
  importFStopSessionFileToBundle,
  importPublicTrajectoryBundles,
  importTrajectoryBundlesFromFile,
  loadAutoresearchCalibrationCases,
  loadOfflineReviewArtifact,
  loadSessionBundle,
  promoteOfflineReviewReportToCalibrationCase,
  pruneWorktreeMetadata,
  renderAutoresearchCalibrationMarkdown,
  renderAutoresearchOptimizationMarkdown,
  renderOfflineReviewPrompt,
  renderOfflineReviewReportMarkdown,
  resolveAutoresearchInputFile,
  runFStopRolePrompt,
  runAutoresearchOptimizeCommand,
  runOfflineReviewArtifactReview,
  runAutoresearchCampaignCommand,
  runAutoresearchRunnerCommand,
  runAutoresearchServiceCommand,
  runAutoresearchSweepCommand,
  prepareOfflineReviewArtifact,
  validateFStopSession,
  writeAutoresearchCalibrationCase,
  writeAutoresearchCalibrationReport,
  writeAutoresearchOptimizationBrief,
  writeOfflineReviewArtifact,
  writeOfflineReviewReport,
} from "./index.js";
import {
  parseCalibrationArgs,
  parseCampaignArgs,
  parseGcArgs,
  parseIngestArgs,
  parseOptimizeArgs,
  parseReviewArgs,
  parseRoleArgs,
  parseRunArgs,
  parseServiceArgs,
  parseSweepArgs,
  parseTrajectoryImportArgs,
  type CalibrationCommand,
  type GcOptions,
  type IngestOptions,
  type Provider,
  type Role,
  type ReviewCommand,
} from "./fstop-cli-args.js";
import { printTopLevelUsage } from "./fstop-cli-usage.js";

type GcResult = {
  deleted: string[];
  preserved: string[];
  skipped: string[];
};

export async function runFStopCli(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  switch (command) {
    case "run":
      await runRunCli(rest);
      return;
    case "campaign":
      await runCampaignCli(rest);
      return;
    case "service":
      await runServiceCli(rest);
      return;
    case "sweep":
      await runSweepCli(rest);
      return;
    case "ingest":
      await runIngestCli(rest);
      return;
    case "optimize":
      await runOptimizeCli(rest);
      return;
    case "gc":
      await runGcCli(rest);
      return;
    case "prepare":
    case "prompt":
    case "compare":
    case "review-run":
      await runReviewCli(command, rest);
      return;
    case "promote":
    case "evaluate":
    case "cycle":
      await runCalibrationCli(command, rest);
      return;
    case "reviewer":
    case "optimizer":
      await runRoleCli(command, rest);
      return;
    case "trajectory-import":
      await runTrajectoryImportCli(rest);
      return;
    case "--help":
    case "-h":
    case undefined:
      printTopLevelUsage();
      return;
    default:
      throw new Error(`Unknown F-Stop command: ${command}`);
  }
}

async function runRunCli(argv: string[]): Promise<void> {
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

async function runCampaignCli(argv: string[]): Promise<void> {
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

async function runServiceCli(argv: string[]): Promise<void> {
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

async function runSweepCli(argv: string[]): Promise<void> {
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

async function runIngestCli(argv: string[]): Promise<void> {
  const options = parseIngestArgs(argv);
  if (!options.filePath) {
    throw new Error("--file is required");
  }

  const fileText = await safeReadText(options.filePath);
  const parsed = fileText ? safeParseJson(fileText) : undefined;
  const canonicalSession = parsed ? validateFStopSession(parsed) : null;
  const payload = canonicalSession
    ? await importCanonicalSession(options)
    : await importRawTrajectoryExport(options);

  if (options.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  const mode = options.dryRun ? "Prepared" : "Imported";
  const sourceLabel = payload.sourceKind === "fstop-session" ? "canonical F-Stop session" : "raw trajectory export";
  process.stdout.write(
    `${mode} ${payload.bundleCount} bundle${payload.bundleCount === 1 ? "" : "s"} from ${sourceLabel} ${path.resolve(options.filePath)}.\n`,
  );
  if ("datasets" in payload && payload.datasets && payload.datasets.length > 0) {
    process.stdout.write(`Datasets: ${payload.datasets.join(", ")}\n`);
  }
  if (payload.sessionFilePaths && payload.sessionFilePaths.length > 0) {
    process.stdout.write("Canonical sessions:\n");
    for (const sessionFilePath of payload.sessionFilePaths) {
      process.stdout.write(`- ${path.relative(process.cwd(), sessionFilePath)}\n`);
    }
  }
  process.stdout.write("Bundles:\n");
  for (const bundlePath of payload.bundlePaths) {
    process.stdout.write(`- ${path.relative(process.cwd(), bundlePath)}\n`);
  }
}

async function runOptimizeCli(argv: string[]): Promise<void> {
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

async function runGcCli(argv: string[]): Promise<void> {
  const options = parseGcArgs(argv);
  const campaignRoot = path.join(options.runtimeRoot, "campaigns");
  const resultsRoot = path.join(options.runtimeRoot, "results");
  const preservedPaths = new Set<string>(await readPreservedPaths(options.runtimeRoot));
  const result: GcResult = {
    deleted: [],
    preserved: [...preservedPaths].sort(),
    skipped: [],
  };

  await pruneDirectory(campaignRoot, options.keepCampaigns, preservedPaths, result, options);
  for (const directory of [
    path.join(resultsRoot, "offline-review", "batches"),
    path.join(resultsRoot, "offline-review", "requests"),
    path.join(resultsRoot, "offline-review", "prompts"),
    path.join(resultsRoot, "offline-review", "raw"),
    path.join(resultsRoot, "offline-review", "responses"),
    path.join(resultsRoot, "offline-review", "disagreements"),
    path.join(resultsRoot, "offline-review", "recommendations"),
    path.join(resultsRoot, "offline-review", "runs"),
    path.join(resultsRoot, "autoresearch", "briefs"),
    path.join(resultsRoot, "autoresearch", "evaluations"),
    path.join(resultsRoot, "autoresearch", "optimizer", "patches"),
    path.join(resultsRoot, "autoresearch", "optimizer", "prompts"),
    path.join(resultsRoot, "autoresearch", "optimizer", "raw"),
    path.join(resultsRoot, "autoresearch", "optimizer", "runs"),
    path.join(resultsRoot, "autoresearch", "proposals"),
    path.join(resultsRoot, "autoresearch", "reports"),
    path.join(resultsRoot, "autoresearch", "runner", "prompts"),
    path.join(resultsRoot, "autoresearch", "runner", "raw"),
    path.join(resultsRoot, "autoresearch", "runner", "runs"),
  ]) {
    await pruneDirectory(directory, options.keepArtifacts, preservedPaths, result, options);
  }

  if (!options.dryRun) {
    await pruneWorktreeMetadata(options.sourceRepo).catch(() => undefined);
  }

  const payload = {
    status: "ok" as const,
    runtimeRoot: options.runtimeRoot,
    sourceRepo: options.sourceRepo,
    deletedCount: result.deleted.length,
    preservedCount: result.preserved.length,
    skippedCount: result.skipped.length,
    ...result,
  };
  emitResult(options.json, payload, [
    `F-Stop GC completed for ${options.runtimeRoot}.`,
    `Deleted: ${result.deleted.length}`,
    `Preserved: ${result.preserved.length}`,
    `Skipped: ${result.skipped.length}`,
  ]);
}

async function runReviewCli(command: ReviewCommand, argv: string[]): Promise<void> {
  const options = parseReviewArgs(command, argv);

  if (options.command === "prepare") {
    const bundle = await loadSessionBundle(options.bundlePath);
    const artifact = prepareOfflineReviewArtifact(bundle, {
      bundlePath: options.bundlePath,
      focusAreas: options.focusAreas,
      ...(options.rubricVersion ? { rubricVersion: options.rubricVersion } : {}),
    });
    const outputPath = options.outputPath ?? defaultOfflineReviewArtifactPath(artifact);
    await writeOfflineReviewArtifact(outputPath, artifact);
    emitResult(options.json, {
      status: "prepared" as const,
      bundleSessionId: bundle.sessionId,
      artifactPath: outputPath,
      focusAreas: artifact.focusAreas,
    }, [
      `Prepared offline review artifact for ${bundle.sessionId}.`,
      `Artifact: ${outputPath}`,
      `Focus areas: ${artifact.focusAreas.join(", ")}`,
    ]);
    return;
  }

  if (options.command === "prompt") {
    const artifact = await loadOfflineReviewArtifact(options.artifactPath);
    const outputPath = options.outputPath ?? defaultOfflineReviewPromptPath(artifact);
    await writeDirectoryFile(outputPath, renderOfflineReviewPrompt(artifact));
    emitResult(options.json, {
      status: "prompted" as const,
      bundleSessionId: artifact.bundle.sessionId,
      artifactPath: options.artifactPath,
      promptPath: outputPath,
    }, [
      `Rendered reviewer prompt for ${artifact.bundle.sessionId}.`,
      `Prompt: ${outputPath}`,
    ]);
    return;
  }

  if (options.command === "compare") {
    const artifact = await loadOfflineReviewArtifact(options.artifactPath);
    const report = compareOfflineReviewArtifact(artifact);
    const outputPath = options.outputPath ?? defaultOfflineReviewReportPath(artifact);
    const markdownPath = outputPath.replace(/\.json$/i, ".md");
    await writeOfflineReviewReport(outputPath, report);
    await writeDirectoryFile(markdownPath, renderOfflineReviewReportMarkdown(report));
    const status = report.summary.disagreementCount > 0 ? "disagreement" : "clean";
    emitResult(options.json, {
      status,
      bundleSessionId: artifact.bundle.sessionId,
      artifactPath: options.artifactPath,
      reportPath: outputPath,
      reportMarkdownPath: markdownPath,
      totalFindings: report.summary.totalFindings,
      matchedFindings: report.summary.matchedFindings,
      disagreementCount: report.summary.disagreementCount,
    }, [
      `Compared offline review artifact for ${artifact.bundle.sessionId}.`,
      `Report: ${outputPath}`,
      `Summary: ${markdownPath}`,
      `Disagreements: ${report.summary.disagreementCount}/${report.summary.totalFindings}`,
    ]);
    if (options.failOnDisagreement && status === "disagreement") {
      process.exitCode = 1;
    }
    return;
  }

  const responseText = options.responseFromStdin
    ? await readStdin()
    : options.responsePath
      ? await readFile(options.responsePath, "utf8")
      : undefined;
  const result = await runOfflineReviewArtifactReview({
    artifactPath: options.artifactPath,
    ...(responseText !== undefined ? { responseText } : {}),
    ...(options.reviewerCommand ? { reviewerCommand: options.reviewerCommand, reviewerProvider: "generic" } : {}),
    ...(options.promptPath ? { promptPath: options.promptPath } : {}),
    ...(options.rawResponsePath ? { rawResponsePath: options.rawResponsePath } : {}),
    ...(options.responseArtifactPath ? { responseArtifactPath: options.responseArtifactPath } : {}),
    ...(options.outputPath ? { outputPath: options.outputPath } : {}),
    ...(options.recommendationPath ? { recommendationPath: options.recommendationPath } : {}),
    ...(options.runPath ? { runPath: options.runPath } : {}),
  });

  emitResult(options.json, {
    status: result.status,
    bundleSessionId: result.bundleSessionId,
    requestPath: options.artifactPath,
    promptPath: result.promptPath,
    rawResponsePath: result.rawResponsePath,
    responseArtifactPath: result.responseArtifactPath,
    reportPath: result.reportPath,
    reportMarkdownPath: result.reportMarkdownPath,
    recommendationPath: result.recommendationPath,
    recommendationMarkdownPath: result.recommendationMarkdownPath,
    runPath: result.runPath,
    totalFindings: result.totalFindings,
    matchedFindings: result.matchedFindings,
    disagreementCount: result.disagreementCount,
    actionableCount: result.actionableCount,
  }, [
    `Ran offline review for ${result.bundleSessionId}.`,
    `Prompt: ${result.promptPath}`,
    `Raw reviewer output: ${result.rawResponsePath}`,
    `Filled artifact: ${result.responseArtifactPath}`,
    `Report: ${result.reportPath}`,
    `Recommendation: ${result.recommendationPath}`,
    `Run summary: ${result.runPath}`,
    `Disagreements: ${result.disagreementCount}/${result.totalFindings}`,
    `Actionable: ${result.actionableCount}`,
  ]);

  if (options.failOnDisagreement && result.status === "disagreement") {
    process.exitCode = 1;
  }
}

async function runCalibrationCli(command: CalibrationCommand, argv: string[]): Promise<void> {
  const options = parseCalibrationArgs(command, argv);
  if (options.command === "promote") {
    const calibrationCase = await promoteOfflineReviewReportToCalibrationCase(options.reportPath, {
      split: options.split,
      ...(options.focusAreas.length > 0 ? { focusAreas: options.focusAreas } : {}),
      recommendationAllowlist: options.recommendations,
      ...(options.minimumConfidence ? { minimumConfidence: options.minimumConfidence } : {}),
      includeStepInvariants: options.includeStepInvariants,
    });
    const outputPath = options.outputPath ?? defaultAutoresearchCalibrationCasePath(calibrationCase);
    await writeAutoresearchCalibrationCase(outputPath, calibrationCase);
    emitResult(options.json, {
      status: "promoted" as const,
      split: calibrationCase.split,
      sessionId: calibrationCase.sessionId,
      outputPath,
      correctedCount: calibrationCase.summary.correctedCount,
      invariantCount: calibrationCase.summary.invariantCount,
      targets: calibrationCase.targets,
      semanticFamilies: calibrationCase.semanticFamilies,
    }, [
      `Promoted calibration case for ${calibrationCase.sessionId}.`,
      `Case: ${outputPath}`,
      `Corrected expectations: ${calibrationCase.summary.correctedCount}`,
      `Invariant expectations: ${calibrationCase.summary.invariantCount}`,
      `Semantic families: ${calibrationCase.semanticFamilies.join(", ") || "(none)"}`,
    ]);
    return;
  }

  const cases = await loadAutoresearchCalibrationCases({
    ...(options.splits.length > 0 ? { splits: options.splits } : {}),
    ...(options.extraCalibrationDirs.length > 0 ? { extraDirectories: options.extraCalibrationDirs } : {}),
  });
  const report = await evaluateAutoresearchCalibrationCases(cases, {});
  const outputPath = options.outputPath ?? defaultAutoresearchEvaluationPath(report);
  const markdownPath = outputPath.replace(/\.json$/i, ".md");
  await writeAutoresearchCalibrationReport(outputPath, report);
  await writeDirectoryFile(markdownPath, renderAutoresearchCalibrationMarkdown(report));

  if (options.command === "evaluate") {
    emitResult(options.json, {
      status: report.summary.mismatchCount > 0 ? "mismatch" : "clean",
      outputPath,
      markdownPath,
      caseCount: report.summary.caseCount,
      expectationCount: report.summary.expectationCount,
      mismatchCount: report.summary.mismatchCount,
      correctedMismatchCount: report.summary.correctedMismatchCount,
      invariantMismatchCount: report.summary.invariantMismatchCount,
      mismatchSemanticFamilyCounts: report.summary.mismatchSemanticFamilyCounts,
    }, [
      `Autoresearch calibration evaluated ${report.summary.caseCount} case(s).`,
      `Report: ${outputPath}`,
      `Summary: ${markdownPath}`,
      `Mismatches: ${report.summary.mismatchCount}/${report.summary.expectationCount}`,
      `Semantic families: ${Object.entries(report.summary.mismatchSemanticFamilyCounts)
        .filter(([, count]) => count > 0)
        .map(([family, count]) => `${family}=${count}`)
        .join(", ") || "(none)"}`,
    ]);
    return;
  }

  const brief = createAutoresearchOptimizationBrief(report, {
    reportPath: outputPath,
  });
  const briefOutputPath = options.briefOutputPath ?? defaultAutoresearchBriefPath(brief);
  const briefMarkdownPath = briefOutputPath.replace(/\.json$/i, ".md");
  await writeAutoresearchOptimizationBrief(briefOutputPath, brief);
  await writeDirectoryFile(briefMarkdownPath, renderAutoresearchOptimizationMarkdown(brief));

  emitResult(options.json, {
    status: report.summary.mismatchCount > 0 ? "actionable" : "clean",
    outputPath,
    markdownPath,
    briefOutputPath,
    briefMarkdownPath,
    caseCount: report.summary.caseCount,
    expectationCount: report.summary.expectationCount,
    mismatchCount: report.summary.mismatchCount,
    correctedMismatchCount: report.summary.correctedMismatchCount,
    invariantMismatchCount: report.summary.invariantMismatchCount,
    mismatchSemanticFamilyCounts: report.summary.mismatchSemanticFamilyCounts,
    priorities: brief.priorities.slice(0, 5).map((priority) => ({
      focusArea: priority.focusArea,
      mismatchCount: priority.mismatchCount,
      correctedMismatchCount: priority.correctedMismatchCount,
      targets: priority.targets,
    })),
  }, [
    `Autoresearch cycle evaluated ${report.summary.caseCount} case(s).`,
    `Report: ${outputPath}`,
    `Summary: ${markdownPath}`,
    `Brief: ${briefOutputPath}`,
    `Brief summary: ${briefMarkdownPath}`,
    `Mismatches: ${report.summary.mismatchCount}/${report.summary.expectationCount}`,
    `Semantic families: ${Object.entries(report.summary.mismatchSemanticFamilyCounts)
      .filter(([, count]) => count > 0)
      .map(([family, count]) => `${family}=${count}`)
      .join(", ") || "(none)"}`,
  ]);
}

async function runRoleCli(role: Role, argv: string[]): Promise<void> {
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

async function runTrajectoryImportCli(argv: string[]): Promise<void> {
  const options = parseTrajectoryImportArgs(argv);
  const imported = await importPublicTrajectoryBundles(options);
  const dataset = options.dataset ?? "swe-smith";
  const split = options.split ?? defaultPublicTrajectorySplit(dataset);
  const mode = options.dryRun ? "Prepared" : "Imported";

  process.stdout.write(
    `${mode} ${imported.length} public trajectory bundle${imported.length === 1 ? "" : "s"} from ${dataset} (${split}, offset ${options.offset ?? 0}).\n`,
  );
  for (const item of imported) {
    process.stdout.write(`- ${item.recordId} -> ${path.relative(process.cwd(), item.filePath)}\n`);
  }
}

async function importCanonicalSession(options: IngestOptions): Promise<{
  bundleCount: number;
  bundlePaths: string[];
  outputDirectory: string;
  sessionFilePaths?: string[];
  sourceKind: "fstop-session";
  sourcePath: string;
  status: "ok";
}> {
  const outputDirectory = options.outputDirectory ?? DEFAULT_FSTOP_SESSION_BUNDLES_DIR;
  const imported = await importFStopSessionFileToBundle({
    filePath: options.filePath,
    outputDirectory,
    ...(options.exportedAt ? { exportedAt: options.exportedAt } : {}),
    ...(options.dryRun ? { dryRun: options.dryRun } : {}),
  });
  return {
    status: "ok",
    sourcePath: options.filePath,
    sourceKind: "fstop-session",
    bundleCount: 1,
    outputDirectory,
    bundlePaths: [imported.bundlePath],
    sessionFilePaths: [imported.sessionPath],
  };
}

async function importRawTrajectoryExport(options: IngestOptions): Promise<{
  bundleCount: number;
  bundlePaths: string[];
  datasets: string[];
  outputDirectory: string;
  sessionFilePaths: string[];
  sourceKind: "raw-export";
  sourcePath: string;
  status: "ok";
}> {
  const imported = await importTrajectoryBundlesFromFile(options);
  const datasets = [...new Set(imported.map((item) => item.dataset))];
  return {
    status: "ok",
    sourcePath: options.filePath,
    sourceKind: "raw-export",
    bundleCount: imported.length,
    datasets,
    outputDirectory: options.outputDirectory ?? DEFAULT_RAW_TRAJECTORY_BUNDLES_DIR,
    bundlePaths: imported.map((item) => item.filePath),
    sessionFilePaths: imported.flatMap((item) => item.sessionFilePath ? [item.sessionFilePath] : []),
  };
}

async function pruneDirectory(
  directory: string,
  keepCount: number,
  preservedPaths: Set<string>,
  result: GcResult,
  options: GcOptions,
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    return;
  }

  const ranked = await Promise.all(entries.map(async (entry) => {
    const filePath = path.join(directory, entry);
    const stats = await lstat(filePath);
    return {
      filePath,
      mtimeMs: stats.mtimeMs,
    };
  }));

  ranked.sort((left, right) => right.mtimeMs - left.mtimeMs || left.filePath.localeCompare(right.filePath));
  const keepSet = new Set(
    ranked.slice(0, Math.max(0, keepCount)).map((entry) => entry.filePath),
  );

  for (const entry of ranked) {
    if (keepSet.has(entry.filePath) || preservedPaths.has(entry.filePath)) {
      continue;
    }
    if (options.dryRun) {
      result.skipped.push(entry.filePath);
      continue;
    }
    await rm(entry.filePath, { recursive: true, force: true });
    result.deleted.push(entry.filePath);
  }
}

async function readPreservedPaths(runtimeRoot: string): Promise<string[]> {
  const paths = new Set<string>();
  for (const linkPath of [
    path.join(runtimeRoot, "current-campaign"),
    path.join(runtimeRoot, "latest-campaign"),
  ]) {
    try {
      const target = await resolveSymlink(linkPath);
      paths.add(target);
    } catch {
      continue;
    }
  }
  return [...paths];
}

async function resolveSymlink(linkPath: string): Promise<string> {
  const target = await readlink(linkPath);
  return realpath(path.resolve(path.dirname(linkPath), target));
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function emitResult(json: boolean, payload: unknown, lines: string[]): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}

async function safeReadText(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

async function writeDirectoryFile(filePath: string, contents: string): Promise<void> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, "utf8");
}
