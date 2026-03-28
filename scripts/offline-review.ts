import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import {
  applyOfflineReviewResponse,
  buildOfflineReviewRecommendationReport,
  compareOfflineReviewArtifact,
  createOfflineReviewRun,
  defaultOfflineReviewArtifactPath,
  defaultOfflineReviewPromptPath,
  defaultOfflineReviewRawResponsePath,
  defaultOfflineReviewRecommendationPath,
  defaultOfflineReviewReportPath,
  defaultOfflineReviewResponsePath,
  defaultOfflineReviewRunPath,
  DEFAULT_OFFLINE_REVIEW_FOCUS_AREAS,
  DEFAULT_OFFLINE_REVIEW_RESULTS_LOG_PATH,
  loadOfflineReviewArtifact,
  loadSessionBundle,
  parseOfflineReviewResponseText,
  prepareOfflineReviewArtifact,
  renderOfflineReviewPrompt,
  renderOfflineReviewRecommendationMarkdown,
  renderOfflineReviewReportMarkdown,
  writeOfflineReviewArtifact,
  writeOfflineReviewRecommendationReport,
  writeOfflineReviewReport,
  writeOfflineReviewRun,
  type OfflineReviewFocusArea,
} from "../packages/lab/src/index.js";

type BaseCommandOptions = {
  json: boolean;
};

type PrepareOptions = BaseCommandOptions & {
  command: "prepare";
  bundlePath: string;
  outputPath?: string;
  rubricVersion?: string;
  focusAreas: OfflineReviewFocusArea[];
};

type CompareOptions = BaseCommandOptions & {
  command: "compare";
  artifactPath: string;
  outputPath?: string;
  failOnDisagreement: boolean;
};

type PromptOptions = BaseCommandOptions & {
  command: "prompt";
  artifactPath: string;
  outputPath?: string;
};

type RunOptions = BaseCommandOptions & {
  command: "run";
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
  resultsLogPath?: string;
  failOnDisagreement: boolean;
};

