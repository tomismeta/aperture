import type { AttentionFrame } from "@tomismeta/aperture-core";
import type { ApertureRuntimeSnapshot } from "@aperture/runtime";

import {
  APERTURE_SURFACE_LIMITS,
  type ApertureSurfaceContextItem,
  type ApertureSurfaceFrame,
  type ApertureSurfaceSnapshotMessage,
  type ApertureSurfaceSource,
} from "./protocol.js";
import { assertApertureSurfaceMessage } from "./protocol-validator.js";
type AttentionContextItem = NonNullable<NonNullable<AttentionFrame["context"]>["items"]>[number];

export class ApertureSurfaceProjectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApertureSurfaceProjectionError";
  }
}

export function projectSurfaceSnapshot(
  snapshot: ApertureRuntimeSnapshot,
  sequence: number,
): ApertureSurfaceSnapshotMessage {
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new ApertureSurfaceProjectionError(
      "surface snapshot sequence must be a positive integer",
    );
  }

  const projected: ApertureSurfaceSnapshotMessage = {
    type: "snapshot",
    sequence,
    sources: snapshot.adapters.slice(0, APERTURE_SURFACE_LIMITS.sources).map(projectSource),
    totals: {
      now: snapshot.attentionView.now ? 1 : 0,
      next: snapshot.attentionView.next.length,
      ambient: snapshot.attentionView.ambient.length,
      sources: snapshot.adapters.length,
    },
    view: {
      now: snapshot.attentionView.now ? projectFrame(snapshot.attentionView.now) : null,
      next: snapshot.attentionView.next
        .slice(0, APERTURE_SURFACE_LIMITS.nextFrames)
        .map(projectFrame),
      ambient: snapshot.attentionView.ambient
        .slice(0, APERTURE_SURFACE_LIMITS.ambientFrames)
        .map(projectFrame),
    },
  };
  const fitted = fitSurfaceSnapshot(projected);
  try {
    assertApertureSurfaceMessage(fitted);
  } catch (error) {
    throw new ApertureSurfaceProjectionError(
      error instanceof Error ? error.message : "surface snapshot failed schema validation",
    );
  }
  return fitted;
}

function projectSource(source: ApertureRuntimeSnapshot["adapters"][number]): ApertureSurfaceSource {
  return {
    kind: projectSurfaceIdentifier(source.kind, APERTURE_SURFACE_LIMITS.kind, "adapter kind"),
    label:
      optionalDisplayText(source.label, APERTURE_SURFACE_LIMITS.label) ??
      requiredDisplayText(source.kind, APERTURE_SURFACE_LIMITS.label, "adapter label"),
  };
}

function projectFrame(frame: AttentionFrame): ApertureSurfaceFrame {
  const sourceKind =
    frame.source?.kind && frame.source.kind.trim()
      ? projectSurfaceIdentifier(
          frame.source.kind,
          APERTURE_SURFACE_LIMITS.kind,
          "frame source kind",
        )
      : "unknown";
  const source = frame.source
    ? {
        kind: sourceKind,
        label:
          optionalDisplayText(frame.source.label, APERTURE_SURFACE_LIMITS.label) ??
          optionalDisplayText(frame.source.kind, APERTURE_SURFACE_LIMITS.label) ??
          requiredDisplayText(frame.source.id, APERTURE_SURFACE_LIMITS.label, "frame source label"),
      }
    : undefined;
  const summary = optionalDisplayText(frame.summary, APERTURE_SURFACE_LIMITS.summary);
  const context = projectContext(frame);
  const whyNow = optionalDisplayText(frame.provenance?.whyNow, APERTURE_SURFACE_LIMITS.whyNow);

  return {
    id: projectSurfaceIdentifier(frame.id, APERTURE_SURFACE_LIMITS.id, "frame id"),
    taskId: projectSurfaceIdentifier(frame.taskId, APERTURE_SURFACE_LIMITS.id, "frame task id"),
    interactionId: projectSurfaceIdentifier(
      frame.interactionId,
      APERTURE_SURFACE_LIMITS.id,
      "frame interaction id",
    ),
    version: frame.version,
    mode: frame.mode,
    tone: frame.tone,
    consequence: frame.consequence,
    title: requiredDisplayText(frame.title, APERTURE_SURFACE_LIMITS.title, "frame title"),
    ...(summary ? { summary } : {}),
    ...(source ? { source } : {}),
    ...(context ? { context } : {}),
    ...(whyNow ? { provenance: { whyNow } } : {}),
    timing: {
      createdAt: canonicalTimestamp(frame.timing.createdAt, "frame createdAt"),
      updatedAt: canonicalTimestamp(frame.timing.updatedAt, "frame updatedAt"),
      ...(frame.timing.expiresAt
        ? { expiresAt: canonicalTimestamp(frame.timing.expiresAt, "frame expiresAt") }
        : {}),
    },
  };
}

