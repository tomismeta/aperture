import { createHash } from "node:crypto";
import {
  ApertureCore,
  type AttentionSurfaceCapabilities,
  type SourceEvent,
} from "@tomismeta/aperture-core";

import type { OmpAttentionEvent } from "../omp-attention-event.js";
import { projectNotificationWorkerSnapshot } from "./projection.js";
import type { NotificationWorkerNavigation, NotificationWorkerSnapshot } from "./protocol.js";
import { mapNotificationToSourceEvent, type NotificationWorkerIdentity } from "./adapter.js";
import type { NotificationClosedInput, NotificationWorkerInput } from "./protocol.js";
import { feedbackSignal, latestRevision, persistedActive } from "./notification-lifecycle.js";
import { projectWorkerDisplayView } from "./notification-projection.js";
import { mapOmpDirectEvent } from "./omp-direct-adapter.js";
import {
  latestOmpDirectRevision,
  OmpDirectCausalityIndex,
  persistedOmpDirectEntry,
} from "./omp-direct-causality.js";
import {
  emptyOmpDirectState,
  loadOmpDirectState,
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
  saveDirectState?: typeof saveOmpDirectState;
};

export type NotificationWorkerEngineRestore = {
  engine: NotificationWorkerEngine;
  recoveredCorruptState: boolean;
};

export class NotificationWorkerEngine {
  private readonly identities: NotificationWorkerIdentity[];
  private readonly stateDir: string;
  private readonly now: () => number;
  private readonly saveDirectState: typeof saveOmpDirectState;
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
    this.saveDirectState = options.saveDirectState ?? saveOmpDirectState;
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

  static async restoreOmpOnly(
    options: NotificationWorkerEngineOptions,
  ): Promise<NotificationWorkerEngineRestore> {
    const engine = new NotificationWorkerEngine(options);
    const direct = await loadOmpDirectState(options.stateDir, engine.now());
    engine.directState = direct.state;
    engine.replayState();
    return {
      engine,
      recoveredCorruptState: direct.recoveredCorruptState,
    };
  }

  getAcceptedSourceCount(): number {
    return this.identities.length;
  }

  activeOmpSessionIds(): string[] {
    const latestBySession = new Map<string, string>();
    for (const entry of this.directState.active) {
      const timestamp = latestOmpDirectRevision(entry).occurredAt;
      const previous = latestBySession.get(entry.sessionId);
      if (!previous || previous < timestamp) {
        latestBySession.set(entry.sessionId, timestamp);
      }
    }
    return [...latestBySession]
      .sort(
        ([leftId, leftTimestamp], [rightId, rightTimestamp]) =>
          rightTimestamp.localeCompare(leftTimestamp) || leftId.localeCompare(rightId),
      )
      .map(([sessionId]) => sessionId);
  }

