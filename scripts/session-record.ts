import readline from "node:readline/promises";
import path from "node:path";
import { stdin, stdout, stderr } from "node:process";

import {
  createRuntimeSessionCaptureCursor,
  createSessionBundleFromRuntimeCapture,
  defaultSessionBundlePath,
  sliceRuntimeSessionCapture,
  writeSessionBundle,
} from "../packages/lab/src/index.ts";
import { discoverLocalRuntimes, type ApertureRuntimeSessionCapture } from "../packages/runtime/src/index.ts";

type CliOptions = {
  runtimeUrl?: string;
  outputPath?: string;
  sessionId?: string;
  title?: string;
  description?: string;
  doctrineTags: string[];
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const runtimeUrl = await resolveRuntimeUrl(options.runtimeUrl);
  const baseline = await fetchSessionCapture(runtimeUrl);
  const cursor = createRuntimeSessionCaptureCursor(baseline);
  const baselineFrameCount =
    (baseline.attentionView.active ? 1 : 0)
    + baseline.attentionView.queued.length
    + baseline.attentionView.ambient.length;

  stdout.write(`Recording session from ${runtimeUrl}\n`);
  stdout.write(`- baseline steps: ${cursor.counts.steps}\n`);
  stdout.write(`- baseline source events: ${cursor.counts.sourceEvents}\n`);
  stdout.write(`- baseline queued: ${baseline.attentionView.queued.length}\n`);
  stdout.write(`- baseline ambient: ${baseline.attentionView.ambient.length}\n`);
  if (baselineFrameCount > 0) {
    stdout.write(
      "Note: the runtime already has visible state. The recording will slice new logs only, but the final bundle may still reflect earlier frames.\n",
    );
  }
  stdout.write("Exercise the system, then press Enter to export the new session slice.\n");

  const rl = readline.createInterface({
    input: stdin,
    output: stdout,
  });

  try {
    await rl.question("");
  } finally {
    rl.close();
  }

  const capture = await fetchSessionCapture(runtimeUrl);
  const slicedCapture = sliceRuntimeSessionCapture(capture, cursor);

  if (slicedCapture.steps.length === 0) {
    throw new Error("No new runtime activity was captured since recording started.");
  }

  const bundle = createSessionBundleFromRuntimeCapture(slicedCapture, {
    ...(options.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
    ...(options.title !== undefined ? { title: options.title } : {}),
    ...(options.description !== undefined ? { description: options.description } : {}),
    ...(options.doctrineTags.length > 0 ? { doctrineTags: options.doctrineTags } : {}),
    source: {
      id: capture.kind,
      kind: "runtime",
      label: `Aperture runtime (${capture.kind})`,
    },
  });
  const outputPath = options.outputPath
    ? path.resolve(options.outputPath)
    : defaultSessionBundlePath(bundle);

  await writeSessionBundle(outputPath, bundle);

  stdout.write(`Wrote recorded session bundle to ${outputPath}\n`);
  stdout.write(`- session: ${bundle.sessionId}\n`);
  stdout.write(`- steps: ${bundle.steps.length}\n`);
  stdout.write(`- traces: ${bundle.traces.length}\n`);
  stdout.write(`- active: ${bundle.outcomes.finalActiveInteractionId ?? "none"}\n`);
  stdout.write(`- queued: ${bundle.outcomes.finalQueuedCount}\n`);
  stdout.write(`- ambient: ${bundle.outcomes.finalAmbientCount}\n`);
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    doctrineTags: [],
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
      case "--out":
        if (!next || next.startsWith("-")) {
          throw new Error("--out requires a value");
        }
        options.outputPath = next;
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
      case "--help":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

async function resolveRuntimeUrl(explicit?: string): Promise<string> {
  if (explicit) {
    return explicit.replace(/\/+$/, "");
  }

  const envUrl = process.env.APERTURE_RUNTIME_URL;
  if (envUrl) {
    return envUrl.replace(/\/+$/, "");
  }

  const runtimes = await discoverLocalRuntimes({ kind: "aperture" });
  if (runtimes.length === 0) {
    throw new Error("No live Aperture runtime found. Start one with `pnpm serve` or `pnpm aperture`.");
  }

  return runtimes[0]?.controlUrl ?? "http://127.0.0.1:4546/runtime";
}

async function fetchSessionCapture(runtimeUrl: string): Promise<ApertureRuntimeSessionCapture> {
  const response = await fetch(`${runtimeUrl}/session`);
  if (!response.ok) {
    throw new Error(`Failed to export runtime session capture from ${runtimeUrl} (${response.status})`);
  }

  return response.json() as Promise<ApertureRuntimeSessionCapture>;
}

function printHelp(): void {
  stdout.write(
    [
      "Usage: pnpm session:record [options]",
      "",
      "Starts from the current runtime capture as a baseline, waits for you to",
      "exercise the system, then exports only the new session slice.",
      "",
      "Options:",
      "  --runtime <url>       Use an explicit runtime control URL",
      "  --out <path>          Write the bundle to an explicit path",
      "  --session-id <id>     Override the bundle session id",
      "  --title <title>       Override the bundle title",
      "  --description <text>  Add a bundle description",
      "  --tag <tag>           Add a doctrine tag (repeatable)",
      "  --help                Show this help text",
    ].join("\n"),
  );
  stdout.write("\n");
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  stderr.write(`${message}\n`);
  process.exitCode = 1;
});
