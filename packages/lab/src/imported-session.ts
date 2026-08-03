import type { SourceEvent } from "@tomismeta/aperture-core";

import { IMPORTED_SESSION_SCHEMA_VERSION } from "./artifact-versions.js";
import type { ReplayArtifactSource, ReplayScenario } from "./scenario.js";
import { createSessionBundleFromScenario, type ReplaySessionBundle } from "./session-bundle.js";
import type { CreateSessionBundleOptions } from "./session-bundle-model.js";
import { clipSourceEventSummary, isClippedSourceEventSummary } from "./source-event-summary.js";
export { IMPORTED_SESSION_SCHEMA_VERSION } from "./artifact-versions.js";

const STALE_IMPORTED_SUMMARY_MAX_LENGTH = 512;

export type ImportedSessionRole = "system" | "user" | "assistant" | "tool";
export type ImportedSessionKind =
  | "message"
  | "tool_call"
  | "tool_result"
  | "completion"
  | "boundary";
export type ImportedSessionSignificance = "context" | "attention";

export type ImportedSessionRawReference = Partial<{
  path: string;
  url: string;
  line: number;
  messageIndex: number;
  toolUseIndex: number;
  id: string;
}>;

export type ImportedSessionSource = ReplayArtifactSource &
  Partial<{
    upstreamUrl: string;
    rawMirrorPath: string;
    license: string;
    contributor: string;
  }>;

export type ImportedSessionEntry = {
  index: number;
  timestamp: string;
  entryId?: string;
  parentEntryId?: string;
  toolCallId?: string;
  role: ImportedSessionRole;
  kind: ImportedSessionKind;
  significance: ImportedSessionSignificance;
  label?: string;
  text?: string;
  excerpt?: string;
  toolName?: string;
  toolFamily?: string;
  rawRef?: ImportedSessionRawReference;
  sourceEvent?: SourceEvent;
};

export type ImportedSession = {
  schemaVersion: typeof IMPORTED_SESSION_SCHEMA_VERSION;
  sessionId: string;
  traceId?: string;
  title: string;
  description?: string;
  doctrineTags?: string[];
  source?: ImportedSessionSource;
  importedAt: string;
  entries: ImportedSessionEntry[];
};

export function createReplayScenarioFromImportedSession(session: ImportedSession): ReplayScenario {
  const steps = session.entries
    .filter(
      (entry): entry is ImportedSessionEntry & { sourceEvent: SourceEvent } =>
        entry.sourceEvent !== undefined,
    )
    .map((entry) => ({
      kind: "publishSource" as const,
      event: canonicalizeImportedSourceEvent(sourceEventWithImportedTextSummary(entry)),
      label: entry.label ?? `${entry.role}:${entry.kind}:${entry.index}`,
    }));

  if (steps.length === 0) {
    throw new Error(
      `Imported session ${session.sessionId} did not produce any replayable source events.`,
    );
  }

  return {
    id: session.sessionId,
    title: session.title,
    ...(session.description !== undefined ? { description: session.description } : {}),
    ...(session.doctrineTags !== undefined ? { doctrineTags: session.doctrineTags } : {}),
    ...(session.source !== undefined ? { source: session.source } : {}),
    steps,
  };
}

export function createSessionBundleFromImportedSession(
  session: ImportedSession,
  options: {
    exportedAt?: string;
    source?: ImportedSessionSource;
    replayTimeSource?: CreateSessionBundleOptions["replayTimeSource"];
  } = {},
): ReplaySessionBundle {
  const scenario = createReplayScenarioFromImportedSession(session);
  return createSessionBundleFromScenario(scenario, {
    sessionId: session.sessionId,
    ...((options.source ?? session.source) !== undefined
      ? { source: options.source ?? session.source }
      : {}),
    ...(options.exportedAt !== undefined ? { exportedAt: options.exportedAt } : {}),
    ...(options.replayTimeSource !== undefined
      ? { replayTimeSource: options.replayTimeSource }
      : {}),
  });
}

function sourceEventWithImportedTextSummary(
  entry: ImportedSessionEntry & { sourceEvent: SourceEvent },
): SourceEvent {
  if (
    entry.kind !== "tool_result" ||
    entry.sourceEvent.type !== "task.updated" ||
    !isImportedCommandExecutionToolFamily(entry.sourceEvent.toolFamily) ||
    entry.sourceEvent.status !== "failed" ||
    !entry.text
  ) {
    return entry.sourceEvent;
  }

  const currentSummary = entry.sourceEvent.summary;
  if (!shouldRefreshImportedToolSummary(currentSummary)) {
    return entry.sourceEvent;
  }

  const summary = clipSourceEventSummary(entry.text);
  if ((currentSummary?.length ?? 0) >= summary.length) {
    return entry.sourceEvent;
  }

  return {
    ...entry.sourceEvent,
    summary,
  };
}

function canonicalizeImportedSourceEvent(event: SourceEvent): SourceEvent {
  if (event.type !== "task.updated") {
    return event;
  }

  const toolFamily = canonicalImportedToolFamily(event.toolFamily);
  if (toolFamily === event.toolFamily) {
    return event;
  }

  const { toolFamily: _rawToolFamily, ...eventWithoutToolFamily } = event;
  return {
    ...eventWithoutToolFamily,
    ...(toolFamily !== undefined ? { toolFamily } : {}),
  };
}

function isImportedCommandExecutionToolFamily(value: string | undefined): boolean {
  return canonicalImportedToolFamily(value) === "bash";
}

function canonicalImportedToolFamily(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  const alias = normalized.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (
    normalized === "bash" ||
    normalized === "shell" ||
    normalized === "terminal" ||
    alias === "exec_command" ||
    alias === "shell_command" ||
    alias === "run_shell_command"
  ) {
    return "bash";
  }

  return normalized;
}

function shouldRefreshImportedToolSummary(currentSummary: string | undefined): boolean {
  if (currentSummary === undefined) {
    return true;
  }

  if (currentSummary.length > STALE_IMPORTED_SUMMARY_MAX_LENGTH) {
    return false;
  }

  return isClippedSourceEventSummary(currentSummary) || currentSummary.trimEnd().endsWith("...");
}
