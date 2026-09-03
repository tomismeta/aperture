import {
  ApertureCore,
  type AttentionSignal,
  type AttentionFrame,
  type AttentionSurfaceCapabilities,
  type AttentionView,
  type SourceEvent,
} from "@tomismeta/aperture-core";

import type { OmpAttentionEvent } from "../omp-attention-event.js";
import { projectNotificationWorkerSnapshot } from "./projection.js";
import type { NotificationWorkerNavigation, NotificationWorkerSnapshot } from "./protocol.js";
import {
  mapNotificationToSourceEvent,
  NOTIFICATION_PUBLIC_SUMMARY,
  type MappedNotificationEvent,
  type NotificationWorkerIdentity,
} from "./adapter.js";
import type { NotificationClosedInput, NotificationWorkerInput } from "./protocol.js";
import { mapOmpDirectEvent } from "./omp-direct-adapter.js";
import {
  latestOmpDirectRevision,
  OmpDirectCausalityIndex,
  persistedOmpDirectEntry,
} from "./omp-direct-causality.js";
import {
  emptyOmpDirectState,
  loadOmpDirectState,
  ompDirectRecordCount,
  saveOmpDirectState,
  type OmpDirectPersistedState,
  type PersistedOmpDirectEntry,
} from "./omp-direct-state-store.js";
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
  private directState: OmpDirectPersistedState;
  private readonly directByKey = new Map<string, PersistedOmpDirectEntry>();
  private readonly directCausality = new OmpDirectCausalityIndex();
  private readonly navigationByTaskId = new Map<string, NotificationWorkerNavigation>();
  private readonly notificationTaskIds = new Set<string>();
  private sequence = 0;

  private constructor(options: NotificationWorkerEngineOptions) {
    this.identities = [...options.identities];
    this.stateDir = options.stateDir;
    this.now = options.now ?? Date.now;
    this.coreClock = { value: this.now() };
    this.core = this.createCore();
    this.state = emptyNotificationWorkerState();
    this.directState = emptyOmpDirectState();
  }

  static async restore(
    options: NotificationWorkerEngineOptions,
  ): Promise<NotificationWorkerEngineRestore> {
    const engine = new NotificationWorkerEngine(options);
    const [loaded, direct] = await Promise.all([
      loadNotificationWorkerState(options.stateDir, engine.now()),
      loadOmpDirectState(options.stateDir, engine.now()),
    ]);
    engine.state = loaded.state;
    engine.directState = direct.state;
    engine.replayState();
    return {
      engine,
      recoveredCorruptState: loaded.recoveredCorruptState || direct.recoveredCorruptState,
    };
  }

  getAcceptedSourceCount(): number {
    return this.identities.length;
  }

  snapshot(): NotificationWorkerSnapshot {
    this.sequence += 1;
    return projectNotificationWorkerSnapshot(
      {
        sources: this.identities.map((identity) => ({
          kind: identity.kind,
          label: identity.label,
        })),
        attentionView: projectWorkerDisplayView(
          this.core.getAttentionView(),
          this.displayTitleByTaskId,
          this.notificationTaskIds,
        ),
        navigationByTaskId: this.navigationByTaskId,
      },
      this.sequence,
    );
  }

  async handle(input: NotificationWorkerInput): Promise<boolean> {
    if (input.type === "shutdown") return false;
    if (input.type === "focus.activate") {
      throw new Error("focus activation must be handled by the volatile broker");
    }
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

  async handleOmpAttention(
    event: OmpAttentionEvent,
    navigation?: NotificationWorkerNavigation,
  ): Promise<void> {
    const mapped = mapOmpDirectEvent(event);
    if (mapped.kind === "shutdown") {
      const previousShutdown = this.directCausality.session(mapped.sessionId);
      if (previousShutdown && previousShutdown.occurredAt >= mapped.occurredAt) return;
      const active = this.directState.active.filter(
        (entry) =>
          entry.sessionId === mapped.sessionId &&
          latestOmpDirectRevision(entry).occurredAt <= mapped.occurredAt,
      );
      for (const entry of active) {
        this.cancelDirect(entry, mapped.eventId, mapped.occurredAt, "OMP session shut down");
      }
      this.directCausality.remember(this.directState, {
        kind: "session",
        sessionId: mapped.sessionId,
        eventId: mapped.eventId,
        occurredAt: mapped.occurredAt,
      });
      await this.persistDirect();
      return;
    }

    const previous = this.directByKey.get(mapped.key);
    if (mapped.kind === "resolve") {
      const previousResolution = this.directCausality.interaction(mapped.key);
      if (previousResolution && previousResolution.occurredAt >= mapped.occurredAt) return;
      if (previous && latestOmpDirectRevision(previous).occurredAt <= mapped.occurredAt) {
        this.cancelDirect(previous, mapped.eventId, mapped.occurredAt, "OMP request resolved");
      }
      this.directCausality.remember(this.directState, {
        kind: "interaction",
        key: mapped.key,
        eventId: mapped.eventId,
        occurredAt: mapped.occurredAt,
      });
      await this.persistDirect();
      return;
    }

    const sessionShutdown = this.directCausality.session(mapped.sessionId);
    if (sessionShutdown && sessionShutdown.occurredAt >= mapped.occurredAt) return;
    const interactionResolution = this.directCausality.interaction(mapped.key);
    if (interactionResolution && interactionResolution.occurredAt >= mapped.occurredAt) return;
    const previousRevision = previous ? latestOmpDirectRevision(previous) : undefined;
    if (
      previousRevision &&
      previousRevision.displayTitle === mapped.displayTitle &&
      JSON.stringify(previousRevision.sourceEvent) === JSON.stringify(mapped.sourceEvent)
    ) {
      this.setDirectNavigation(mapped.taskId, navigation);
      return;
    }
    if (previousRevision && previousRevision.occurredAt > mapped.occurredAt) return;

    this.setClock(mapped.occurredAt);
    this.core.publishSourceEvent(mapped.sourceEvent);
    const active = persistedOmpDirectEntry(mapped, previous);
    const index = this.directState.active.findIndex((entry) => entry.key === mapped.key);
    if (index === -1) this.directState.active.push(active);
    else this.directState.active[index] = active;
    await this.persistDirect();
    this.setDirectNavigation(mapped.taskId, navigation);
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

  private cancelDirect(
    active: PersistedOmpDirectEntry,
    eventId: string,
    occurredAt: string,
    reason: string,
  ): void {
    this.setClock(occurredAt);
    this.core.publishSourceEvent({
      id: `${eventId}:${active.taskId}`,
      taskId: active.taskId,
      timestamp: occurredAt,
      type: "task.cancelled",
      reason,
    });
    this.directState.active = this.directState.active.filter((entry) => entry.key !== active.key);
    this.navigationByTaskId.delete(active.taskId);
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
    this.directByKey.clear();
    this.directCausality.rebuild(this.directState.tombstones);
    const replay = [
      ...this.state.active.flatMap((entry) =>
        entry.revisions.map((revision, index) => ({
          timestamp: revision.occurredAt,
          apply: () => {
            this.core.publishSourceEvent(revision.sourceEvent);
            if (index === entry.revisions.length - 1) {
              this.activeByKey.set(entry.key, entry);
              this.notificationTaskIds.add(entry.taskId);
              this.displayTitleByTaskId.set(entry.taskId, revision.displayTitle);
            }
          },
        })),
      ),
      ...this.directState.active.flatMap((entry) =>
        entry.revisions.map((revision, index) => ({
          timestamp: revision.occurredAt,
          apply: () => {
            this.core.publishSourceEvent(revision.sourceEvent);
            if (index === entry.revisions.length - 1) {
              this.directByKey.set(entry.key, entry);
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
    this.rebuildIndexes();
  }

  private async persistDirect(): Promise<void> {
    const recordCount = ompDirectRecordCount(this.directState);
    this.directState = await saveOmpDirectState(this.stateDir, this.directState, this.now());
    if (ompDirectRecordCount(this.directState) !== recordCount) {
      this.replayState();
      return;
    }
    this.rebuildIndexes();
  }

  private rebuildIndexes(): void {
    const volatileNavigation = new Map(this.navigationByTaskId);
    this.activeByKey.clear();
    this.directByKey.clear();
    this.directCausality.rebuild(this.directState.tombstones);
    this.displayTitleByTaskId.clear();
    this.navigationByTaskId.clear();
    this.notificationTaskIds.clear();
    for (const active of this.state.active) {
      this.activeByKey.set(active.key, active);
      this.notificationTaskIds.add(active.taskId);
      this.displayTitleByTaskId.set(active.taskId, latestRevision(active).displayTitle);
    }
    for (const active of this.directState.active) {
      this.directByKey.set(active.key, active);
      this.displayTitleByTaskId.set(active.taskId, latestOmpDirectRevision(active).displayTitle);
      const navigation = volatileNavigation.get(active.taskId);
      if (navigation) this.navigationByTaskId.set(active.taskId, navigation);
    }
  }

  removeFocusHandle(handle: string): boolean {
    let changed = false;
    for (const [taskId, navigation] of this.navigationByTaskId) {
      if (navigation.kind === "opaque-focus" && navigation.handle === handle) {
        this.navigationByTaskId.delete(taskId);
        changed = true;
      }
    }
    return changed;
  }

  private setDirectNavigation(
    taskId: string,
    navigation: NotificationWorkerNavigation | undefined,
  ): void {
    if (navigation) this.navigationByTaskId.set(taskId, navigation);
    else this.navigationByTaskId.delete(taskId);
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

function projectWorkerDisplayView(
  view: AttentionView,
  displayTitleByTaskId: ReadonlyMap<string, string>,
  notificationTaskIds: ReadonlySet<string>,
): AttentionView {
  const project = (frame: AttentionFrame) =>
    projectWorkerDisplayFrame(frame, displayTitleByTaskId, notificationTaskIds);
  return {
    now: view.now ? project(view.now) : null,
    next: view.next.map(project),
    ambient: view.ambient.map(project),
  };
}

function projectWorkerDisplayFrame(
  frame: AttentionFrame,
  displayTitleByTaskId: ReadonlyMap<string, string>,
  notificationTaskIds: ReadonlySet<string>,
): AttentionFrame {
  const displayTitle = displayTitleByTaskId.get(frame.taskId);
  if (!displayTitle) return frame;
  if (!notificationTaskIds.has(frame.taskId)) {
    return { ...frame, title: displayTitle };
  }
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
