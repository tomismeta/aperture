import { createHash } from "node:crypto";
import { ApertureCore, type AttentionSurfaceCapabilities } from "@tomismeta/aperture-core";

import type { OmpAttentionEvent } from "../omp-attention-event.js";
import { projectOmpWorkerSnapshot } from "./omp-projection.js";
import type { NotificationWorkerNavigation, NotificationWorkerSnapshot } from "./protocol.js";
import { projectOmpPresentation } from "./omp-presentation-projection.js";
import { mapOmpDirectEvent } from "./omp-direct-adapter.js";
import { ompCompletionResolutionEvent } from "./omp-completion-resolution.js";
import {
  applyMappedOmpDirectEvent,
  latestOmpDirectRevision,
  OmpDirectCausalityIndex,
} from "./omp-direct-causality.js";
import {
  emptyOmpDirectState,
  loadOmpDirectState,
  saveOmpDirectState,
  type OmpDirectPersistedState,
  type PersistedOmpDirectEntry,
} from "./omp-direct-state-store.js";
import type { ProjectedOmpSessionPresentation } from "./omp-session-presentation.js";

const OMP_SURFACE_CAPABILITIES: AttentionSurfaceCapabilities = {
  topology: { supportsAmbient: true },
  responses: {
    supportsSingleChoice: false,
    supportsMultipleChoice: false,
    supportsForm: false,
    supportsTextResponse: false,
  },
};
const OMP_SOURCES = [{ kind: "omp", label: "OMP" }] as const;

export type OmpWorkerEngineOptions = {
  stateDir: string;
  now?: () => number;
  saveDirectState?: typeof saveOmpDirectState;
};

export type OmpWorkerEngineRestore = {
  engine: OmpWorkerEngine;
  recoveredCorruptState: boolean;
};

export class OmpWorkerEngine {
  private readonly stateDir: string;
  private readonly now: () => number;
  private readonly saveDirectState: typeof saveOmpDirectState;
  private readonly coreClock: { value: number };
  private core: ApertureCore;
  private directState: OmpDirectPersistedState = emptyOmpDirectState();
  private readonly directByKey = new Map<string, PersistedOmpDirectEntry>();
  private readonly directCausality = new OmpDirectCausalityIndex();
  private readonly displayTitleByTaskId = new Map<string, string>();
  private readonly presentationByTaskId = new Map<string, ProjectedOmpSessionPresentation>();
  private readonly navigationByTaskId = new Map<string, NotificationWorkerNavigation>();
  private sequence = 0;

  private constructor(options: OmpWorkerEngineOptions) {
    this.stateDir = options.stateDir;
    this.now = options.now ?? Date.now;
    this.saveDirectState = options.saveDirectState ?? saveOmpDirectState;
    this.coreClock = { value: this.now() };
    this.core = this.createCore();
  }

  static async restore(options: OmpWorkerEngineOptions): Promise<OmpWorkerEngineRestore> {
    const engine = new OmpWorkerEngine(options);
    const direct = await loadOmpDirectState(options.stateDir, engine.now());
    engine.directState = direct.state;
    engine.replayState();
    return { engine, recoveredCorruptState: direct.recoveredCorruptState };
  }

  activeOmpSessionIds(): string[] {
    const latestBySession = new Map<string, string>();
    for (const entry of this.directState.active) {
      const timestamp = latestOmpDirectRevision(entry).occurredAt;
      const previous = latestBySession.get(entry.sessionId);
      if (!previous || previous < timestamp) latestBySession.set(entry.sessionId, timestamp);
    }
    return [...latestBySession]
      .sort(
        ([leftId, leftTimestamp], [rightId, rightTimestamp]) =>
          rightTimestamp.localeCompare(leftTimestamp) || leftId.localeCompare(rightId),
      )
      .map(([sessionId]) => sessionId);
  }

