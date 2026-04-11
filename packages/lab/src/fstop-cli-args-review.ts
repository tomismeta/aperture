import path from "node:path";

import { DEFAULT_OFFLINE_REVIEW_FOCUS_AREAS, type OfflineReviewFocusArea } from "./index.js";
import {
  printCompareUsage,
  printPrepareUsage,
  printPromptUsage,
  printReviewRunUsage,
} from "./fstop-cli-usage.js";
import {
  printUsageAndExit,
  readFocusAreas,
} from "./fstop-cli-args-support.js";

export type JsonOptions = {
  json: boolean;
};

export type ReviewCommand = "prepare" | "prompt" | "compare" | "review-run";

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

export type ReviewCliOptions =
  | ReviewPrepareOptions
  | ReviewPromptOptions
  | ReviewCompareOptions
  | ReviewRunOptions;

export function parseReviewArgs(command: ReviewCommand, argv: string[]): ReviewCliOptions {
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

function parseReviewPrepareArgs(argv: string[]): ReviewPrepareOptions {
  let bundlePath: string | undefined;
  let outputPath: string | undefined;
  let rubricVersion: string | undefined;
  let focusAreas: OfflineReviewFocusArea[] = [...DEFAULT_OFFLINE_REVIEW_FOCUS_AREAS];
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
        return printUsageAndExit(printPrepareUsage);
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
        return printUsageAndExit(printPromptUsage);
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
        return printUsageAndExit(printCompareUsage);
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
        return printUsageAndExit(printReviewRunUsage);
      default:
        throw new Error(`Unknown option for review-run: ${arg}`);
    }
  }

  if (!artifactPath) {
    throw new Error("--artifact is required");
  }

  const responseSourceCount =
    Number(responseFromStdin) +
    Number(Boolean(responsePath)) +
    Number(Boolean(reviewerCommand));
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
