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
  type AutoresearchCalibrationSplit,
  type AutoresearchCampaignCommandOptions,
  type AutoresearchCampaignProvider,
  type AutoresearchRunCommandOptions,
  type AutoresearchRunnerProvider,
  type AutoresearchServiceCommandOptions,
  type AutoresearchServiceProvider,
  type AutoresearchSweepCommandOptions,
  type AutoresearchSweepLane,
  type AutoresearchSweepPreset,
  type ImportPublicTrajectoryBundlesOptions,
  type ImportTrajectoryBundlesFromFileOptions,
  type OfflineReviewConfidence,
  type OfflineReviewFocusArea,
  type OfflineReviewRecommendation,
  type PublicTrajectoryDataset,
  type PublicTrajectorySplit,
} from "./index.js";

type Provider = "generic" | "hermes" | "openclaw";

type JsonOptions = {
  json: boolean;
};

type GcOptions = JsonOptions & {
  dryRun: boolean;
  keepArtifacts: number;
  keepCampaigns: number;
  runtimeRoot: string;
  sourceRepo: string;
};

type GcResult = {
  deleted: string[];
  preserved: string[];
  skipped: string[];
};

type IngestOptions = ImportTrajectoryBundlesFromFileOptions & JsonOptions;

type ReviewCommand = "prepare" | "prompt" | "compare" | "review-run";

type ReviewPrepareOptions = JsonOptions & {
  command: "prepare";
  bundlePath: string;
  outputPath?: string;
  rubricVersion?: string;
  focusAreas: OfflineReviewFocusArea[];
};

type ReviewPromptOptions = JsonOptions & {
  command: "prompt";
  artifactPath: string;
  outputPath?: string;
};

type ReviewCompareOptions = JsonOptions & {
  command: "compare";
  artifactPath: string;
  outputPath?: string;
  failOnDisagreement: boolean;
};

type ReviewRunOptions = JsonOptions & {
  command: "review-run";
  artifactPath: string;
  responsePath?: string;
  responseFromStdin: boolean;
  reviewerCommand?: string;
  promptPath?: string;
  rawResponsePath?: string;
  responseArtifactPath?: string;
  outputPath?: string;
  recommendationPath?: string;
  runPath?: string;
  failOnDisagreement: boolean;
};

type ReviewCliOptions =
  | ReviewPrepareOptions
  | ReviewPromptOptions
  | ReviewCompareOptions
  | ReviewRunOptions;