function projectContext(frame: AttentionFrame): ApertureSurfaceFrame["context"] | undefined {
  const stage = optionalDisplayText(frame.context?.stage, APERTURE_SURFACE_LIMITS.label);
  const progress = frame.context?.progress;
  const items = frame.context?.items
    ?.slice(0, APERTURE_SURFACE_LIMITS.contextItems)
    .map(projectContextItem);

  if (!stage && progress === undefined && (!items || items.length === 0)) {
    return undefined;
  }

  return {
    ...(stage ? { stage } : {}),
    ...(typeof progress === "number" && Number.isFinite(progress) ? { progress } : {}),
    ...(items && items.length > 0 ? { items } : {}),
  };
}

function projectContextItem(item: AttentionContextItem): ApertureSurfaceContextItem {
  const value = optionalDisplayText(item.value, APERTURE_SURFACE_LIMITS.contextValue);
  return {
    id: projectSurfaceIdentifier(item.id, APERTURE_SURFACE_LIMITS.id, "context item id"),
    label: requiredDisplayText(item.label, APERTURE_SURFACE_LIMITS.label, "context item label"),
    ...(value ? { value } : {}),
  };
}

export function projectSurfaceIdentifier(value: string, maximum: number, label: string): string {
  if (!value.trim()) {
    throw new ApertureSurfaceProjectionError(`${label} must be non-empty`);
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new ApertureSurfaceProjectionError(`${label} must not contain control characters`);
  }
  if (Array.from(value).length > maximum) {
    throw new ApertureSurfaceProjectionError(`${label} exceeds the surface identifier limit`);
  }
  return value;
}

function requiredDisplayText(value: string, maximum: number, label: string): string {
  const normalized = normalizeDisplayText(value, maximum);
  if (!normalized) {
    throw new ApertureSurfaceProjectionError(`${label} must contain visible text`);
  }
  return normalized;
}

function optionalDisplayText(value: string | undefined, maximum: number): string | undefined {
  return value === undefined ? undefined : normalizeDisplayText(value, maximum) || undefined;
}

function normalizeDisplayText(value: string, maximum: number): string {
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const characters = Array.from(normalized);
  if (characters.length <= maximum) {
    return normalized;
  }
  return `${characters.slice(0, Math.max(0, maximum - 1)).join("")}…`;
}

function canonicalTimestamp(value: string, label: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    throw new ApertureSurfaceProjectionError(`${label} must be a valid timestamp`);
  }
  return new Date(timestamp).toISOString();
}

function fitSurfaceSnapshot(
  snapshot: ApertureSurfaceSnapshotMessage,
): ApertureSurfaceSnapshotMessage {
  const fitted: ApertureSurfaceSnapshotMessage = {
    ...snapshot,
    sources: [],
    view: {
      now: snapshot.view.now,
      next: [],
      ambient: [],
    },
  };
  let bytes = Buffer.byteLength(`${JSON.stringify(fitted)}\n`, "utf8");
  if (bytes > APERTURE_SURFACE_LIMITS.jsonLineBytes) {
    throw new ApertureSurfaceProjectionError(
      "surface Now frame could not fit within the JSONL byte limit",
    );
  }

  const appendPrefix = <T>(target: T[], candidates: T[]): void => {
    for (const candidate of candidates) {
      const separatorBytes = target.length === 0 ? 0 : 1;
      const candidateBytes = Buffer.byteLength(JSON.stringify(candidate), "utf8");
      if (bytes + separatorBytes + candidateBytes > APERTURE_SURFACE_LIMITS.jsonLineBytes) {
        break;
      }
      target.push(candidate);
      bytes += separatorBytes + candidateBytes;
    }
  };

  appendPrefix(fitted.sources, snapshot.sources);
  appendPrefix(fitted.view.next, snapshot.view.next);
  appendPrefix(fitted.view.ambient, snapshot.view.ambient);
  return fitted;
}
