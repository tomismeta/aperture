import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { stderr, stdout } from "node:process";

import {
  createScenarioFromSessionBundle,
  defaultHarvestedScenarioPath,
  DEFAULT_GOLDEN_SCENARIOS_DIR,
  DEFAULT_HARVESTED_SCENARIOS_DIR,
  type ReplayArtifactSource,
  type ReplaySessionBundle,
  writeReplayScenario,
} from "../packages/lab/src/index.ts";

type CliOptions = {
  bundlePath?: string;
  outputPath?: string;
  collection?: string;
  golden?: boolean;
  scenarioId?: string;
  title?: string;
  description?: string;
  sourceId?: string;
  sourceKind?: string;
  sourceLabel?: string;
  redacted?: boolean;
  eventTransport?: string;
  semanticCapture?: string;
  responseBridge?: string;
  deleteSource?: boolean;
  keepExpectations?: boolean;
  doctrineTags: string[];
  notes: string[];
};

async function main(): Promise<void> {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (!options.bundlePath) {
      throw new Error("--bundle is required");
    }

    const bundlePath = path.resolve(options.bundlePath);
    const bundle = JSON.parse(await readFile(bundlePath, "utf8")) as ReplaySessionBundle;
    const source = mergeSource(bundle.source, options);
    const scenario = createScenarioFromSessionBundle(bundle, {
      ...(options.scenarioId !== undefined ? { id: options.scenarioId } : {}),
      ...(options.title !== undefined ? { title: options.title } : {}),
      ...(options.description !== undefined ? { description: options.description } : {}),
      ...(options.doctrineTags.length > 0 ? { doctrineTags: options.doctrineTags } : {}),
      ...(source !== undefined ? { source } : {}),
      provenance: {
        promotedAt: new Date().toISOString(),
        promotedFromBundleSessionId: bundle.sessionId,
        promotedFromPath: bundlePath,
      },
      includeOutcomeExpectations: options.keepExpectations,
    });

    const targetDirectory = options.outputPath
      ? undefined
      : path.resolve(
          options.golden
            ? DEFAULT_GOLDEN_SCENARIOS_DIR
            : DEFAULT_HARVESTED_SCENARIOS_DIR,
          options.collection ?? (options.golden ? "harvested" : ""),
        );
    const outputPath = options.outputPath
      ? path.resolve(options.outputPath)
      : defaultHarvestedScenarioPath(scenario, targetDirectory);

    await writeReplayScenario(outputPath, scenario);

    if (options.deleteSource) {
      await rm(bundlePath, { force: true });
    }

    stdout.write(`Promoted session bundle to ${outputPath}\n`);
    stdout.write(`- source bundle: ${bundlePath}\n`);
    stdout.write(`- scenario id: ${scenario.id}\n`);
    stdout.write(`- tags: ${scenario.doctrineTags?.join(", ") ?? "(none)"}\n`);
    stdout.write(`- expectations: ${options.keepExpectations ? "included" : "omitted"}\n`);
    if (options.deleteSource) {
      stdout.write("- raw bundle deleted after promotion\n");
    }
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
    keepExpectations: true,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    switch (arg) {
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
      case "--collection":
        if (!next || next.startsWith("-")) {
          throw new Error("--collection requires a value");
        }
        options.collection = next;
        index += 1;
        continue;
      case "--golden":
        options.golden = true;
        continue;
      case "--scenario-id":
        if (!next || next.startsWith("-")) {
          throw new Error("--scenario-id requires a value");
        }
        options.scenarioId = next;
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
      case "--delete-source":
        options.deleteSource = true;
        continue;
      case "--no-expectations":
        options.keepExpectations = false;
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

function mergeSource(
  source: ReplaySessionBundle["source"],
  options: CliOptions,
): ReplayArtifactSource | undefined {
  const base = source ?? (
    options.sourceId || options.sourceKind || options.sourceLabel || options.redacted
      ? { id: options.sourceId ?? "promoted-session" }
      : undefined
  );
  if (!base) {
    return undefined;
  }

  const notes = [
    ...(base.capture?.notes ?? []),
    ...options.notes,
  ];

  return {
    ...base,
    ...(options.sourceId !== undefined ? { id: options.sourceId } : {}),
    ...(options.sourceKind !== undefined ? { kind: options.sourceKind } : {}),
    ...(options.sourceLabel !== undefined ? { label: options.sourceLabel } : {}),
    ...(options.redacted === true ? { redacted: true } : {}),
    capture: {
      ...(base.capture ?? {}),
      ...(options.eventTransport !== undefined ? { eventTransport: options.eventTransport } : {}),
      ...(options.semanticCapture !== undefined ? { semanticCapture: options.semanticCapture } : {}),
      ...(options.responseBridge !== undefined ? { responseBridge: options.responseBridge } : {}),
      ...(notes.length > 0 ? { notes } : {}),
    },
  };
}

function printHelp(): void {
  stdout.write(
    [
      "Usage: pnpm session:promote --bundle <path> [options]",
      "",
      "Promote a raw Lab session bundle into a durable replay scenario.",
      "",
      "Options:",
      "  --bundle <path>         Source bundle JSON to promote",
      "  --out <path>            Explicit scenario output path",
      "  --collection <name>     Subdirectory under harvested or golden",
      "  --golden                Write under packages/lab/golden/harvested",
      "  --scenario-id <id>      Override the replay scenario id",
      "  --title <title>         Override the scenario title",
      "  --description <text>    Override the scenario description",
      "  --tag <tag>             Add doctrine tags (repeatable)",
      "  --note <text>           Add capture notes (repeatable)",
      "  --source-id <id>        Override the source id",
      "  --source-kind <kind>    Override the source kind",
      "  --source-label <text>   Override the source label",
      "  --redacted              Mark the promoted source as redacted",
      "  --event-transport <v>   Describe how events were captured",
      "  --semantic-capture <v>  Describe the semantic capture path",
      "  --response-bridge <v>   Describe how answers bridged back",
      "  --delete-source         Delete the raw bundle after promotion",
      "  --no-expectations       Omit final-outcome expectations",
      "  --help                  Show this help text",
    ].join("\n"),
  );
  stdout.write("\n");
}

void main();
