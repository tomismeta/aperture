import type { AttentionView, Frame } from "./types.js";

export const DEFAULT_AMBIENT_STALE_MS = 60 * 1000;

export function buildSurfaceAttentionView(
  attentionView: AttentionView,
  options: {
    nowMs?: number;
    ambientStaleMs?: number;
  } = {},
): AttentionView {
  const nowMs = options.nowMs ?? Date.now();
  const ambientStaleMs = options.ambientStaleMs ?? DEFAULT_AMBIENT_STALE_MS;

  return {
    active: attentionView.active,
    queued: attentionView.queued,
    ambient: attentionView.ambient.filter((frame) => !isStalePassiveAmbient(frame, nowMs, ambientStaleMs)),
  };
}

export function sameAttentionView(left: AttentionView, right: AttentionView): boolean {
  return compareFrame(left.active, right.active)
    && compareFrameLists(left.queued, right.queued)
    && compareFrameLists(left.ambient, right.ambient);
}

export function isAttentionViewEmpty(attentionView: AttentionView): boolean {
  return !attentionView.active
    && attentionView.queued.length === 0
    && attentionView.ambient.length === 0;
}

function compareFrame(left: Frame | null, right: Frame | null): boolean {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return left === right;
  }

  return left.interactionId === right.interactionId && left.timing.updatedAt === right.timing.updatedAt;
}

function compareFrameLists(left: Frame[], right: Frame[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let i = 0; i < left.length; i += 1) {
    if (!compareFrame(left[i] ?? null, right[i] ?? null)) {
      return false;
    }
  }

  return true;
}

function isStalePassiveAmbient(frame: Frame, nowMs: number, ambientStaleMs: number): boolean {
  if (frame.mode !== "status" || frame.responseSpec?.kind !== "none") {
    return false;
  }

  const updatedAtMs = Date.parse(frame.timing.updatedAt);
  if (Number.isNaN(updatedAtMs)) {
    return false;
  }

  return Math.max(0, nowMs - updatedAtMs) > ambientStaleMs;
}
