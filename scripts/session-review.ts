import { stdout, stderr } from "node:process";
import path from "node:path";

import {
  DEFAULT_OFFLINE_REVIEW_FOCUS_AREAS,
  writeCaptureReviewArtifacts,
  writeSessionBundleReviewArtifact,
  type OfflineReviewFocusArea,
} from "../packages/lab/src/index.ts";
import { fetchRuntimeSessionCapture, resolveSessionRuntimeUrl } from "./session-support.ts";

type CliOptions = {
  runtimeUrl?: string;
  bundlePath?: string;
  outputPath?: string;
  bundleOutputPath?: string;
  sessionId?: string;
  title?: string;
  description?: string;
  doctrineTags: string[];
  focusAreas?: OfflineReviewFocusArea[];
  rubricVersion?: string;
  json: boolean;
};

async function main(): Promise<void> {
  try {
    const options = parseArgs(process.argv.slice(2));

    if (options.bundlePath) {
      const result = await writeSessionBundleReviewArtifact(path.resolve(options.bundlePath), {
        ...(options.outputPath ? { artifactPath: path.resolve(options.outputPath) } : {}),
        ...(options.focusAreas ? { focusAreas: options.focusAreas } : {}),
        ...(options.rubricVersion ? { rubricVersion: options.rubricVersion } : {}),
      });

      emitResult(options.json, {
        status: "prepared" as const,
        source: "bundle" as const,
        sessionId: result.bundle.sessionId,
        bundlePath: result.bundlePath,
        artifactPath: result.artifactPath,
        focusAreas: result.artifact.focusAreas,
        nextCommand: buildReviewRunCommand(result.artifactPath),
      }, [
        `Prepared offline review artifact for ${result.bundle.sessionId}.`,
        `Bundle: ${result.bundlePath}`,
        `Artifact: ${result.artifactPath}`,
        `Focus areas: ${result.artifact.focusAreas.join(", ")}`,
        `Next: ${buildReviewRunCommand(result.artifactPath)}`,
      ]);
      return;
    }

    const runtimeUrl = await resolveSessionRuntimeUrl(options.runtimeUrl, {
      emptyMessage: "No live Aperture runtime found. Start one with `pnpm serve` or `pnpm aperture`, or pass --bundle <path>.",
      multipleLabel: "session review",
    });
    const capture = await fetchRuntimeSessionCapture(runtimeUrl);
    const result = await writeCaptureReviewArtifacts(capture, {
      ...(options.sessionId ? { sessionId: options.sessionId } : {}),
      ...(options.title ? { title: options.title } : {}),
      ...(options.description ? { description: options.description } : {}),
      ...(options.doctrineTags.length > 0 ? { doctrineTags: options.doctrineTags } : {}),
      ...(options.bundleOutputPath ? { bundlePath: path.resolve(options.bundleOutputPath) } : {}),
      ...(options.outputPath ? { artifactPath: path.resolve(options.outputPath) } : {}),
      ...(options.focusAreas ? { focusAreas: options.focusAreas } : {}),
      ...(options.rubricVersion ? { rubricVersion: options.rubricVersion } : {}),
      source: {
        id: capture.kind,
        kind: "runtime",
        label: `Aperture runtime (${capture.kind})`,
        capture: {
          eventTransport: "runtime_capture",
          semanticCapture: "source+normalized+trace",
          notes: ["prepared via pnpm session:review"],
        },
      },
    });

    emitResult(options.json, {
      status: "prepared" as const,
      source: "runtime" as const,
      runtimeUrl,
      sessionId: result.bundle.sessionId,
      bundlePath: result.bundlePath,
      artifactPath: result.artifactPath,
      focusAreas: result.artifact.focusAreas,
      explanationHeadline: result.bundle.explanation?.headline ?? null,
      nextCommand: buildReviewRunCommand(result.artifactPath),
    }, [
      `Prepared offline review artifact from live runtime ${runtimeUrl}.`,
      `Session: ${result.bundle.sessionId}`,
      `Bundle: ${result.bundlePath}`,
      `Artifact: ${result.artifactPath}`,
      `Focus areas: ${result.artifact.focusAreas.join(", ")}`,
      ...(result.bundle.explanation?.headline ? [`Why: ${result.bundle.explanation.headline}`] : []),
      `Next: ${buildReviewRunCommand(result.artifactPath)}`,
    ]);
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    doctrineTags: [],
    json: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    switch (arg) {
      case "--runtime":
        if (!next || next.startsWith("-")) {
          throw new Error("--runtime requires a value");
        }
        options.runtimeUrl = next;
        index += 1;
        continue;
      case "--bundle":
        if (!next || next.startsWith("-")) {
          throw new Error("--bundle requires a value");
        }
        options.bundlePath = next;
        index += 1;
        continue;
      case "--out":
        if (!next || next.startsWith("-")) {
          throw new Error("--out requires a value");
        }
        options.outputPath = next;
        index += 1;
        continue;
      case "--bundle-out":
        if (!next || next.startsWith("-")) {
          throw new Error("--bundle-out requires a value");
        }
        options.bundleOutputPath = next;
        index += 1;
        continue;
      case "--session-id":
        if (!next || next.startsWith("-")) {
          throw new Error("--session-id requires a value");
        }
        options.sessionId = next;
        index += 1;
        continue;
      case "--title":
        if (!next || next.startsWith("-")) {
          throw new Error("--title requires a value");
        }
        options.title = next;
        index += 1;
        continue;
      case "--description":
        if (!next || next.startsWith("-")) {
          throw new Error("--description requires a value");
        }
        options.description = next;
        index += 1;
        continue;
      case "--tag":
        if (!next || next.startsWith("-")) {
          throw new Error("--tag requires a value");
        }
        options.doctrineTags.push(next);
        index += 1;
        continue;
      case "--focus-area":
        if (!next || next.startsWith("-")) {
          throw new Error("--focus-area requires a value");
        }
        options.focusAreas ??= [];
        options.focusAreas.push(readFocusArea(next));
        index += 1;
        continue;
      case "--rubric-version":
        if (!next || next.startsWith("-")) {
          throw new Error("--rubric-version requires a value");
        }
        options.rubricVersion = next;
        index += 1;
        continue;
      case "--json":
        options.json = true;
        continue;
      case "--help":
        return printUsageAndExit(printHelp);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.bundlePath && options.bundleOutputPath) {
    throw new Error("--bundle-out can only be used when preparing review artifacts from a live runtime");
  }

  if (options.bundlePath && (options.sessionId || options.title || options.description || options.doctrineTags.length > 0)) {
    throw new Error("--session-id, --title, --description, and --tag are only used when preparing review artifacts from a live runtime");
  }

  return options;
}

function readFocusArea(value: string): OfflineReviewFocusArea {
  const focusArea = DEFAULT_OFFLINE_REVIEW_FOCUS_AREAS.find((candidate) => candidate === value)
    ?? (["ask", "source"] as const).find((candidate) => candidate === value);
  if (!focusArea) {
    throw new Error(
      `--focus-area must be one of: ${[...DEFAULT_OFFLINE_REVIEW_FOCUS_AREAS, "ask", "source"].join(", ")}`,
    );
  }
  return focusArea;
}

function emitResult(json: boolean, payload: Record<string, unknown>, lines: string[]): void {
  if (json) {
    stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  stdout.write(`${lines.join("\n")}\n`);
}

function buildReviewRunCommand(artifactPath: string): string {
  return `pnpm lab:fstop:review-run --artifact ${JSON.stringify(artifactPath)} --reviewer-command \"<command>\"`;
}

function printHelp(): void {
  stdout.write(
    [
      "Usage: pnpm session:review [options]",
      "",
      "Prepare an offline-review artifact either from a live Aperture runtime or",
      "from an existing session bundle JSON.",
      "",
      "Inputs:",
      "  --runtime <url>            Use an explicit runtime control URL",
      "  --bundle <path>            Prepare from an existing session bundle JSON",
      "",
      "Outputs:",
      "  --out <path>               Write the review artifact to an explicit path",
      "  --bundle-out <path>        When using a live runtime, also write the derived bundle to this path",
      "",
      "Live runtime metadata:",
      "  --session-id <id>          Override the generated bundle session id",
      "  --title <title>            Override the derived bundle title",
      "  --description <text>       Add a bundle description",
      "  --tag <tag>                Add a doctrine tag (repeatable)",
      "",
      "Review shape:",
      "  --focus-area <name>        Limit review focus areas (repeatable)",
      "  --rubric-version <value>   Override the review rubric version",
      "  --json                     Emit machine-readable output",
      "  --help                     Show this help text",
      "",
      "If no --bundle or --runtime is provided, the script uses APERTURE_RUNTIME_URL",
      "or the most recent discovered local Aperture runtime.",
    ].join("\n"),
  );
  stdout.write("\n");
}

function printUsageAndExit(printUsage: () => void): never {
  printUsage();
  process.exit(0);
}

void main();