type CommandOptions = PrepareOptions | CompareOptions | PromptOptions | RunOptions;

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.command === "prepare") {
    const bundle = await loadSessionBundle(options.bundlePath);
    const artifact = prepareOfflineReviewArtifact(bundle, {
      bundlePath: options.bundlePath,
      focusAreas: options.focusAreas,
      ...(options.rubricVersion ? { rubricVersion: options.rubricVersion } : {}),
    });
    const outputPath = options.outputPath ?? defaultOfflineReviewArtifactPath(artifact);
    await writeOfflineReviewArtifact(outputPath, artifact);

    emitResult(
      options.json,
      {
        status: "prepared",
        bundleSessionId: bundle.sessionId,
        artifactPath: outputPath,
        focusAreas: artifact.focusAreas,
      },
      [
        `Prepared offline review artifact for ${bundle.sessionId}.`,
        `Artifact: ${outputPath}`,
        `Focus areas: ${artifact.focusAreas.join(", ")}`,
      ],
    );
    return;
  }

  if (options.command === "prompt") {
    const artifact = await loadOfflineReviewArtifact(options.artifactPath);
    const outputPath = options.outputPath ?? defaultOfflineReviewPromptPath(artifact);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, renderOfflineReviewPrompt(artifact), "utf8");

    emitResult(
      options.json,
      {
        status: "prompted",
        bundleSessionId: artifact.bundle.sessionId,
        artifactPath: options.artifactPath,
        promptPath: outputPath,
      },
      [
        `Rendered reviewer prompt for ${artifact.bundle.sessionId}.`,
        `Prompt: ${outputPath}`,
      ],
    );
    return;
  }

  if (options.command === "compare") {
    const artifact = await loadOfflineReviewArtifact(options.artifactPath);
    const report = compareOfflineReviewArtifact(artifact);
    const outputPath = options.outputPath ?? defaultOfflineReviewReportPath(artifact);
    const markdownPath = outputPath.replace(/\.json$/i, ".md");

    await writeOfflineReviewReport(outputPath, report);
    await writeFile(markdownPath, renderOfflineReviewReportMarkdown(report), "utf8");

    const status = report.summary.disagreementCount > 0 ? "disagreement" : "clean";
    emitResult(
      options.json,
      {
        status,
        bundleSessionId: artifact.bundle.sessionId,
        artifactPath: options.artifactPath,
        reportPath: outputPath,
        reportMarkdownPath: markdownPath,
        totalFindings: report.summary.totalFindings,
        matchedFindings: report.summary.matchedFindings,
        disagreementCount: report.summary.disagreementCount,
      },
      [
        `Compared offline review artifact for ${artifact.bundle.sessionId}.`,
        `Report: ${outputPath}`,
        `Summary: ${markdownPath}`,
        `Disagreements: ${report.summary.disagreementCount}/${report.summary.totalFindings}`,
      ],
    );

    if (options.failOnDisagreement && status === "disagreement") {
      process.exitCode = 1;
    }
    return;
  }

  const artifact = await loadOfflineReviewArtifact(options.artifactPath);
  const promptPath = options.promptPath ?? defaultOfflineReviewPromptPath(artifact);
  await mkdir(path.dirname(promptPath), { recursive: true });
  const prompt = renderOfflineReviewPrompt(artifact);
  await writeFile(promptPath, prompt, "utf8");

  const rawResponsePath = options.rawResponsePath ?? defaultOfflineReviewRawResponsePath(artifact);
  const responseText = await loadReviewerResponse(options, prompt, rawResponsePath);
  const response = parseOfflineReviewResponseText(responseText);
  const completedArtifact = applyOfflineReviewResponse(artifact, response);
  const responseArtifactPath = options.responseArtifactPath ?? defaultOfflineReviewResponsePath(completedArtifact);

  await writeOfflineReviewArtifact(responseArtifactPath, completedArtifact);

  const report = compareOfflineReviewArtifact(completedArtifact);
  const reportPath = options.outputPath ?? defaultOfflineReviewReportPath(completedArtifact);
  const reportMarkdownPath = reportPath.replace(/\.json$/i, ".md");
  await writeOfflineReviewReport(reportPath, report);
  await writeFile(reportMarkdownPath, renderOfflineReviewReportMarkdown(report), "utf8");

  const recommendation = buildOfflineReviewRecommendationReport(report);
  const recommendationPath = options.recommendationPath ?? defaultOfflineReviewRecommendationPath(completedArtifact);
  const recommendationMarkdownPath = recommendationPath.replace(/\.json$/i, ".md");
  await writeOfflineReviewRecommendationReport(recommendationPath, recommendation);
  await writeFile(
    recommendationMarkdownPath,
    renderOfflineReviewRecommendationMarkdown(recommendation),
    "utf8",
  );

  const runPath = options.runPath ?? defaultOfflineReviewRunPath(completedArtifact);
  const run = createOfflineReviewRun(
    report,
    recommendation,
    {
      requestPath: options.artifactPath,
      promptPath,
      rawResponsePath,
      responsePath: responseArtifactPath,
      reportPath,
      reportMarkdownPath,
      recommendationPath,
      recommendationMarkdownPath,
      runPath,
    },
  );
  await writeOfflineReviewRun(runPath, run);
  await appendResultsLog(options.resultsLogPath ?? DEFAULT_OFFLINE_REVIEW_RESULTS_LOG_PATH, run);

  emitResult(
    options.json,
    {
      status: run.status,
      bundleSessionId: completedArtifact.bundle.sessionId,
      requestPath: options.artifactPath,
      promptPath,
      rawResponsePath,
      responseArtifactPath,
      reportPath,
      reportMarkdownPath,
      recommendationPath,
      recommendationMarkdownPath,
      runPath,
      totalFindings: report.summary.totalFindings,
      matchedFindings: report.summary.matchedFindings,
      disagreementCount: report.summary.disagreementCount,
      actionableCount: recommendation.summary.actionableCount,
    },
    [
      `Ran offline review for ${completedArtifact.bundle.sessionId}.`,
      `Prompt: ${promptPath}`,
      `Raw reviewer output: ${rawResponsePath}`,
      `Filled artifact: ${responseArtifactPath}`,
      `Report: ${reportPath}`,
      `Recommendation: ${recommendationPath}`,
      `Run summary: ${runPath}`,
      `Disagreements: ${report.summary.disagreementCount}/${report.summary.totalFindings}`,
      `Actionable: ${recommendation.summary.actionableCount}`,
    ],
  );

  if (options.failOnDisagreement && run.status === "disagreement") {
    process.exitCode = 1;
  }
}

