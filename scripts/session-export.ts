import { stdout, stderr } from "node:process";
import path from "node:path";

import {
  createSessionBundleFromRuntimeCapture,
  defaultSessionBundlePath,
  writeSessionBundle,
} from "../packages/lab/src/index.ts";
import { discoverLocalRuntimes, type ApertureRuntimeSessionCapture } from "../packages/runtime/src/index.ts";

type CliOptions = {
  runtimeUrl?: string;
  outputPath?: string;
  sessionId?: string;
  title?: string;
  description?: string;
  sourceId?: string;
  sourceKind?: string;
  sourceLabel?: string;
  redacted?: boolean;
  eventTransport?: string;
  semanticCapture?: string;
  responseBridge?: string;
  doctrineTags: string[];
  notes: string[];
};

async function main(): Promise<void> {
  try {
    const options = parseArgs(process.argv.slice(2));
    const runtimeUrl = await resolveRuntimeUrl(options.runtimeUrl);
    const capture = await fetchSessionCapture(runtimeUrl);
    const bundle = createSessionBundleFromRuntimeCapture(capture, {
      ...(options.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
      ...(options.title !== undefined ? { title: options.title } : {}),
      ...(options.description !== undefined ? { description: options.description } : {}),
      ...(options.doctrineTags.length > 0 ? { doctrineTags: options.doctrineTags } : {}),
      source: {
        id: options.sourceId ?? capture.kind,
        kind: options.sourceKind ?? "runtime",
        label: options.sourceLabel ?? `Aperture runtime (${capture.kind})`,
        ...(options.redacted === true ? { redacted: true } : {}),
        capture: {
          eventTransport: options.eventTransport ?? "runtime_capture",
          semanticCapture: options.semanticCapture ?? "source+normalized+trace",
          ...(options.responseBridge !== undefined ? { responseBridge: options.responseBridge } : {}),
          ...(options.notes.length > 0 ? { notes: options.notes } : {}),
        },
      },
    });
    const outputPath = options.outputPath
      ? path.resolve(options.outputPath)
      : defaultSessionBundlePath(bundle);

    await writeSessionBundle(outputPath, bundle);

    stdout.write(`Wrote session bundle to ${outputPath}\n`);
    stdout.write(`- runtime: ${runtimeUrl}\n`);
    stdout.write(`- session: ${bundle.sessionId}\n`);
    stdout.write(`- steps: ${bundle.steps.length}\n`);
    stdout.write(`- traces: ${bundle.traces.length}\n`);
    stdout.write(`- active: ${bundle.outcomes.finalActiveInteractionId ?? "none"}\n`);
    stdout.write(`- queued: ${bundle.outcomes.finalQueuedCount}\n`);
    stdout.write(`- ambient: ${bundle.outcomes.finalAmbientCount}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    doctrineTags: [],
    notes: [],
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
      case "--note":
        if (!next || next.startsWith("-")) {
          throw new Error("--note requires a value");
        }
        options.notes.push(next);
        index += 1;
        continue;
      case "--source-id":
        if (!next || next.startsWith("-")) {
          throw new Error("--source-id requires a value");
        }
        options.sourceId = next;
        index += 1;
        continue;
      case "--source-kind":
        if (!next || next.startsWith("-")) {
          throw new Error("--source-kind requires a value");
        }
        options.sourceKind = next;
        index += 1;
        continue;
      case "--source-label":
        if (!next || next.startsWith("-")) {
          throw new Error("--source-label requires a value");
        }
        options.sourceLabel = next;
        index += 1;
        continue;
      case "--redacted":
        options.redacted = true;
        continue;
      case "--event-transport":
        if (!next || next.startsWith("-")) {
          throw new Error("--event-transport requires a value");
        }
        options.eventTransport = next;
        index += 1;
        continue;
      case "--semantic-capture":
        if (!next || next.startsWith("-")) {
          throw new Error("--semantic-capture requires a value");
        }
        options.semanticCapture = next;
        index += 1;
        continue;
      case "--response-bridge":
        if (!next || next.startsWith("-")) {
          throw new Error("--response-bridge requires a value");
        }
        options.responseBridge = next;
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
      "Usage: pnpm session:export [options]",
      "",
      "Options:",
      "  --runtime <url>       Use an explicit runtime control URL",
      "  --out <path>          Write the bundle to an explicit path",
      "  --session-id <id>     Override the bundle session id",
      "  --title <title>       Override the bundle title",
      "  --description <text>  Add a bundle description",
      "  --tag <tag>           Add a doctrine tag (repeatable)",
      "  --note <text>         Add capture notes (repeatable)",
      "  --source-id <id>      Override the bundle source id",
      "  --source-kind <kind>  Override the bundle source kind",
      "  --source-label <text> Override the bundle source label",
      "  --redacted            Mark the bundle source as redacted",
      "  --event-transport <v> Describe how events were captured",
      "  --semantic-capture <v> Describe the semantic capture path",
      "  --response-bridge <v> Describe how operator answers bridged back",
      "  --help                Show this help text",
      "",
      "If no runtime URL is provided, the script uses APERTURE_RUNTIME_URL or the",
      "most recent discovered local Aperture runtime.",
    ].join("\n"),
  );
  stdout.write("\n");
}

void main();