  hasActiveOmpSession(sessionId: string): boolean {
    return this.directState.active.some((entry) => entry.sessionId === sessionId);
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
      let fenceAt =
        previousExpiry && previousExpiry.occurredAt > occurredAt
          ? previousExpiry.occurredAt
          : occurredAt;
      let removed = false;
      candidate.active = candidate.active.filter((entry) => {
        if (entry.sessionId !== sessionId) return true;
        // Lease expiry is monotonic: wall-clock skew must not retain dead attention.
        const revisionAt = latestOmpDirectRevision(entry).occurredAt;
        if (revisionAt > fenceAt) fenceAt = revisionAt;
        nextNavigation.delete(entry.taskId);
        removed = true;
        return false;
      });
      if (!removed && previousExpiry && previousExpiry.occurredAt >= fenceAt) continue;
      candidateCausality.remember(candidate, {
        kind: "session",
        sessionId,
        eventId: `omp-session-lease:${createHash("sha256")
          .update(sessionId)
          .update("\u0000")
          .update(fenceAt)
          .digest("hex")}`,
        occurredAt: fenceAt,
      });
      changed = true;
    }
    if (!changed) return false;
    await this.persistDirect(candidate, nextNavigation, signal);
    return true;
  }

  snapshot(): NotificationWorkerSnapshot {
    this.sequence += 1;
    return projectOmpWorkerSnapshot(
      {
        sources: [...OMP_SOURCES],
        attentionView: projectOmpPresentation(
          this.core.getAttentionView(),
          this.displayTitleByTaskId,
          this.presentationByTaskId,
        ),
        navigationByTaskId: this.navigationByTaskId,
      },
      this.sequence,
    );
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
    const previous = "key" in mapped ? this.directByKey.get(mapped.key) : undefined;
    const result = applyMappedOmpDirectEvent(
      candidate,
      candidateCausality,
      mapped,
      previous,
      nextNavigation,
      navigation,
    );
    if (result === "ignored") return;
    if (result === "navigation-only") {
      if (mapped.kind === "upsert") this.setDirectNavigation(mapped.taskId, navigation);
      return;
    }
    await this.persistDirect(candidate, nextNavigation, signal);
  }

  async resolveOmpCompletionByFocusHandle(
    handle: string,
    occurredAt: string,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const event = ompCompletionResolutionEvent(
      this.directState.active,
      this.navigationByTaskId,
      handle,
      occurredAt,
    );
    if (!event) return false;
    await this.handleOmpAttention(event, undefined, signal);
    return true;
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

  private createCore(): ApertureCore {
    return new ApertureCore({
      surfaceCapabilities: OMP_SURFACE_CAPABILITIES,
      timeSource: () => this.coreClock.value,
    });
  }

  private replayState(
    navigation: ReadonlyMap<string, NotificationWorkerNavigation> = this.navigationByTaskId,
  ): void {
    const volatileNavigation = new Map(navigation);
    this.core = this.createCore();
    this.directByKey.clear();
    this.directCausality.rebuild(this.directState.tombstones);
    this.displayTitleByTaskId.clear();
    this.presentationByTaskId.clear();
    this.navigationByTaskId.clear();
    const replay = this.directState.active
      .flatMap((entry) =>
        entry.revisions.map((revision, index) => ({
          timestamp: revision.occurredAt,
          apply: () => {
            this.core.publishSourceEvent(revision.sourceEvent);
            if (index !== entry.revisions.length - 1) return;
            this.directByKey.set(entry.key, entry);
            this.displayTitleByTaskId.set(entry.taskId, revision.displayTitle);
            this.presentationByTaskId.set(entry.taskId, revision.presentation);
            const retainedNavigation = volatileNavigation.get(entry.taskId);
            if (retainedNavigation) this.navigationByTaskId.set(entry.taskId, retainedNavigation);
          },
        })),
      )
      .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
    for (const entry of replay) {
      this.coreClock.value = Date.parse(entry.timestamp);
      entry.apply();
    }
    this.coreClock.value = this.now();
  }

  private async persistDirect(
    candidate: OmpDirectPersistedState,
    navigation: ReadonlyMap<string, NotificationWorkerNavigation>,
    signal?: AbortSignal,
  ): Promise<void> {
    this.directState = await this.saveDirectState(this.stateDir, candidate, this.now(), signal);
    this.replayState(navigation);
  }

  private setDirectNavigation(
    taskId: string,
    navigation: NotificationWorkerNavigation | undefined,
  ): void {
    if (navigation) this.navigationByTaskId.set(taskId, navigation);
    else this.navigationByTaskId.delete(taskId);
  }
}
