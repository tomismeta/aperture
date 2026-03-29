import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { SourceEvent } from "@tomismeta/aperture-core";

import {
  createReplayScenarioFromImportedSession,
  createSessionBundleFromImportedSession,
  IMPORTED_SESSION_SCHEMA_VERSION,
  type ImportedSession,
  type ImportedSessionEntry,
  type ImportedSessionKind,
  type ImportedSessionRawReference,
  type ImportedSessionRole,
  type ImportedSessionSignificance,
  type ImportedSessionSource,
} from "./imported-session.js";
import { defaultLabRuntimeSubdirectory } from "./runtime-paths.js";
import {
  hasShape,
  isBoolean,
  isNumber,
  isRecord,
  isString,
  isStringArray,
  validateWith,
} from "./shape.js";
import {
  defaultSessionBundlePath,
  validateSessionBundle,
  writeSessionBundle,
  type ReplaySessionBundle,
} from "./session-bundle.js";
import { validateSourceEvent } from "./validation.js";

export const FSTOP_SESSION_SCHEMA_VERSION = IMPORTED_SESSION_SCHEMA_VERSION;
export const DEFAULT_FSTOP_SESSION_FILES_DIR = defaultLabRuntimeSubdirectory("sessions");
export const DEFAULT_FSTOP_SESSION_BUNDLES_DIR = defaultLabRuntimeSubdirectory("bundles", "sessions");

export type FStopSession = ImportedSession;
export type FStopSessionEntry = ImportedSessionEntry;
export type FStopSessionKind = ImportedSessionKind;
export type FStopSessionRawReference = ImportedSessionRawReference;
export type FStopSessionRole = ImportedSessionRole;
export type FStopSessionSignificance = ImportedSessionSignificance;
export type FStopSessionSource = ImportedSessionSource;

const SESSION_ROLES = new Set<FStopSessionRole>(["system", "user", "assistant", "tool"]);
const SESSION_KINDS = new Set<FStopSessionKind>([
  "message",
  "tool_call",
  "tool_result",
  "completion",
  "boundary",
]);
const SESSION_SIGNIFICANCE = new Set<FStopSessionSignificance>(["context", "attention"]);

export async function loadFStopSessionFile(filePath: string): Promise<FStopSession> {
  const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  const session = validateFStopSession(parsed);
  if (!session) {
    throw new Error(`Invalid F-Stop session file: ${filePath}`);
  }
  return session;
}

export async function loadReplayBundleFromFStopInputFile(
  filePath: string,
): Promise<ReplaySessionBundle> {
  const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  const bundle = validateSessionBundle(parsed);
  if (bundle) {
    return bundle;
  }

  const session = validateFStopSession(parsed);
  if (session) {
    return createSessionBundleFromFStopSession(session);
  }

  throw new Error(`Unsupported F-Stop input file: ${filePath}`);
}

