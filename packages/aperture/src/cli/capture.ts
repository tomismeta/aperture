import { randomUUID } from "node:crypto";
import path from "node:path";
import { stdout } from "node:process";

import {
  type RuntimeSessionCaptureCursor,
  createRuntimeSessionCaptureCursor,
  createSessionBundleFromRuntimeCapture,
  defaultSessionBundlePath,
  sliceRuntimeSessionCapture,
  writeSessionBundle,
} from "@aperture/lab/capture";

import { apertureCaptureDir } from "../opencode-config.js";
import { uniqueStrings } from "./shared.js";
import { fetchSessionCapture } from "./runtime-support.js";

export type CaptureOptions = {
  outputPath?: string;
  sessionId?: string;
  title?: string;
  description?: string;
  doctrineTags: string[];
};

export async function beginCapture(runtimeUrl: string): Promise<RuntimeSessionCaptureCursor> {
  const baseline = await fetchSessionCapture(runtimeUrl);
  const cursor = createRuntimeSessionCaptureCursor(baseline);
  const baselineNowCount = baseline.attentionView.active ? 1 : 0;
  const baselineFrameCount = baselineNowCount + baseline.attentionView.queued.length + baseline.attentionView.ambient.length;

  stdout.write(`Capture enabled for this Aperture session (${runtimeUrl})\n`);
  stdout.write(`- baseline steps: ${cursor.counts.steps}\n`);
  stdout.write(`- baseline source events: ${cursor.counts.sourceEvents}\n`);
  stdout.write(`- baseline now: ${baselineNowCount}\n`);
  stdout.write(`- baseline next: ${baseline.attentionView.queued.length}\n`);
  stdout.write(`- baseline ambient: ${baseline.attentionView.ambient.length}\n`);
  if (baselineFrameCount > 0) {
    stdout.write(
      "Note: the runtime already has visible state. The capture will slice new logs only, but the final bundle may still reflect earlier frames.\n",
    );
  }

  return cursor;
}

export async function exportCapturedSession(
  runtimeUrl: string,
  cursor: RuntimeSessionCaptureCursor,
  options: CaptureOptions,
): Promise<void> {
  const capture = await fetchSessionCapture(runtimeUrl);
  const slicedCapture = sliceRuntimeSessionCapture(capture, cursor);
  const exportedAt = new Date().toISOString();
  const doctrineTags = uniqueStrings(["harvested", "launcher", ...options.doctrineTags]);

  if (slicedCapture.steps.length === 0) {
    stdout.write("No new runtime activity was captured during this Aperture session.\n");
    return;
  }

  const bundle = createSessionBundleFromRuntimeCapture(slicedCapture, {
    sessionId: options.sessionId ?? randomUUID(),
    title: options.title ?? defaultLauncherCaptureTitle(exportedAt),
    ...(options.description !== undefined ? { description: options.description } : {}),
    doctrineTags,
    exportedAt,
    source: {
      id: capture.kind,
      kind: "runtime",
      label: `Aperture runtime (${capture.kind})`,
      capture: {
        eventTransport: "runtime_capture",
        semanticCapture: "source+normalized+trace",
        notes: ["captured via aperture --capture"],
      },
    },
  });
  const outputPath = options.outputPath
    ? path.resolve(options.outputPath)
    : defaultSessionBundlePath(bundle, apertureCaptureDir());

  await writeSessionBundle(outputPath, bundle);

  stdout.write(`Wrote captured session bundle to ${outputPath}\n`);
  stdout.write(`- session: ${bundle.sessionId}\n`);
  stdout.write(`- steps: ${bundle.steps.length}\n`);
  stdout.write(`- traces: ${bundle.traces.length}\n`);
  stdout.write(`- now: ${bundle.outcomes.finalActiveInteractionId ?? "none"}\n`);
  stdout.write(`- next: ${bundle.outcomes.finalQueuedCount}\n`);
  stdout.write(`- ambient: ${bundle.outcomes.finalAmbientCount}\n`);
}

function defaultLauncherCaptureTitle(exportedAt: string): string {
  const date = new Date(exportedAt);
  const formatter = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  return `Aperture harvested session ${formatter.format(date)}`;
}
