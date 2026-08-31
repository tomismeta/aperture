import {
  ApertureCore,
  type AttentionSignal,
  type AttentionFrame,
  type AttentionSurfaceCapabilities,
  type AttentionView,
  type SourceEvent,
} from "@tomismeta/aperture-core";

import { projectAttentionSurfaceView } from "../surface/projection.js";
import type { ApertureSurfaceSnapshotMessage } from "../surface/protocol.js";
import {
  mapNotificationToSourceEvent,
  NOTIFICATION_PUBLIC_SUMMARY,
  type MappedNotificationEvent,
  type NotificationWorkerIdentity,
} from "./adapter.js";
import type { NotificationClosedInput, NotificationWorkerInput } from "./protocol.js";
import {
  emptyNotificationWorkerState,
  loadNotificationWorkerState,
  notificationWorkerRecordCount,
  saveNotificationWorkerState,
  type NotificationWorkerPersistedState,
  type PersistedActiveNotification,
  type PersistedNotificationRevision,
} from "./state-store.js";

const NOTIFICATION_SURFACE_CAPABILITIES: AttentionSurfaceCapabilities = {
  topology: { supportsAmbient: true },
  responses: {
    supportsSingleChoice: false,
    supportsMultipleChoice: false,
    supportsForm: false,
    supportsTextResponse: false,
  },
};

export type NotificationWorkerEngineOptions = {
  identities: NotificationWorkerIdentity[];
  stateDir: string;
  now?: () => number;
};

export type NotificationWorkerEngineRestore = {
  engine: NotificationWorkerEngine;
  recoveredCorruptState: boolean;
};

export class NotificationWorkerEngine {
  private readonly identities: NotificationWorkerIdentity[];
  private readonly stateDir: string;
  private readonly now: () => number;
  private readonly coreClock: { value: number };
  private core: ApertureCore;
  private state: NotificationWorkerPersistedState;
  private readonly activeByKey = new Map<string, PersistedActiveNotification>();
  private readonly displayTitleByTaskId = new Map<string, string>();
  private sequence = 0;

  private constructor(options: NotificationWorkerEngineOptions) {
    this.identities = [...options.identities];
    this.stateDir = options.stateDir;
    this.now = options.now ?? Date.now;
    this.coreClock = { value: this.now() };
    this.core = this.createCore();
    this.state = emptyNotificationWorkerState();
  }

  static async restore(
    options: NotificationWorkerEngineOptions,
  ): Promise<NotificationWorkerEngineRestore> {
    const engine = new NotificationWorkerEngine(options);
    const loaded = await loadNotificationWorkerState(options.stateDir, engine.now());
    engine.state = loaded.state;
    engine.replayState();
    return { engine, recoveredCorruptState: loaded.recoveredCorruptState };
  }

  getAcceptedSourceCount(): number {
    return this.identities.length;
  }

  snapshot(): ApertureSurfaceSnapshotMessage {
    this.sequence += 1;
    return projectAttentionSurfaceView(
      {
        sources: this.identities.map((identity) => ({
          kind: identity.kind,
          label: identity.label,
        })),
        attentionView: projectNotificationDisplayView(
          this.core.getAttentionView(),
          this.displayTitleByTaskId,
        ),
      },
      this.sequence,
    );
  }

  async handle(input: NotificationWorkerInput): Promise<boolean> {
    if (input.type === "shutdown") return false;
    if (input.type === "notification.closed") {
      await this.closeNotification(input);
      return true;
    }

    const mapped = mapNotificationToSourceEvent(input, this.identities);
    let previous = this.activeByKey.get(input.key);
    if (!mapped) {
      if (previous) await this.removeActive(previous, input.occurredAt, "source identity changed");
      return true;
    }
    if (previous && previous.taskId !== mapped.taskId) {
      await this.removeActive(previous, input.occurredAt, "source identity changed");
      previous = undefined;
    }
    const previousRevision = previous ? latestRevision(previous) : undefined;
    if (
      previousRevision &&
      previousRevision.displayTitle === mapped.displayTitle &&
      JSON.stringify(previousRevision.sourceEvent) === JSON.stringify(mapped.sourceEvent)
    ) {
      return true;
    }

    this.setClock(input.occurredAt);
    this.core.publishSourceEvent(mapped.sourceEvent);
    const active = persistedActive(mapped, previous);
    this.activeByKey.set(input.key, active);
    this.displayTitleByTaskId.set(active.taskId, latestRevision(active).displayTitle);
    const index = this.state.active.findIndex((entry) => entry.key === input.key);
    if (index === -1) this.state.active.push(active);
    else this.state.active[index] = active;
    await this.persist();
    return true;
  }

  private async closeNotification(input: NotificationClosedInput): Promise<void> {
    const active = this.activeByKey.get(input.key);
    if (!active) return;

    this.setClock(input.occurredAt);
    const signal = feedbackSignal(active, input);
    if (signal) {
      this.core.recordSignal(signal);
      this.state.signals.push(signal);
    }
    await this.removeActive(active, input.occurredAt, `notification ${input.reason}`);
  }