type CalibrationCommand = "cycle" | "evaluate" | "promote";
type OptimizeCliOptions = JsonOptions & {
  provider: Provider;
  optimizerCommand?: string;
  extraCalibrationDirs: string[];
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

type PromoteOptions = JsonOptions & {
  command: "promote";
  focusAreas: OfflineReviewFocusArea[];
  includeStepInvariants: boolean;
  minimumConfidence?: OfflineReviewConfidence;
  outputPath?: string;
  recommendations: OfflineReviewRecommendation[];
  reportPath: string;
  split: AutoresearchCalibrationSplit;
};

type EvaluateOptions = JsonOptions & {
  command: "evaluate";
  extraCalibrationDirs: string[];
  outputPath?: string;
  splits: AutoresearchCalibrationSplit[];
};

type CycleOptions = JsonOptions & {
  briefOutputPath?: string;
  command: "cycle";
  extraCalibrationDirs: string[];
  outputPath?: string;
  splits: AutoresearchCalibrationSplit[];
};

type CalibrationOptions = PromoteOptions | EvaluateOptions | CycleOptions;

type Role = "optimizer" | "reviewer";

type RoleOptions = {
  command?: string;
  provider: Provider;
};

type ServiceCliOptions = AutoresearchServiceCommandOptions & JsonOptions;
type SweepCliOptions = AutoresearchSweepCommandOptions & JsonOptions;

type CampaignCliOptions = AutoresearchCampaignCommandOptions & JsonOptions;

type RunCliOptions = AutoresearchRunCommandOptions & JsonOptions;

type SharedProviderState<T extends Provider> = {
  provider: T;
  reviewerProvider?: T;
  optimizerProvider?: T;
};

function createSharedProviderState<T extends Provider>(
  provider: T,
  options: {
    initializeReviewer?: boolean;
    initializeOptimizer?: boolean;
  } = {},
): SharedProviderState<T> {
  return {
    provider,
    ...(options.initializeReviewer ? { reviewerProvider: provider } : {}),
    ...(options.initializeOptimizer ? { optimizerProvider: provider } : {}),
  };
}

function applySharedProviderArg<T extends Provider>(
  state: SharedProviderState<T>,
  arg: string | undefined,
  value: string | undefined,
  options: {
    propagatePrimaryProvider: boolean;
  },
): boolean {
  switch (arg) {
    case "--provider": {
      const provider = readProvider(value) as T;
      state.provider = provider;
      if (options.propagatePrimaryProvider) {
        if (state.reviewerProvider === undefined || state.reviewerProvider === "generic") {
          state.reviewerProvider = provider;
        }
        if (state.optimizerProvider === undefined || state.optimizerProvider === "generic") {
          state.optimizerProvider = provider;
        }
      }
      return true;
    }
    case "--reviewer-provider":
      state.reviewerProvider = readProvider(value) as T;
      return true;
    case "--optimizer-provider":
      state.optimizerProvider = readProvider(value) as T;
      return true;
    default:
      return false;
  }
}

function resolveSharedProviderState<T extends Provider>(
  state: SharedProviderState<T>,
): {
  provider: T;
  reviewerProvider: T;
  optimizerProvider: T;
} {
  return {
    provider: state.provider,
    reviewerProvider: state.reviewerProvider ?? state.provider,
    optimizerProvider: state.optimizerProvider ?? state.reviewerProvider ?? state.provider,
  };
}

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
      dataset: options.dataset,
      split: options.split,
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
    }, [
      `Promoted calibration case for ${calibrationCase.sessionId}.`,
      `Case: ${outputPath}`,
      `Corrected expectations: ${calibrationCase.summary.correctedCount}`,
      `Invariant expectations: ${calibrationCase.summary.invariantCount}`,
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
    }, [
      `Autoresearch calibration evaluated ${report.summary.caseCount} case(s).`,
      `Report: ${outputPath}`,
      `Summary: ${markdownPath}`,
      `Mismatches: ${report.summary.mismatchCount}/${report.summary.expectationCount}`,
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

function parseRunArgs(argv: string[]): RunCliOptions {
  const providers = createSharedProviderState<AutoresearchRunnerProvider>("generic", {
    initializeReviewer: true,
    initializeOptimizer: true,
  });
  let inputFile: string | undefined;
  let batchReportPath: string | undefined;
  const bundlePaths: string[] = [];
  let dataset: PublicTrajectoryDataset = "swe-smith";
  let split: PublicTrajectorySplit | undefined;
  let offset = 0;
  let limit = 12;
  let maxSlices = 3;
  let reviewConcurrency = DEFAULT_AUTORESEARCH_RUN_REVIEW_CONCURRENCY;
  let minSessionCount = 2;
  let maxReports = 4;
  let outputPath: string | undefined;
  let statusOutputPath: string | undefined;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (applySharedProviderArg(providers, arg, argv[index + 1], { propagatePrimaryProvider: true })) {
      index += 1;
      continue;
    }
    switch (arg) {
      case "--file":
        inputFile = path.resolve(argv[++index] ?? "");
        break;
      case "--batch-report":
        batchReportPath = path.resolve(argv[++index] ?? "");
        break;
      case "--bundle":
        bundlePaths.push(path.resolve(argv[++index] ?? ""));
        break;
      case "--dataset":
        dataset = readDataset(argv[++index]);
        break;
      case "--split":
        split = readPublicSplit(argv[++index]);
        break;
      case "--offset":
        offset = readInteger(argv[++index], "--offset");
        break;
      case "--limit":
        limit = readInteger(argv[++index], "--limit");
        break;
      case "--max-slices":
        maxSlices = readInteger(argv[++index], "--max-slices");
        break;
      case "--review-concurrency":
        reviewConcurrency = readPositiveInteger(argv[++index], "--review-concurrency");
        break;
      case "--min-session-count":
        minSessionCount = readInteger(argv[++index], "--min-session-count");
        break;
      case "--max-reports":
        maxReports = readInteger(argv[++index], "--max-reports");
        break;
      case "--output":
        outputPath = path.resolve(argv[++index] ?? "");
        break;
      case "--status-output":
        statusOutputPath = path.resolve(argv[++index] ?? "");
        break;
      case "--json":
        json = true;
        break;
      case "--help":
      case "-h":
        printRunUsage();
        process.exit(0);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  const resolvedProviders = resolveSharedProviderState(providers);

  return {
    provider: resolvedProviders.provider,
    ...(inputFile ? { inputFile } : {}),
    ...(batchReportPath ? { batchReportPath } : {}),
    bundlePaths,
    dataset,
    split: split ?? defaultPublicTrajectorySplit(dataset),
    offset,
    limit,
    maxSlices,
    reviewerProvider: resolvedProviders.reviewerProvider,
    optimizerProvider: resolvedProviders.optimizerProvider,
    reviewConcurrency,
    minSessionCount,
    maxReports,
    ...(outputPath ? { outputPath } : {}),
    ...(statusOutputPath ? { statusOutputPath } : {}),
    json,
  };
}

function parseCampaignArgs(argv: string[]): CampaignCliOptions {
  const providers = createSharedProviderState<AutoresearchCampaignProvider>("generic", {
    initializeReviewer: true,
    initializeOptimizer: true,
  });
  let dataset: CampaignCliOptions["dataset"] = "swe-smith";
  let split: CampaignCliOptions["split"] | undefined;
  let offset = 0;
  let limit = 12;
  let maxSlices = 10;
  let windowCount = 8;
  let reviewConcurrency = 2;
  let minSessionCount = 2;
  let maxReports = 4;
  let stallThresholdSeconds = 900;
  let campaignId: string | undefined;
  let campaignRoot: string | undefined;
  let sourceRepo = process.cwd();
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (applySharedProviderArg(providers, arg, argv[index + 1], { propagatePrimaryProvider: true })) {
      index += 1;
      continue;
    }
    switch (arg) {
      case "--dataset":
        dataset = readDataset(argv[++index]);
        break;
      case "--split":
        split = readPublicSplit(argv[++index]);
        break;
      case "--offset":
        offset = readInteger(argv[++index], "--offset");
        break;
      case "--limit":
        limit = readPositiveInteger(argv[++index], "--limit");
        break;
      case "--max-slices":
        maxSlices = readPositiveInteger(argv[++index], "--max-slices");
        break;
      case "--windows":
      case "--window-count":
        windowCount = readPositiveInteger(argv[++index], "--window-count");
        break;
      case "--review-concurrency":
        reviewConcurrency = readPositiveInteger(argv[++index], "--review-concurrency");
        break;
      case "--min-session-count":
        minSessionCount = readInteger(argv[++index], "--min-session-count");
        break;
      case "--max-reports":
        maxReports = readPositiveInteger(argv[++index], "--max-reports");
        break;
      case "--stall-threshold-seconds":
        stallThresholdSeconds = readPositiveInteger(argv[++index], "--stall-threshold-seconds");
        break;
      case "--campaign-id":
        campaignId = argv[++index];
        break;
      case "--campaign-root":
        campaignRoot = path.resolve(argv[++index] ?? "");
        break;
      case "--source-repo":
        sourceRepo = path.resolve(argv[++index] ?? "");
        break;
      case "--json":
        json = true;
        break;
      case "--help":
      case "-h":
        printCampaignUsage();
        process.exit(0);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  const resolvedProviders = resolveSharedProviderState(providers);

  return {
    provider: resolvedProviders.provider,
    dataset,
    split: split ?? defaultPublicTrajectorySplit(dataset),
    offset,
    limit,
    maxSlices,
    windowCount,
    reviewerProvider: resolvedProviders.reviewerProvider,
    optimizerProvider: resolvedProviders.optimizerProvider,
    reviewConcurrency,
    minSessionCount,
    maxReports,
    stallThresholdSeconds,
    ...(campaignId ? { campaignId } : {}),
    ...(campaignRoot ? { campaignRoot } : {}),
    sourceRepo,
    json,
  };
}

function parseServiceArgs(argv: string[]): ServiceCliOptions {
  const providers = createSharedProviderState<AutoresearchServiceProvider>("generic");
  let dataset: PublicTrajectoryDataset = "swe-smith";
  let split: PublicTrajectorySplit | undefined;
  let offset = 0;
  let limit = 12;
  let maxSlices = 10;
  let windowCount = 8;
  let reviewConcurrency = 2;
  let minSessionCount = 2;
  let maxReports = 4;
  let maxRestarts = 3;
  let restartBackoffSeconds = 15;
  let campaignStallThresholdSeconds = 900;
  let serviceStallThresholdSeconds = 1200;
  let serviceId: string | undefined;
  let serviceRoot: string | undefined;
  let sourceRepo = process.cwd();
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (applySharedProviderArg(providers, arg, argv[index + 1], { propagatePrimaryProvider: false })) {
      index += 1;
      continue;
    }
    switch (arg) {
      case "--dataset":
        dataset = readDataset(argv[++index]);
        break;
      case "--split":
        split = readPublicSplit(argv[++index]);
        break;
      case "--offset":
        offset = readInteger(argv[++index], "--offset");
        break;
      case "--limit":
        limit = readPositiveInteger(argv[++index], "--limit");
        break;
      case "--max-slices":
        maxSlices = readPositiveInteger(argv[++index], "--max-slices");
        break;
      case "--window-count":
        windowCount = readPositiveInteger(argv[++index], "--window-count");
        break;
      case "--review-concurrency":
        reviewConcurrency = readPositiveInteger(argv[++index], "--review-concurrency");
        break;
      case "--min-session-count":
        minSessionCount = readPositiveInteger(argv[++index], "--min-session-count");
        break;
      case "--max-reports":
        maxReports = readPositiveInteger(argv[++index], "--max-reports");
        break;
      case "--max-restarts":
        maxRestarts = readInteger(argv[++index], "--max-restarts");
        break;
      case "--restart-backoff-seconds":
        restartBackoffSeconds = readPositiveInteger(argv[++index], "--restart-backoff-seconds");
        break;
      case "--campaign-stall-threshold-seconds":
        campaignStallThresholdSeconds = readPositiveInteger(argv[++index], "--campaign-stall-threshold-seconds");
        break;
      case "--service-stall-threshold-seconds":
        serviceStallThresholdSeconds = readPositiveInteger(argv[++index], "--service-stall-threshold-seconds");
        break;
      case "--service-id":
        serviceId = argv[++index];
        break;
      case "--service-root":
        serviceRoot = path.resolve(argv[++index] ?? "");
        break;
      case "--source-repo":
        sourceRepo = path.resolve(argv[++index] ?? "");
        break;
      case "--json":
        json = true;
        break;
      case "--help":
      case "-h":
        printServiceUsage();
        process.exit(0);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  const resolvedProviders = resolveSharedProviderState(providers);

  return {
    provider: resolvedProviders.provider,
    dataset,
    split: split ?? defaultPublicTrajectorySplit(dataset),
    offset,
    limit,
    maxSlices,
    windowCount,
    reviewerProvider: resolvedProviders.reviewerProvider,
    optimizerProvider: resolvedProviders.optimizerProvider,
    reviewConcurrency,
    minSessionCount,
    maxReports,
    maxRestarts,
    restartBackoffSeconds,
    campaignStallThresholdSeconds,
    serviceStallThresholdSeconds,
    ...(serviceId ? { serviceId } : {}),
    ...(serviceRoot ? { serviceRoot } : {}),
    sourceRepo,
    json,
  };
}

function parseSweepArgs(argv: string[]): SweepCliOptions {
  const providers = createSharedProviderState<AutoresearchServiceProvider>("generic");
  let offset = 0;
  let limit = 12;
  let maxSlices = 10;
  let windowCount = 8;
  let reviewConcurrency = 2;
  let minSessionCount = 2;
  let maxReports = 4;
  let maxRestarts = 3;
  let restartBackoffSeconds = 15;
  let campaignStallThresholdSeconds = 900;
  let serviceStallThresholdSeconds = 1200;
  let sweepId: string | undefined;
  let sweepRoot: string | undefined;
  let sourceRepo = process.cwd();
  let preset: AutoresearchSweepPreset | undefined;
  const lanes: AutoresearchSweepLane[] = [];
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (applySharedProviderArg(providers, arg, argv[index + 1], { propagatePrimaryProvider: false })) {
      index += 1;
      continue;
    }
    switch (arg) {
      case "--preset":
        preset = readSweepPreset(argv[++index]);
        break;
      case "--lane":
        lanes.push(readSweepLane(argv[++index]));
        break;
      case "--offset":
        offset = readInteger(argv[++index], "--offset");
        break;
      case "--limit":
        limit = readPositiveInteger(argv[++index], "--limit");
        break;
      case "--max-slices":
        maxSlices = readPositiveInteger(argv[++index], "--max-slices");
        break;
      case "--window-count":
        windowCount = readPositiveInteger(argv[++index], "--window-count");
        break;
      case "--review-concurrency":
        reviewConcurrency = readPositiveInteger(argv[++index], "--review-concurrency");
        break;
      case "--min-session-count":
        minSessionCount = readPositiveInteger(argv[++index], "--min-session-count");
        break;
      case "--max-reports":
        maxReports = readPositiveInteger(argv[++index], "--max-reports");
        break;
      case "--max-restarts":
        maxRestarts = readInteger(argv[++index], "--max-restarts");
        break;
      case "--restart-backoff-seconds":
        restartBackoffSeconds = readPositiveInteger(argv[++index], "--restart-backoff-seconds");
        break;
      case "--campaign-stall-threshold-seconds":
        campaignStallThresholdSeconds = readPositiveInteger(argv[++index], "--campaign-stall-threshold-seconds");
        break;
      case "--service-stall-threshold-seconds":
        serviceStallThresholdSeconds = readPositiveInteger(argv[++index], "--service-stall-threshold-seconds");
        break;
      case "--sweep-id":
        sweepId = argv[++index];
        break;
      case "--sweep-root":
        sweepRoot = path.resolve(argv[++index] ?? "");
        break;
      case "--source-repo":
        sourceRepo = path.resolve(argv[++index] ?? "");
        break;
      case "--json":
        json = true;
        break;
      case "--help":
      case "-h":
        printSweepUsage();
        process.exit(0);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!preset && lanes.length === 0) {
    throw new Error("F-Stop sweep requires --preset or at least one --lane <dataset>/<split>.");
  }

  const resolvedProviders = resolveSharedProviderState(providers);

  return {
    provider: resolvedProviders.provider,
    reviewerProvider: resolvedProviders.reviewerProvider,
    optimizerProvider: resolvedProviders.optimizerProvider,
    offset,
    limit,
    maxSlices,
    windowCount,
    reviewConcurrency,
    minSessionCount,
    maxReports,
    maxRestarts,
    restartBackoffSeconds,
    campaignStallThresholdSeconds,
    serviceStallThresholdSeconds,
    ...(sweepId ? { sweepId } : {}),
    ...(sweepRoot ? { sweepRoot } : {}),
    sourceRepo,
    ...(preset ? { preset } : {}),
    ...(lanes.length > 0 ? { lanes } : {}),
    json,
  };
}

function parseIngestArgs(argv: string[]): IngestOptions {
  const options: IngestOptions = {
    filePath: "",
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--file":
        options.filePath = path.resolve(argv[++index] ?? "");
        break;
      case "--dataset":
        options.dataset = readDataset(argv[++index]);
        break;
      case "--split":
        options.split = readPublicSplit(argv[++index]);
        break;
      case "--output-dir":
        options.outputDirectory = path.resolve(argv[++index] ?? "");
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--json":
        options.json = true;
        break;
      case "--help":
      case "-h":
        printIngestUsage();
        process.exit(0);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (options.dataset && !options.split) {
    options.split = defaultPublicTrajectorySplit(options.dataset);
  }
  options.outputDirectory ??= DEFAULT_RAW_TRAJECTORY_BUNDLES_DIR;
  return options;
}

function parseReviewArgs(command: ReviewCommand, argv: string[]): ReviewCliOptions {
  switch (command) {
    case "prepare":
      return parseReviewPrepareArgs(argv);
    case "prompt":
      return parseReviewPromptArgs(argv);
    case "compare":
      return parseReviewCompareArgs(argv);
    case "review-run":
      return parseReviewRunArgs(argv);
  }
}

function parseOptimizeArgs(argv: string[]): OptimizeCliOptions {
  let provider: Provider = "generic";
  let optimizerCommand: string | undefined;
  const extraCalibrationDirs: string[] = [];
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
      case "--extra-calibration-dir":
        extraCalibrationDirs.push(path.resolve(argv[++index] ?? ""));
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
        printOptimizeUsage();
        process.exit(0);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return {
    provider,
    ...(optimizerCommand ? { optimizerCommand } : {}),
    extraCalibrationDirs,
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

function parseReviewPrepareArgs(argv: string[]): ReviewPrepareOptions {
  let bundlePath: string | undefined;
  let outputPath: string | undefined;
  let rubricVersion: string | undefined;
  let focusAreas = [...DEFAULT_OFFLINE_REVIEW_FOCUS_AREAS];
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--bundle":
        bundlePath = path.resolve(argv[++index] ?? "");
        break;
      case "--output":
        outputPath = path.resolve(argv[++index] ?? "");
        break;
      case "--rubric-version":
        rubricVersion = argv[++index];
        break;
      case "--focus":
        focusAreas = readFocusAreas(argv[++index]);
        break;
      case "--json":
        json = true;
        break;
      case "--help":
      case "-h":
        printPrepareUsage();
        process.exit(0);
      default:
        throw new Error(`Unknown option for prepare: ${arg}`);
    }
  }

  if (!bundlePath) {
    throw new Error("--bundle is required");
  }

  return {
    command: "prepare",
    bundlePath,
    ...(outputPath ? { outputPath } : {}),
    ...(rubricVersion ? { rubricVersion } : {}),
    focusAreas,
    json,
  };
}

function parseReviewPromptArgs(argv: string[]): ReviewPromptOptions {
  let artifactPath: string | undefined;
  let outputPath: string | undefined;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--artifact":
        artifactPath = path.resolve(argv[++index] ?? "");
        break;
      case "--output":
        outputPath = path.resolve(argv[++index] ?? "");
        break;
      case "--json":
        json = true;
        break;
      case "--help":
      case "-h":
        printPromptUsage();
        process.exit(0);
      default:
        throw new Error(`Unknown option for prompt: ${arg}`);
    }
  }

  if (!artifactPath) {
    throw new Error("--artifact is required");
  }

  return {
    command: "prompt",
    artifactPath,
    ...(outputPath ? { outputPath } : {}),
    json,
  };
}

function parseReviewCompareArgs(argv: string[]): ReviewCompareOptions {
  let artifactPath: string | undefined;
  let outputPath: string | undefined;
  let json = false;
  let failOnDisagreement = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--artifact":
        artifactPath = path.resolve(argv[++index] ?? "");
        break;
      case "--output":
        outputPath = path.resolve(argv[++index] ?? "");
        break;
      case "--json":
        json = true;
        break;
      case "--fail-on-disagreement":
        failOnDisagreement = true;
        break;
      case "--help":
      case "-h":
        printCompareUsage();
        process.exit(0);
      default:
        throw new Error(`Unknown option for compare: ${arg}`);
    }
  }

  if (!artifactPath) {
    throw new Error("--artifact is required");
  }

  return {
    command: "compare",
    artifactPath,
    ...(outputPath ? { outputPath } : {}),
    failOnDisagreement,
    json,
  };
}

function parseReviewRunArgs(argv: string[]): ReviewRunOptions {
  let artifactPath: string | undefined;
  let responsePath: string | undefined;
  let responseFromStdin = false;
  let reviewerCommand: string | undefined;
  let promptPath: string | undefined;
  let rawResponsePath: string | undefined;
  let responseArtifactPath: string | undefined;
  let outputPath: string | undefined;
  let recommendationPath: string | undefined;
  let runPath: string | undefined;
  let json = false;
  let failOnDisagreement = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--artifact":
        artifactPath = path.resolve(argv[++index] ?? "");
        break;
      case "--response":
        responsePath = path.resolve(argv[++index] ?? "");
        break;
      case "--response-stdin":
        responseFromStdin = true;
        break;
      case "--reviewer-command":
        reviewerCommand = argv[++index];
        break;
      case "--prompt":
        promptPath = path.resolve(argv[++index] ?? "");
        break;
      case "--raw-response-output":
        rawResponsePath = path.resolve(argv[++index] ?? "");
        break;
      case "--response-artifact":
        responseArtifactPath = path.resolve(argv[++index] ?? "");
        break;
      case "--output":
        outputPath = path.resolve(argv[++index] ?? "");
        break;
      case "--recommendation-output":
        recommendationPath = path.resolve(argv[++index] ?? "");
        break;
      case "--run-output":
        runPath = path.resolve(argv[++index] ?? "");
        break;
      case "--json":
        json = true;
        break;
      case "--fail-on-disagreement":
        failOnDisagreement = true;
        break;
      case "--help":
      case "-h":
        printReviewRunUsage();
        process.exit(0);
      default:
        throw new Error(`Unknown option for review-run: ${arg}`);
    }
  }

  if (!artifactPath) {
    throw new Error("--artifact is required");
  }

  const responseSourceCount =
    Number(responseFromStdin)
    + Number(Boolean(responsePath))
    + Number(Boolean(reviewerCommand));
  if (responseSourceCount !== 1) {
    throw new Error("Provide exactly one of --response, --response-stdin, or --reviewer-command");
  }

  return {
    command: "review-run",
    artifactPath,
    ...(responsePath ? { responsePath } : {}),
    responseFromStdin,
    ...(reviewerCommand ? { reviewerCommand } : {}),
    ...(promptPath ? { promptPath } : {}),
    ...(rawResponsePath ? { rawResponsePath } : {}),
    ...(responseArtifactPath ? { responseArtifactPath } : {}),
    ...(outputPath ? { outputPath } : {}),
    ...(recommendationPath ? { recommendationPath } : {}),
    ...(runPath ? { runPath } : {}),
    failOnDisagreement,
    json,
  };
}