  async expireOmpSessions(
    sessionIds: readonly string[],
    occurredAt: string,
    signal?: AbortSignal,
  ): Promise<boolean> {
    signal?.throwIfAborted();
    if (sessionIds.length === 0) return false;
    if (Number.isNaN(Date.parse(occurredAt))) {
      throw new Error("Aperture OMP session expiry timestamp was invalid");
    }
    const candidate = structuredClone(this.directState);
    const candidateCausality = new OmpDirectCausalityIndex();
    candidateCausality.rebuild(candidate.tombstones);
    const nextNavigation = new Map(this.navigationByTaskId);
    let changed = false;
    for (const sessionId of new Set(sessionIds)) {
      const previousExpiry = this.directCausality.session(sessionId);
      if (previousExpiry && previousExpiry.occurredAt >= occurredAt) continue;
      candidate.active = candidate.active.filter((entry) => {
        const expired =
          entry.sessionId === sessionId && latestOmpDirectRevision(entry).occurredAt <= occurredAt;
        if (expired) nextNavigation.delete(entry.taskId);
        return !expired;
      });
      candidateCausality.remember(candidate, {
        kind: "session",
        sessionId,
        eventId: `omp-session-lease:${createHash("sha256")
          .update(sessionId)
          .update("\u0000")
          .update(occurredAt)
          .digest("hex")}`,
        occurredAt,
      });
      changed = true;
    }
    if (!changed) return false;
    await this.persistDirect(candidate, nextNavigation, signal);
    return true;
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
    signal?: AbortSignal,
  ): Promise<void> {
    signal?.throwIfAborted();
    const mapped = mapOmpDirectEvent(event);
    const candidate = structuredClone(this.directState);
    const candidateCausality = new OmpDirectCausalityIndex();
    candidateCausality.rebuild(candidate.tombstones);
    const nextNavigation = new Map(this.navigationByTaskId);

    if (mapped.kind === "shutdown") {
      const previousShutdown = this.directCausality.session(mapped.sessionId);
      if (previousShutdown && previousShutdown.occurredAt >= mapped.occurredAt) return;
      candidate.active = candidate.active.filter((entry) => {
        const cancelled =
          entry.sessionId === mapped.sessionId &&
          latestOmpDirectRevision(entry).occurredAt <= mapped.occurredAt;
        if (cancelled) nextNavigation.delete(entry.taskId);
        return !cancelled;
      });
      candidateCausality.remember(candidate, {
        kind: "session",
        sessionId: mapped.sessionId,
        eventId: mapped.eventId,
        occurredAt: mapped.occurredAt,
      });
      await this.persistDirect(candidate, nextNavigation, signal);
      return;
    }

    const previous = this.directByKey.get(mapped.key);
    if (mapped.kind === "resolve") {
      const previousResolution = this.directCausality.interaction(mapped.key);
      if (previousResolution && previousResolution.occurredAt >= mapped.occurredAt) return;
      if (previous && latestOmpDirectRevision(previous).occurredAt <= mapped.occurredAt) {
        candidate.active = candidate.active.filter((entry) => entry.key !== previous.key);
        nextNavigation.delete(previous.taskId);
      }
      candidateCausality.remember(candidate, {
        kind: "interaction",
        key: mapped.key,
        eventId: mapped.eventId,
        occurredAt: mapped.occurredAt,
      });
      await this.persistDirect(candidate, nextNavigation, signal);
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
      signal?.throwIfAborted();
      this.setDirectNavigation(mapped.taskId, navigation);
      return;
    }
    if (previousRevision && previousRevision.occurredAt > mapped.occurredAt) return;

    const active = persistedOmpDirectEntry(mapped, previous);
    const index = candidate.active.findIndex((entry) => entry.key === mapped.key);
    if (index === -1) candidate.active.push(active);
    else candidate.active[index] = active;
    if (navigation) nextNavigation.set(mapped.taskId, navigation);
    else nextNavigation.delete(mapped.taskId);
    await this.persistDirect(candidate, nextNavigation, signal);
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

  private replayState(
    navigation: ReadonlyMap<string, NotificationWorkerNavigation> = this.navigationByTaskId,
  ): void {
    const volatileNavigation = new Map(navigation);
    this.core = this.createCore();
    this.activeByKey.clear();
    this.directByKey.clear();
    this.displayTitleByTaskId.clear();
    this.navigationByTaskId.clear();
    this.notificationTaskIds.clear();
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
              const retainedNavigation = volatileNavigation.get(entry.taskId);
              if (retainedNavigation) {
                this.navigationByTaskId.set(entry.taskId, retainedNavigation);
              }
            }
          },
        })),
      ),
      ...this.state.signals.map((attentionSignal) => ({
        timestamp: attentionSignal.timestamp,
        apply: () => this.core.recordSignal(attentionSignal),
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

  private async persistDirect(
    candidate: OmpDirectPersistedState,
    navigation: ReadonlyMap<string, NotificationWorkerNavigation>,
    signal?: AbortSignal,
  ): Promise<void> {
    const persisted = await this.saveDirectState(this.stateDir, candidate, this.now(), signal);
    this.directState = persisted;
    this.replayState(navigation);
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