  private async removeActive(
    active: PersistedActiveNotification,
    occurredAt: string,
    reason: string,
  ): Promise<void> {
    this.setClock(occurredAt);
    const cancelled: SourceEvent = {
      id: `notification-close:${active.taskId}:${occurredAt}`,
      taskId: active.taskId,
      timestamp: occurredAt,
      type: "task.cancelled",
      reason,
    };
    this.core.publishSourceEvent(cancelled);
    this.activeByKey.delete(active.key);
    this.state.active = this.state.active.filter((entry) => entry.key !== active.key);
    this.displayTitleByTaskId.delete(active.taskId);
    await this.persist(true);
  }

  private createCore(): ApertureCore {
    return new ApertureCore({
      surfaceCapabilities: NOTIFICATION_SURFACE_CAPABILITIES,
      timeSource: () => this.coreClock.value,
    });
  }

  private replayState(): void {
    this.core = this.createCore();
    this.activeByKey.clear();
    this.displayTitleByTaskId.clear();
    const replay = [
      ...this.state.active.flatMap((entry) =>
        entry.revisions.map((revision, index) => ({
          timestamp: revision.occurredAt,
          apply: () => {
            this.core.publishSourceEvent(revision.sourceEvent);
            if (index === entry.revisions.length - 1) {
              this.activeByKey.set(entry.key, entry);
              this.displayTitleByTaskId.set(entry.taskId, revision.displayTitle);
            }
          },
        })),
      ),
      ...this.state.signals.map((signal) => ({
        timestamp: signal.timestamp,
        apply: () => this.core.recordSignal(signal),
      })),
    ].sort((left, right) => left.timestamp.localeCompare(right.timestamp));

    for (const entry of replay) {
      this.setClock(entry.timestamp);
      entry.apply();
    }
    this.coreClock.value = this.now();
  }

  private setClock(timestamp: string): void {
    const value = Date.parse(timestamp);
    this.coreClock.value = Number.isNaN(value) ? this.now() : value;
  }

  private async persist(rebuildCore = false): Promise<void> {
    const recordCount = notificationWorkerRecordCount(this.state);
    this.state = await saveNotificationWorkerState(this.stateDir, this.state, this.now());
    if (rebuildCore || notificationWorkerRecordCount(this.state) !== recordCount) {
      this.replayState();
      return;
    }
    this.activeByKey.clear();
    this.displayTitleByTaskId.clear();
    for (const active of this.state.active) {
      this.activeByKey.set(active.key, active);
      this.displayTitleByTaskId.set(active.taskId, latestRevision(active).displayTitle);
    }
  }
}

function persistedActive(
  mapped: MappedNotificationEvent,
  previous: PersistedActiveNotification | undefined,
): PersistedActiveNotification {
  const revision: PersistedNotificationRevision = {
    occurredAt: mapped.occurredAt,
    displayTitle: mapped.displayTitle,
    sourceEvent: mapped.sourceEvent,
  };
  return {
    key: mapped.key,
    taskId: mapped.taskId,
    interactionId: mapped.interactionId,
    revisions: [...(previous?.revisions ?? []), revision],
  };
}

function latestRevision(active: PersistedActiveNotification): PersistedNotificationRevision {
  const revision = active.revisions.at(-1);
  if (!revision) throw new Error("notification worker active state has no revision");
  return revision;
}

function projectNotificationDisplayView(
  view: AttentionView,
  displayTitleByTaskId: ReadonlyMap<string, string>,
): AttentionView {
  return {
    now: view.now ? projectNotificationDisplayFrame(view.now, displayTitleByTaskId) : null,
    next: view.next.map((frame) => projectNotificationDisplayFrame(frame, displayTitleByTaskId)),
    ambient: view.ambient.map((frame) =>
      projectNotificationDisplayFrame(frame, displayTitleByTaskId),
    ),
  };
}

function projectNotificationDisplayFrame(
  frame: AttentionFrame,
  displayTitleByTaskId: ReadonlyMap<string, string>,
): AttentionFrame {
  const displayTitle = displayTitleByTaskId.get(frame.taskId);
  if (!displayTitle) return frame;
  const { provenance: _provenance, ...withoutProvenance } = frame;
  return {
    ...withoutProvenance,
    title: displayTitle,
    summary: NOTIFICATION_PUBLIC_SUMMARY,
  };
}

function feedbackSignal(
  active: PersistedActiveNotification,
  input: NotificationClosedInput,
): AttentionSignal | null {
  const base = {
    taskId: active.taskId,
    interactionId: active.interactionId,
    timestamp: input.occurredAt,
    surface: "omarchy-notifications",
  };
  switch (input.reason) {
    case "expired":
      return { ...base, kind: "timed_out" };
    case "dismissed":
      return { ...base, kind: "dismissed" };
    case "actioned":
      return { ...base, kind: "responded", responseKind: "acknowledged" };
    case "closed":
    case "unknown":
      return null;
  }
}