function parseGcArgs(argv: string[]): GcOptions {
  let runtimeRoot = defaultLabRuntimeRoot(process.cwd());
  let sourceRepo = process.cwd();
  let keepCampaigns = 5;
  let keepArtifacts = 50;
  let dryRun = false;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--runtime-root":
        runtimeRoot = path.resolve(argv[++index] ?? "");
        break;
      case "--source-repo":
        sourceRepo = path.resolve(argv[++index] ?? "");
        break;
      case "--keep-campaigns":
        keepCampaigns = readInteger(argv[++index], "--keep-campaigns");
        break;
      case "--keep-artifacts":
        keepArtifacts = readInteger(argv[++index], "--keep-artifacts");
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--json":
        json = true;
        break;
      case "--help":
      case "-h":
        printGcUsage();
        process.exit(0);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return {
    runtimeRoot,
    sourceRepo,
    keepCampaigns,
    keepArtifacts,
    dryRun,
    json,
  };
}

function parseCalibrationArgs(command: CalibrationCommand, argv: string[]): CalibrationOptions {
  if (command === "promote") {
    return parsePromoteArgs(argv);
  }
  if (command === "evaluate") {
    return parseEvaluateArgs(argv);
  }
  return parseCycleArgs(argv);
}

function parsePromoteArgs(argv: string[]): PromoteOptions {
  let reportPath: string | undefined;
  let split: AutoresearchCalibrationSplit | undefined;
  let outputPath: string | undefined;
  const focusAreas: OfflineReviewFocusArea[] = [];
  const recommendations: OfflineReviewRecommendation[] = [];
  let minimumConfidence: OfflineReviewConfidence | undefined;
  let includeStepInvariants = true;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--report":
        reportPath = path.resolve(argv[++index] ?? "");
        break;
      case "--split":
        split = readCalibrationSplit(argv[++index]);
        break;
      case "--output":
        outputPath = path.resolve(argv[++index] ?? "");
        break;
      case "--focus-area":
        focusAreas.push(readFocusArea(argv[++index]));
        break;
      case "--recommendation":
        recommendations.push(readRecommendation(argv[++index]));
        break;
      case "--minimum-confidence":
        minimumConfidence = readConfidence(argv[++index]);
        break;
      case "--no-step-invariants":
        includeStepInvariants = false;
        break;
      case "--json":
        json = true;
        break;
      case "--help":
      case "-h":
        printCalibrationUsage();
        process.exit(0);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!reportPath) {
    throw new Error("--report is required.");
  }
  if (!split) {
    throw new Error("--split is required.");
  }

  return {
    command: "promote",
    reportPath,
    split,
    ...(outputPath ? { outputPath } : {}),
    focusAreas,
    recommendations: recommendations.length > 0 ? recommendations : ["promote"],
    ...(minimumConfidence ? { minimumConfidence } : {}),
    includeStepInvariants,
    json,
  };
}

