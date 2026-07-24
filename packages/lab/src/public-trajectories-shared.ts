import path from "node:path";

import type { SourceEvent } from "@tomismeta/aperture-core";

import { defaultSessionBundlePath, runSessionBundle, type ReplaySessionBundle } from "./session-bundle.js";
import { isRecord as isShapeRecord } from "./shape.js";
import {
  DEFAULT_DATACLAW_SPLIT,
  DEFAULT_OPEN_AGENT_SESSIONS_SPLIT,
  DEFAULT_PI_SPLIT,
  DEFAULT_PUBLIC_TRAJECTORY_BUNDLES_DIR,
  DEFAULT_SWE_SMITH_SPLIT,
  DEFAULT_TRACE_COMMONS_SPLIT,
  type PublicTrajectoryDataset,
  type PublicTrajectorySplit,
} from "./public-trajectories-types.js";

const SYNTHETIC_START_TIME_MS = Date.UTC(2026, 0, 1, 0, 0, 0, 0);

const NON_FAILING_READBACK_PHRASES = [
  "file created successfully",
  "has been edited",
  "result of running `cat -n`",
  "result of running `sed -n`",
  "result of running `grep`",
  "result of running `ls`",
  "result of running `find`",
  "showing abbreviated version",
  "please use `str_replace_editor view`",
] as const;

const ROUTINE_SUCCESS_OBSERVATION_PHRASES = [
  "ran successfully and did not produce any output",
  "command ran successfully and did not produce any output",
  "completed successfully and did not produce any output",
  "patch applied successfully",
] as const;

export function defaultPublicTrajectorySplit(
  dataset: PublicTrajectoryDataset,
): PublicTrajectorySplit {
  if (dataset === "dataclaw") {
    return DEFAULT_DATACLAW_SPLIT;
  }
  if (dataset === "pi") {
    return DEFAULT_PI_SPLIT;
  }
  if (dataset === "open-agent-sessions") {
    return DEFAULT_OPEN_AGENT_SESSIONS_SPLIT;
  }
  if (dataset === "trace-commons") {
    return DEFAULT_TRACE_COMMONS_SPLIT;
  }
  return DEFAULT_SWE_SMITH_SPLIT;
}

export function defaultImportedTrajectoryBundlePath(
  bundle: ReplaySessionBundle,
  dataset: PublicTrajectoryDataset,
  split: PublicTrajectorySplit = DEFAULT_SWE_SMITH_SPLIT,
  rootDirectory: string = DEFAULT_PUBLIC_TRAJECTORY_BUNDLES_DIR,
): string {
  return defaultSessionBundlePath(bundle, path.join(rootDirectory, dataset, split));
}

export function validateImportedTrajectoryBundle(
  bundle: ReplaySessionBundle,
): ReplaySessionBundle {
  const replayed = runSessionBundle(bundle);
  const finalView = replayed.views.at(-1);

  if (!finalView) {
    throw new Error(`Imported trajectory bundle ${bundle.sessionId} did not produce a final attention view.`);
  }

  if (
    finalView.nowInteractionId !== bundle.outcomes.finalNowInteractionId
    || finalView.nextInteractionIds.length !== bundle.outcomes.finalNextCount
    || finalView.ambientInteractionIds.length !== bundle.outcomes.finalAmbientCount
  ) {
    throw new Error(`Imported trajectory bundle ${bundle.sessionId} failed roundtrip replay validation.`);
  }

  return bundle;
}

export function buildAssistantTitle(toolFamily: string | undefined, summary: string): string {
  if (toolFamily) {
    return `${toolFamily} action`;
  }
  return clipText(summary, 96);
}

export function buildObservationTitle(
  status: Extract<SourceEvent, { type: "task.updated" }>["status"],
  toolFamily: string | undefined,
): string {
  if (status === "failed") {
    return toolFamily ? `${toolFamily} failure` : "tool failure";
  }
  return toolFamily ? `${toolFamily} observation` : "tool observation";
}

export function inferAssistantStatus(
  text: string,
): Extract<SourceEvent, { type: "task.updated" }>["status"] {
  const normalized = text.toLowerCase();
  if (
    normalized.includes("could you")
    || normalized.includes("can you")
    || normalized.includes("would you")
    || normalized.includes("please confirm")
    || normalized.includes("let me know")
  ) {
    return "waiting";
  }

  return "running";
}

