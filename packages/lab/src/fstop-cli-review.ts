import { readFile } from "node:fs/promises";

import {
  compareOfflineReviewArtifact,
  createAutoresearchOptimizationBrief,
  defaultAutoresearchBriefPath,
  defaultAutoresearchCalibrationCasePath,
  defaultAutoresearchEvaluationPath,
  defaultOfflineReviewArtifactPath,
  defaultOfflineReviewPromptPath,
  defaultOfflineReviewReportPath,
  evaluateAutoresearchCalibrationCases,
  loadAutoresearchCalibrationCases,
  loadOfflineReviewArtifact,
  loadSessionBundle,
  prepareOfflineReviewArtifact,
  promoteOfflineReviewReportToCalibrationCase,
  renderAutoresearchCalibrationMarkdown,
  renderAutoresearchOptimizationMarkdown,
  renderOfflineReviewPrompt,
  renderOfflineReviewReportMarkdown,
  runOfflineReviewArtifactReview,
  writeAutoresearchCalibrationCase,
  writeAutoresearchCalibrationReport,
  writeAutoresearchOptimizationBrief,
  writeOfflineReviewArtifact,
  writeOfflineReviewReport,
} from "./index.js";
import {
  parseCalibrationArgs,
  parseReviewArgs,
  type CalibrationCommand,
  type ReviewCommand,
} from "./fstop-cli-args.js";
import {
  emitResult,
  readStdin,
  writeDirectoryFile,
} from "./fstop-cli-shared.js";

export async function runReviewCli(command: ReviewCommand, argv: string[]): Promise<void> {
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

export async function runCalibrationCli(command: CalibrationCommand, argv: string[]): Promise<void> {
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