function parseEvaluateArgs(argv: string[]): EvaluateOptions {
  const splits: AutoresearchCalibrationSplit[] = [];
  const extraCalibrationDirs: string[] = [];
  let outputPath: string | undefined;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--split":
        splits.push(readCalibrationSplit(argv[++index]));
        break;
      case "--output":
        outputPath = path.resolve(argv[++index] ?? "");
        break;
      case "--extra-calibration-dir":
        extraCalibrationDirs.push(path.resolve(argv[++index] ?? ""));
        break;
      case "--json":
        json = true;
        break;
      case "--help":
      case "-h":
        printCalibrationUsage();
        process.exit(0);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return {
    command: "evaluate",
    splits,
    extraCalibrationDirs,
    ...(outputPath ? { outputPath } : {}),
    json,
  };
}

function parseCycleArgs(argv: string[]): CycleOptions {
  const splits: AutoresearchCalibrationSplit[] = [];
  const extraCalibrationDirs: string[] = [];
  let outputPath: string | undefined;
  let briefOutputPath: string | undefined;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--split":
        splits.push(readCalibrationSplit(argv[++index]));
        break;
      case "--output":
        outputPath = path.resolve(argv[++index] ?? "");
        break;
      case "--extra-calibration-dir":
        extraCalibrationDirs.push(path.resolve(argv[++index] ?? ""));
        break;
      case "--brief-output":
        briefOutputPath = path.resolve(argv[++index] ?? "");
        break;
      case "--json":
        json = true;
        break;
      case "--help":
      case "-h":
        printCalibrationUsage();
        process.exit(0);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return {
    command: "cycle",
    splits,
    extraCalibrationDirs,
    ...(outputPath ? { outputPath } : {}),
    ...(briefOutputPath ? { briefOutputPath } : {}),
    json,
  };
}