export async function writeFStopSessionFile(filePath: string, session: FStopSession): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(session, null, 2)}\n`, "utf8");
}

export function defaultFStopSessionFilePath(
  session: FStopSession,
  directory: string = DEFAULT_FSTOP_SESSION_FILES_DIR,
): string {
  return path.join(directory, `${safeSessionFilename(session.sessionId)}.json`);
}

export async function importFStopSessionFileToBundle(options: {
  filePath: string;
  outputDirectory?: string;
  exportedAt?: string;
  dryRun?: boolean;
}): Promise<{
  session: FStopSession;
  sessionPath: string;
  bundle: ReplaySessionBundle;
  bundlePath: string;
}> {
  const sessionPath = path.resolve(options.filePath);
  const session = await loadFStopSessionFile(sessionPath);
  const bundle = createSessionBundleFromFStopSession(session, {
    ...(options.exportedAt ? { exportedAt: options.exportedAt } : {}),
  });
  const bundlePath = defaultSessionBundlePath(
    bundle,
    options.outputDirectory ?? DEFAULT_FSTOP_SESSION_BUNDLES_DIR,
  );

  if (!options.dryRun) {
    await writeSessionBundle(bundlePath, bundle);
  }

  return {
    session,
    sessionPath,
    bundle,
    bundlePath,
  };
}

export function createReplayScenarioFromFStopSession(session: FStopSession) {
  return createReplayScenarioFromImportedSession(session);
}

export function createSessionBundleFromFStopSession(
  session: FStopSession,
  options: {
    exportedAt?: string;
    source?: FStopSessionSource;
  } = {},
): ReplaySessionBundle {
  return createSessionBundleFromImportedSession(session, options);
}

export function createFStopSessionFromSessionBundle(
  bundle: ReplaySessionBundle,
  options: {
    importedAt?: string;
    source?: FStopSessionSource;
  } = {},
): FStopSession {
  const entries = bundle.steps.map((step, index) => {
    if (step.kind !== "publishSource") {
      throw new Error(
        `F-Stop session conversion only supports publishSource bundles. Received ${step.kind} at step ${index}.`,
      );
    }

    const role = inferFStopSessionRole(step.event, step.label);
    const kind = inferFStopSessionKind(step.event, role);
    const summary = readSourceEventString(step.event, "summary");
    const title = readSourceEventString(step.event, "title");
    const toolFamily = readSourceEventString(step.event, "toolFamily");
    const text = summary ?? title ?? undefined;

    return {
      index,
      timestamp: step.event.timestamp,
      role,
      kind,
      significance: inferFStopSessionSignificance(step.event, kind),
      ...(step.label ? { label: step.label } : {}),
      ...(text ? { text } : {}),
      ...(summary ? { excerpt: summary } : {}),
      ...(toolFamily ? { toolFamily } : {}),
      sourceEvent: step.event,
    } satisfies FStopSessionEntry;
  });

  return {
    schemaVersion: FSTOP_SESSION_SCHEMA_VERSION,
    sessionId: bundle.sessionId,
    title: bundle.title,
    ...(bundle.description !== undefined ? { description: bundle.description } : {}),
    ...(bundle.doctrineTags !== undefined ? { doctrineTags: bundle.doctrineTags } : {}),
    ...((options.source ?? bundle.source) !== undefined ? { source: options.source ?? bundle.source } : {}),
    importedAt: options.importedAt ?? bundle.exportedAt,
    entries,
  };
}

export function validateFStopSession(value: unknown): FStopSession | null {
  if (
    !isRecord(value)
    || value.schemaVersion !== FSTOP_SESSION_SCHEMA_VERSION
    || !hasShape(
      value,
      {
        sessionId: isString,
        title: isString,
        importedAt: isString,
        entries: (entries): entries is FStopSessionEntry[] => (
          Array.isArray(entries) && entries.every((entry) => validateFStopSessionEntry(entry) !== null)
        ),
      },
      {
        traceId: isString,
        description: isString,
        doctrineTags: isStringArray,
        source: validateWith(validateFStopSessionSource),
      },
    )
  ) {
    return null;
  }

  return value as FStopSession;
}

function validateFStopSessionEntry(value: unknown): FStopSessionEntry | null {
  if (
    !isRecord(value)
    || !hasShape(
      value,
      {
        index: isNumber,
        timestamp: isString,
        role: (entry): entry is FStopSessionRole => isString(entry) && SESSION_ROLES.has(entry as FStopSessionRole),
        kind: (entry): entry is FStopSessionKind => isString(entry) && SESSION_KINDS.has(entry as FStopSessionKind),
        significance: (entry): entry is FStopSessionSignificance => (
          isString(entry) && SESSION_SIGNIFICANCE.has(entry as FStopSessionSignificance)
        ),
      },
      {
        entryId: isString,
        parentEntryId: isString,
        toolCallId: isString,
        label: isString,
        text: isString,
        excerpt: isString,
        toolName: isString,
        toolFamily: isString,
        rawRef: validateWith(validateFStopSessionRawReference),
        sourceEvent: validateWith(validateSourceEvent),
      },
    )
  ) {
    return null;
  }

  return value as FStopSessionEntry;
}

function validateFStopSessionRawReference(value: unknown): FStopSessionRawReference | null {
  if (
    !isRecord(value)
    || !hasShape(value, {}, {
      path: isString,
      url: isString,
      line: isNumber,
      messageIndex: isNumber,
      toolUseIndex: isNumber,
      id: isString,
    })
  ) {
    return null;
  }

  return value as FStopSessionRawReference;
}

function validateFStopSessionSource(value: unknown): FStopSessionSource | null {
  if (
    !isRecord(value)
    || !hasShape(
      value,
      { id: isString },
      {
        kind: isString,
        label: isString,
        redacted: isBoolean,
        upstreamUrl: isString,
        rawMirrorPath: isString,
        license: isString,
        contributor: isString,
        capture: validateWith(validateFStopSessionCapture),
      },
    )
  ) {
    return null;
  }

  return value as FStopSessionSource;
}

function validateFStopSessionCapture(value: unknown): FStopSessionSource["capture"] | null {
  if (
    !isRecord(value)
    || !hasShape(value, {}, {
      eventTransport: isString,
      semanticCapture: isString,
      responseBridge: isString,
      notes: isStringArray,
    })
  ) {
    return null;
  }

  return value as FStopSessionSource["capture"];
}

function safeSessionFilename(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
}

function inferFStopSessionRole(
  event: SourceEvent,
  label: string | undefined,
): FStopSessionRole {
  if (event.type === "task.started") {
    return "user";
  }

  if (readSourceEventString(event, "toolFamily") || label?.toLowerCase().includes("tool")) {
    return "tool";
  }

  return "assistant";
}

function inferFStopSessionKind(
  event: SourceEvent,
  role: FStopSessionRole,
): FStopSessionKind {
  if (event.type === "task.started" || event.type === "task.completed") {
    return "boundary";
  }

  if (role === "tool") {
    return "tool_result";
  }

  return "message";
}

function inferFStopSessionSignificance(
  event: SourceEvent,
  kind: FStopSessionKind,
): FStopSessionSignificance {
  const status = readSourceEventString(event, "status");
  if (
    kind === "boundary"
    || status === "failed"
    || status === "blocked"
    || status === "waiting"
    || status === "completed"
  ) {
    return "attention";
  }

  return "context";
}

function readSourceEventString(
  event: SourceEvent,
  key: "summary" | "title" | "toolFamily" | "status",
): string | undefined {
  if (!isRecord(event)) {
    return undefined;
  }

  const value = (event as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}