function parseArgs(argv: string[]): CommandOptions {
  const command = argv[0];
  if (command === "prepare") {
    return parsePrepareArgs(argv.slice(1));
  }
  if (command === "compare") {
    return parseCompareArgs(argv.slice(1));
  }
  if (command === "prompt") {
    return parsePromptArgs(argv.slice(1));
  }
  if (command === "run") {
    return parseRunArgs(argv.slice(1));
  }

  throw new Error(
    "Usage: pnpm lab:review:prepare --bundle <path> | pnpm lab:review:prompt --artifact <path> | pnpm lab:review:compare --artifact <path> | pnpm lab:review:run --artifact <path> --response <path>",
  );
}

function parsePrepareArgs(argv: string[]): PrepareOptions {
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

function parseCompareArgs(argv: string[]): CompareOptions {
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

function parsePromptArgs(argv: string[]): PromptOptions {
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

function parseRunArgs(argv: string[]): RunOptions {
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
  let resultsLogPath: string | undefined;
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
      case "--results-log":
        resultsLogPath = path.resolve(argv[++index] ?? "");
        break;
      case "--json":
        json = true;
        break;
      case "--fail-on-disagreement":
        failOnDisagreement = true;
        break;
      case "--help":
      case "-h":
        printRunUsage();
        process.exit(0);
      default:
        throw new Error(`Unknown option for run: ${arg}`);
    }
  }

  if (!artifactPath) {
    throw new Error("--artifact is required");
  }

  const responseSourceCount = Number(responseFromStdin) + Number(Boolean(responsePath)) + Number(Boolean(reviewerCommand));
  if (responseSourceCount !== 1) {
    throw new Error("Provide exactly one of --response, --response-stdin, or --reviewer-command");
  }

  return {
    command: "run",
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
    ...(resultsLogPath ? { resultsLogPath } : {}),
    failOnDisagreement,
    json,
  };
}

function readFocusAreas(raw: string | undefined): OfflineReviewFocusArea[] {
  const parts = (raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (parts.length === 0) {
    throw new Error("--focus requires a comma-separated list");
  }

  const result: OfflineReviewFocusArea[] = [];
  for (const part of parts) {
    if (
      !DEFAULT_OFFLINE_REVIEW_FOCUS_AREAS.includes(part as OfflineReviewFocusArea)
      && part !== "intentFrame"
      && part !== "toolFamily"
      && part !== "consequence"
      && part !== "status"
      && part !== "title"
      && part !== "summary"
    ) {
      throw new Error(`Unsupported focus area: ${part}`);
    }
    result.push(part as OfflineReviewFocusArea);
  }

  return result;
}

function emitResult(json: boolean, payload: Record<string, unknown>, lines: string[]): void {
  process.stdout.write(json ? `${JSON.stringify(payload, null, 2)}\n` : `${lines.join("\n")}\n`);
}

async function loadReviewerResponse(
  options: RunOptions,
  prompt: string,
  rawResponsePath: string,
): Promise<string> {
  let responseText: string;
  if (options.responseFromStdin) {
    responseText = await readStdin();
  } else if (options.responsePath) {
    responseText = await readFile(options.responsePath, "utf8");
  } else {
    responseText = await executeReviewerCommand(options.reviewerCommand ?? "", prompt);
  }

  await mkdir(path.dirname(rawResponsePath), { recursive: true });
  await writeFile(rawResponsePath, responseText, "utf8");
  return responseText;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function executeReviewerCommand(command: string, prompt: string): Promise<string> {
  if (!command.trim()) {
    throw new Error("Reviewer command is empty.");
  }

  return await new Promise<string>((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
      cwd: process.cwd(),
      env: process.env,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    child.stderr.on("data", (chunk) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      if (code !== 0) {
        reject(new Error(`Reviewer command failed with exit code ${code}${stderr ? `: ${stderr}` : ""}`));
        return;
      }
      if (!stdout.trim()) {
        reject(new Error("Reviewer command produced no stdout."));
        return;
      }
      resolve(stdout);
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

async function appendResultsLog(filePath: string, run: ReturnType<typeof createOfflineReviewRun>): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const exists = await fileExists(filePath);
  const row = [
    run.generatedAt,
    run.bundle.sessionId,
    run.status,
    String(run.summary.disagreementCount),
    String(run.summary.actionableCount),
    sanitizeTsv(run.review.reviewer ?? ""),
    sanitizeTsv(run.review.model ?? ""),
    sanitizeTsv(run.artifacts.requestPath),
    sanitizeTsv(run.artifacts.promptPath ?? ""),
    sanitizeTsv(run.artifacts.rawResponsePath ?? ""),
    sanitizeTsv(run.artifacts.responsePath),
    sanitizeTsv(run.artifacts.reportPath),
    sanitizeTsv(run.artifacts.recommendationPath),
    sanitizeTsv(run.artifacts.runPath ?? ""),
  ].join("\t");

  const header = [
    "generated_at",
    "session_id",
    "status",
    "disagreement_count",
    "actionable_count",
    "reviewer",
    "model",
    "request_path",
    "prompt_path",
    "raw_response_path",
    "response_path",
    "report_path",
    "recommendation_path",
    "run_path",
  ].join("\t");

  const content = exists ? `${row}\n` : `${header}\n${row}\n`;
  await writeFile(filePath, content, { encoding: "utf8", flag: exists ? "a" : "w" });
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function sanitizeTsv(value: string): string {
  return value.replace(/\t/g, " ").replace(/\n/g, " ").trim();
}

function printPrepareUsage(): void {
  console.log([
    "Usage: pnpm lab:review:prepare --bundle <path> [options]",
    "",
    "Options:",
    "  --bundle <path>          Session bundle JSON to prepare for offline review",
    "  --output <path>          Destination artifact JSON path",
    "  --rubric-version <id>    Rubric identifier to record in the artifact",
    `  --focus <csv>            Focus areas (default: ${DEFAULT_OFFLINE_REVIEW_FOCUS_AREAS.join(",")})`,
    "  --json                   Emit machine-readable JSON to stdout",
  ].join("\n"));
}

function printCompareUsage(): void {
  console.log([
    "Usage: pnpm lab:review:compare --artifact <path> [options]",
    "",
    "Options:",
    "  --artifact <path>        Completed offline review artifact JSON",
    "  --output <path>          Destination disagreement report JSON path",
    "  --json                   Emit machine-readable JSON to stdout",
    "  --fail-on-disagreement   Exit non-zero when disagreements are found",
  ].join("\n"));
}

function printPromptUsage(): void {
  console.log([
    "Usage: pnpm lab:review:prompt --artifact <path> [options]",
    "",
    "Options:",
    "  --artifact <path>        Prepared offline review artifact JSON",
    "  --output <path>          Destination reviewer prompt markdown path",
    "  --json                   Emit machine-readable JSON to stdout",
  ].join("\n"));
}

function printRunUsage(): void {
  console.log([
    "Usage: pnpm lab:review:run --artifact <path> (--response <path> | --response-stdin | --reviewer-command <cmd>) [options]",
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
    "  --results-log <path>          Destination TSV results log path",
    "  --json                        Emit machine-readable JSON to stdout",
    "  --fail-on-disagreement        Exit non-zero when disagreements are found",
  ].join("\n"));
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
