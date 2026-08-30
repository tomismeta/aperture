import type { AttentionFrame } from "@tomismeta/aperture-core";
import type { ApertureRuntimeSnapshot } from "@aperture/runtime";

import {
  APERTURE_SURFACE_LIMITS,
  type ApertureSurfaceContextItem,
  type ApertureSurfaceFrame,
  type ApertureSurfaceSnapshotMessage,
  type ApertureSurfaceSource,
} from "./protocol.js";
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

  return {
    type: "snapshot",
    sequence,
    sources: snapshot.adapters.slice(0, APERTURE_SURFACE_LIMITS.sources).map(projectSource),
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
}

function projectSource(source: ApertureRuntimeSnapshot["adapters"][number]): ApertureSurfaceSource {
  return {
    id: requiredText(source.id, APERTURE_SURFACE_LIMITS.id, "adapter id"),
    kind: requiredText(source.kind, APERTURE_SURFACE_LIMITS.kind, "adapter kind"),
    label: requiredText(
      source.label ?? source.kind,
      APERTURE_SURFACE_LIMITS.label,
      "adapter label",
    ),
  };
}

function projectFrame(frame: AttentionFrame): ApertureSurfaceFrame {
  const source = frame.source
    ? {
        kind: requiredText(
          frame.source.kind ?? "unknown",
          APERTURE_SURFACE_LIMITS.kind,
          "frame source kind",
        ),
        label: requiredText(
          frame.source.label ?? frame.source.kind ?? frame.source.id,
          APERTURE_SURFACE_LIMITS.label,
          "frame source label",
        ),
      }
    : undefined;
  const summary = optionalText(frame.summary, APERTURE_SURFACE_LIMITS.summary);
  const context = projectContext(frame);
  const whyNow = optionalText(frame.provenance?.whyNow, APERTURE_SURFACE_LIMITS.whyNow);

  return {
    id: requiredText(frame.id, APERTURE_SURFACE_LIMITS.id, "frame id"),
    taskId: requiredText(frame.taskId, APERTURE_SURFACE_LIMITS.id, "frame task id"),
    interactionId: requiredText(
      frame.interactionId,
      APERTURE_SURFACE_LIMITS.id,
      "frame interaction id",
    ),
    version: frame.version,
    mode: frame.mode,
    tone: frame.tone,
    consequence: frame.consequence,
    title: requiredText(frame.title, APERTURE_SURFACE_LIMITS.title, "frame title"),
    ...(summary ? { summary } : {}),
    ...(source ? { source } : {}),
    ...(context ? { context } : {}),
    ...(whyNow ? { provenance: { whyNow } } : {}),
    timing: {
      createdAt: frame.timing.createdAt,
      updatedAt: frame.timing.updatedAt,
      ...(frame.timing.expiresAt ? { expiresAt: frame.timing.expiresAt } : {}),
    },
  };
}

function projectContext(frame: AttentionFrame): ApertureSurfaceFrame["context"] | undefined {
  const stage = optionalText(frame.context?.stage, APERTURE_SURFACE_LIMITS.label);
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
  const value = optionalText(item.value, APERTURE_SURFACE_LIMITS.contextValue);
  return {
    id: requiredText(item.id, APERTURE_SURFACE_LIMITS.id, "context item id"),
    label: requiredText(item.label, APERTURE_SURFACE_LIMITS.label, "context item label"),
    ...(value ? { value } : {}),
  };
}

function requiredText(value: string, maximum: number, label: string): string {
  const normalized = normalizeText(value, maximum);
  if (!normalized) {
    throw new ApertureSurfaceProjectionError(`${label} must contain visible text`);
  }
  return normalized;
}

function optionalText(value: string | undefined, maximum: number): string | undefined {
  return value === undefined ? undefined : normalizeText(value, maximum) || undefined;
}

function normalizeText(value: string, maximum: number): string {
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}