function parseRoleArgs(argv: string[]): RoleOptions {
  let provider: Provider = "generic";
  let command: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--provider":
        provider = readProvider(argv[++index]);
        break;
      case "--command":
        command = argv[++index];
        break;
      case "--help":
      case "-h":
        printRoleUsage();
        process.exit(0);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return {
    provider,
    ...(command ? { command } : {}),
  };
}

function parseTrajectoryImportArgs(argv: string[]): ImportPublicTrajectoryBundlesOptions {
  const options: ImportPublicTrajectoryBundlesOptions = {
    dataset: "swe-smith",
    offset: 0,
    limit: 5,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--dataset":
        options.dataset = readDataset(argv[++index]);
        break;
      case "--split":
        options.split = readPublicSplit(argv[++index]);
        break;
      case "--offset":
        options.offset = readInteger(argv[++index], "--offset");
        break;
      case "--limit":
        options.limit = readInteger(argv[++index], "--limit");
        break;
      case "--output-dir":
        options.outputDirectory = path.resolve(argv[++index] ?? "");
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--help":
      case "-h":
        printTrajectoryImportUsage();
        process.exit(0);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  options.split ??= defaultPublicTrajectorySplit(options.dataset ?? "swe-smith");
  options.outputDirectory ??= DEFAULT_PUBLIC_TRAJECTORY_BUNDLES_DIR;
  return options;
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

function readProvider(value: string | undefined): Provider {
  if (value === "hermes" || value === "openclaw" || value === "generic") {
    return value;
  }
  throw new Error("--provider must be one of: hermes, openclaw, generic");
}

function readDataset(value: string | undefined): PublicTrajectoryDataset {
  if (value === "swe-smith" || value === "dataclaw" || value === "open-agent-sessions") {
    return value;
  }
  throw new Error("--dataset must be: swe-smith, dataclaw, open-agent-sessions");
}

function readPublicSplit(value: string | undefined): PublicTrajectorySplit {
  if (value === "tool" || value === "xml" || value === "ticks" || value === "train" || value === "approved") {
    return value;
  }
  throw new Error("--split must be one of: tool, xml, ticks, train, approved");
}

function readSweepPreset(value: string | undefined): AutoresearchSweepPreset {
  if (value === "pre-release") {
    return value;
  }
  throw new Error("--preset must be: pre-release");
}

function readSweepLane(value: string | undefined): AutoresearchSweepLane {
  const raw = (value ?? "").trim();
  const separator = raw.includes("/") ? "/" : raw.includes(":") ? ":" : undefined;
  if (!separator) {
    throw new Error("--lane must look like <dataset>/<split>");
  }
  const [datasetRaw, splitRaw] = raw.split(separator);
  return {
    dataset: readDataset(datasetRaw),
    split: readPublicSplit(splitRaw),
  };
}

function readCalibrationSplit(value: string | undefined): AutoresearchCalibrationSplit {
  if (value === "train" || value === "validation" || value === "heldout") {
    return value;
  }
  throw new Error(`Invalid split: ${value ?? "(missing)"}`);
}

function readFocusArea(value: string | undefined): OfflineReviewFocusArea {
  if (
    value === "title"
    || value === "summary"
    || value === "status"
    || value === "intentFrame"
    || value === "toolFamily"
    || value === "consequence"
  ) {
    return value;
  }
  throw new Error(`Invalid focus area: ${value ?? "(missing)"}`);
}

function readFocusAreas(raw: string | undefined): OfflineReviewFocusArea[] {
  const parts = (raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (parts.length === 0) {
    throw new Error("--focus requires a comma-separated list");
  }
  return parts.map((part) => readFocusArea(part));
}

function readRecommendation(value: string | undefined): OfflineReviewRecommendation {
  if (value === "promote" || value === "inspect" || value === "ignore") {
    return value;
  }
  throw new Error(`Invalid recommendation: ${value ?? "(missing)"}`);
}

function readConfidence(value: string | undefined): OfflineReviewConfidence {
  if (value === "high" || value === "medium" || value === "low") {
    return value;
  }
  throw new Error(`Invalid confidence: ${value ?? "(missing)"}`);
}

function readInteger(value: string | undefined, flag: string): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative integer`);
  }
  return parsed;
}

function readPositiveInteger(value: string | undefined, flag: string): number {
  const parsed = readInteger(value, flag);
  if (parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

async function writeDirectoryFile(filePath: string, contents: string): Promise<void> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, "utf8");
}

function printTopLevelUsage(): void {
  process.stdout.write([
    "Usage: pnpm tsx scripts/fstop.ts <command> [options]",
    "",
    "Commands:",
    "  run               Run a single unattended F-Stop window",
    "  campaign          Run repeated unattended F-Stop windows",
    "  service           Supervise campaign windows with restart/stall handling",
    "  sweep             Run a repeatable multi-lane unattended sweep",
    "  ingest            Normalize a raw export or canonical session into replay bundles",
    "  gc                Prune old runtime campaigns and artifacts",
    "  optimize          Run one bounded optimizer attempt against calibration cases",
    "  prepare           Prepare an offline-review artifact from a replay bundle",
    "  prompt            Render an offline-review prompt from an artifact",
    "  compare           Compare a completed offline-review artifact",
    "  review-run        Run a reviewer command against an offline-review artifact",
    "  promote           Promote an offline-review report into a calibration case",
    "  evaluate          Evaluate frozen calibration cases",
    "  cycle             Evaluate frozen calibration cases and emit an optimization brief",
    "  reviewer          Read a reviewer prompt on stdin and delegate to a configured provider",
    "  optimizer         Read an optimizer prompt on stdin and delegate to a configured provider",
    "  trajectory-import Import public trajectory bundles into the runtime bundle format",
  ].join("\n") + "\n");
}

function printRunUsage(): void {
  process.stdout.write([
    "Usage: pnpm lab:fstop:run [options]",
    "",
    "Runs Aperture Lab F-Stop so a provider can manage repeated proposal attempts end to end.",
    "",
    "Options:",
    "  --provider <hermes|openclaw|generic>   Default provider shortcut for reviewer and optimizer (default: generic)",
    "  --file <path>                         Autodetect a session bundle JSON, offline-review batch report JSON, canonical F-Stop session JSON, or supported raw export file",
    "  --batch-report <path>                 Reuse a precomputed offline-review batch report JSON",
    "  --bundle <path>                       Run a single unattended proposal attempt against an explicit bundle (repeatable)",
    "  --dataset <swe-smith|dataclaw|open-agent-sessions>  Public dataset to import (default: swe-smith)",
    "  --split <tool|xml|ticks|train|approved>             Dataset split (default: dataset-specific)",
    "  --offset <number>                     Starting row offset (default: 0)",
    "  --limit <number>                      Rows per proposal slice (default: 12)",
    "  --max-slices <number>                 Maximum slices to attempt (default: 3)",
    "  --reviewer-provider <provider>        Reviewer provider used inside proposal attempts",
    "  --optimizer-provider <provider>       Optimizer provider used inside proposal attempts",
    "  --review-concurrency <number>         Parallel offline reviews per slice (default: 2)",
    "  --min-session-count <number>          Proposal promotion threshold (default: 2)",
    "  --max-reports <number>                Max promoted reports per attempt (default: 4)",
    "  --output <path>                       Run JSON output path",
    "  --status-output <path>                Live run status JSON output path",
    "  --json                                Emit machine-readable JSON",
  ].join("\n") + "\n");
}

function printCampaignUsage(): void {
  process.stdout.write([
    "Usage: pnpm lab:fstop:campaign [options]",
    "",
    "Runs repeated F-Stop campaign windows from a clean source checkout.",
    "",
    "Options:",
    "  --provider <hermes|openclaw|generic>   Default provider shortcut for reviewer and optimizer (default: generic)",
    "  --dataset <swe-smith|dataclaw|open-agent-sessions>  Public dataset to import (default: swe-smith)",
    "  --split <tool|xml|ticks|train|approved>             Dataset split (default: dataset-specific)",
    "  --offset <number>                     Starting row offset (default: 0)",
    "  --limit <number>                      Rows per slice (default: 12)",
    "  --max-slices <number>                 Max slices per window (default: 10)",
    "  --windows <number>                    Number of repeated windows to attempt (default: 8)",
    "  --reviewer-provider <provider>        Reviewer provider used inside proposal attempts",
    "  --optimizer-provider <provider>       Optimizer provider used inside proposal attempts",
    "  --review-concurrency <number>         Parallel offline reviews per slice (default: 2)",
    "  --min-session-count <number>          Proposal promotion threshold (default: 2)",
    "  --max-reports <number>                Max promoted reports per attempt (default: 4)",
    "  --stall-threshold-seconds <number>    Mark a run stalled after this many seconds (default: 900)",
    "  --campaign-id <id>                    Explicit campaign id",
    "  --campaign-root <path>                Explicit campaign directory",
    "  --source-repo <path>                  Source repo to run from (default: cwd)",
    "  --json                                Emit machine-readable JSON",
  ].join("\n") + "\n");
}

function printServiceUsage(): void {
  process.stdout.write([
    "Usage: pnpm lab:fstop:service [options]",
    "",
    "Supervises F-Stop campaign windows with restart and stall handling.",
    "",
    "Options:",
    "  --provider <hermes|openclaw|generic>   Default provider shortcut for reviewer and optimizer (default: generic)",
    "  --dataset <swe-smith|dataclaw|open-agent-sessions>  Public dataset to review",
    "  --split <tool|xml|ticks|train|approved>             Dataset split (default: dataset-specific)",
    "  --offset <number>                      Starting row offset (default: 0)",
    "  --limit <number>                       Rows per slice (default: 12)",
    "  --max-slices <number>                  Maximum slices per campaign window (default: 10)",
    "  --window-count <number>                Maximum supervised campaign windows (default: 8)",
    "  --reviewer-provider <provider>         Reviewer provider used inside campaign windows",
    "  --optimizer-provider <provider>        Optimizer provider used inside campaign windows",
    "  --review-concurrency <number>          Parallel offline reviews per slice (default: 2)",
    "  --min-session-count <number>           Proposal promotion threshold (default: 2)",
    "  --max-reports <number>                 Max promoted reports per campaign window (default: 4)",
    "  --max-restarts <number>                Restart budget before failing (default: 3)",
    "  --restart-backoff-seconds <number>     Delay before restarting after failure (default: 15)",
    "  --campaign-stall-threshold-seconds <number>  Inner campaign stall threshold (default: 900)",
    "  --service-stall-threshold-seconds <number>   Supervisor stall threshold (default: 1200)",
    "  --service-id <id>                      Override the generated service id",
    "  --service-root <path>                  Service status/log root (default: .aperture/lab/service)",
    "  --source-repo <path>                   Clean repo to supervise (default: cwd)",
    "  --json                                 Emit machine-readable JSON",
  ].join("\n") + "\n");
}

function printSweepUsage(): void {
  process.stdout.write([
    "Usage: pnpm lab:fstop:sweep [options]",
    "",
    "Runs multiple F-Stop service lanes sequentially from one clean source checkout.",
    "",
    "Options:",
    "  --provider <hermes|openclaw|generic>   Default provider shortcut for reviewer and optimizer (default: generic)",
    "  --reviewer-provider <provider>         Reviewer provider used inside each lane",
    "  --optimizer-provider <provider>        Optimizer provider used inside each lane",
    "  --preset <pre-release>                 Built-in sweep lane preset",
    "  --lane <dataset>/<split>               Add one lane explicitly (repeatable)",
    "  --offset <number>                      Starting row offset for each lane (default: 0)",
    "  --limit <number>                       Rows per slice (default: 12)",
    "  --max-slices <number>                  Maximum slices per campaign window (default: 10)",
    "  --window-count <number>                Maximum supervised campaign windows per lane (default: 8)",
    "  --review-concurrency <number>          Parallel offline reviews per slice (default: 2)",
    "  --min-session-count <number>           Proposal promotion threshold (default: 2)",
    "  --max-reports <number>                 Max promoted reports per campaign window (default: 4)",
    "  --max-restarts <number>                Restart budget before failing a lane (default: 3)",
    "  --restart-backoff-seconds <number>     Delay before restarting after failure (default: 15)",
    "  --campaign-stall-threshold-seconds <number>  Inner campaign stall threshold (default: 900)",
    "  --service-stall-threshold-seconds <number>   Supervisor stall threshold (default: 1200)",
    "  --sweep-id <id>                        Override the generated sweep id",
    "  --sweep-root <path>                    Preserve sweep outputs here (default: .aperture/fstop-sweeps/<id>)",
    "  --source-repo <path>                   Clean repo to supervise (default: cwd)",
    "  --json                                 Emit machine-readable JSON",
  ].join("\n") + "\n");
}

function printIngestUsage(): void {
  process.stdout.write([
    "Usage: pnpm lab:fstop:ingest --file <path> [options]",
    "",
    "Normalizes a supported raw export or canonical F-Stop session file into replayable bundles.",
    "",
    "Options:",
    "  --file <path>                        Raw export file to ingest",
    "  --dataset <swe-smith|dataclaw|open-agent-sessions>  Optional dataset hint",
    "  --split <tool|xml|ticks|train|approved>             Optional split hint",
    "  --output-dir <path>                 Bundle destination root (default: .aperture/lab/bundles/raw)",
    "  --dry-run                           Parse and prepare without writing bundle files",
    "  --json                              Emit machine-readable JSON",
    "  --help, -h                          Show this message",
  ].join("\n") + "\n");
}

function printGcUsage(): void {
  process.stdout.write([
    "Usage: pnpm lab:fstop:gc [options]",
    "",
    "Prunes old F-Stop campaign and artifact outputs from the runtime directory.",
    "",
    "Options:",
    "  --runtime-root <path>     Runtime root to prune (default: .aperture/lab)",
    "  --source-repo <path>      Source repo whose git worktree metadata should also be pruned (default: cwd)",
    "  --keep-campaigns <n>      Number of campaign directories to keep (default: 5)",
    "  --keep-artifacts <n>      Number of files or proposal/report dirs to keep per artifact bucket (default: 50)",
    "  --dry-run                 Show what would be pruned without deleting",
    "  --json                    Emit machine-readable JSON",
  ].join("\n") + "\n");
}

function printOptimizeUsage(): void {
  process.stdout.write([
    "Usage: pnpm lab:fstop:optimize [options]",
    "",
    "Runs the Aperture Lab F-Stop frozen calibration loop, asks an optimizer provider to make bounded semantic-layer edits, then reruns the gates.",
    "",
    "Options:",
    "  --provider <hermes|openclaw|generic>  Optimizer provider shortcut (default: generic)",
    "  --optimizer-command <cmd>             Explicit optimizer command; overrides provider adapter",
    "  --extra-calibration-dir <path>        Include additional calibration cases from this directory",
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
  ].join("\n") + "\n");
}

function printPrepareUsage(): void {
  process.stdout.write([
    "Usage: pnpm lab:fstop:prepare --bundle <path> [options]",
    "",
    "Options:",
    "  --bundle <path>          Session bundle JSON to prepare for offline review",
    "  --output <path>          Destination artifact JSON path",
    "  --rubric-version <id>    Rubric identifier to record in the artifact",
    `  --focus <csv>            Focus areas (default: ${DEFAULT_OFFLINE_REVIEW_FOCUS_AREAS.join(",")})`,
    "  --json                   Emit machine-readable JSON to stdout",
  ].join("\n") + "\n");
}

function printPromptUsage(): void {
  process.stdout.write([
    "Usage: pnpm lab:fstop:prompt --artifact <path> [options]",
    "",
    "Options:",
    "  --artifact <path>        Prepared offline review artifact JSON",
    "  --output <path>          Destination reviewer prompt markdown path",
    "  --json                   Emit machine-readable JSON to stdout",
  ].join("\n") + "\n");
}

function printCompareUsage(): void {
  process.stdout.write([
    "Usage: pnpm lab:fstop:compare --artifact <path> [options]",
    "",
    "Options:",
    "  --artifact <path>        Completed offline review artifact JSON",
    "  --output <path>          Destination disagreement report JSON path",
    "  --json                   Emit machine-readable JSON to stdout",
    "  --fail-on-disagreement   Exit non-zero when disagreements are found",
  ].join("\n") + "\n");
}

function printReviewRunUsage(): void {
  process.stdout.write([
    "Usage: pnpm lab:fstop:review:run --artifact <path> (--response <path> | --response-stdin | --reviewer-command <cmd>) [options]",
    "",
    "Options:",
    "  --artifact <path>             Prepared offline review artifact JSON",
    "  --response <path>             Reviewer-model response file (JSON or fenced JSON)",
    "  --response-stdin              Read reviewer-model response from stdin",
    "  --reviewer-command <cmd>      Shell command that reads the prompt on stdin and writes JSON to stdout",
    "  --prompt <path>               Destination reviewer prompt markdown path",
    "  --raw-response-output <path>  Destination raw reviewer stdout path",
    "  --response-artifact <path>    Destination completed artifact JSON path",
    "  --output <path>               Destination disagreement report JSON path",
    "  --recommendation-output <path> Destination recommendation JSON path",
    "  --run-output <path>           Destination run summary JSON path",
    "  --json                        Emit machine-readable JSON to stdout",
    "  --fail-on-disagreement        Exit non-zero when disagreements are found",
  ].join("\n") + "\n");
}

function printCalibrationUsage(): void {
  process.stdout.write([
    "Usage:",
    "  pnpm lab:fstop:promote --report <path> --split <train|validation|heldout> [options]",
    "  pnpm lab:fstop:evaluate [--split <split>] [--extra-calibration-dir <path>] [--json]",
    "  pnpm lab:fstop:cycle [--split <split>] [--extra-calibration-dir <path>] [--json]",
    "",
    "Promotion options:",
    "  --focus-area <title|summary|status|intentFrame|toolFamily|consequence>",
    "  --recommendation <promote|inspect|ignore>",
    "  --minimum-confidence <high|medium|low>",
    "  --no-step-invariants",
    "",
    "Evaluate / cycle options:",
    "  --extra-calibration-dir <path>        Include additional calibration cases from this directory",
  ].join("\n") + "\n");
}

function printRoleUsage(): void {
  process.stdout.write([
    "Usage:",
    "  pnpm lab:fstop:reviewer [options]",
    "  pnpm lab:fstop:optimizer [options]",
    "",
    "Each command reads a prompt on stdin and delegates to a configured provider command.",
    "",
    "Options:",
    "  --provider <hermes|openclaw|generic>  Provider shortcut (default: generic)",
    "  --command <cmd>                       Explicit command; overrides env vars",
  ].join("\n") + "\n");
}

function printTrajectoryImportUsage(): void {
  process.stdout.write([
    "Usage: pnpm trajectory:import [options]",
    "",
    "Imports public trajectories into local Aperture Lab session bundles.",
    "",
    "Options:",
    "  --dataset <swe-smith|dataclaw|open-agent-sessions>  Public dataset to import (default: swe-smith)",
    `  --split <tool|xml|ticks|${DEFAULT_DATACLAW_SPLIT}|${DEFAULT_OPEN_AGENT_SESSIONS_SPLIT}>  Dataset split to import (dataset-specific default: ${DEFAULT_SWE_SMITH_SPLIT}, ${DEFAULT_DATACLAW_SPLIT}, or ${DEFAULT_OPEN_AGENT_SESSIONS_SPLIT})`,
    "  --offset <number>         Row offset in the dataset (default: 0)",
    "  --limit <number>          Number of rows to import (default: 5)",
    "  --output-dir <path>       Destination root for imported bundle JSON files",
    "  --dry-run                 Fetch and convert without writing files",
    "  --help, -h                Show this message",
  ].join("\n") + "\n");
}
