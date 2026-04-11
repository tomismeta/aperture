import type { SourceEvent } from "@tomismeta/aperture-core";

import { IMPORTED_SESSION_SCHEMA_VERSION } from "./artifact-versions.js";
import type { ReplayArtifactSource, ReplayScenario } from "./scenario.js";
import { createSessionBundleFromScenario, type ReplaySessionBundle } from "./session-bundle.js";
export { IMPORTED_SESSION_SCHEMA_VERSION } from "./artifact-versions.js";

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
      event: entry.sourceEvent,
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
  } = {},
): ReplaySessionBundle {
  const scenario = createReplayScenarioFromImportedSession(session);
  return createSessionBundleFromScenario(scenario, {
    sessionId: session.sessionId,
    ...((options.source ?? session.source) !== undefined
      ? { source: options.source ?? session.source }
      : {}),
    ...(options.exportedAt !== undefined ? { exportedAt: options.exportedAt } : {}),
  });
}
