import type { AttentionFrame, AttentionView } from "@tomismeta/aperture-core";
import type { ApertureRuntimeSnapshot } from "@aperture/runtime";

import { createEmptyRuntimeSnapshot } from "../../../runtime/src/runtime-client-shared.js";
import { apertureSurfaceHello, type ApertureSurfaceMessage } from "../../src/surface/protocol.js";
import { projectSurfaceSnapshot } from "../../src/surface/projection.js";

export function canonicalSurfaceFixtures(): Record<string, ApertureSurfaceMessage> {
  return {
    "hello.json": apertureSurfaceHello("0.5.0"),
    "connection-connecting.json": { type: "connection", state: "connecting" },
    "connection-connected.json": {
      type: "connection",
      state: "connected",
      runtimeId: "runtime-1",
      runtimeKind: "aperture",
    },
    "connection-disconnected.json": {
      type: "connection",
      state: "disconnected",
      reason: "runtime_unavailable",
    },
    "error.json": {
      type: "error",
      code: "surface_projection_failed",
      message: "Aperture could not produce a bounded surface snapshot.",
      recoverable: true,
    },
    "snapshot-calm.json": projectSurfaceSnapshot(
      runtimeSnapshot(
        {
          now: null,
          next: [reviewPlanFrame()],
          ambient: [backgroundStatusFrame()],
        },
        [
          { id: "adapter-claude", kind: "claude-code", label: "Claude Code" },
          { id: "adapter-opencode", kind: "opencode", label: "OpenCode" },
        ],
      ),
      1,
    ),
    "snapshot-now.json": projectSurfaceSnapshot(
      runtimeSnapshot(
        {
          now: migrationFrame(),
          next: [retryFrame()],
          ambient: [],
        },
        [
          { id: "adapter-codex", kind: "codex", label: "Codex" },
          { id: "adapter-claude", kind: "claude-code", label: "Claude Code" },
        ],
      ),
      2,
    ),
    "snapshot-minimal.json": projectSurfaceSnapshot(
      runtimeSnapshot(
        {
          now: {
            id: "frame-minimal",
            version: 1,
            taskId: "task-minimal",
            interactionId: "interaction-minimal",
            mode: "status",
            tone: "ambient",
            consequence: "low",
            title: "Minimal projected frame",
            timing: {
              createdAt: "2026-08-30T16:10:00.000Z",
              updatedAt: "2026-08-30T16:10:00.000Z",
            },
          },
          next: [],
          ambient: [],
        },
        [],
      ),
      3,
    ),
  };
}

function runtimeSnapshot(
  attentionView: AttentionView,
  adapters: Array<{ id: string; kind: string; label: string }>,
): ApertureRuntimeSnapshot {
  return {
    ...createEmptyRuntimeSnapshot(),
    version: 1,
    attentionView,
    adapters: adapters.map((adapter) => ({
      ...adapter,
      connectedAt: "2026-08-30T15:00:00.000Z",
      lastSeenAt: "2026-08-30T16:07:00.000Z",
    })),
  };
}

function reviewPlanFrame(): AttentionFrame {
  return {
    id: "frame-review-plan",
    version: 1,
    taskId: "task-review-plan",
    interactionId: "interaction-review-plan",
    mode: "status",
    tone: "ambient",
    consequence: "low",
    title: "Review generated migration plan",
    summary: "The migration plan is ready for later review.",
    source: { id: "claude-code", kind: "claude-code", label: "Claude Code" },
    context: {
      items: [{ id: "project", label: "Project", value: "aperture" }],
    },
    timing: {
      createdAt: "2026-08-30T16:00:00.000Z",
      updatedAt: "2026-08-30T16:01:00.000Z",
    },
  };
}

function backgroundStatusFrame(): AttentionFrame {
  return {
    id: "frame-background-status",
    version: 1,
    taskId: "task-background-status",
    interactionId: "interaction-background-status",
    mode: "status",
    tone: "ambient",
    consequence: "low",
    title: "Adapter fixture completed",
    summary: "Background work completed without requiring attention.",
    source: { id: "opencode", kind: "opencode", label: "OpenCode" },
    context: {
      items: [{ id: "project", label: "Project", value: "codex-adapter" }],
    },
    timing: {
      createdAt: "2026-08-30T15:55:00.000Z",
      updatedAt: "2026-08-30T16:02:00.000Z",
    },
  };
}

function migrationFrame(): AttentionFrame {
  return {
    id: "frame-database-migration",
    version: 2,
    taskId: "task-database-migration",
    interactionId: "interaction-database-migration",
    mode: "approval",
    tone: "focused",
    consequence: "medium",
    title: "Run the local database migration?",
    summary:
      "The agent prepared two migration files and is blocked before applying them to the development database.",
    source: { id: "codex", kind: "codex", label: "Codex" },
    context: {
      items: [
        { id: "project", label: "Project", value: "aperture" },
        { id: "branch", label: "Branch", value: "main" },
      ],
    },
    provenance: {
      whyNow: "Implementation cannot continue until execution is reviewed.",
    },
    timing: {
      createdAt: "2026-08-30T16:05:00.000Z",
      updatedAt: "2026-08-30T16:07:00.000Z",
    },
  };
}

function retryFrame(): AttentionFrame {
  return {
    id: "frame-retry-behavior",
    version: 1,
    taskId: "task-retry-behavior",
    interactionId: "interaction-retry-behavior",
    mode: "status",
    tone: "ambient",
    consequence: "low",
    title: "Confirm retry behavior",
    summary: "A retry decision is queued behind the current interaction.",
    source: { id: "claude-code", kind: "claude-code", label: "Claude Code" },
    context: {
      items: [{ id: "project", label: "Project", value: "runtime" }],
    },
    timing: {
      createdAt: "2026-08-30T16:01:00.000Z",
      updatedAt: "2026-08-30T16:06:00.000Z",
    },
  };
}
