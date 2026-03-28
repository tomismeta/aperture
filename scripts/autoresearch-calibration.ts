import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createAutoresearchOptimizationBrief,
  defaultAutoresearchBriefPath,
  defaultAutoresearchCalibrationCasePath,
  defaultAutoresearchEvaluationPath,
  evaluateAutoresearchCalibrationCases,
  loadAutoresearchCalibrationCases,
  promoteOfflineReviewReportToCalibrationCase,
  renderAutoresearchCalibrationMarkdown,
  renderAutoresearchOptimizationMarkdown,
  writeAutoresearchCalibrationCase,
  writeAutoresearchCalibrationReport,
  writeAutoresearchOptimizationBrief,
  type AutoresearchCalibrationSplit,
  type OfflineReviewConfidence,
  type OfflineReviewFocusArea,
  type OfflineReviewRecommendation,
} from "../packages/lab/src/index.js";

type BaseCommandOptions = {
  json: boolean;
};

type PromoteOptions = BaseCommandOptions & {
  command: "promote";
  reportPath: string;
  split: AutoresearchCalibrationSplit;
  outputPath?: string;
  focusAreas: OfflineReviewFocusArea[];
  recommendations: OfflineReviewRecommendation[];
  minimumConfidence?: OfflineReviewConfidence;
  includeStepInvariants: boolean;
};

type EvaluateOptions = BaseCommandOptions & {
  command: "evaluate";
  splits: AutoresearchCalibrationSplit[];
  outputPath?: string;
};

type CycleOptions = BaseCommandOptions & {
  command: "cycle";
  splits: AutoresearchCalibrationSplit[];
  outputPath?: string;
  briefOutputPath?: string;
};

type CommandOptions = PromoteOptions | EvaluateOptions | CycleOptions;

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

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

    emitResult(
      options.json,
      {
        status: "promoted",
        split: calibrationCase.split,
        sessionId: calibrationCase.sessionId,
        outputPath,
        correctedCount: calibrationCase.summary.correctedCount,
        invariantCount: calibrationCase.summary.invariantCount,
        targets: calibrationCase.targets,
      },
      [
        `Promoted calibration case for ${calibrationCase.sessionId}.`,
        `Case: ${outputPath}`,
        `Corrected expectations: ${calibrationCase.summary.correctedCount}`,
        `Invariant expectations: ${calibrationCase.summary.invariantCount}`,
      ],
    );
    return;
  }

  const cases = await loadAutoresearchCalibrationCases({
    ...(options.splits.length > 0 ? { splits: options.splits } : {}),
  });
  const report = await evaluateAutoresearchCalibrationCases(cases, {});
  const outputPath = options.outputPath ?? defaultAutoresearchEvaluationPath(report);
  const markdownPath = outputPath.replace(/\.json$/i, ".md");
  await writeAutoresearchCalibrationReport(outputPath, report);
  await mkdir(path.dirname(markdownPath), { recursive: true });
  await writeFile(markdownPath, renderAutoresearchCalibrationMarkdown(report), "utf8");

  if (options.command === "evaluate") {
    emitResult(
      options.json,
      {
        status: report.summary.mismatchCount > 0 ? "mismatch" : "clean",
        outputPath,
        markdownPath,
        caseCount: report.summary.caseCount,
        expectationCount: report.summary.expectationCount,
        mismatchCount: report.summary.mismatchCount,
        correctedMismatchCount: report.summary.correctedMismatchCount,
        invariantMismatchCount: report.summary.invariantMismatchCount,
      },
      [
        `Autoresearch calibration evaluated ${report.summary.caseCount} case(s).`,
        `Report: ${outputPath}`,
        `Summary: ${markdownPath}`,
        `Mismatches: ${report.summary.mismatchCount}/${report.summary.expectationCount}`,
      ],
    );
    return;
  }

  const brief = createAutoresearchOptimizationBrief(report, {
    reportPath: outputPath,
  });
  const briefOutputPath = options.briefOutputPath ?? defaultAutoresearchBriefPath(brief);
  const briefMarkdownPath = briefOutputPath.replace(/\.json$/i, ".md");
  await writeAutoresearchOptimizationBrief(briefOutputPath, brief);
  await mkdir(path.dirname(briefMarkdownPath), { recursive: true });
  await writeFile(briefMarkdownPath, renderAutoresearchOptimizationMarkdown(brief), "utf8");

  emitResult(
    options.json,
    {
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
    },
    [
      `Autoresearch cycle evaluated ${report.summary.caseCount} case(s).`,
      `Report: ${outputPath}`,
      `Summary: ${markdownPath}`,
      `Brief: ${briefOutputPath}`,
      `Brief summary: ${briefMarkdownPath}`,
      `Mismatches: ${report.summary.mismatchCount}/${report.summary.expectationCount}`,
    ],
  );
}

function parseArgs(argv: string[]): CommandOptions {
  const command = argv[0];
  if (command === "promote") {
    return parsePromoteArgs(argv.slice(1));
  }
  if (command === "evaluate") {
    return parseEvaluateArgs(argv.slice(1));
  }
  if (command === "cycle") {
    return parseCycleArgs(argv.slice(1));
  }

  throw new Error(`Unknown command: ${command ?? "(missing)"}`);
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
        split = readSplit(argv[++index]);
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
        printUsage();
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
  let outputPath: string | undefined;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--split":
        splits.push(readSplit(argv[++index]));
        break;
      case "--output":
        outputPath = path.resolve(argv[++index] ?? "");
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
    command: "evaluate",
    splits,
    ...(outputPath ? { outputPath } : {}),
    json,
  };
}

function parseCycleArgs(argv: string[]): CycleOptions {
  const splits: AutoresearchCalibrationSplit[] = [];
  let outputPath: string | undefined;
  let briefOutputPath: string | undefined;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--split":
        splits.push(readSplit(argv[++index]));
        break;
      case "--output":
        outputPath = path.resolve(argv[++index] ?? "");
        break;
      case "--brief-output":
        briefOutputPath = path.resolve(argv[++index] ?? "");
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
    command: "cycle",
    splits,
    ...(outputPath ? { outputPath } : {}),
    ...(briefOutputPath ? { briefOutputPath } : {}),
    json,
  };
}

function printUsage(): void {
  process.stdout.write([
    "Usage:",
    "  pnpm lab:autoresearch:promote --report <path> --split <train|validation|heldout> [options]",
    "  pnpm lab:autoresearch:evaluate [--split <split>] [--json]",
    "  pnpm lab:autoresearch:cycle [--split <split>] [--json]",
    "",
    "Promotion options:",
    "  --focus-area <title|summary|status|intentFrame|toolFamily|consequence>",
    "  --recommendation <promote|inspect|ignore>",
    "  --minimum-confidence <high|medium|low>",
    "  --no-step-invariants",
  ].join("\n"));
}

function readSplit(value: string | undefined): AutoresearchCalibrationSplit {
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

function emitResult(json: boolean, payload: unknown, lines: string[]): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${lines.join("\n")}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