export function inferObservationStatus(
  text: string,
  toolFamily?: string,
): Extract<SourceEvent, { type: "task.updated" }>["status"] {
  const normalized = text.toLowerCase();
  if (looksLikeSuccessfulObservation(normalized, toolFamily)) {
    return "running";
  }

  if (
    normalized.includes("traceback")
    || normalized.includes("exception")
    || normalized.includes("permission denied")
    || normalized.includes("command not found")
    || normalized.includes("segmentation fault")
    || normalized.includes("forbidden")
    || /\bfailed\b/.test(normalized)
    || /\bfailure\b/.test(normalized)
    || /\berror\b(?::|\s|$)/.test(normalized)
    || /\b[a-z]+error\b(?::|\s|$)/.test(normalized)
  ) {
    return "failed";
  }

  if (
    normalized.includes("waiting")
    || normalized.includes("awaiting")
    || normalized.includes("pending")
  ) {
    return "waiting";
  }

  return "running";
}

export function stringifyStructuredValue(value: unknown): string | null {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  if (Array.isArray(value)) {
    const parts = value
      .map((item) => stringifyStructuredValue(item))
      .filter((item): item is string => item !== null);
    return parts.length > 0 ? parts.join("\n") : null;
  }

  if (!isRecord(value)) {
    return null;
  }

  const preferredKeys = [
    "description",
    "prompt",
    "command",
    "file_path",
    "path",
    "query",
    "url",
    "text",
    "stdout",
    "stderr",
    "error",
    "message",
  ] as const;

  const preferredValues = preferredKeys
    .map((key) => value[key])
    .map((entry) => stringifyStructuredValue(entry))
    .filter((entry): entry is string => entry !== null);

  if (preferredValues.length > 0) {
    return preferredValues.join("\n");
  }

  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

export function readIssueTitle(issueText: string): string | null {
  const lines = issueText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return lines[0] ? clipText(lines[0], 96) : null;
}

export function normalizeToolFamily(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.toLowerCase();
  if (normalized === "bash" || normalized === "shell" || normalized === "terminal") return "bash";
  if (normalized.includes("read") || normalized.includes("open") || normalized.includes("view")) return "read";
  if (normalized.includes("edit") || normalized.includes("write") || normalized.includes("patch") || normalized.includes("replace")) return "edit";
  if (normalized.includes("search") || normalized.includes("find") || normalized.includes("grep")) return "search";
  if (normalized.includes("web") || normalized.includes("browser")) return "web";
  if (normalized.includes("task") || normalized.includes("subagent")) return "task";
  if (normalized === "submit") return undefined;
  return normalized;
}

export function coerceImportedTimestamp(
  value: string | undefined,
  fallback: string | undefined,
  stepIndex: number,
): string {
  const timestamp = value ?? fallback;
  if (timestamp) {
    const parsed = Date.parse(timestamp);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
  }

  return syntheticTimestamp(stepIndex);
}

export function syntheticTimestamp(stepIndex: number): string {
  return new Date(SYNTHETIC_START_TIME_MS + (stepIndex * 1000)).toISOString();
}

export function clipText(value: string, maxLength: number): string {
  const normalized = toSingleLine(value) ?? value;
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 3)}...`;
}

export function toSingleLine(value: string): string | null {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : null;
}

export function slug(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return normalized.length > 0 ? normalized : "trajectory";
}

export function trajectorySlug(value: string): string {
  return slug(value).replace(/\./g, "-");
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return isShapeRecord(value);
}

function looksLikeSuccessfulObservation(
  text: string,
  toolFamily?: string,
): boolean {
  if (containsAnyPhrase(text, ROUTINE_SUCCESS_OBSERVATION_PHRASES)) {
    return true;
  }

  if (countOccurrences(text, "/testbed/") >= 2 && !text.includes("traceback")) {
    return true;
  }

  if (toolFamily === "edit" || toolFamily === "read") {
    return containsAnyPhrase(text, NON_FAILING_READBACK_PHRASES);
  }

  return false;
}

function containsAnyPhrase(text: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => text.includes(phrase));
}

function countOccurrences(text: string, needle: string): number {
  if (!needle) {
    return 0;
  }

  let count = 0;
  let index = text.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(needle, index + needle.length);
  }
  return count;
}
